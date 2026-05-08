// ZoneBossEntitySystem - converts zone events into a typed
// ZoneBossEntityResource that any renderer (Three.js, Canvas2D, etc.)
// can poll each frame without parsing SSE protocol envelopes
// (LOOM-BOSS-RENDER-SPEC §3.2).
//
// Runs in PHASE_LOGIC, AFTER ZoneEventSystem (which runs in PHASE_INPUT
// and is the source of truth on event ordering + ZoneEventLog state).
// This system is a downstream projection of ZoneEventLog into a
// renderer-friendly entity shape.
//
// Cursor strategy: per-zone lastProcessedEventId. Each tick we scan
// ZoneEventLog.byZone[zid].recent (newest-first ring) and process any
// events with id > cursor, then advance the cursor. The ring caps at
// ZONE_RING_SIZE = 32 entries; if more than 32 events landed for one
// zone in a single frame, some are lost. Acceptable in practice
// (60 Hz tick vs server bursts of <32/frame) since zone.boss.end +
// zone.snapshot are P0 priority and will not be dropped by the bridge.
//
// Dispatch table:
//
//   zone.boss.spawn  -> entities.byZone[zid] = buildEntityFromSpawn(env)
//   zone.boss.tick   -> if boss_id matches current, applyTick; else ignore
//   zone.boss.end    -> if boss_id matches current, clear to null
//   zone.snapshot    -> replace wholesale (entity if active_boss non-null,
//                       null otherwise)
//   other            -> no-op
//
// v1 supports at most one active boss per zone (matches Phase 16 spec).
import { RESOURCE_ZONE_EVENT_LOG, } from './zone-event-log.js';
import { RESOURCE_ZONE_BOSS_ENTITY, buildEntityFromSpawn, applyTick, } from './zone-boss-entity.js';
export class ZoneBossEntitySystem {
    name = 'zone-boss-entity';
    // Per-zone last-processed event id. Events with id > cursor are new
    // since the previous frame.
    cursors = new Map();
    update(world, _dt) {
        const log = world.resources.get(RESOURCE_ZONE_EVENT_LOG);
        const entities = world.resources.get(RESOURCE_ZONE_BOSS_ENTITY);
        if (!log || !entities)
            return;
        for (const [zoneId, entry] of log.byZone) {
            const cursor = this.cursors.get(zoneId) ?? 0;
            // Walk the newest-first ring. Collect events with id > cursor,
            // then reverse to apply oldest-first.
            const fresh = [];
            for (let i = 0; i < entry.recent.length; i++) {
                const ev = entry.recent[i];
                if (!ev)
                    continue;
                if (ev.id <= cursor)
                    break;
                fresh.push(ev);
            }
            if (fresh.length === 0)
                continue;
            fresh.reverse();
            let highestId = cursor;
            for (let i = 0; i < fresh.length; i++) {
                const ev = fresh[i];
                if (!ev)
                    continue;
                if (ev.id > highestId)
                    highestId = ev.id;
                applyEventToEntity(ev, zoneId, entities);
            }
            this.cursors.set(zoneId, highestId);
        }
    }
    // Diagnostic accessor for tests + debug HUDs.
    cursorFor(zoneId) {
        return this.cursors.get(zoneId) ?? 0;
    }
}
function applyEventToEntity(ev, zoneId, entities) {
    switch (ev.type) {
        case 'zone.boss.spawn': {
            entities.byZone.set(zoneId, buildEntityFromSpawn(ev));
            break;
        }
        case 'zone.boss.tick': {
            const e = ev;
            const current = entities.byZone.get(zoneId);
            if (!current)
                return;
            if (current.boss_id !== e.data.boss_id)
                return;
            applyTick(current, ev);
            break;
        }
        case 'zone.boss.end': {
            const e = ev;
            const current = entities.byZone.get(zoneId);
            if (current && current.boss_id === e.data.boss_id) {
                entities.byZone.set(zoneId, null);
            }
            break;
        }
        case 'zone.snapshot': {
            const e = ev;
            if (e.data.active_boss) {
                entities.byZone.set(zoneId, buildEntityFromSpawn(ev));
            }
            else {
                entities.byZone.set(zoneId, null);
            }
            break;
        }
        default:
            // Other event types (zone.narrator, zone.knot, zone.state) do
            // not affect the boss entity. Pure no-op.
            break;
    }
}
//# sourceMappingURL=zone-boss-entity-system.js.map