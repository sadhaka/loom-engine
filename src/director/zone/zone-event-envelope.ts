// Zone-event envelope + typed payloads (Phase 16, LOOM-DIRECTOR-PROTOCOL-V2 §3).
//
// v2 introduces a parallel event surface scoped per zone instead of per
// character. The Director emits a zone event, the server fans it out to
// every peer currently in that zone. v1's character-scoped EventEnvelope
// in ../event-envelope.ts remains the source of truth for v1 events and
// is NOT touched by this file.
//
// Spec invariants preserved:
//   - id is monotonic per zone (NOT global). Each zone is its own
//     append-only log starting at 1.
//   - emitter_id is the character_id that triggered the event, or null
//     when the Loom emitted spontaneously (timer, autonomous Director).
//   - encounter_id is GONE - zone events are zone-scoped, not encounter-
//     scoped.
//   - priority field carries v1 §7.2 semantics: P0 always delivered,
//     P1 dropped first under load, P2 next.
//   - Reuses v1's DropSpec, NarratorVoice, KnotPaletteHex, KnotMood so
//     consumer code that already understands v1 needs zero changes for
//     the overlapping shapes.

import type {
  DropSpec,
  EventPriority,
  KnotMood,
  KnotPaletteHex,
  NarratorVoice,
} from '../event-envelope.js';

// ----- Envelope -----

export interface ZoneEventEnvelope<T extends ZoneEventType = ZoneEventType> {
  // Monotonic per zone (NOT global). Server-assigned at emit time.
  id: number;
  // Server emit timestamp, ms since epoch.
  ts: number;
  type: T;
  // Authoritative scope. Server fans out to every peer currently in
  // this zone. Renderer applies the event ONLY when its local player
  // is in this zone (other-zone events get logged but not applied).
  zone_id: string;
  // character_id that triggered the event, or null for Loom-initiated
  // (timer-based or autonomous Director events).
  emitter_id: string | null;
  // Same semantics as v1: P0 always delivered, P1 first to drop under
  // load, P2 next. Optional for forward-compat with future server
  // versions that may omit when irrelevant.
  priority?: EventPriority;
  data: ZoneEventDataMap[T];
}

// ----- Per-event data shapes (spec §3.2) -----

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
  // Damage events since last tick. Empty array if no hits.
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
  // Free-form key/value mutation for zone state. Renderer reads
  // ZoneStateResource; gameplay systems decide what each key means.
  // The Director and the consumer agree on key naming offline.
  changes: ReadonlyArray<ZoneStateChange>;
}

export interface ZoneSnapshotData {
  // Full state of the zone at this moment. Sent to peers entering the
  // zone or recovering from a hard gap. Replaces local zone state
  // wholesale.
  active_boss: ZoneBossSpec | null;
  knot: ZoneKnotData | null;
  state: ReadonlyArray<ZoneStateChange>;
  last_event_id: number;
}

// ----- Type registry -----

export type ZoneEventType =
  | 'zone.boss.spawn'
  | 'zone.boss.tick'
  | 'zone.boss.end'
  | 'zone.narrator'
  | 'zone.knot'
  | 'zone.state'
  | 'zone.snapshot';

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

// ----- Priority classes (spec §3.1) -----

const ZONE_PRIORITY_BY_TYPE: Record<ZoneEventType, EventPriority> = {
  'zone.boss.spawn': 'P0',
  'zone.boss.end':   'P0',
  'zone.snapshot':   'P0',
  'zone.state':      'P0',
  'zone.narrator':   'P1',
  'zone.knot':       'P1',
  'zone.boss.tick':  'P2',
};

export function priorityFor(type: ZoneEventType): EventPriority {
  return ZONE_PRIORITY_BY_TYPE[type];
}

// ----- Parsers -----

export class ZoneEventEnvelopeParseError extends Error {
  constructor(message: string, public readonly raw: unknown) {
    super('ZoneEventEnvelopeParseError: ' + message);
    this.name = 'ZoneEventEnvelopeParseError';
  }
}

const KNOWN_ZONE_EVENT_TYPES: ReadonlySet<ZoneEventType> = new Set([
  'zone.boss.spawn',
  'zone.boss.tick',
  'zone.boss.end',
  'zone.narrator',
  'zone.knot',
  'zone.state',
  'zone.snapshot',
]);

// Validate envelope shape only - data payload validation is the caller's
// responsibility (downstream type narrowing on `event.type` gives full
// payload typing). Throws on shape errors so the bridge can decide to
// drop / log / reconnect. Mirrors parseEnvelope() in v1.
export function parseZoneEnvelope(raw: unknown): ZoneEvent {
  if (!raw || typeof raw !== 'object') {
    throw new ZoneEventEnvelopeParseError('envelope is not an object', raw);
  }
  const e = raw as Record<string, unknown>;
  if (typeof e['id'] !== 'number' || e['id'] < 0 || !Number.isFinite(e['id'])) {
    throw new ZoneEventEnvelopeParseError('id must be a non-negative number', raw);
  }
  if (typeof e['ts'] !== 'number') {
    throw new ZoneEventEnvelopeParseError('ts must be a number', raw);
  }
  if (typeof e['type'] !== 'string' || !KNOWN_ZONE_EVENT_TYPES.has(e['type'] as ZoneEventType)) {
    throw new ZoneEventEnvelopeParseError('unknown zone event type: ' + String(e['type']), raw);
  }
  if (typeof e['zone_id'] !== 'string' || e['zone_id'].length === 0) {
    throw new ZoneEventEnvelopeParseError('zone_id must be a non-empty string', raw);
  }
  if (e['emitter_id'] !== null && typeof e['emitter_id'] !== 'string') {
    throw new ZoneEventEnvelopeParseError('emitter_id must be string or null', raw);
  }
  if (e['priority'] !== undefined) {
    if (e['priority'] !== 'P0' && e['priority'] !== 'P1' && e['priority'] !== 'P2') {
      throw new ZoneEventEnvelopeParseError(
        'priority must be P0 / P1 / P2 when present, got: ' + String(e['priority']),
        raw,
      );
    }
  }
  if (!e['data'] || typeof e['data'] !== 'object') {
    throw new ZoneEventEnvelopeParseError('data must be an object', raw);
  }
  return e as unknown as ZoneEvent;
}

// Convenience: parse a string (typically an SSE 'data:' line) into an
// envelope. Returns null on JSON parse error or shape error so the
// caller can decide whether to log or re-throw.
export function parseZoneEnvelopeJson(json: string): ZoneEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  try {
    return parseZoneEnvelope(parsed);
  } catch {
    return null;
  }
}
