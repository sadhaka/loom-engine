// Loom Engine - Phase 16 v2 zone-event envelope tests.
//
// Round-trip parser tests for all 7 zone event types; reject malformed
// envelopes; priority resolution table. Mirrors the v1 director.test.ts
// envelope-parsing section in style and shape.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  parseZoneEnvelope,
  parseZoneEnvelopeJson,
  zonePriorityFor,
  ZoneEventEnvelopeParseError,
  type ZoneEvent,
  type ZoneBossSpec,
  type ZoneEventEnvelope,
} from '../src/index.js';

// ----- Helpers -----

function bossSpec(overrides: Partial<ZoneBossSpec> = {}): ZoneBossSpec {
  return {
    boss_id: 'b_1',
    type: 'iron_titan',
    name: 'Iron Titan',
    hp_max: 1000,
    hp_current: 1000,
    dmg: 50,
    x: 12,
    y: 8,
    knot_flavor: 'str',
    ...overrides,
  };
}

function envelope<T extends ZoneEvent['type']>(
  id: number,
  type: T,
  zone_id: string,
  data: Extract<ZoneEvent, { type: T }>['data'],
  emitter_id: string | null = null,
): ZoneEventEnvelope<T> {
  return {
    id,
    ts: 1700000000000 + id,
    type,
    zone_id,
    emitter_id,
    data,
  };
}

// ----- Round-trip per type -----

test('zone envelope: round-trip zone.boss.spawn', () => {
  const ev = envelope(1, 'zone.boss.spawn', 'iron_reach', {
    boss: bossSpec(),
    narrator_line: 'The earth shakes.',
  });
  const json = JSON.stringify(ev);
  const parsed = parseZoneEnvelopeJson(json);
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.boss.spawn');
  assert.equal(parsed.zone_id, 'iron_reach');
  if (parsed.type === 'zone.boss.spawn') {
    assert.equal(parsed.data.boss.boss_id, 'b_1');
    assert.equal(parsed.data.narrator_line, 'The earth shakes.');
  }
});

test('zone envelope: round-trip zone.boss.tick', () => {
  const ev = envelope(2, 'zone.boss.tick', 'iron_reach', {
    boss_id: 'b_1',
    hp_current: 750,
    x: 14,
    y: 8,
    recent_hits: [
      { from_character_id: 'c_a', amount: 100, ts_ms: 1700000005000 },
      { from_character_id: 'c_b', amount: 150, ts_ms: 1700000005100 },
    ],
  });
  const parsed = parseZoneEnvelopeJson(JSON.stringify(ev));
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.boss.tick');
  if (parsed.type === 'zone.boss.tick') {
    assert.equal(parsed.data.recent_hits.length, 2);
    assert.equal(parsed.data.recent_hits[0]?.amount, 100);
  }
});

test('zone envelope: round-trip zone.boss.end killed + loot', () => {
  const ev = envelope(3, 'zone.boss.end', 'iron_reach', {
    boss_id: 'b_1',
    outcome: 'killed',
    killer_character_id: 'c_a',
    loot: [
      {
        item_id: 'iron_helm',
        name: 'Iron Helm',
        slot: 'head',
        knot_affinity: 'str',
        stats: { armor: 25 },
      },
    ],
    duration_ms: 32000,
  });
  const parsed = parseZoneEnvelopeJson(JSON.stringify(ev));
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.boss.end');
  if (parsed.type === 'zone.boss.end') {
    assert.equal(parsed.data.outcome, 'killed');
    assert.equal(parsed.data.loot[0]?.item_id, 'iron_helm');
  }
});

test('zone envelope: round-trip zone.narrator', () => {
  const ev = envelope(4, 'zone.narrator', 'iron_reach', {
    line: 'A bell tolls beneath the smoke.',
    voice: 'urgent',
    ttl_ms: 3500,
  });
  const parsed = parseZoneEnvelopeJson(JSON.stringify(ev));
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.narrator');
  if (parsed.type === 'zone.narrator') {
    assert.equal(parsed.data.voice, 'urgent');
    assert.equal(parsed.data.ttl_ms, 3500);
  }
});

test('zone envelope: round-trip zone.knot pulse', () => {
  const ev = envelope(5, 'zone.knot', 'iron_reach', {
    knot: 'str',
    palette: { primary: '#b04a24', secondary: '#5ac9d6', accent: '#ffd86a' },
    mood: 'climactic',
    fade_ms: 800,
  });
  const parsed = parseZoneEnvelopeJson(JSON.stringify(ev));
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.knot');
  if (parsed.type === 'zone.knot') {
    assert.equal(parsed.data.mood, 'climactic');
    assert.equal(parsed.data.palette.primary, '#b04a24');
  }
});

test('zone envelope: round-trip zone.state', () => {
  const ev = envelope(6, 'zone.state', 'iron_reach', {
    changes: [
      { key: 'door.gate_north', value: 'open' },
      { key: 'fire.altar', value: true },
      { key: 'altar.charges', value: 3 },
    ],
  });
  const parsed = parseZoneEnvelopeJson(JSON.stringify(ev));
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.state');
  if (parsed.type === 'zone.state') {
    assert.equal(parsed.data.changes.length, 3);
    assert.equal(parsed.data.changes[1]?.value, true);
  }
});

