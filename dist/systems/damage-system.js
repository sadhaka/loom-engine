// DamageSystem - sweeps the HealthPool each tick, removes dead
// entities (clears their Sprite + Transform components and destroys
// the entity handle).
//
// Death pipeline:
//   1. AttackSystem (or any gameplay code) calls health.applyDamage
//   2. If HP drops to 0, HEALTH_FLAG_DEAD is set on the pool
//   3. DamageSystem next tick walks the pool, sees DEAD flag,
//      detaches Sprite + Transform + Health + Animation +
//      Emitter components, destroys the entity
//   4. Optional consumers can listen to the event log for kill
//      notifications (Phase 7+ adds a kill-event ring buffer)
//
// Runs in PHASE_LOGIC, after AttackSystem + PursueSystem so this
// frame's damage events have been resolved before cleanup.
import { POOL_HEALTH, HEALTH_FLAG_ACTIVE, HEALTH_FLAG_DEAD } from '../components/health.js';
import { POOL_TRANSFORM, POOL_SPRITE } from '../world.js';
import { POOL_EMITTER } from './particle-emitter-system.js';
import { POOL_ANIMATION } from './animation-system.js';
import { makeEntity } from '../entity.js';
export class DeathLog {
    // Newest first. Capped at MAX_KILLS to bound memory.
    recent = [];
    totalKills = 0;
    static MAX_KILLS = 64;
}
export const RESOURCE_DEATH_LOG = 'death_log';
export class DamageSystem {
    name = 'damage';
    update(world, _dt) {
        const health = world.getPool(POOL_HEALTH);
        if (!health)
            return;
        const transforms = world.getPool(POOL_TRANSFORM);
        const sprites = world.getPool(POOL_SPRITE);
        const emitters = world.getPool(POOL_EMITTER);
        const animations = world.getPool(POOL_ANIMATION);
        const deathLog = world.resources.get(RESOURCE_DEATH_LOG);
        const hwm = health.getHighWaterMark();
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        for (let i = 1; i < hwm; i++) {
            const f = health.flags[i] ?? 0;
            if ((f & HEALTH_FLAG_ACTIVE) === 0)
                continue;
            if ((f & HEALTH_FLAG_DEAD) === 0)
                continue;
            // Reconstruct an EntityId for the index. Generation isn't
            // material here because the pools all store by index and the
            // entity allocator's destroy will bump the generation.
            const e = makeEntity(i, 0);
            // Detach everything we know about. Pool detach is idempotent
            // and bounds-checked, so unknown components are no-ops.
            health.detach(e);
            transforms?.detach(e);
            sprites?.detach(e);
            emitters?.detach(e);
            animations?.stop(e);
            // Destroy the entity allocator slot. The slot returns to the
            // free list and a future create() will recycle it. The
            // generation bump invalidates any stale handles still held
            // by gameplay code.
            world.destroyEntity(e);
            // Record the kill in the log. Killer attribution is gameplay-
            // specific and not tracked here; AttackSystem can extend the
            // log with killer info when it deals lethal damage.
            if (deathLog) {
                const ev = { entityIndex: i, killerIndex: null, atMs: now };
                deathLog.recent.unshift(ev);
                if (deathLog.recent.length > DeathLog.MAX_KILLS) {
                    deathLog.recent.length = DeathLog.MAX_KILLS;
                }
                deathLog.totalKills++;
            }
        }
    }
}
//# sourceMappingURL=damage-system.js.map