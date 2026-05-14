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
import { RESOURCE_TIME } from '../resources.js';
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
        // Deterministic clock - TimeResource instead of performance.now()
        // so kill timestamps reproduce across HeadlessTicker runs with the
        // same seed + tick stream.
        const time = world.resources.get(RESOURCE_TIME);
        const now = time ? time.elapsed * 1000 : 0;
        for (let i = 1; i < hwm; i++) {
            const f = health.flags[i] ?? 0;
            if ((f & HEALTH_FLAG_ACTIVE) === 0)
                continue;
            if ((f & HEALTH_FLAG_DEAD) === 0)
                continue;
            // Canonical live handle for this pool slot. HEALTH_FLAG_ACTIVE
            // implies the allocator slot is live, so entityAt(i) returns a
            // real handle. This replaces makeEntity(i, 0), which produced a
            // 0-generation handle that only matched a slot on its first
            // life - once the slot had been recycled, the old code's
            // world.destroyEntity call silently failed and leaked the slot.
            const e = world.entityAt(i);
            // Detach everything we know about. Pool detach is idempotent
            // and bounds-checked, so unknown components are no-ops.
            health.detach(e);
            transforms?.detach(e);
            sprites?.detach(e);
            emitters?.detach(e);
            animations?.stop(e);
            // Destroy the allocator slot by index. The slot returns to the
            // free list and a future create() recycles it with a bumped
            // generation, invalidating any stale handles gameplay code
            // still holds. destroyByLiveIndex is generation-agnostic and
            // guarded by the allocator's alive bitmap.
            world.destroyEntityByLiveIndex(i);
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