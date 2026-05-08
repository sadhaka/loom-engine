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

import type { System } from '../system.js';
import type { World } from '../world.js';
import { POOL_TRANSFORM } from '../world.js';
import { TransformPool } from '../components/transform.js';
import { PursuePool, POOL_PURSUE, PURSUE_FLAG_ACTIVE } from '../components/pursue.js';
import { HealthPool, POOL_HEALTH } from '../components/health.js';
import { makeEntity } from '../entity.js';
import { RESOURCE_TIME, type TimeResource } from '../resources.js';

export class PursueSystem implements System {
  readonly name: string = 'pursue';

  update(world: World, dt: number): void {
    const transforms = world.getPool<TransformPool>(POOL_TRANSFORM);
    const pursuit = world.getPool<PursuePool>(POOL_PURSUE);
    if (!transforms || !pursuit) return;
    const health = world.getPool<HealthPool>(POOL_HEALTH);

    const hwm = pursuit.getHighWaterMark();
    // Deterministic clock - TimeResource not performance.now(). Pursue
    // contact-damage cooldown checks reproduce across replays.
    const time = world.resources.get<TimeResource>(RESOURCE_TIME);
    const now = time ? time.elapsed * 1000 : 0;

    for (let i = 1; i < hwm; i++) {
      const f = pursuit.flags[i] ?? 0;
      if ((f & PURSUE_FLAG_ACTIVE) === 0) continue;

      // Skip dead pursuers.
      if (health) {
        const e = makeEntity(i, 0);
        if (health.isDead(e)) {
          pursuit.flags[i] = 0;
          continue;
        }
      }

      const targetIdx = pursuit.targetIndex[i] ?? -1;
      if (targetIdx < 0) continue;
      // If the target is dead, stop pursuing.
      if (health && health.isDead(makeEntity(targetIdx, 0))) {
        continue;
      }

      const myX = transforms.x[i] ?? 0;
      const myY = transforms.y[i] ?? 0;
      const tx = transforms.x[targetIdx] ?? 0;
      const ty = transforms.y[targetIdx] ?? 0;

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
        const e = makeEntity(i, 0);
        transforms.setPosition(e, myX + moveX, myY + moveY, transforms.z[i] ?? 0);
      } else {
        // In contact range. Apply contact damage if cooldown elapsed.
        const damage = pursuit.contactDamage[i] ?? 0;
        if (damage > 0 && health) {
          const lastHit = pursuit.lastHitMs[i] ?? -1;
          const cooldown = pursuit.contactCooldownMs[i] ?? 1000;
          if (lastHit < 0 || now - lastHit >= cooldown) {
            const target = makeEntity(targetIdx, 0);
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
