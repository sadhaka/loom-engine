// SpritePool - per-entity sprite appearance data.
//
// Companion to TransformPool: an entity that has both Transform
// (position) and Sprite (atlas + frame + tint) gets rendered by
// the SpriteRenderSystem.
//
// Stored as parallel arrays indexed by entity index, mirroring
// TransformPool's structure-of-arrays layout. Atlas + frame are
// tightly packed. Tint is split into rgba arrays so iteration
// stays cache-friendly.

import { growF32, growI32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
import { type EntityId, entityIndex } from '../entity.js';
import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { ColorRGBA } from '../util/color.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';

export const SPRITE_FLAG_ACTIVE = 1 << 0;
export const SPRITE_FLAG_TINTED = 1 << 1;

export class SpritePool implements ISnapshotable {
  // Hot data
  atlas: Int32Array;        // -1 = no sprite assigned (pair with flags ACTIVE bit)
  frame: Int32Array;
  tintR: Float32Array;
  tintG: Float32Array;
  tintB: Float32Array;
  tintA: Float32Array;

  // Cold data
  flags: Uint8Array;

  private highWaterMark: number = 0;
  private capacity: number = 0;

  constructor(initialCapacity: number = 64) {
    this.capacity = nextPow2(initialCapacity);
    this.atlas = new Int32Array(this.capacity).fill(-1);
    this.frame = new Int32Array(this.capacity);
    this.tintR = new Float32Array(this.capacity);
    this.tintG = new Float32Array(this.capacity);
    this.tintB = new Float32Array(this.capacity);
    this.tintA = new Float32Array(this.capacity);
    this.flags = new Uint8Array(this.capacity);
  }

  ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    const newAtlas = new Int32Array(next).fill(-1);
    newAtlas.set(this.atlas);
    this.atlas = newAtlas;
    this.frame = growI32(this.frame, next);
    this.tintR = growF32(this.tintR, next);
    this.tintG = growF32(this.tintG, next);
    this.tintB = growF32(this.tintB, next);
    this.tintA = growF32(this.tintA, next);
    this.flags = growU8(this.flags, next);
    this.capacity = next;
  }

  attach(
    e: EntityId,
    atlas: AtlasHandle,
    frame: number = 0,
    tint?: Readonly<ColorRGBA>,
  ): void {
    const i = entityIndex(e);
    this.ensureCapacity(i);
    this.atlas[i] = atlas;
    this.frame[i] = frame;
    if (tint) {
      this.tintR[i] = tint.r;
      this.tintG[i] = tint.g;
      this.tintB[i] = tint.b;
      this.tintA[i] = tint.a;
      this.flags[i] = SPRITE_FLAG_ACTIVE | SPRITE_FLAG_TINTED;
    } else {
      this.tintR[i] = 1;
      this.tintG[i] = 1;
      this.tintB[i] = 1;
      this.tintA[i] = 1;
      this.flags[i] = SPRITE_FLAG_ACTIVE;
    }
    if (i >= this.highWaterMark) this.highWaterMark = i + 1;
  }

  detach(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.atlas[i] = -1;
    this.flags[i] = 0;
  }

  setFrame(e: EntityId, frame: number): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.frame[i] = frame;
  }

  setTint(e: EntityId, tint: Readonly<ColorRGBA>): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.tintR[i] = tint.r;
    this.tintG[i] = tint.g;
    this.tintB[i] = tint.b;
    this.tintA[i] = tint.a;
    const f = this.flags[i] ?? 0;
    this.flags[i] = f | SPRITE_FLAG_TINTED;
  }

  clearTint(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.tintR[i] = 1;
    this.tintG[i] = 1;
    this.tintB[i] = 1;
    this.tintA[i] = 1;
    const f = this.flags[i] ?? 0;
    this.flags[i] = f & ~SPRITE_FLAG_TINTED;
  }

  isActive(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & SPRITE_FLAG_ACTIVE) !== 0;
  }

  getHighWaterMark(): number {
    return this.highWaterMark;
  }

  getCapacity(): number {
    return this.capacity;
  }

  // Lower highWaterMark past trailing detached slots. SPRITE_FLAG_-
  // ACTIVE is set by attach and cleared only by detach, so a zero
  // flags byte marks a free slot.
  tighten(): void {
    this.highWaterMark = tightenHighWaterMark(this.flags, this.highWaterMark);
  }

  // --- ISnapshotable: canonical SoA columns [0, highWaterMark). ---

  readonly snapshotKey: string = 'loom.sprite-pool';

  snapshotInto(w: SnapshotWriter): void {
    const n = this.highWaterMark;
    w.writeU32(n);
    w.writeI32Slice(this.atlas, n);
    w.writeI32Slice(this.frame, n);
    w.writeF32Slice(this.tintR, n);
    w.writeF32Slice(this.tintG, n);
    w.writeF32Slice(this.tintB, n);
    w.writeF32Slice(this.tintA, n);
    w.writeU8Slice(this.flags, n);
  }

  restoreFrom(r: SnapshotReader): void {
    const n = r.readU32();
    this.atlas = r.readI32Slice();
    this.frame = r.readI32Slice();
    this.tintR = r.readF32Slice();
    this.tintG = r.readF32Slice();
    this.tintB = r.readF32Slice();
    this.tintA = r.readF32Slice();
    this.flags = r.readU8Slice();
    this.capacity = n;
    this.highWaterMark = n;
  }
}