test('zone envelope: round-trip zone.snapshot', () => {
  const ev = envelope(7, 'zone.snapshot', 'iron_reach', {
    active_boss: bossSpec({ hp_current: 500 }),
    knot: {
      knot: 'str',
      palette: { primary: '#b04a24', secondary: '#5ac9d6', accent: '#ffd86a' },
      mood: 'tense',
      fade_ms: 0,
    },
    state: [{ key: 'door.gate_north', value: 'open' }],
    last_event_id: 12,
  });
  const parsed = parseZoneEnvelopeJson(JSON.stringify(ev));
  assert.ok(parsed);
  assert.equal(parsed.type, 'zone.snapshot');
  if (parsed.type === 'zone.snapshot') {
    assert.equal(parsed.data.last_event_id, 12);
    assert.equal(parsed.data.active_boss?.hp_current, 500);
    assert.equal(parsed.data.state.length, 1);
  }
});

// ----- Reject malformed -----

test('zone envelope: rejects non-object', () => {
  assert.throws(() => parseZoneEnvelope(42), ZoneEventEnvelopeParseError);
  assert.throws(() => parseZoneEnvelope(null), ZoneEventEnvelopeParseError);
  assert.throws(() => parseZoneEnvelope('a string'), ZoneEventEnvelopeParseError);
});

test('zone envelope: rejects unknown type', () => {
  const raw = {
    id: 1, ts: 1, type: 'mystery.zone', zone_id: 'z', emitter_id: null, data: {},
  };
  assert.throws(() => parseZoneEnvelope(raw), ZoneEventEnvelopeParseError);
});

test('zone envelope: rejects negative id', () => {
  const raw = {
    id: -1, ts: 1, type: 'zone.narrator', zone_id: 'z', emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  assert.throws(() => parseZoneEnvelope(raw), ZoneEventEnvelopeParseError);
});

test('zone envelope: rejects missing zone_id', () => {
  const raw = {
    id: 1, ts: 1, type: 'zone.narrator', emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  assert.throws(() => parseZoneEnvelope(raw), ZoneEventEnvelopeParseError);
});

test('zone envelope: rejects empty zone_id', () => {
  const raw = {
    id: 1, ts: 1, type: 'zone.narrator', zone_id: '', emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  assert.throws(() => parseZoneEnvelope(raw), ZoneEventEnvelopeParseError);
});

test('zone envelope: rejects non-string non-null emitter_id', () => {
  const raw = {
    id: 1, ts: 1, type: 'zone.narrator', zone_id: 'z', emitter_id: 42,
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  assert.throws(() => parseZoneEnvelope(raw), ZoneEventEnvelopeParseError);
});

test('zone envelope: emitter_id null is valid (Loom-initiated)', () => {
  const raw = {
    id: 1, ts: 1, type: 'zone.narrator', zone_id: 'z', emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  const ev = parseZoneEnvelope(raw);
  assert.equal(ev.emitter_id, null);
});

test('zone envelope: emitter_id string is valid (player-triggered)', () => {
  const raw = {
    id: 1, ts: 1, type: 'zone.narrator', zone_id: 'z', emitter_id: 'c_player',
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  const ev = parseZoneEnvelope(raw);
  assert.equal(ev.emitter_id, 'c_player');
});

test('zone envelope: parseZoneEnvelopeJson returns null on invalid JSON', () => {
  assert.equal(parseZoneEnvelopeJson('{not json'), null);
});

test('zone envelope: parseZoneEnvelopeJson returns null on shape error', () => {
  assert.equal(parseZoneEnvelopeJson('{"id": -1}'), null);
});

test('zone envelope: priority field optional but validated when present', () => {
  const baseRaw = {
    id: 1, ts: 1, type: 'zone.narrator', zone_id: 'z', emitter_id: null,
    data: { line: 'x', voice: 'ambient', ttl_ms: 0 },
  };
  const noPrio = parseZoneEnvelope(baseRaw);
  assert.equal(noPrio.priority, undefined);
  const withP0 = parseZoneEnvelope({ ...baseRaw, priority: 'P0' });
  assert.equal(withP0.priority, 'P0');
  const withP1 = parseZoneEnvelope({ ...baseRaw, priority: 'P1' });
  assert.equal(withP1.priority, 'P1');
  const withP2 = parseZoneEnvelope({ ...baseRaw, priority: 'P2' });
  assert.equal(withP2.priority, 'P2');
  assert.throws(() => parseZoneEnvelope({ ...baseRaw, priority: 'P3' }), ZoneEventEnvelopeParseError);
  assert.throws(() => parseZoneEnvelope({ ...baseRaw, priority: 42 }), ZoneEventEnvelopeParseError);
  assert.throws(() => parseZoneEnvelope({ ...baseRaw, priority: '' }), ZoneEventEnvelopeParseError);
});

// ----- Priority table (spec §3.1) -----

test('zone envelope: priorityFor returns correct class', () => {
  // P0 - always delivered
  assert.equal(zonePriorityFor('zone.boss.spawn'), 'P0');
  assert.equal(zonePriorityFor('zone.boss.end'), 'P0');
  assert.equal(zonePriorityFor('zone.snapshot'), 'P0');
  assert.equal(zonePriorityFor('zone.state'), 'P0');
  // P1 - dropped first under load
  assert.equal(zonePriorityFor('zone.narrator'), 'P1');
  assert.equal(zonePriorityFor('zone.knot'), 'P1');
  // P2 - high frequency, dropped first
  assert.equal(zonePriorityFor('zone.boss.tick'), 'P2');
});
