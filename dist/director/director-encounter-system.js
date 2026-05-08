// DirectorEncounterSystem - subscribes to encounter.spawn events
// from the DirectorEventLog and spawns mobs into the world.
//
// Works in tandem with DirectorSystem:
//   1. DirectorSystem (PHASE_INPUT) drains the bridge and applies
//      events to KnotContext / VeilBudget / DirectorEventLog
//   2. DirectorEncounterSystem (PHASE_LOGIC) re-reads the most
//      recent events from the log, spawns mobs from any new
//      encounter.spawn event, and tracks handled encounter ids so
//      replay / duplicate events don't double-spawn
//
// Per spec §3.1 the encounter.spawn payload includes:
//   - mobs: ReadonlyArray<MobSpec> with type, position_hint, etc.
//   - boss: BossSpec | null
//   - knot, level, zone_id, narrator_line
//
// The renderer never decides composition (spec §5.1, §6.5). It just
// applies what the Director said.
//
// Mob type mapping: the spec's `type` field is a string the Director
// chose. We map known strings to MobArchetype values; unknown strings
// fall back to 'skel_warrior' so the encounter still produces
// something visible.
import { RESOURCE_DIRECTOR_LOG, } from './director-system.js';
import { spawnMob, MOB_CATALOG, } from '../combat/mob-catalog.js';
// String -> MobArchetype map. The Director can emit any string in
// the type field (spec doesn't enumerate); the engine validates +
// falls back. New mob types added in subsequent phases just extend
// this map.
const TYPE_MAP = {
    skel_warrior: 'skel_warrior',
    skel_archer: 'skel_archer',
    skel_caster: 'skel_caster',
    // Aliases / legacy names from the existing Survivor that map to
    // catalog archetypes.
    skeleton_iron: 'skel_warrior',
    skeleton_warrior: 'skel_warrior',
    skeleton_archer: 'skel_archer',
    skeleton_caster: 'skel_caster',
};
function resolveMobArchetype(typeStr) {
    return TYPE_MAP[typeStr] ?? 'skel_warrior';
}
export class DirectorEncounterSystem {
    name = 'director-encounter';
    // Set of encounter_ids we've already spawned. Prevents duplicate
    // spawn on event replay (spec §9.3 dual-delivery dedupe).
    handled = new Set();
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    update(world, _dt) {
        const log = world.resources.get(RESOURCE_DIRECTOR_LOG);
        if (!log)
            return;
        // Walk recent events from the log. recent is newest-first and
        // capped at 32 (per DirectorSystem ring buffer). Iterate from
        // oldest-to-newest so multi-encounter ticks spawn in order.
        for (let i = log.recent.length - 1; i >= 0; i--) {
            const ev = log.recent[i];
            if (!ev || ev.type !== 'encounter.spawn')
                continue;
            const spawn = ev;
            const id = spawn.data.encounter_id;
            if (!id || this.handled.has(id))
                continue;
            this.spawnEncounter(world, spawn.data);
            this.handled.add(id);
        }
        // On encounter.end events, free up the encounter id so a future
        // re-emission (e.g. retry) can spawn again.
        for (let i = log.recent.length - 1; i >= 0; i--) {
            const ev = log.recent[i];
            if (!ev || ev.type !== 'encounter.end')
                continue;
            const id = ev.encounter_id;
            if (id)
                this.handled.delete(id);
        }
    }
    spawnEncounter(world, data) {
        let totalSpawned = 0;
        for (const mob of data.mobs) {
            totalSpawned += this.spawnOne(world, mob);
        }
        // Boss spawn (if present).
        if (data.boss) {
            // Bosses use the same spawnMob factory in v1; future work
            // adds a spawnBoss with bigger HP / unique behaviour.
            const archetype = resolveMobArchetype(data.boss.type);
            // Verify the catalog has the entry before spawning - prevents
            // a typo on the Director side from crashing the renderer.
            if (MOB_CATALOG[archetype]) {
                spawnMob(world, archetype, data.boss.position_hint.x, data.boss.position_hint.y, this.opts.player, this.opts.mobAtlas);
                totalSpawned++;
            }
        }
        if (this.opts.onEncounterStarted) {
            this.opts.onEncounterStarted(data.encounter_id, totalSpawned, data.narrator_line);
        }
    }
    spawnOne(world, mob) {
        const archetype = resolveMobArchetype(mob.type);
        if (!MOB_CATALOG[archetype])
            return 0;
        const baseX = mob.position_hint.x;
        const baseY = mob.position_hint.y;
        // count > 1 spawns multiple instances at slightly varied
        // positions (small radius around the position_hint).
        for (let i = 0; i < mob.count; i++) {
            const angle = (i / Math.max(1, mob.count)) * Math.PI * 2;
            const spread = mob.count > 1 ? 0.5 : 0;
            spawnMob(world, archetype, baseX + Math.cos(angle) * spread, baseY + Math.sin(angle) * spread, this.opts.player, this.opts.mobAtlas);
        }
        return mob.count;
    }
    // Test / debug helper: clear the handled-id cache. Used by demo
    // code when transitioning zones so a fresh encounter.spawn for a
    // re-entered zone re-spawns mobs.
    clearHandled() {
        this.handled.clear();
    }
    hasHandled(encounterId) {
        return this.handled.has(encounterId);
    }
}
//# sourceMappingURL=director-encounter-system.js.map