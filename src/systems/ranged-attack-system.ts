// RangedAttackSystem - per-tick ranged-attack scheduler.
//
// For each active RangedAttackPool entry:
//   1. Read the firing entity's transform + the target's transform
//   2. If target alive AND distance is in [minRange, range] AND
//      cooldown elapsed: spawn a projectile aimed at the target
//      with the configured params
//   3. Otherwise no-op for this tick
//
// Runs in PHASE_LOGIC, after PursueSystem (so positions are up to
// date) and before DamageSystem cleanup. Spawns projectiles into
// the shared ProjectilePool which ProjectileSystem (PHASE_PHYSICS)
// will then advance + collide.

import type { System } from '../system.js';
import type { World } from '../world.js';
import { POOL_TRANSFORM } from '../world.js';
import { TransformPool } from '../components/transform.js';
import {
  RangedAttackPool,
  POOL_RANGED,
  RANGED_FLAG_ACTIVE,
  RANGED_FLAG_HOMING,
} from '../components/ranged-attack.js';
import { ProjectilePool, POOL_PROJECTILE } from '../vfx/projectile-pool.js';
import { HealthPool, POOL_HEALTH } from '../components/health.js';
import { RESOURCE_TIME, type TimeResource } from '../resources.js';

export class RangedAttackSystem implements System {
  readonly name: string = 'ranged-attack';

  update(world: World, _dt: number): void {
    const ranged = world.getPool<RangedAttackPool>(POOL_RANGED);
    if (!ranged) return;
    const transforms = world.getPool<TransformPool>(POOL_TRANSFORM);
    const projectiles = world.getPool<ProjectilePool>(POOL_PROJECTILE);
    const health = world.getPool<HealthPool>(POOL_HEALTH);
    if (!transforms || !projectiles || !health) return;

    const hwm = ranged.getHighWaterMark();
    // Deterministic clock - TimeResource so cooldowns + projectile
    // spawn timestamps reproduce under trace replay.
    const time = world.resources.get<TimeResource>(RESOURCE_TIME);
    const now = time ? time.elapsed * 1000 : 0;

    for (let i = 1; i < hwm; i++) {
      const f = ranged.flags[i] ?? 0;
      if ((f & RANGED_FLAG_ACTIVE) === 0) continue;

      // Skip dead firers. entityAt(i) is the canonical handle for
      // the slot - makeEntity(i, 0) would go stale once the slot is
      // recycled.
      const firer = world.entityAt(i);
      if (!health.isAlive(firer)) {
        ranged.flags[i] = 0;
        continue;
      }

      const targetIdx = ranged.targetIndex[i] ?? -1;
      if (targetIdx < 0) continue;
      const target = world.entityAt(targetIdx);
      if (!health.isAlive(target)) continue;

      // Cooldown gate.
      const cooldown = ranged.cooldownMs[i] ?? 1000;
      const lastFire = ranged.lastFireMs[i] ?? -1;
      if (lastFire >= 0 && now - lastFire < cooldown) continue;

      // Range check.
      const myX = transforms.x[i] ?? 0;
      const myY = transforms.y[i] ?? 0;
      const tx = transforms.x[targetIdx] ?? 0;
      const ty = transforms.y[targetIdx] ?? 0;
      const dx = tx - myX;
      const dy = ty - myY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const range = ranged.range[i] ?? 0;
      const minRange = ranged.minRange[i] ?? 0;
      if (dist > range || dist < minRange) continue;

      // Fire. Velocity = direction normalized * projectileSpeed.
      const speed = ranged.projectileSpeed[i] ?? 1;
      const norm = dist > 1e-6 ? 1 / dist : 0;
      const vx = dx * norm * speed;
      const vy = dy * norm * speed;
      const homing = (f & RANGED_FLAG_HOMING) !== 0;

      const slot = projectiles.spawn({
        x: myX,
        y: myY,
        z: transforms.z[i] ?? 0.5,
        vx,
        vy,
        vz: 0,
        life: ranged.projectileLife[i] ?? 2.0,
        damage: ranged.damage[i] ?? 1,
        ownerIndex: i,
        targetIndex: homing ? targetIdx : -1,
        size: ranged.projectileSize[i] ?? 5,
        color: {
          r: ranged.r[i] ?? 1,
          g: ranged.g[i] ?? 1,
          b: ranged.b[i] ?? 1,
          a: ranged.a[i] ?? 1,
        },
        homing,
        pierce: false,
      });
      if (slot >= 0) {
        ranged.lastFireMs[i] = now;
      }
    }
  }
}
