import type { ZoneEvent } from './zone-event-envelope.js';
export interface ZoneEventLogEntry {
    recent: ZoneEvent[];
    activeBossId: string | null;
    lastNarratorLine: string | null;
    lastNarratorTtlMs: number;
    eventsApplied: number;
}
export interface ZoneEventLog {
    byZone: Map<string, ZoneEventLogEntry>;
}
export declare const RESOURCE_ZONE_EVENT_LOG = "zone_event_log";
export declare const ZONE_RING_SIZE = 32;
export declare function createZoneEventLog(): ZoneEventLog;
export declare function getOrCreateZoneEntry(log: ZoneEventLog, zoneId: string): ZoneEventLogEntry;
export declare function pushZoneEvent(entry: ZoneEventLogEntry, ev: ZoneEvent): void;
//# sourceMappingURL=zone-event-log.d.ts.map