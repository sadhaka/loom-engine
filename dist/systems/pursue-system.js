// PursueSystem - per-tick enemy AI advance.
//
// For each entity with a PursueComponent + Transform, walks the
// entity toward its target's Transform at the configured speed.
// When in stop-distance, stops moving and (if contactDamage > 0
// and cooldown elapsed) applies contact damage to the target.
//
// Runs in PHASE_LOGIC, after the input-driven systems (camera,
// click) so target positions are settled, before DamageSystem
// (PHASE_LOGIC later in the registration order) so the damage
// applied this tick is reflected in the cleanup pass.
import { POOL_TRANSFORM } from '../world.js';
import { POOL_PURSUE, PURSUE_FLAG_ACTIVE } from '../components/pursue.js';
import { POOL_HEALTH } from '../components/health.js';
import { RESOURCE_TIME } from '../resources.js';
import { entityIndex, NULL_ENTITY } from '../entity.js';
export class PursueSystem {
    name = 'pursue';
    update(world, dt) {
        const transforms = world.getPool(POOL_TRANSFORM);
        const pursuit = world.getPool(POOL_PURSUE);
        if (!transforms || !pursuit)
            return;
        const health = world.getPool(POOL_HEALTH);
        const hwm = pursuit.getHighWaterMark();
        // Deterministic clock - TimeResource not performance.now(). Pursue
        // contact-damage cooldown checks reproduce across replays.
        const time = world.resources.get(RESOURCE_TIME);
        const now = time ? time.elapsed * 1000 : 0;
        for (let i = 1; i < hwm; i++) {
            const f = pursuit.flags[i] ?? 0;
            if ((f & PURSUE_FLAG_ACTIVE) === 0)
                continue;
            // Skip dead pursuers.
            if (health) {
                const e = world.entityAt(i);
                if (health.isDead(e)) {
                    pursuit.flags[i] = 0;
                    continue;
                }
            }
            const target = pursuit.targetEntity[i] ?? NULL_ENTITY;
            if (target === NULL_ENTITY)
                continue;
            // Stop pursuing if the target is no longer the entity we
            // locked onto - destroyed, or its slot recycled into a fresh
            // tenant (the stored handle's generation no longer matches).
            // A raw-index targetIndex silently followed the slot onto
            // whatever new entity took it; the generation check does not.
            if (!world.entities.isAlive(target))
                continue;
            // Also stop on a target that is dead in gameplay terms - a
            // lethal hit landed but DamageSystem has not swept it yet.
            if (health && health.isDead(target))
                continue;
            const ti = entityIndex(target);
            const myX = transforms.x[i] ?? 0;
            const myY = transforms.y[i] ?? 0;
            const tx = transforms.x[ti] ?? 0;
            const ty = transforms.y[ti] ?? 0;
            const dx = tx - myX;
            const dy = ty - myY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const stopDist = pursuit.stopDistance[i] ?? 0;
            if (dist > stopDist) {
                // Walk toward target. Normalize delta + step by speed * dt.
                const speed = pursuit.speed[i] ?? 0;
                const step = speed * dt;
                const nx = dist > 0 ? dx / dist : 0;
                const ny = dist > 0 ? dy / dist : 0;
                // Don't overshoot.
                const moveX = step >= dist ? dx : nx * step;
                const moveY = step >= dist ? dy : ny * step;
                const e = world.entityAt(i);
                transforms.setPosition(e, myX + moveX, myY + moveY, transforms.z[i] ?? 0);
            }
            else {
                // In contact range. Apply contact damage if cooldown elapsed.
                const damage = pursuit.contactDamage[i] ?? 0;
                if (damage > 0 && health) {
                    const lastHit = pursuit.lastHitMs[i] ?? -1;
                    const cooldown = pursuit.contactCooldownMs[i] ?? 1000;
                    if (lastHit < 0 || now - lastHit >= cooldown) {
                        const applied = health.applyDamage(target, damage, now);
                        if (applied > 0) {
                            pursuit.lastHitMs[i] = now;
                        }
                    }
                }
            }
        }
    }
}
//# sourceMappingURL=pursue-system.js.map