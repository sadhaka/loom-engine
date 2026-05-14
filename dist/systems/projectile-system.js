// ProjectileSystem - simulates in-flight projectiles + applies hit
// damage when a projectile contacts a HealthPool entity.
//
// Pipeline per tick:
//   1. For each live projectile:
//      - Decrease life by dt; kill if life <= 0
//      - If homing + target alive: re-aim velocity toward target
//      - Integrate position by velocity * dt
//      - Spatial query: any alive Health-bearing entity within hit
//        radius (size/2 in world units, plus a small fudge)?
//      - On hit: apply damage to target; kill projectile unless
//        PIERCE flag is set
//
// Runs in PHASE_PHYSICS, alongside ParticleSimulationSystem. The
// hit query is O(projectiles * targets); for typical Survivor loads
// (under 50 of each) that's fine. Phase 8+ may add a spatial hash
// if profile shows the inner loop dominates.
import { POOL_PROJECTILE, PROJECTILE_FLAG_ALIVE, PROJECTILE_FLAG_HOMING, PROJECTILE_FLAG_PIERCE } from '../vfx/projectile-pool.js';
import { POOL_HEALTH } from '../components/health.js';
import { POOL_TRANSFORM } from '../world.js';
import { RESOURCE_TIME } from '../resources.js';
import { entityIndex, NULL_ENTITY } from '../entity.js';
export class ProjectileSystem {
    name = 'projectile';
    update(world, dt) {
        const pool = world.getPool(POOL_PROJECTILE);
        if (!pool)
            return;
        const transforms = world.getPool(POOL_TRANSFORM);
        const health = world.getPool(POOL_HEALTH);
        if (!transforms || !health)
            return;
        const hwm = pool.getHighWaterMark();
        if (hwm === 0)
            return;
        // Deterministic clock from TimeResource so projectile-impact
        // damage timestamps reproduce across replays.
        const time = world.resources.get(RESOURCE_TIME);
        const now = time ? time.elapsed * 1000 : 0;
        for (let i = 0; i < hwm; i++) {
            const f = pool.flags[i] ?? 0;
            if ((f & PROJECTILE_FLAG_ALIVE) === 0)
                continue;
            // Life decay.
            const remaining = (pool.life[i] ?? 0) - dt;
            if (remaining <= 0) {
                pool.kill(i);
                continue;
            }
            pool.life[i] = remaining;
            // Homing: re-aim velocity toward target each tick.
            if ((f & PROJECTILE_FLAG_HOMING) !== 0) {
                const target = pool.targetEntity[i] ?? NULL_ENTITY;
                // world.entities.isAlive validates the stored handle's
                // generation: if the target died and its slot was recycled,
                // the projectile stops homing instead of chasing whatever
                // new entity now occupies the slot. health.isAlive then
                // gates on gameplay liveness (not dead, has health).
                if (target !== NULL_ENTITY && world.entities.isAlive(target) && health.isAlive(target)) {
                    const ti = entityIndex(target);
                    const tx = transforms.x[ti] ?? 0;
                    const ty = transforms.y[ti] ?? 0;
                    const tz = transforms.z[ti] ?? 0;
                    const dx = tx - (pool.x[i] ?? 0);
                    const dy = ty - (pool.y[i] ?? 0);
                    const dz = tz - (pool.z[i] ?? 0);
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist > 1e-6) {
                        const speed = Math.sqrt((pool.vx[i] ?? 0) ** 2 +
                            (pool.vy[i] ?? 0) ** 2 +
                            (pool.vz[i] ?? 0) ** 2);
                        pool.vx[i] = (dx / dist) * speed;
                        pool.vy[i] = (dy / dist) * speed;
                        pool.vz[i] = (dz / dist) * speed;
                    }
                }
            }
            // Integrate position.
            pool.x[i] = (pool.x[i] ?? 0) + (pool.vx[i] ?? 0) * dt;
            pool.y[i] = (pool.y[i] ?? 0) + (pool.vy[i] ?? 0) * dt;
            pool.z[i] = (pool.z[i] ?? 0) + (pool.vz[i] ?? 0) * dt;
            // Hit detection: scan HealthPool for alive entities within
            // hit radius. Skip the projectile's owner.
            const px = pool.x[i] ?? 0;
            const py = pool.y[i] ?? 0;
            const owner = entityIndex(pool.ownerEntity[i] ?? NULL_ENTITY);
            const hitRadius = (pool.size[i] ?? 4) * 0.05; // size pixels -> world units, approx
            const hitRadiusSq = hitRadius * hitRadius;
            const targetHwm = health.getHighWaterMark();
            let hitIdx = -1;
            for (let j = 1; j < targetHwm; j++) {
                if (j === owner)
                    continue;
                const target = world.entityAt(j);
                if (!health.isAlive(target))
                    continue;
                const tx = transforms.x[j] ?? 0;
                const ty = transforms.y[j] ?? 0;
                const dx = tx - px;
                const dy = ty - py;
                // Use a slightly larger hit radius for tile-space contact -
                // 0.5 world units is roughly half a tile and matches the
                // existing PursueSystem stopDistance defaults.
                const contactSq = 0.5 * 0.5;
                const distSq = dx * dx + dy * dy;
                if (distSq < Math.max(hitRadiusSq, contactSq)) {
                    hitIdx = j;
                    break;
                }
            }
            if (hitIdx >= 0) {
                const target = world.entityAt(hitIdx);
                health.applyDamage(target, pool.damage[i] ?? 0, now);
                if ((f & PROJECTILE_FLAG_PIERCE) === 0) {
                    pool.kill(i);
                }
            }
        }
    }
}
//# sourceMappingURL=projectile-system.js.map