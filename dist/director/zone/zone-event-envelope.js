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
// ----- Priority classes (spec §3.1) -----
const ZONE_PRIORITY_BY_TYPE = {
    'zone.boss.spawn': 'P0',
    'zone.boss.end': 'P0',
    'zone.snapshot': 'P0',
    'zone.state': 'P0',
    'zone.narrator': 'P1',
    'zone.knot': 'P1',
    'zone.boss.tick': 'P2',
};
export function priorityFor(type) {
    return ZONE_PRIORITY_BY_TYPE[type];
}
// ----- Parsers -----
export class ZoneEventEnvelopeParseError extends Error {
    raw;
    constructor(message, raw) {
        super('ZoneEventEnvelopeParseError: ' + message);
        this.raw = raw;
        this.name = 'ZoneEventEnvelopeParseError';
    }
}
const KNOWN_ZONE_EVENT_TYPES = new Set([
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
export function parseZoneEnvelope(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new ZoneEventEnvelopeParseError('envelope is not an object', raw);
    }
    const e = raw;
    if (typeof e['id'] !== 'number' || e['id'] < 0 || !Number.isFinite(e['id'])) {
        throw new ZoneEventEnvelopeParseError('id must be a non-negative number', raw);
    }
    if (typeof e['ts'] !== 'number') {
        throw new ZoneEventEnvelopeParseError('ts must be a number', raw);
    }
    if (typeof e['type'] !== 'string' || !KNOWN_ZONE_EVENT_TYPES.has(e['type'])) {
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
            throw new ZoneEventEnvelopeParseError('priority must be P0 / P1 / P2 when present, got: ' + String(e['priority']), raw);
        }
    }
    if (!e['data'] || typeof e['data'] !== 'object') {
        throw new ZoneEventEnvelopeParseError('data must be an object', raw);
    }
    return e;
}
// Convenience: parse a string (typically an SSE 'data:' line) into an
// envelope. Returns null on JSON parse error or shape error so the
// caller can decide whether to log or re-throw.
export function parseZoneEnvelopeJson(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return null;
    }
    try {
        return parseZoneEnvelope(parsed);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=zone-event-envelope.js.map