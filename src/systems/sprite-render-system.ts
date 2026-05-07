// SpriteRenderSystem - iterates entities with both Transform and
// Sprite components and submits drawSprite calls to the device.
//
// This is the first real ECS system in the engine. Everything in
// the demo that previously called device.drawSprite directly now
// goes through here.
//
// v1 sort: simple back-to-front by iso depth key (x + y), with
// per-frame allocation of a sort buffer. Phase 2 keeps this naive;
// optimization (radix sort, persistent buffer) deferred to Phase 4
// when the VFX framework adds many additive sprites that will
// expose any sort cost.

import type { System } from '../system.js';
import type { World } from '../world.js';
import { POOL_TRANSFORM, POOL_SPRITE } from '../world.js';
import { TransformPool, TRANSFORM_FLAG_VISIBLE } from '../components/transform.js';
import { SpritePool, SPRITE_FLAG_ACTIVE, SPRITE_FLAG_TINTED } from '../components/sprite.js';
import {
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
} from '../resources.js';
import type { IGraphicsDevice } from '../renderer/graphics-device.js';
import type { CameraView } from '../renderer/camera.js';

interface SortEntry {
  index: number;
  depth: number;
}

export class SpriteRenderSystem implements System {
  readonly name: string = 'sprite-render';

  // Persistent sort buffer to avoid per-frame allocation. Resized
  // when entity count grows past it.
  private sortBuffer: SortEntry[] = [];

  // Scratch tint object reused across all tinted-sprite draws this
  // frame. Phase 9.1: replaces a per-tinted-sprite allocation with
  // one mutate-and-pass. drawSprite reads ColorRGBA fields by name
  // and does not retain the reference past the call, so reuse is
  // safe and avoids ~N tint-object allocations per frame.
  private scratchTint: { r: number; g: number; b: number; a: number } = {
    r: 1, g: 1, b: 1, a: 1,
  };

  update(world: World, _dt: number): void {
    const transforms = world.getPool<TransformPool>(POOL_TRANSFORM);
    const sprites = world.getPool<SpritePool>(POOL_SPRITE);
    const device = world.resources.get<IGraphicsDevice>(RESOURCE_DEVICE);
    const camera = world.resources.get<CameraView>(RESOURCE_CAMERA);
    if (!transforms || !sprites || !device || !camera) return;

    device.setCamera(camera);

    const hwm = Math.min(transforms.getHighWaterMark(), sprites.getHighWaterMark());

    // Build the sort list - one entry per active sprite with a
    // visible transform. Reuse the buffer; grow only when needed.
    let count = 0;
    while (this.sortBuffer.length < hwm) {
      this.sortBuffer.push({ index: 0, depth: 0 });
    }

    for (let i = 1; i < hwm; i++) {  // index 0 is NULL_ENTITY, skip
      const tFlags = transforms.flags[i] ?? 0;
      const sFlags = sprites.flags[i] ?? 0;
      if ((tFlags & TRANSFORM_FLAG_VISIBLE) === 0) continue;
      if ((sFlags & SPRITE_FLAG_ACTIVE) === 0) continue;
      const x = transforms.x[i] ?? 0;
      const y = transforms.y[i] ?? 0;
      const z = transforms.z[i] ?? 0;
      const entry = this.sortBuffer[count];
      if (!entry) continue;
      entry.index = i;
      // Iso depth key: (x + y) * 1000 + z. Larger = drawn later.
      entry.depth = (x + y) * 1000 + z;
      count++;
    }

    // Insertion sort. For small N (typical Phase 2 demo: dozens of
    // entities), this beats Array.prototype.sort's overhead. When N
    // grows, we'll swap in a radix sort.
    for (let i = 1; i < count; i++) {
      const key = this.sortBuffer[i];
      if (!key) continue;
      let j = i - 1;
      while (j >= 0) {
        const prev = this.sortBuffer[j];
        if (!prev || prev.depth <= key.depth) break;
        this.sortBuffer[j + 1] = prev;
        j--;
      }
      this.sortBuffer[j + 1] = key;
    }

    // Submit in sort order.
    for (let k = 0; k < count; k++) {
      const entry = this.sortBuffer[k];
      if (!entry) continue;
      const i = entry.index;
      const atlas = sprites.atlas[i] ?? -1;
      if (atlas < 0) continue;
      const frame = sprites.frame[i] ?? 0;
      const x = transforms.x[i] ?? 0;
      const y = transforms.y[i] ?? 0;
      const z = transforms.z[i] ?? 0;
      const sFlags = sprites.flags[i] ?? 0;
      if ((sFlags & SPRITE_FLAG_TINTED) !== 0) {
        const tint = this.scratchTint;
        tint.r = sprites.tintR[i] ?? 1;
        tint.g = sprites.tintG[i] ?? 1;
        tint.b = sprites.tintB[i] ?? 1;
        tint.a = sprites.tintA[i] ?? 1;
        device.drawSprite(x, y, z, atlas, frame, tint);
      } else {
        device.drawSprite(x, y, z, atlas, frame);
      }
    }
  }
}
