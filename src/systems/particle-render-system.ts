// ParticleRenderSystem - iterates the ParticlePool and submits
// drawParticle calls to the device.
//
// Runs in PHASE_RENDER. Registration order matters: this system
// should be registered AFTER SpriteRenderSystem so particles draw
// on top of sprites (typical "VFX above" layering). Caller can
// reverse the order to put particles UNDER sprites for, say, ground-
// level smoke trails.
//
// Particle draw order is insertion order; the pool's free-list
// recycles slots so the order isn't strictly back-to-front. For
// additive-blended particles this doesn't matter; for alpha-blended
// the visual difference is rarely noticeable at typical particle
// sizes. Phase 4 ships without sort to keep the hot loop tight;
// Phase 5+ may add a sorted-render variant if profiling demands.

import type { System } from '../system.js';
import type { World } from '../world.js';
import { ParticlePool, PARTICLE_FLAG_ALIVE, PARTICLE_FLAG_ADDITIVE } from '../vfx/particle-pool.js';
import {
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
} from '../resources.js';
import type { IGraphicsDevice } from '../renderer/graphics-device.js';
import type { CameraView } from '../renderer/camera.js';
import { POOL_PARTICLE } from './particle-simulation-system.js';

const SCRATCH_COLOR = { r: 1, g: 1, b: 1, a: 1 };

export class ParticleRenderSystem implements System {
  readonly name: string = 'particle-render';

  update(world: World, _dt: number): void {
    const pool = world.getPool<ParticlePool>(POOL_PARTICLE);
    const device = world.resources.get<IGraphicsDevice>(RESOURCE_DEVICE);
    const camera = world.resources.get<CameraView>(RESOURCE_CAMERA);
    if (!pool || !device || !camera) return;
    if (pool.getLiveCount() === 0) return;

    device.setCamera(camera);
    const hwm = pool.getHighWaterMark();

    for (let i = 0; i < hwm; i++) {
      const f = pool.flags[i] ?? 0;
      if ((f & PARTICLE_FLAG_ALIVE) === 0) continue;

      const life = pool.life[i] ?? 0;
      const maxLife = pool.maxLife[i] ?? 1;
      // t = 0 at spawn, t = 1 at death.
      const t = maxLife > 0 ? 1 - life / maxLife : 1;

      const r = (pool.r0[i] ?? 1) + ((pool.r1[i] ?? 1) - (pool.r0[i] ?? 1)) * t;
      const g = (pool.g0[i] ?? 1) + ((pool.g1[i] ?? 1) - (pool.g0[i] ?? 1)) * t;
      const b = (pool.b0[i] ?? 1) + ((pool.b1[i] ?? 1) - (pool.b0[i] ?? 1)) * t;
      const a = (pool.a0[i] ?? 1) + ((pool.a1[i] ?? 0) - (pool.a0[i] ?? 1)) * t;
      const size = (pool.size[i] ?? 4) + ((pool.endSize[i] ?? 4) - (pool.size[i] ?? 4)) * t;

      SCRATCH_COLOR.r = r;
      SCRATCH_COLOR.g = g;
      SCRATCH_COLOR.b = b;
      SCRATCH_COLOR.a = a;

      device.drawParticle(
        pool.x[i] ?? 0,
        pool.y[i] ?? 0,
        pool.z[i] ?? 0,
        size,
        SCRATCH_COLOR,
        (f & PARTICLE_FLAG_ADDITIVE) !== 0,
      );
    }
  }
}
