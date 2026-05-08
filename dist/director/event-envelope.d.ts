export interface EventEnvelope<T extends DirectorEventType = DirectorEventType> {
    id: number;
    ts: number;
    type: T;
    character_id: string;
    encounter_id: string | null;
    priority?: EventPriority;
    data: DirectorEventDataMap[T];
}
export interface MobSpec {
    type: string;
    name: string;
    hp: number;
    dmg: number;
    count: number;
    position_hint: {
        x: number;
        y: number;
    };
    knot_flavor: string;
}
export interface BossSpec {
    type: string;
    name: string;
    hp: number;
    dmg: number;
    position_hint: {
        x: number;
        y: number;
    };
    knot_flavor: string;
}
export interface DropSpec {
    item_id: string;
    name: string;
    slot: string;
    knot_affinity: string;
    stats: Record<string, number>;
}
export interface EncounterSpawnData {
    encounter_id: string;
    zone_id: string;
    level: number;
    knot: string;
    mobs: ReadonlyArray<MobSpec>;
    boss: BossSpec | null;
    narrator_line: string | null;
    difficulty_score: number;
}
export interface EncounterTickData {
    encounter_id: string;
    elapsed_ms: number;
    difficulty_delta: number;
    narrator_line: string | null;
    vfx_prompt: string | null;
}
export interface EncounterEndData {
    encounter_id: string;
    outcome: 'victory' | 'death' | 'flee';
    duration_ms: number;
    mob_killed: ReadonlyArray<string>;
    next_step: 'loot' | 'respawn' | 'transition' | 'idle';
}
export interface EncounterLootData {
    encounter_id: string;
    drops: ReadonlyArray<DropSpec>;
    ve_bonus: number;
    narrator_line: string | null;
}
export interface KnotPaletteHex {
    primary: string;
    secondary: string;
    accent: string;
}
export type KnotMood = 'calm' | 'tense' | 'climactic';
export interface KnotContextData {
    knot: string;
    palette: KnotPaletteHex;
    mood: KnotMood;
    fade_ms: number;
}
export type VeilTier = 'green' | 'amber' | 'red';
export interface VeBudgetUpdateData {
    ve_remaining_month: number;
    ve_ceiling_month: number;
    tier: VeilTier;
    tier_prev: VeilTier;
    encounter_budget_ve: number;
    encounter_budget_usd: number;
}
export type SceneTransitionKind = 'walk' | 'portal' | 'cinematic' | 'instant';
export interface SceneTransitionData {
    from_zone: string;
    to_zone: string;
    transition_kind: SceneTransitionKind;
    duration_ms: number;
}
export type NarratorVoice = 'ambient' | 'urgent' | 'whisper';
export interface NarratorLineData {
    line: string;
    voice: NarratorVoice;
    ttl_ms: number;
}
export interface SystemHeartbeatData {
    tail_id: number;
    drops_p2: number;
    drops_p1: number;
}
export interface SystemReplayCompleteData {
    from_id: number;
    to_id: number;
    events_sent: number;
}
export interface SystemSnapshotRequiredData {
    last_known_id: number;
    current_tail_id: number;
    retention_window: number;
}
export type DirectorEventType = 'encounter.spawn' | 'encounter.tick' | 'encounter.end' | 'encounter.loot' | 'knot.context' | 've.budget.update' | 'scene.transition' | 'narrator.line' | 'system.heartbeat' | 'system.replay.complete' | 'system.snapshot.required';
export interface DirectorEventDataMap {
    'encounter.spawn': EncounterSpawnData;
    'encounter.tick': EncounterTickData;
    'encounter.end': EncounterEndData;
    'encounter.loot': EncounterLootData;
    'knot.context': KnotContextData;
    've.budget.update': VeBudgetUpdateData;
    'scene.transition': SceneTransitionData;
    'narrator.line': NarratorLineData;
    'system.heartbeat': SystemHeartbeatData;
    'system.replay.complete': SystemReplayCompleteData;
    'system.snapshot.required': SystemSnapshotRequiredData;
}
export type DirectorEvent = {
    [K in DirectorEventType]: EventEnvelope<K>;
}[DirectorEventType];
export type EventPriority = 'P0' | 'P1' | 'P2';
export declare function priorityFor(type: DirectorEventType): EventPriority;
export declare class EventEnvelopeParseError extends Error {
    readonly raw: unknown;
    constructor(message: string, raw: unknown);
}
export declare function parseEnvelope(raw: unknown): DirectorEvent;
export declare function parseEnvelopeJson(json: string): DirectorEvent | null;
//# sourceMappingURL=event-envelope.d.ts.map