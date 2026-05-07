// AnimationSystem - advances each active AnimationState's elapsedMs
// and writes the resolved frame index back to SpritePool.
//
// Runs in SYSTEM_PHASE_ANIMATION. By the time SpriteRenderSystem
// runs in SYSTEM_PHASE_RENDER, every entity's frame is up-to-date.
//
// Lookup cost per entity: O(clipCount) to find the named clip, then
// O(1) for uniform-fps clips or O(framesInClip) for per-frame
// duration clips. For Phase 3 / typical clips of <16 frames, no
// optimization beyond a linear scan. Phase 4+ may swap in a clip-
// name-to-index hash if profiling exposes hotspots.

import type { System } from '../system.js';
import type { World } from '../world.js';
import { POOL_SPRITE } from '../world.js';
import { SpritePool } from '../components/sprite.js';
import {
  AnimationStatePool,
  ANIMATION_FLAG_ACTIVE,
  ANIMATION_FLAG_FINISHED,
} from '../animation/animation-state-pool.js';
import {
  type AnimationClip,
  frameInClipAt,
  manifestFrameIndex,
  clipDurationMs,
} from '../animation/animation-clip.js';
import { RESOURCE_TIME, type TimeResource } from '../resources.js';

// Conventional pool key. Engine.create registers AnimationStatePool
// under this name; Phase 3 demo + ARPG systems look it up by it.
export const POOL_ANIMATION = 'animation';

// Find a clip by name on a manifest. Linear scan is fine for the
// typical clip count (idle / walk / run / attack / hit / death = ~6).
function findClip(
  clips: ReadonlyArray<AnimationClip>,
  name: string,
): AnimationClip | undefined {
  for (let i = 0; i < clips.length; i++) {
    if (clips[i]?.name === name) return clips[i];
  }
  return undefined;
}

export class AnimationSystem implements System {
  readonly name: string = 'animation';

  update(world: World, dt: number): void {
    const animations = world.getPool<AnimationStatePool>(POOL_ANIMATION);
    const sprites = world.getPool<SpritePool>(POOL_SPRITE);
    if (!animations || !sprites) return;

    // dt is seconds; manifests work in milliseconds.
    const dtMs = dt * 1000;
    const hwm = animations.getHighWaterMark();

    for (let i = 1; i < hwm; i++) {  // index 0 reserved for NULL
      const flags = animations.flags[i] ?? 0;
      if ((flags & ANIMATION_FLAG_ACTIVE) === 0) continue;

      const manifest = animations.manifest[i];
      const clipName = animations.clipName[i] ?? '';
      if (!manifest || !clipName) continue;

      const clip = findClip(manifest.clips, clipName);
      if (!clip) continue;

      const prevElapsed = animations.elapsedMs[i] ?? 0;
      const nextElapsed = prevElapsed + dtMs;

      if (clip.loop) {
        animations.elapsedMs[i] = nextElapsed;
      } else {
        // Non-looping: clamp at total duration so subsequent ticks
        // keep returning the last frame, and set FINISHED once we
        // cross the boundary.
        const total = clipDurationMs(clip, manifest.fps);
        if (nextElapsed >= total && total > 0) {
          animations.elapsedMs[i] = total;
          animations.flags[i] = (flags | ANIMATION_FLAG_FINISHED);
        } else {
          animations.elapsedMs[i] = nextElapsed;
        }
      }

      const frameInClip = frameInClipAt(clip, animations.elapsedMs[i] ?? 0, manifest.fps);
      const sheetFrame = manifestFrameIndex(clip, frameInClip);

      // SpritePool indexes per entity index, same shape; we can
      // write directly without going through setFrame for fewer
      // function calls in the hot loop.
      if (i < sprites.frame.length) {
        sprites.frame[i] = sheetFrame;
      }
    }
  }
}
