// Loom Engine - EntityAllocator model-based fuzzer.
//
// Runs random create / destroy / destroyByLiveIndex sequences against
// the real EntityAllocator and a slow, obviously-correct reference
// model in lockstep. After every operation it asserts the allocator's
// observable state matches the model, plus the structural invariants
// the Trinity dossier calls out for the allocator:
//
//   - no duplicate free-list entries: a freed index is never handed
//     out by create() while it is still live. The model catches this
//     as a "double-alloc" - create() returning an index the model
//     still has marked alive.
//   - no stale-handle validation: a handle from a previous tenant of
//     a recycled slot never passes isAlive(), and destroy() never
//     resurrects / double-frees through it.
//   - count() and capacity() always agree with the model.
//   - generation bookkeeping (8-bit, wraps at 256) is followed
//     exactly through any recycle sequence.
//
// Why model-based: the allocator's free list + per-slot generation +
// alive bitmap is exactly the kind of stateful bookkeeping where a
// hand-written example test misses the one operation ordering that
// corrupts the free list. A random walk checked against a reference
// model that *cannot* have those bugs - it is a plain Map, no free
// list, no typed arrays - surfaces divergence on the first bad op,
// with the iteration index and handle in the assertion message.
//
// Not covered: 24-bit index-space exhaustion. Reaching it needs ~16M
// fresh allocations with zero recycling; that is not a unit-scale
// scenario. The fuzzer instead keeps a healthy live population and
// recycles hard, which is what stresses the generation + free-list
// paths that actually changed.

import { strict as assert } from 'node:assert';
import {
  EntityAllocator,
  entityIndex,
  entityGeneration,
  makeEntity,
  NULL_ENTITY,
  type EntityId,
  type IEntropy,
} from '../../src/index.js';

// Per-slot reference state. A slot becomes "known" the first time it
// is fresh-allocated; from then on it is either alive or free, and
// carries the generation the allocator should report for it.
interface ModelSlot {
  generation: number;   // 8-bit, wraps at 256
  alive: boolean;
}

// The reference model. Deliberately a plain Map plus a monotonic
// counter - no free list, no typed arrays - so it cannot reproduce
// the allocator's potential free-list / generation bugs. It is the
// oracle: the allocator is correct iff it agrees with this on every
// observable.
export class AllocatorModel {
  readonly slots: Map<number, ModelSlot> = new Map();
  // Next never-used index. Mirrors EntityAllocator.capacity().
  freshNext: number = 1;

  liveCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.alive) n++;
    return n;
  }

  // Record + validate a create() result from the real allocator. The
  // model does not choose the index - it observes what create()
  // returned and asserts the choice was legal.
  observeCreate(handle: EntityId): void {
    const idx = entityIndex(handle);
    const gen = entityGeneration(handle);
    assert.notEqual(idx, 0, 'create() must never return the reserved index 0');
    const existing = this.slots.get(idx);
    if (existing === undefined) {
      // Fresh allocation: must be exactly the next fresh index, and a
      // never-used slot hands out generation 0.
      assert.equal(idx, this.freshNext,
        'create() returned unknown index ' + idx + ', expected fresh index ' + this.freshNext);
      assert.equal(gen, 0,
        'create() handed out generation ' + gen + ' for a never-used slot ' + idx);
      this.slots.set(idx, { generation: 0, alive: true });
      this.freshNext++;
    } else {
      // Recycled free index: it must currently be free, and the
      // generation must match what the slot was bumped to on destroy.
      assert.equal(existing.alive, false,
        'create() returned index ' + idx + ' that is still alive - '
        + 'duplicate free-list entry / double allocation');
      assert.equal(gen, existing.generation,
        'create() returned generation ' + gen + ' for recycled slot ' + idx
        + ', model expected ' + existing.generation);
      existing.alive = true;
    }
  }

  // What destroy(handle) should return, given the current model state.
  predictDestroy(handle: EntityId): boolean {
    const idx = entityIndex(handle);
    if (idx === 0 || idx >= this.freshNext) return false;
    const s = this.slots.get(idx);
    if (s === undefined || !s.alive) return false;
    return s.generation === entityGeneration(handle);
  }

  applyDestroy(handle: EntityId): void {
    const s = this.slots.get(entityIndex(handle));
    assert.ok(s !== undefined, 'applyDestroy on an unknown slot');
    s.alive = false;
    s.generation = (s.generation + 1) & 0xff;
  }

  // What destroyByLiveIndex(index) should return. No handle, so no
  // generation check - only the alive bitmap gates it.
  predictDestroyByLiveIndex(idx: number): boolean {
    if (idx === 0 || idx >= this.freshNext) return false;
    const s = this.slots.get(idx);
    if (s === undefined) return false;
    return s.alive;
  }

  applyDestroyByLiveIndex(idx: number): void {
    const s = this.slots.get(idx);
    assert.ok(s !== undefined, 'applyDestroyByLiveIndex on an unknown slot');
    s.alive = false;
    s.generation = (s.generation + 1) & 0xff;
  }

  // The handle entityAt(idx) should return: the live canonical handle
  // for the slot, or NULL_ENTITY if the slot is out of range or dead.
  expectedEntityAt(idx: number): EntityId {
    if (idx === 0 || idx >= this.freshNext) return NULL_ENTITY;
    const s = this.slots.get(idx);
    if (s === undefined || !s.alive) return NULL_ENTITY;
    return makeEntity(idx, s.generation);
  }

  // Whether isAlive(handle) should return true.
  expectedIsAlive(handle: EntityId): boolean {
    const idx = entityIndex(handle);
    if (idx === 0 || idx >= this.freshNext) return false;
    const s = this.slots.get(idx);
    if (s === undefined || !s.alive) return false;
    return s.generation === entityGeneration(handle);
  }
}

export interface AllocatorFuzzResult {
  iterations: number;
  creates: number;
  destroys: number;
  destroyByIndex: number;
  staleProbes: number;       // stale-handle destroy() probes that were rejected
  staleSweepChecks: number;  // total stale-handle isAlive/entityAt assertions
  maxLiveCount: number;
  finalLiveCount: number;
  finalCapacity: number;
}

// Population band - the fuzzer keeps the live count inside this range
// so there is sustained recycling pressure (free list never starves,
// never trivially empty) without unbounded growth.
const POP_LOW = 48;
const POP_HIGH = 192;
// Bounded ring of recently-freed handles. The per-iteration sweep
// probes every one of these against the model, so the cost is capped.
const STALE_RING_CAP = 128;

