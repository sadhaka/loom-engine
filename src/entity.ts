// Entity allocator for the Loom Engine ECS.
//
// An entity is a 32-bit handle: high 8 bits = generation, low 24
// bits = index. The generation guards against use-after-free: when
// an entity is destroyed and its index is recycled, the generation
// bumps so old handles fail validation.
//
// Two destroy paths exist by design:
//   - destroy(EntityId): for callers holding a stored handle. The
//     handle generation is validated against the slot's live
//     generation, so a stale handle from a previous tenant of the
//     slot is rejected.
//   - destroyByLiveIndex(index): for systems sweeping a component
//     pool by dense index that have already proven the slot live
//     via that pool's own ACTIVE flag. There is no handle to
//     generation-check, so the per-slot `alive` bitmap is the guard
//     against a double-destroy corrupting the free list.
//
// Systems that need a real EntityId for a pool index they are
// iterating must call entityAt(index) - never makeEntity(index, 0).
// A literal 0 generation only matches a slot on its first
// allocation; once the slot recycles, makeEntity(i, 0) silently
// fails every generation check. entityAt reads the slot's live
// generation, so the handle it returns always validates.
//
// Inspired by the standard ECS sparse-set pattern (see PRIOR-ART.md
// EnTT entry). Re-implemented from scratch.

import type {
  ISnapshotable,
  SnapshotWriter,
  SnapshotReader,
} from './runtime/state-snapshot.js';

export type EntityId = number;

export const NULL_ENTITY: EntityId = 0;
const INDEX_MASK = 0x00ffffff;
const GENERATION_SHIFT = 24;
const GENERATION_MASK = 0xff;

export function entityIndex(e: EntityId): number {
  return e & INDEX_MASK;
}

export function entityGeneration(e: EntityId): number {
  return (e >>> GENERATION_SHIFT) & GENERATION_MASK;
}

export function makeEntity(index: number, generation: number): EntityId {
  return ((generation & GENERATION_MASK) << GENERATION_SHIFT) | (index & INDEX_MASK);
}

export class EntityAllocator implements ISnapshotable {
  // Generation array indexed by entity index. Index 0 is reserved
  // for NULL_ENTITY so live indices start at 1.
  private generations: Uint8Array = new Uint8Array(64);
  // Per-slot alive bitmap, parallel to `generations`. 1 = the slot
  // is currently allocated; 0 = free (never used, or destroyed and
  // waiting on the free list). destroyByLiveIndex has no handle to
  // generation-check, so this bit is the only guard that stops a
  // double-destroy from pushing the same index onto the free list
  // twice.
  private alive: Uint8Array = new Uint8Array(64);
  private freeList: number[] = [];
  // Next never-used index. Always >= 1.
  private nextFresh: number = 1;
  private liveCount: number = 0;

  create(): EntityId {
    let index: number;
    const recycled = this.freeList.pop();
    if (recycled !== undefined) {
      index = recycled;
    } else {
      index = this.nextFresh++;
      if (index >= this.generations.length) {
        const nextLen = index * 2;
        const nextGen = new Uint8Array(nextLen);
        nextGen.set(this.generations);
        this.generations = nextGen;
        const nextAlive = new Uint8Array(nextLen);
        nextAlive.set(this.alive);
        this.alive = nextAlive;
      }
    }
    this.alive[index] = 1;
    this.liveCount++;
    const gen = this.generations[index] ?? 0;
    return makeEntity(index, gen);
  }

  destroy(e: EntityId): boolean {
    const index = entityIndex(e);
    const gen = entityGeneration(e);
    if (index === 0 || index >= this.nextFresh) return false;
    if ((this.alive[index] ?? 0) === 0) return false;   // already destroyed
    const currentGen = this.generations[index] ?? 0;
    if (currentGen !== gen) return false;          // stale handle
    this.alive[index] = 0;
    this.generations[index] = (currentGen + 1) & GENERATION_MASK;
    this.freeList.push(index);
    this.liveCount--;
    return true;
  }

  // Destroy a slot by raw pool index. For systems that sweep a
  // component pool by dense index and have already confirmed the
  // slot is live via that pool's ACTIVE flag (DamageSystem clearing
  // dead entities, etc). There is no handle to generation-check, so
  // the `alive` bitmap is the guard: a second call on the same index
  // returns false instead of corrupting the free list.
  //
  // Use this instead of destroy(makeEntity(i, 0)) - a 0-generation
  // handle only matches a slot on its first life and silently fails
  // to destroy a recycled slot, leaking it permanently.
  destroyByLiveIndex(index: number): boolean {
    if (index === 0 || index >= this.nextFresh) return false;
    if ((this.alive[index] ?? 0) === 0) return false;
    this.alive[index] = 0;
    const currentGen = this.generations[index] ?? 0;
    this.generations[index] = (currentGen + 1) & GENERATION_MASK;
    this.freeList.push(index);
    this.liveCount--;
    return true;
  }

