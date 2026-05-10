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
const PRIORITY_BY_TYPE = {
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
export function priorityFor(type) {
    return PRIORITY_BY_TYPE[type];
}
// ----- Parsers -----
export class EventEnvelopeParseError extends Error {
    raw;
    constructor(message, raw) {
        super('EventEnvelopeParseError: ' + message);
        this.raw = raw;
        this.name = 'EventEnvelopeParseError';
    }
}
const KNOWN_EVENT_TYPES = new Set([
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
export function parseEnvelope(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new EventEnvelopeParseError('envelope is not an object', raw);
    }
    const e = raw;
    if (typeof e['id'] !== 'number' || e['id'] < 0 || !Number.isFinite(e['id'])) {
        throw new EventEnvelopeParseError('id must be a non-negative number', raw);
    }
    if (typeof e['ts'] !== 'number') {
        throw new EventEnvelopeParseError('ts must be a number', raw);
    }
    if (typeof e['type'] !== 'string' || !KNOWN_EVENT_TYPES.has(e['type'])) {
        throw new EventEnvelopeParseError('unknown event type: ' + String(e['type']), raw);
    }
    if (typeof e['character_id'] !== 'string') {
        throw new EventEnvelopeParseError('character_id must be a string', raw);
    }
    if (e['encounter_id'] !== null && typeof e['encounter_id'] !== 'string') {
        throw new EventEnvelopeParseError('encounter_id must be string or null', raw);
    }
    // Priority field is optional (Phase 6.4 backend addition; pre-6.4
    // events on disk lack it). When present, must be a known class.
    if (e['priority'] !== undefined) {
        if (e['priority'] !== 'P0' && e['priority'] !== 'P1' && e['priority'] !== 'P2') {
            throw new EventEnvelopeParseError('priority must be P0 / P1 / P2 when present, got: ' + String(e['priority']), raw);
        }
    }
    if (!e['data'] || typeof e['data'] !== 'object') {
        throw new EventEnvelopeParseError('data must be an object', raw);
    }
    return e;
}
// Convenience: parse a string (typically an SSE 'data:' line) into
// an envelope. Returns null on JSON parse error so the caller can
// decide whether to log or re-throw.
export function parseEnvelopeJson(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return null;
    }
    try {
        return parseEnvelope(parsed);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=event-envelope.js.map