// Run `iterations` random allocator operations against a fresh
// EntityAllocator + reference model in lockstep. Every operation and
// every per-iteration invariant is asserted internally, so a buggy
// allocator throws here (with the failing iteration + handle in the
// message). The returned struct is only for the caller to sanity-
// check that the run actually exercised every op kind.
export function fuzzEntityAllocator(
  iterations: number,
  entropy: IEntropy,
): AllocatorFuzzResult {
  const alloc = new EntityAllocator();
  const model = new AllocatorModel();

  // Handles we currently hold and believe are live.
  const liveHandles: EntityId[] = [];
  // Bounded ring of handles whose slot we have since freed. Probing
  // isAlive on these is the core "no stale-handle validation" check.
  const staleRing: EntityId[] = [];

  function pushStale(h: EntityId): void {
    staleRing.push(h);
    if (staleRing.length > STALE_RING_CAP) staleRing.shift();
  }

  let creates = 0;
  let destroys = 0;
  let destroyByIndex = 0;
  let staleProbes = 0;
  let staleSweepChecks = 0;
  let maxLiveCount = 0;

  for (let i = 0; i < iterations; i++) {
    const pop = liveHandles.length;
    const roll = entropy.int(0, 99);

    if (roll < 20 && staleRing.length > 0) {
      // Stale-handle destroy probe: a handle whose slot we already
      // freed must not destroy again (no double-free, no
      // resurrection). The rare 8-bit generation-wrap case - the slot
      // recycled back to this exact generation - is left to the
      // per-iteration sweep below; predictDestroy tells us when we
      // are in it so we do not mutate state we cannot cleanly track.
      const h = staleRing[entropy.int(0, staleRing.length - 1)]!;
      if (!model.predictDestroy(h)) {
        assert.equal(alloc.destroy(h), false,
          'stale handle ' + h + ' destroyed at iteration ' + i
          + ' - allocator resurrected or double-freed a recycled slot');
        staleProbes++;
      }
    } else if (pop <= POP_LOW || (pop < POP_HIGH && roll < 65)) {
      // Create - forced at/below the low-water mark, the common op
      // otherwise.
      const h = alloc.create();
      model.observeCreate(h);
      liveHandles.push(h);
      creates++;
    } else if (pop > 0) {
      // Destroy a random held handle - half by handle, half by raw
      // index - and retire it to the stale ring.
      const pick = entropy.int(0, liveHandles.length - 1);
      const h = liveHandles[pick]!;
      if (entropy.int(0, 1) === 0) {
        const expected = model.predictDestroy(h);
        const actual = alloc.destroy(h);
        assert.equal(actual, expected,
          'destroy(' + h + ') returned ' + actual + ', model expected '
          + expected + ' at iteration ' + i);
        assert.equal(actual, true, 'a held live handle must destroy successfully');
        model.applyDestroy(h);
        destroys++;
      } else {
        const idx = entityIndex(h);
        const expected = model.predictDestroyByLiveIndex(idx);
        const actual = alloc.destroyByLiveIndex(idx);
        assert.equal(actual, expected,
          'destroyByLiveIndex(' + idx + ') returned ' + actual + ', model expected '
          + expected + ' at iteration ' + i);
        assert.equal(actual, true, 'a live slot index must destroy successfully');
        model.applyDestroyByLiveIndex(idx);
        destroyByIndex++;
      }
      liveHandles.splice(pick, 1);
      pushStale(h);
    } else {
      // Safety net: population is empty and we did not take the
      // create branch. Create so the walk continues.
      const h = alloc.create();
      model.observeCreate(h);
      liveHandles.push(h);
      creates++;
    }

    // ---- per-iteration invariant sweep ----

    // Aggregate counters must always agree with the model.
    assert.equal(alloc.count(), model.liveCount(),
      'count() disagreement at iteration ' + i);
    assert.equal(alloc.capacity(), model.freshNext,
      'capacity() disagreement at iteration ' + i);

    // Every handle we hold validates, and entityAt round-trips it.
    for (let k = 0; k < liveHandles.length; k++) {
      const h = liveHandles[k]!;
      assert.equal(alloc.isAlive(h), true,
        'held handle ' + h + ' not alive at iteration ' + i);
      assert.equal(alloc.entityAt(entityIndex(h)), h,
        'entityAt(' + entityIndex(h) + ') did not round-trip held handle '
        + h + ' at iteration ' + i);
    }

    // Every stale handle agrees with the model: rejected unless its
    // slot has been recycled back to the same generation (the model
    // is the oracle either way). entityAt must reflect the slot's
    // *current* tenant, never the stale handle.
    for (let k = 0; k < staleRing.length; k++) {
      const h = staleRing[k]!;
      staleSweepChecks++;
      assert.equal(alloc.isAlive(h), model.expectedIsAlive(h),
        'stale-handle isAlive(' + h + ') disagreement at iteration ' + i);
      assert.equal(alloc.entityAt(entityIndex(h)), model.expectedEntityAt(entityIndex(h)),
        'entityAt(' + entityIndex(h) + ') disagreement at iteration ' + i);
    }

    const lc = model.liveCount();
    if (lc > maxLiveCount) maxLiveCount = lc;
  }

  return {
    iterations,
    creates,
    destroys,
    destroyByIndex,
    staleProbes,
    staleSweepChecks,
    maxLiveCount,
    finalLiveCount: model.liveCount(),
    finalCapacity: model.freshNext,
  };
}
