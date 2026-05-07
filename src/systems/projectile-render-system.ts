// ProjectileRenderSystem - draws live projectiles each frame.
//
// Reuses Canvas2DDevice.drawParticle for rendering since projectiles
// are visually similar to particles (small bright dots / lines). For
// a dedicated arrow/bolt sprite, future work can extend with a
// drawProjectile primitive that renders an oriented sprite. For v1
// of Phase 7 deeper, code-painted dots are sufficient.

import type { System } from '../system.js';
import type { World } from '../world.js';
import { ProjectilePool, POOL_PROJECTILE, PROJECTILE_FLAG_ALIVE } from '../vfx/projectile-pool.js';
import {
  RESOURCE_DEVICE,
  RESOURCE_CAMERA,
} from '../resources.js';
import type { IGraphicsDevice } from '../renderer/graphics-device.js';
import type { CameraView } from '../renderer/camera.js';

const SCRATCH_COLOR = { r: 1, g: 1, b: 1, a: 1 };

export class ProjectileRenderSystem implements System {
  readonly name: string = 'projectile-render';

  update(world: World, _dt: number): void {
    const pool = world.getPool<ProjectilePool>(POOL_PROJECTILE);
    const device = world.resources.get<IGraphicsDevice>(RESOURCE_DEVICE);
    const camera = world.resources.get<CameraView>(RESOURCE_CAMERA);
    if (!pool || !device || !camera) return;
    if (pool.getLiveCount() === 0) return;

    device.setCamera(camera);
    const hwm = pool.getHighWaterMark();
    for (let i = 0; i < hwm; i++) {
      const f = pool.flags[i] ?? 0;
      if ((f & PROJECTILE_FLAG_ALIVE) === 0) continue;
      SCRATCH_COLOR.r = pool.r[i] ?? 1;
      SCRATCH_COLOR.g = pool.g[i] ?? 1;
      SCRATCH_COLOR.b = pool.b[i] ?? 1;
      SCRATCH_COLOR.a = pool.a[i] ?? 1;
      device.drawParticle(
        pool.x[i] ?? 0,
        pool.y[i] ?? 0,
        pool.z[i] ?? 0,
        pool.size[i] ?? 4,
        SCRATCH_COLOR,
        true,   // additive blend - bright projectile glow
      );
    }
  }
}
