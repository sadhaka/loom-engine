// ZoneEventLog - per-zone ring buffer parallel to v1's
// DirectorEventLog (LOOM-DIRECTOR-PROTOCOL-V2 §4.4).
//
// Renderer reads from this for UI surfaces (boss HP bar, recent loot
// toast, narrator banner). Per-zone slots so a player who briefly
// stepped through another zone keeps a separate diagnostic trail per
// zone they have observed.
//
// The map is dense by-zone; a zone's slot is created lazily on the
// first event for that zone (avoids preallocating slots for zones the
// player will never enter). The ring buffer per zone caps at
// ZONE_RING_SIZE = 32 entries, newest first - matches v1's
// DirectorEventLog.recent semantics.
export const RESOURCE_ZONE_EVENT_LOG = 'zone_event_log';
export const ZONE_RING_SIZE = 32;
export function createZoneEventLog() {
    return { byZone: new Map() };
}
// Get or lazily create the slot for a zone. Used by ZoneEventSystem
// when the first event for a zone arrives. Exported for tests +
// bench.
export function getOrCreateZoneEntry(log, zoneId) {
    const existing = log.byZone.get(zoneId);
    if (existing)
        return existing;
    const fresh = {
        recent: [],
        activeBossId: null,
        lastNarratorLine: null,
        lastNarratorTtlMs: 0,
        eventsApplied: 0,
    };
    log.byZone.set(zoneId, fresh);
    return fresh;
}
// Push an event into the per-zone ring buffer (newest first) and
// bump eventsApplied. Pure; does not touch activeBossId / narrator
// state - those are the system's job to set per event type.
export function pushZoneEvent(entry, ev) {
    entry.recent.unshift(ev);
    if (entry.recent.length > ZONE_RING_SIZE) {
        entry.recent.length = ZONE_RING_SIZE;
    }
    entry.eventsApplied++;
}
//# sourceMappingURL=zone-event-log.js.map