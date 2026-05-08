// SpriteBatcher - per-frame instance accumulator for the WebGL2 path.
//
// Pure CPU-side: holds a growable Float32Array of per-instance data
// and tracks the current batch key (atlas + blend mode). submit()
// appends; if the batch key changes it flushes the current run via
// a handler the device wires up at construction. flush() also runs
// from endFrame to drain any pending instances.
//
// 12 floats per instance:
//   [origin.x, origin.y, size.x, size.y,
//    uv0.x, uv0.y, uv1.x, uv1.y,
//    tint.r, tint.g, tint.b, tint.a]
//
// Why: a single drawArraysInstanced call covers the whole batch with
// one CPU->GPU upload of the instance buffer. Atlas swap forces a
// flush because the bound texture changes; blend-mode swap forces a
// flush because gl.blendFunc state changes.
//
// Submission order is preserved within a batch. Higher-level systems
// (SpriteRenderSystem) sort globally before submitting; the batcher
// trusts that order. Subsequent atlas batches reset the order chain
// but never mix across atlases - that is intentional, the cost is
// borne by the consumer (sort by atlas then by depth if global
// ordering across atlases matters).

import type { TextureAtlas } from './texture-atlas.js';

// Two blend modes ship in v1: standard alpha (drawSprite, drawTile,
// drawText) and additive (drawParticle additive=true). Mapping to
// gl.blendFunc happens in the device.
export type BlendMode = 'alpha' | 'add';

export const FLOATS_PER_INSTANCE: number = 12;

// Flush handler signature. Device passes a closure that:
//   1. Binds the atlas texture.
//   2. Sets gl.blendFunc per blendMode.
//   3. Uploads `count * FLOATS_PER_INSTANCE` floats from `data`.
//   4. Calls drawArraysInstanced(TRIANGLES, 0, 6, count).
export type FlushHandler = (
  atlas: TextureAtlas,
  blendMode: BlendMode,
  data: Float32Array,
  count: number,
) => void;

const INITIAL_CAPACITY: number = 1024;

export class SpriteBatcher {
  // Instance data buffer. Grows by doubling when capacity is hit.
  // Backing typed-array stays referentially stable when count is
  // below capacity to avoid per-frame allocation.
  private buffer: Float32Array;
  private capacity: number;

  // Current run state.
  private count: number = 0;
  private currentAtlas: TextureAtlas | null = null;
  private currentBlend: BlendMode = 'alpha';

  // Flush statistics. Reset at beginFrame; surfaced by getStats for
  // tests + diagnostics.
  private flushCount: number = 0;
  private instanceTotal: number = 0;

  private readonly flushHandler: FlushHandler;

  constructor(flushHandler: FlushHandler, initialCapacity: number = INITIAL_CAPACITY) {
    this.flushHandler = flushHandler;
    this.capacity = Math.max(64, initialCapacity);
    this.buffer = new Float32Array(this.capacity * FLOATS_PER_INSTANCE);
  }

  // Reset for a new frame. Counts go to zero; batch state cleared.
  // Flushes any pending instances first as a safety net (endFrame
  // should have done this, but we belt-and-suspenders to keep the
  // device contract clean).
  beginFrame(): void {
    if (this.count > 0 && this.currentAtlas) {
      this.flush();
    }
    this.count = 0;
    this.currentAtlas = null;
    this.currentBlend = 'alpha';
    this.flushCount = 0;
    this.instanceTotal = 0;
  }

  // Submit one instance to the batcher. Triggers flush if the
  // (atlas, blendMode) key differs from the current batch.
  submit(
    atlas: TextureAtlas,
    blendMode: BlendMode,
    originX: number,
    originY: number,
    sizeX: number,
    sizeY: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    tintR: number,
    tintG: number,
    tintB: number,
    tintA: number,
  ): void {
    if (atlas.released) return;

    if (this.currentAtlas !== atlas || this.currentBlend !== blendMode) {
      // Atlas / blend change forces a batch break. Flush the current
      // run before installing the new key.
      if (this.count > 0 && this.currentAtlas) {
        this.flush();
      }
      this.currentAtlas = atlas;
      this.currentBlend = blendMode;
    }

    if (this.count >= this.capacity) {
      this.grow();
    }

    var off = this.count * FLOATS_PER_INSTANCE;
    var b = this.buffer;
    b[off + 0] = originX;
    b[off + 1] = originY;
    b[off + 2] = sizeX;
    b[off + 3] = sizeY;
    b[off + 4] = u0;
    b[off + 5] = v0;
    b[off + 6] = u1;
    b[off + 7] = v1;
    b[off + 8] = tintR;
    b[off + 9] = tintG;
    b[off + 10] = tintB;
    b[off + 11] = tintA;
    this.count++;
  }

  // Flush the current run via the device-supplied handler. No-op if
  // nothing pending or no atlas selected.
  flush(): void {
    if (this.count === 0 || !this.currentAtlas) return;
    var atlas = this.currentAtlas;
    var blend = this.currentBlend;
    var n = this.count;
    this.flushHandler(atlas, blend, this.buffer, n);
    this.flushCount++;
    this.instanceTotal += n;
    this.count = 0;
  }

  // Final drain - call from endFrame to push the last partial batch.
  endFrame(): void {
    if (this.count > 0 && this.currentAtlas) {
      this.flush();
    }
  }

  // Diagnostics. Returned object is owned by the caller; we copy
  // into it to avoid allocating per-frame.
  getStats(out: { flushCount: number; instanceTotal: number; capacity: number }): void {
    out.flushCount = this.flushCount;
    out.instanceTotal = this.instanceTotal;
    out.capacity = this.capacity;
  }

  // Test-only inspection helpers. Not part of the public API but
  // exported so the test file can assert internal state without
  // brittle reflection.
  _peekCount(): number {
    return this.count;
  }
  _peekCurrentAtlas(): TextureAtlas | null {
    return this.currentAtlas;
  }
  _peekCurrentBlend(): BlendMode {
    return this.currentBlend;
  }
  _peekBuffer(): Float32Array {
    return this.buffer;
  }

  // Grow by doubling. Float32Array does not resize in place; we
  // allocate a new buffer and copy the live prefix. Triggered when
  // submit overruns capacity.
  private grow(): void {
    var next = this.capacity * 2;
    var b = new Float32Array(next * FLOATS_PER_INSTANCE);
    b.set(this.buffer.subarray(0, this.count * FLOATS_PER_INSTANCE));
    this.buffer = b;
    this.capacity = next;
  }
}
