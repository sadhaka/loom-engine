// ZoneEventSystem - drains the IZoneEventBridge each tick, applies
// each event to the world's zone-scoped resources, and tracks per-zone
// recent state for the renderer (LOOM-DIRECTOR-PROTOCOL-V2 §4.3).
//
// Runs in PHASE_INPUT, AFTER DirectorSystem (v1) and PeerPresenceSystem
// (15.x). Order rationale:
//   1. DirectorSystem runs first so v1 character-scoped events have
//      already mutated VeilBudget + KnotContext for THIS frame.
//   2. PeerPresenceSystem advances peer interpolation so the local
//      player's current zone is fresh.
//   3. ZoneEventSystem THEN overlays zone-scoped events on top -
//      knot pulses can stack on top of v1 knot.context, narrator
//      lines can override v1 narrator.line for the same frame, etc.
//
// Local-zone filter (spec §4.3): events are applied ONLY for the
// local character's current zone. Events for other zones are still
// pushed into the per-zone ZoneEventLog so debug HUDs can see the
// fanout, but they do not mutate KnotContextResource or
// DirectorZoneStateResource.
//
// Dispatch table per event type:
//
//   zone.boss.spawn  -> ZoneEventLog.activeBossId = ev.data.boss.boss_id
//                       narrator_line -> log.lastNarratorLine
//   zone.boss.tick   -> log only (renderer reads ev for HP / pos)
//   zone.boss.end    -> ZoneEventLog.activeBossId = null
//   zone.narrator    -> log.lastNarratorLine + ttl
//   zone.knot        -> KnotContextResource.beginFade (parallel to v1)
//   zone.state       -> applyZoneStateChanges into
//                       DirectorZoneStateResource
//   zone.snapshot    -> replaceZoneStateFromSnapshot wholesale +
//                       reset activeBossId from snapshot's
//                       active_boss + apply knot if non-null
//
// Lightweight-by-design: most events are just logged + appended to
// the per-zone ring buffer that gameplay code can read. Heavy state
// mutation (combat boss entity spawn / despawn, loot pickup) lives
// in higher-level systems that read from ZoneEventLog.
import { RESOURCE_ZONE_EVENT_BRIDGE, } from './zone-event-bridge.js';
import { RESOURCE_ZONE_EVENT_LOG, getOrCreateZoneEntry, pushZoneEvent, } from './zone-event-log.js';
import { RESOURCE_DIRECTOR_ZONE_STATE, applyZoneStateChanges, replaceZoneStateFromSnapshot, } from './zone-state-resource.js';
import { RESOURCE_KNOT_CONTEXT, } from '../director-bridge.js';
import { RESOURCE_TIME, } from '../../resources.js';
export class ZoneEventSystem {
    name = 'zone-events';
    currentZone;
    applyKnotToSharedContext;
    constructor(opts = {}) {
        this.currentZone = opts.currentZone ?? null;
        this.applyKnotToSharedContext = opts.applyKnotToSharedContext ?? true;
    }
    update(world, _dt) {
        const bridge = world.resources.get(RESOURCE_ZONE_EVENT_BRIDGE);
        const log = world.resources.get(RESOURCE_ZONE_EVENT_LOG);
        const stateRes = world.resources.get(RESOURCE_DIRECTOR_ZONE_STATE);
        if (!bridge || !log)
            return;
        const knotCtx = this.applyKnotToSharedContext
            ? world.resources.get(RESOURCE_KNOT_CONTEXT)
            : undefined;
        const time = world.resources.get(RESOURCE_TIME);
        // Deterministic clock - TimeResource only. We previously summed in
        // performance.now() which made knot fade timings non-reproducible
        // across replays. Both DirectorSystem and ZoneEventSystem now use
        // the same coordinate (time.elapsed * 1000) so beginFade / tickFade
        // remain in sync.
        const nowMs = time ? time.elapsed * 1000 : 0;
        const events = bridge.pollEvents();
        if (events.length === 0)
            return;
        const localZone = safeCurrentZone(this.currentZone);
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev)
                continue;
            // Always push into the per-zone log (so debug HUDs can see all
            // observed zones) - the local-zone filter only gates state
            // mutation, not logging.
            const entry = getOrCreateZoneEntry(log, ev.zone_id);
            pushZoneEvent(entry, ev);
            const isLocal = localZone === null
                ? true // no filter set: apply everything (single-zone consumer)
                : ev.zone_id === localZone;
            applyEvent(ev, entry, isLocal, knotCtx, stateRes, nowMs);
        }
    }
}
function applyEvent(ev, entry, isLocal, knotCtx, stateRes, nowMs) {
    switch (ev.type) {
        case 'zone.boss.spawn': {
            const e = ev;
            const d = e.data;
            // activeBossId is per-zone, so always update the per-zone log
            // entry regardless of local filter.
            entry.activeBossId = d.boss.boss_id;
            if (isLocal && d.narrator_line) {
                entry.lastNarratorLine = d.narrator_line;
                entry.lastNarratorTtlMs = 0;
            }
            break;
        }
        case 'zone.boss.tick': {
            // Log only. Renderer reads the most recent zone.boss.tick from
            // entry.recent for HP / position.
            break;
        }
        case 'zone.boss.end': {
            const e = ev;
            // Clear active boss for this zone if the ended boss matches.
            // (Defensive: a stale zone.boss.end for a different boss should
            // not nuke the current one.)
            if (entry.activeBossId === e.data.boss_id) {
                entry.activeBossId = null;
            }
            break;
        }
        case 'zone.narrator': {
            if (!isLocal)
                break;
            const e = ev;
            entry.lastNarratorLine = e.data.line;
            entry.lastNarratorTtlMs = e.data.ttl_ms;
            break;
        }
        case 'zone.knot': {
            if (!isLocal || !knotCtx)
                break;
            const e = ev;
            const d = e.data;
            knotCtx.knot = d.knot;
            knotCtx.mood = d.mood;
            knotCtx.beginFade(d.palette, d.fade_ms, nowMs);
            break;
        }
        case 'zone.state': {
            if (!stateRes)
                break;
            const e = ev;
            // State changes are applied to ALL zones we observe so a
            // debug HUD that flips back to a foreign zone sees the right
            // state. Per spec §4.3 the LOCAL filter is for "applies the
            // gameplay effect"; the state map is observation-grade.
            applyZoneStateChanges(stateRes, e.zone_id, e.data.changes);
            break;
        }
        case 'zone.snapshot': {
            const e = ev;
            const d = e.data;
            // Snapshot replaces local state wholesale.
            if (stateRes) {
                replaceZoneStateFromSnapshot(stateRes, e.zone_id, d.state);
            }
            // Reset active boss from snapshot.
            entry.activeBossId = d.active_boss ? d.active_boss.boss_id : null;
            // Apply snapshot's knot if present and we are the local zone.
            if (isLocal && knotCtx && d.knot) {
                knotCtx.knot = d.knot.knot;
                knotCtx.mood = d.knot.mood;
                knotCtx.beginFade(d.knot.palette, d.knot.fade_ms, nowMs);
            }
            break;
        }
        default: {
            // Exhaustiveness check - if a new ZoneEventType is added without
            // a case, TS will complain at compile time on `_unreachable`.
            const _unreachable = ev;
            void _unreachable;
            break;
        }
    }
}
function safeCurrentZone(fn) {
    if (!fn)
        return null;
    try {
        const z = fn();
        return typeof z === 'string' && z.length > 0 ? z : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=zone-event-system.js.map