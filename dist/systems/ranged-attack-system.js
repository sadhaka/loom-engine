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
import { POOL_TRANSFORM } from '../world.js';
import { POOL_RANGED, RANGED_FLAG_ACTIVE, RANGED_FLAG_HOMING, } from '../components/ranged-attack.js';
import { POOL_PROJECTILE } from '../vfx/projectile-pool.js';
import { POOL_HEALTH } from '../components/health.js';
import { RESOURCE_TIME } from '../resources.js';
import { entityIndex, NULL_ENTITY } from '../entity.js';
export class RangedAttackSystem {
    name = 'ranged-attack';
    update(world, _dt) {
        const ranged = world.getPool(POOL_RANGED);
        if (!ranged)
            return;
        const transforms = world.getPool(POOL_TRANSFORM);
        const projectiles = world.getPool(POOL_PROJECTILE);
        const health = world.getPool(POOL_HEALTH);
        if (!transforms || !projectiles || !health)
            return;
        const hwm = ranged.getHighWaterMark();
        // Deterministic clock - TimeResource so cooldowns + projectile
        // spawn timestamps reproduce under trace replay.
        const time = world.resources.get(RESOURCE_TIME);
        const now = time ? time.elapsed * 1000 : 0;
        for (let i = 1; i < hwm; i++) {
            const f = ranged.flags[i] ?? 0;
            if ((f & RANGED_FLAG_ACTIVE) === 0)
                continue;
            // Skip dead firers. entityAt(i) is the canonical handle for
            // the slot - makeEntity(i, 0) would go stale once the slot is
            // recycled.
            const firer = world.entityAt(i);
            if (!health.isAlive(firer)) {
                ranged.flags[i] = 0;
                continue;
            }
            const target = ranged.targetEntity[i] ?? NULL_ENTITY;
            if (target === NULL_ENTITY)
                continue;
            // Validate the stored handle's generation - if the target
            // died and its slot was recycled, skip rather than fire at
            // whatever new entity now holds the slot.
            if (!world.entities.isAlive(target))
                continue;
            if (!health.isAlive(target))
                continue;
            // Cooldown gate.
            const cooldown = ranged.cooldownMs[i] ?? 1000;
            const lastFire = ranged.lastFireMs[i] ?? -1;
            if (lastFire >= 0 && now - lastFire < cooldown)
                continue;
            // Range check.
            const ti = entityIndex(target);
            const myX = transforms.x[i] ?? 0;
            const myY = transforms.y[i] ?? 0;
            const tx = transforms.x[ti] ?? 0;
            const ty = transforms.y[ti] ?? 0;
            const dx = tx - myX;
            const dy = ty - myY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const range = ranged.range[i] ?? 0;
            const minRange = ranged.minRange[i] ?? 0;
            if (dist > range || dist < minRange)
                continue;
            // Fire. Velocity = direction normalized * projectileSpeed.
            const speed = ranged.projectileSpeed[i] ?? 1;
            const norm = dist > 1e-6 ? 1 / dist : 0;
            const vx = dx * norm * speed;
            const vy = dy * norm * speed;
            const homing = (f & RANGED_FLAG_HOMING) !== 0;
            // spawnRaw - no per-shot spawn object or nested color alloc.
            const slot = projectiles.spawnRaw(myX, myY, transforms.z[i] ?? 0.5, vx, vy, 0, ranged.projectileLife[i] ?? 2.0, ranged.damage[i] ?? 1, firer, homing ? target : NULL_ENTITY, ranged.projectileSize[i] ?? 5, ranged.r[i] ?? 1, ranged.g[i] ?? 1, ranged.b[i] ?? 1, ranged.a[i] ?? 1, homing, false);
            if (slot >= 0) {
                ranged.lastFireMs[i] = now;
            }
        }
    }
}
//# sourceMappingURL=ranged-attack-system.js.map