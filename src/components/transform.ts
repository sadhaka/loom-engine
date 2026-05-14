// TransformPool - the hot component for the Loom Engine ECS.
//
// Structure-of-arrays storage: x, y, z, rotation, scaleX, scaleY in
// separate Float32Arrays so iteration sweeps a contiguous block.
// Cold metadata (parent, flags) in their own arrays.
//
// Inspired by Mike Acton's CppCon 2014 "Data-Oriented Design" talk
// (see PRIOR-ART.md). The premise: a 10k-entity sort step iterates
// through ~80kB of contiguous Float32Array memory rather than
// chasing 10k object pointers.
//
// Capacity grows by 2x on demand. Initial capacity is small to
// keep startup cost tiny; first scene with > 64 entities pays for
// one grow, after that pow-2 sizing absorbs further growth cheaply.

import { growF32, growI32, growU8, nextPow2 } from '../util/typed-arrays.js';
import { type EntityId, entityIndex } from '../entity.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';

// Bitflags packed into the cold flags array.
export const TRANSFORM_FLAG_DIRTY = 1 << 0;       // world matrix needs recompute
export const TRANSFORM_FLAG_VISIBLE = 1 << 1;     // skip render if cleared
export const TRANSFORM_FLAG_STATIC = 1 << 2;      // never moves; cache aggressively
export const TRANSFORM_FLAG_HAS_PARENT = 1 << 3;  // parent slot is meaningful

export class TransformPool implements ISnapshotable {
  // Hot data - touched every frame by render + sort systems.
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  rotation: Float32Array;
  scaleX: Float32Array;
  scaleY: Float32Array;

  // Cold data - rarely touched per-frame.
  parent: Int32Array;     // -1 for root, otherwise parent entity index
  flags: Uint8Array;

  // High-water mark of active indices. Iteration goes up to this,
  // not capacity, so a sparsely-populated pool doesn't waste cycles
  // on empty slots above the live set.
  private highWaterMark: number = 0;
  private capacity: number = 0;

  constructor(initialCapacity: number = 64) {
    this.capacity = nextPow2(initialCapacity);
    this.x = new Float32Array(this.capacity);
    this.y = new Float32Array(this.capacity);
    this.z = new Float32Array(this.capacity);
    this.rotation = new Float32Array(this.capacity);
    this.scaleX = new Float32Array(this.capacity);
    this.scaleY = new Float32Array(this.capacity);
    this.parent = new Int32Array(this.capacity).fill(-1);
    this.flags = new Uint8Array(this.capacity);
  }

  ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    this.x = growF32(this.x, next);
    this.y = growF32(this.y, next);
    this.z = growF32(this.z, next);
    this.rotation = growF32(this.rotation, next);
    this.scaleX = growF32(this.scaleX, next);
    this.scaleY = growF32(this.scaleY, next);
    // -1 is the parent sentinel for "no parent" - new slots default
    // to that.
    const oldParent = this.parent;
    const newParent = new Int32Array(next).fill(-1);
    newParent.set(oldParent);
    this.parent = newParent;
    this.flags = growU8(this.flags, next);
    this.capacity = next;
  }

  // Attach a transform to an entity. Sets sane defaults: scale = 1,
  // visible = true, dirty = true. The dirty flag tells the transform
  // system to recompute any cached world matrix on the next commit.
  attach(e: EntityId, x: number = 0, y: number = 0, z: number = 0): void {
    const i = entityIndex(e);
    this.ensureCapacity(i);
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.rotation[i] = 0;
    this.scaleX[i] = 1;
    this.scaleY[i] = 1;
    this.parent[i] = -1;
    this.flags[i] = TRANSFORM_FLAG_DIRTY | TRANSFORM_FLAG_VISIBLE;
    if (i >= this.highWaterMark) this.highWaterMark = i + 1;
  }

  detach(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.flags[i] = 0;
    // We don't shrink highWaterMark on detach - the slot is just
    // marked invisible. A future tighten() pass could compact, but
    // v1 keeps it simple.
  }

  setPosition(e: EntityId, x: number, y: number, z: number = 0): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    const f = this.flags[i] ?? 0;
    this.flags[i] = f | TRANSFORM_FLAG_DIRTY;
  }

  setScale(e: EntityId, sx: number, sy: number): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.scaleX[i] = sx;
    this.scaleY[i] = sy;
    const f = this.flags[i] ?? 0;
    this.flags[i] = f | TRANSFORM_FLAG_DIRTY;
  }

  setRotation(e: EntityId, radians: number): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.rotation[i] = radians;
    const f = this.flags[i] ?? 0;
    this.flags[i] = f | TRANSFORM_FLAG_DIRTY;
  }

  isVisible(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & TRANSFORM_FLAG_VISIBLE) !== 0;
  }

  setVisible(e: EntityId, visible: boolean): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    const f = this.flags[i] ?? 0;
    this.flags[i] = visible ? f | TRANSFORM_FLAG_VISIBLE : f & ~TRANSFORM_FLAG_VISIBLE;
  }

  getHighWaterMark(): number {
    return this.highWaterMark;
  }

  getCapacity(): number {
    return this.capacity;
  }

  // Clear the dirty bit after the transform-system commit pass. The
  // commit pass walks all dirty entries, recomputes derived state,
  // then calls this.
  clearDirtyAt(index: number): void {
    if (index >= this.capacity) return;
    const f = this.flags[index] ?? 0;
    this.flags[index] = f & ~TRANSFORM_FLAG_DIRTY;
  }

  // --- ISnapshotable: canonical SoA columns [0, highWaterMark). ---

  readonly snapshotKey: string = 'loom.transform-pool';

  snapshotInto(w: SnapshotWriter): void {
    const n = this.highWaterMark;
    w.writeU32(n);
    w.writeF32Slice(this.x, n);
    w.writeF32Slice(this.y, n);
    w.writeF32Slice(this.z, n);
    w.writeF32Slice(this.rotation, n);
    w.writeF32Slice(this.scaleX, n);
    w.writeF32Slice(this.scaleY, n);
    w.writeI32Slice(this.parent, n);
    w.writeU8Slice(this.flags, n);
  }

  restoreFrom(r: SnapshotReader): void {
    const n = r.readU32();
    this.x = r.readF32Slice();
    this.y = r.readF32Slice();
    this.z = r.readF32Slice();
    this.rotation = r.readF32Slice();
    this.scaleX = r.readF32Slice();
    this.scaleY = r.readF32Slice();
    this.parent = r.readI32Slice();
    this.flags = r.readU8Slice();
    this.capacity = n;
    this.highWaterMark = n;
  }
}