  isAlive(e: EntityId): boolean {
    const index = entityIndex(e);
    if (index === 0 || index >= this.nextFresh) return false;
    if ((this.alive[index] ?? 0) === 0) return false;
    return (this.generations[index] ?? 0) === entityGeneration(e);
  }

  // The canonical live EntityId for a pool index. Safe replacement
  // for makeEntity(index, 0): it reads the slot's live generation so
  // the returned handle always validates against the allocator.
  // Returns NULL_ENTITY for an out-of-range or dead slot, so a
  // caller that forwards the result to a generation-checked API
  // fails closed instead of acting on a stale slot.
  entityAt(index: number): EntityId {
    if (index === 0 || index >= this.nextFresh) return NULL_ENTITY;
    if ((this.alive[index] ?? 0) === 0) return NULL_ENTITY;
    return makeEntity(index, this.generations[index] ?? 0);
  }

  count(): number {
    return this.liveCount;
  }

  // Highest live entity index + 1. Used by component pools to size
  // their backing arrays.
  capacity(): number {
    return this.nextFresh;
  }

  // Lower nextFresh past trailing free slots so capacity() stops
  // reporting dead address space after a create/destroy spike:
  // component pools size their backing arrays to capacity() and
  // index-sweeping systems iterate [0, capacity()). This is the
  // dossier's P2 "high-water marks never shrink" finding applied to
  // the allocator's own high-water mark.
  //
  // Every slot walked past is reset to generation 0 - its
  // never-allocated state. snapshotInto serializes only
  // [0, nextFresh) on the invariant that slots above it look
  // pristine, and the destroy-bumped generation is not needed for
  // stale-handle safety once a slot is past nextFresh: isAlive's
  // index >= nextFresh bounds check already rejects every handle to
  // it. Zeroing keeps that invariant true, so a tightened allocator
  // round-trips through a snapshot unchanged.
  //
  // Free-list entries at or above the new nextFresh are dropped -
  // those indices no longer exist in the live range, so create()
  // must not recycle them. liveCount is untouched; the reclaimed
  // slots were already destroyed. O(trailing free slots): a
  // maintenance pass, not a per-tick call.
  tighten(): void {
    let h = this.nextFresh;
    // Index 0 is reserved for NULL_ENTITY, so nextFresh never drops
    // below 1 even when every live entity has been destroyed.
    while (h > 1 && (this.alive[h - 1] ?? 0) === 0) {
      h--;
      this.generations[h] = 0;
    }
    this.nextFresh = h;
    let w = 0;
    for (let r = 0; r < this.freeList.length; r++) {
      const slot = this.freeList[r] ?? 0;
      if (slot < h) this.freeList[w++] = slot;
    }
    this.freeList.length = w;
  }

  // --- ISnapshotable: canonical binary state for determinism
  // hashing and rewind/restore. ---

  readonly snapshotKey: string = 'loom.entity-allocator';

  snapshotInto(w: SnapshotWriter): void {
    w.writeU32(this.nextFresh);
    w.writeU32(this.liveCount);
    // Only the meaningful prefix [0, nextFresh) of each parallel
    // array - indices >= nextFresh have never been allocated.
    w.writeU8Slice(this.generations, this.nextFresh);
    w.writeU8Slice(this.alive, this.nextFresh);
    // The free list is the recycle stack: its order decides which
    // index the next create() hands out, so it is deterministic
    // state, not a cache.
    w.writeU32(this.freeList.length);
    for (let i = 0; i < this.freeList.length; i++) {
      w.writeU32(this.freeList[i] ?? 0);
    }
  }

  restoreFrom(r: SnapshotReader): void {
    this.nextFresh = r.readU32();
    this.liveCount = r.readU32();
    const gens = r.readU8Slice();
    const alive = r.readU8Slice();
    // Size the backing arrays to at least the constructor's initial
    // capacity so a restored-then-grown allocator does not reallocate
    // on its first fresh create().
    const cap = this.nextFresh > 64 ? this.nextFresh : 64;
    this.generations = new Uint8Array(cap);
    this.generations.set(gens);
    this.alive = new Uint8Array(cap);
    this.alive.set(alive);
    const freeCount = r.readU32();
    const free: number[] = [];
    for (let i = 0; i < freeCount; i++) {
      free.push(r.readU32());
    }
    this.freeList = free;
  }
}
