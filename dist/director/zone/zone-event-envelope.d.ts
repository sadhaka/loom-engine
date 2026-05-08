import type { DropSpec, EventPriority, KnotMood, KnotPaletteHex, NarratorVoice } from '../event-envelope.js';
export interface ZoneEventEnvelope<T extends ZoneEventType = ZoneEventType> {
    id: number;
    ts: number;
    type: T;
    zone_id: string;
    emitter_id: string | null;
    priority?: EventPriority;
    data: ZoneEventDataMap[T];
}
export interface ZoneBossSpec {
    boss_id: string;
    type: string;
    name: string;
    hp_max: number;
    hp_current: number;
    dmg: number;
    x: number;
    y: number;
    knot_flavor: string;
}
export interface ZoneBossSpawnData {
    boss: ZoneBossSpec;
    narrator_line: string | null;
}
export interface ZoneBossHit {
    from_character_id: string;
    amount: number;
    ts_ms: number;
}
export interface ZoneBossTickData {
    boss_id: string;
    hp_current: number;
    x: number;
    y: number;
    recent_hits: ReadonlyArray<ZoneBossHit>;
}
export type ZoneBossOutcome = 'killed' | 'despawned' | 'fled';
export interface ZoneBossEndData {
    boss_id: string;
    outcome: ZoneBossOutcome;
    killer_character_id: string | null;
    loot: ReadonlyArray<DropSpec>;
    duration_ms: number;
}
export interface ZoneNarratorData {
    line: string;
    voice: NarratorVoice;
    ttl_ms: number;
}
export interface ZoneKnotData {
    knot: string;
    palette: KnotPaletteHex;
    mood: KnotMood;
    fade_ms: number;
}
export interface ZoneStateChange {
    key: string;
    value: unknown;
}
export interface ZoneStateData {
    changes: ReadonlyArray<ZoneStateChange>;
}
export interface ZoneSnapshotData {
    active_boss: ZoneBossSpec | null;
    knot: ZoneKnotData | null;
    state: ReadonlyArray<ZoneStateChange>;
    last_event_id: number;
}
export type ZoneEventType = 'zone.boss.spawn' | 'zone.boss.tick' | 'zone.boss.end' | 'zone.narrator' | 'zone.knot' | 'zone.state' | 'zone.snapshot';
export interface ZoneEventDataMap {
    'zone.boss.spawn': ZoneBossSpawnData;
    'zone.boss.tick': ZoneBossTickData;
    'zone.boss.end': ZoneBossEndData;
    'zone.narrator': ZoneNarratorData;
    'zone.knot': ZoneKnotData;
    'zone.state': ZoneStateData;
    'zone.snapshot': ZoneSnapshotData;
}
export type ZoneEvent = {
    [K in ZoneEventType]: ZoneEventEnvelope<K>;
}[ZoneEventType];
export declare function priorityFor(type: ZoneEventType): EventPriority;
export declare class ZoneEventEnvelopeParseError extends Error {
    readonly raw: unknown;
    constructor(message: string, raw: unknown);
}
export declare function parseZoneEnvelope(raw: unknown): ZoneEvent;
export declare function parseZoneEnvelopeJson(json: string): ZoneEvent | null;
//# sourceMappingURL=zone-event-envelope.d.ts.map