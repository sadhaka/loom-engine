// Director event envelope + typed event payloads.
//
// Per LOOM-DIRECTOR-PROTOCOL.md Section 3: every event shares an
// envelope of {id, ts, type, character_id, encounter_id, data} where
// `data` is type-specific. This file defines all 11 event types and
// the discriminated-union DirectorEvent that callers parse against.
//
// Spec invariants preserved:
//   - id is monotonic positive integer per (user, character)
//   - encounter_id is null for non-encounter-scoped events
//   - all hex palette values in knot.context come straight from
//     LOOM-CLASS-SYSTEM-SPEC Section 4 (Director sources them at
//     emit time; renderer trusts and applies)
//   - mood is one of 'calm' | 'tense' | 'climactic'
//   - tier is one of 'green' | 'amber' | 'red'

// ----- Envelope -----

export interface EventEnvelope<T extends DirectorEventType = DirectorEventType> {
  id: number;
  ts: number;
  type: T;
  character_id: string;
  encounter_id: string | null;
  data: DirectorEventDataMap[T];
}

// ----- Per-event data shapes -----

export interface MobSpec {
  type: string;
  name: string;
  hp: number;
  dmg: number;
  count: number;
  position_hint: { x: number; y: number };
  knot_flavor: string;
}

export interface BossSpec {
  type: string;
  name: string;
  hp: number;
  dmg: number;
  position_hint: { x: number; y: number };
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

// ----- Type registry -----

export type DirectorEventType =
  | 'encounter.spawn'
  | 'encounter.tick'
  | 'encounter.end'
  | 'encounter.loot'
  | 'knot.context'
  | 've.budget.update'
  | 'scene.transition'
  | 'narrator.line'
  | 'system.heartbeat'
  | 'system.replay.complete'
  | 'system.snapshot.required';

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

// ----- Priority classes (Section 7.2) -----

export type EventPriority = 'P0' | 'P1' | 'P2';

const PRIORITY_BY_TYPE: Record<DirectorEventType, EventPriority> = {
  'encounter.spawn': 'P0',
  'encounter.end': 'P0',
  'encounter.loot': 'P0',
  'system.replay.complete': 'P0',
  'system.snapshot.required': 'P0',
  'knot.context': 'P1',
  'scene.transition': 'P1',
  'narrator.line': 'P1',
  've.budget.update': 'P1',
  'encounter.tick': 'P2',
  'system.heartbeat': 'P2',
};

export function priorityFor(type: DirectorEventType): EventPriority {
  return PRIORITY_BY_TYPE[type];
}

// ----- Parsers -----

export class EventEnvelopeParseError extends Error {
  constructor(message: string, public readonly raw: unknown) {
    super('EventEnvelopeParseError: ' + message);
    this.name = 'EventEnvelopeParseError';
  }
}

const KNOWN_EVENT_TYPES: ReadonlySet<DirectorEventType> = new Set([
  'encounter.spawn',
  'encounter.tick',
  'encounter.end',
  'encounter.loot',
  'knot.context',
  've.budget.update',
  'scene.transition',
  'narrator.line',
  'system.heartbeat',
  'system.replay.complete',
  'system.snapshot.required',
]);

// Validate the envelope shape only - data payload validation is the
// caller's responsibility (downstream type narrowing on `event.type`
// gives full payload typing). Throws on shape errors so the bridge
// can decide to drop / log / reconnect.
export function parseEnvelope(raw: unknown): DirectorEvent {
  if (!raw || typeof raw !== 'object') {
    throw new EventEnvelopeParseError('envelope is not an object', raw);
  }
  const e = raw as Record<string, unknown>;
  if (typeof e['id'] !== 'number' || e['id'] < 0 || !Number.isFinite(e['id'])) {
    throw new EventEnvelopeParseError('id must be a non-negative number', raw);
  }
  if (typeof e['ts'] !== 'number') {
    throw new EventEnvelopeParseError('ts must be a number', raw);
  }
  if (typeof e['type'] !== 'string' || !KNOWN_EVENT_TYPES.has(e['type'] as DirectorEventType)) {
    throw new EventEnvelopeParseError('unknown event type: ' + String(e['type']), raw);
  }
  if (typeof e['character_id'] !== 'string') {
    throw new EventEnvelopeParseError('character_id must be a string', raw);
  }
  if (e['encounter_id'] !== null && typeof e['encounter_id'] !== 'string') {
    throw new EventEnvelopeParseError('encounter_id must be string or null', raw);
  }
  if (!e['data'] || typeof e['data'] !== 'object') {
    throw new EventEnvelopeParseError('data must be an object', raw);
  }
  return e as unknown as DirectorEvent;
}

// Convenience: parse a string (typically an SSE 'data:' line) into
// an envelope. Returns null on JSON parse error so the caller can
// decide whether to log or re-throw.
export function parseEnvelopeJson(json: string): DirectorEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  try {
    return parseEnvelope(parsed);
  } catch {
    return null;
  }
}
