// Loom Engine - Phase 6 Director-bridge tests.
//
// Envelope parsing edge cases, MockDirectorBridge contract, palette
// crossfade math, DirectorSystem end-to-end mutating world resources.
// All tests run in Node via tsx --test; SSEDirectorBridge has its own
// browser-only path that's exercised by the demo's preview verification.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Envelope
  parseEnvelope,
  parseEnvelopeJson,
  priorityFor,
  EventEnvelopeParseError,
  // Bridge
  MockDirectorBridge,
  RESOURCE_DIRECTOR_BRIDGE,
  RESOURCE_KNOT_CONTEXT,
  // System + resource
  DirectorSystem,
  KnotContextResource,
  RESOURCE_DIRECTOR_LOG,
  createDirectorEventLog,
  // Re-used
  RESOURCE_VEIL_BUDGET,
  RESOURCE_TIME,
  createTimeResource,
  createVeilBudgetResource,
  SYSTEM_PHASE_INPUT,
  approxEq,
  type DirectorEvent,
  type VeilBudgetResource,
  type DirectorEventLog,
} from '../src/index.js';

// ---------- Helpers ----------

function makeKnotEvent(id: number, knot: string, primary: string, fadeMs: number): DirectorEvent {
  return {
    id,
    ts: 1000 + id,
    type: 'knot.context',
    character_id: 'c_test',
    encounter_id: null,
    data: {
      knot,
      palette: { primary, secondary: '#5ac9d6', accent: '#ffd86a' },
      mood: 'tense',
      fade_ms: fadeMs,
    },
  };
}

function makeBudgetEvent(id: number, tier: 'green' | 'amber' | 'red', remaining: number): DirectorEvent {
  return {
    id,
    ts: 2000 + id,
    type: 've.budget.update',
    character_id: 'c_test',
    encounter_id: null,
    data: {
      ve_remaining_month: remaining,
      ve_ceiling_month: 10000,
      tier,
      tier_prev: 'green',
      encounter_budget_ve: 100,
      encounter_budget_usd: 1.0,
    },
  };
}

// ---------- Envelope parsing ----------

test('envelope: parses a valid event', () => {
  const raw = {
    id: 1,
    ts: 1717000000.0,
    type: 'system.heartbeat',
    character_id: 'c_a',
    encounter_id: null,
    data: { tail_id: 1, drops_p1: 0, drops_p2: 0 },
  };
  const ev = parseEnvelope(raw);
  assert.equal(ev.id, 1);
  assert.equal(ev.type, 'system.heartbeat');
});

test('envelope: rejects non-object', () => {
  assert.throws(() => parseEnvelope(42), EventEnvelopeParseError);
  assert.throws(() => parseEnvelope(null), EventEnvelopeParseError);
  assert.throws(() => parseEnvelope('a string'), EventEnvelopeParseError);
});

test('envelope: rejects unknown event type', () => {
  const raw = {
    id: 1, ts: 1, type: 'mystery.event', character_id: 'c', encounter_id: null, data: {},
  };
  assert.throws(() => parseEnvelope(raw), EventEnvelopeParseError);
});

test('envelope: rejects negative id', () => {
  const raw = {
    id: -1, ts: 1, type: 'system.heartbeat', character_id: 'c', encounter_id: null,
    data: { tail_id: 0, drops_p1: 0, drops_p2: 0 },
  };
  assert.throws(() => parseEnvelope(raw), EventEnvelopeParseError);
});

test('envelope: rejects non-numeric ts', () => {
  const raw = {
    id: 1, ts: 'now', type: 'system.heartbeat', character_id: 'c', encounter_id: null,
    data: { tail_id: 0, drops_p1: 0, drops_p2: 0 },
  };
  assert.throws(() => parseEnvelope(raw), EventEnvelopeParseError);
});

test('envelope: rejects non-string character_id', () => {
  const raw = {
    id: 1, ts: 1, type: 'system.heartbeat', character_id: 42, encounter_id: null,
    data: { tail_id: 0, drops_p1: 0, drops_p2: 0 },
  };
  assert.throws(() => parseEnvelope(raw), EventEnvelopeParseError);
});

test('envelope: encounter_id null is valid; non-string non-null rejected', () => {
  const ok = {
    id: 1, ts: 1, type: 'system.heartbeat', character_id: 'c', encounter_id: null,
    data: { tail_id: 0, drops_p1: 0, drops_p2: 0 },
  };
  assert.doesNotThrow(() => parseEnvelope(ok));
  const bad = { ...ok, encounter_id: 42 };
  assert.throws(() => parseEnvelope(bad), EventEnvelopeParseError);
});

test('envelope: parseEnvelopeJson returns null on invalid JSON', () => {
  assert.equal(parseEnvelopeJson('{not json'), null);
});

test('envelope: parseEnvelopeJson returns null on shape error', () => {
  assert.equal(parseEnvelopeJson('{"id": -1}'), null);
});

test('envelope: priorityFor returns correct class', () => {
  assert.equal(priorityFor('encounter.spawn'), 'P0');
  assert.equal(priorityFor('encounter.end'), 'P0');
  assert.equal(priorityFor('encounter.loot'), 'P0');
  assert.equal(priorityFor('system.snapshot.required'), 'P0');
  assert.equal(priorityFor('knot.context'), 'P1');
  assert.equal(priorityFor('ve.budget.update'), 'P1');
  assert.equal(priorityFor('encounter.tick'), 'P2');
  assert.equal(priorityFor('system.heartbeat'), 'P2');
});

test('envelope: priority field optional but validated when present (Phase 6.4)', () => {
  const baseRaw = {
    id: 1, ts: 1, type: 'system.heartbeat', character_id: 'c', encounter_id: null,
    data: { tail_id: 0, drops_p1: 0, drops_p2: 0 },
  };
  // No priority -> still parses (back-compat with pre-6.4 events).
  const noPrio = parseEnvelope(baseRaw);
  assert.equal(noPrio.priority, undefined);
  // Valid priority -> parses + preserved on output.
  const withP0 = parseEnvelope({ ...baseRaw, priority: 'P0' });
  assert.equal(withP0.priority, 'P0');
  const withP1 = parseEnvelope({ ...baseRaw, priority: 'P1' });
  assert.equal(withP1.priority, 'P1');
  const withP2 = parseEnvelope({ ...baseRaw, priority: 'P2' });
  assert.equal(withP2.priority, 'P2');
  // Invalid priority -> rejected.
  assert.throws(() => parseEnvelope({ ...baseRaw, priority: 'P3' }), EventEnvelopeParseError);
  assert.throws(() => parseEnvelope({ ...baseRaw, priority: 42 }), EventEnvelopeParseError);
  assert.throws(() => parseEnvelope({ ...baseRaw, priority: '' }), EventEnvelopeParseError);
});

// ---------- MockDirectorBridge ----------

test('mock bridge: starts idle, becomes connected after start()', () => {
  const b = new MockDirectorBridge();
  assert.equal(b.status(), 'idle');
  assert.equal(b.isConnected(), false);
  b.start();
  assert.equal(b.status(), 'connected');
  assert.equal(b.isConnected(), true);
});

test('mock bridge: enqueue / pollEvents drains FIFO order + tracks lastEventId', () => {
  const b = new MockDirectorBridge();
  b.start();
  b.enqueue(makeKnotEvent(1, 'str', '#b04a24', 600));
  b.enqueue(makeKnotEvent(2, 'dex', '#5ac9d6', 600));
  b.enqueue(makeKnotEvent(3, 'int', '#9b5de5', 600));
  assert.equal(b.pending(), 3);
  const drained = b.pollEvents();
  assert.equal(drained.length, 3);
  assert.equal(drained[0]?.id, 1);
  assert.equal(drained[2]?.id, 3);
  assert.equal(b.pending(), 0);
  assert.equal(b.getLastEventId(), 3);
  // Next poll returns empty.
  assert.equal(b.pollEvents().length, 0);
});

test('mock bridge: out-of-order enqueue increments outOfOrderEvents', () => {
  const b = new MockDirectorBridge();
  b.start();
  b.enqueue(makeKnotEvent(5, 'str', '#b04a24', 0));
  b.enqueue(makeKnotEvent(2, 'dex', '#5ac9d6', 0));
  assert.equal(b.stats().outOfOrderEvents, 1);
  assert.equal(b.getLastEventId(), 5);
});

test('mock bridge: stop sets closed', () => {
  const b = new MockDirectorBridge();
  b.start();
  b.stop();
  assert.equal(b.status(), 'closed');
});

test('mock bridge: enqueueAll batch respects order', () => {
  const b = new MockDirectorBridge();
  b.start();
  b.enqueueAll([
    makeKnotEvent(1, 'str', '#b04a24', 0),
    makeKnotEvent(2, 'dex', '#5ac9d6', 0),
  ]);
  assert.equal(b.pending(), 2);
  assert.equal(b.stats().eventsReceived, 2);
});

// ---------- KnotContextResource ----------

test('knot context: starts with default Strknot palette', () => {
  const k = new KnotContextResource();
  assert.equal(k.knot, 'str');
  assert.equal(k.mood, 'tense');
  // Iron-red primary by default per LOOM-CLASS-SYSTEM-SPEC Section 4.
  assert.ok(approxEq(k.current.primary.r, 0xb0 / 255, 1e-3));
});

test('knot context: beginFade copies current to fadeFrom and sets target', () => {
  const k = new KnotContextResource();
  const initialPrimary = k.current.primary.r;
  k.beginFade(
    { primary: '#000000', secondary: '#000000', accent: '#000000' },
    400,
    1000,
  );
  assert.equal(k.fadeStartMs, 1000);
  assert.equal(k.fadeDurationMs, 400);
  assert.ok(approxEq(k.fadeFromPalette.primary.r, initialPrimary, 1e-9), 'fadeFrom snapshots current at fade start');
  assert.ok(approxEq(k.target.primary.r, 0, 1e-9), 'target reflects new palette');
});

test('knot context: tickFade interpolates linearly', () => {
  const k = new KnotContextResource();
  k.beginFade(
    { primary: '#ffffff', secondary: '#ffffff', accent: '#ffffff' },
    100,
    1000,
  );
  k.tickFade(1050);   // halfway
  assert.ok(approxEq(k.current.primary.r, (0xb0 / 255 + 1) / 2, 1e-3), 'r halfway between iron-red and white');
  k.tickFade(1100);
  assert.ok(approxEq(k.current.primary.r, 1, 1e-6), 'fully white at fade end');
  assert.equal(k.isFading(), false);
});

test('knot context: fade_ms = 0 is rendered as 1-frame fade', () => {
  const k = new KnotContextResource();
  k.beginFade(
    { primary: '#ffffff', secondary: '#ffffff', accent: '#ffffff' },
    0,
    1000,
  );
  assert.equal(k.fadeDurationMs, 16);
  // After 16ms tick, fade completes.
  k.tickFade(1016);
  assert.equal(k.isFading(), false);
});

test('knot context: mood multipliers per Section 5.4', () => {
  const k = new KnotContextResource();
  k.mood = 'calm';
  assert.equal(k.getBloomMultiplier(), 0.6);
  assert.equal(k.getShakeMultiplier(), 0.5);
  k.mood = 'climactic';
  assert.equal(k.getBloomMultiplier(), 1.4);
  assert.equal(k.getShakeMultiplier(), 1.5);
  k.mood = 'tense';
  assert.equal(k.getBloomMultiplier(), 1.0);
});

// ---------- DirectorSystem end-to-end ----------

test('director system: applies knot.context + starts crossfade', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockDirectorBridge();
  bridge.start();
  const knotCtx = new KnotContextResource();
  const log: DirectorEventLog = createDirectorEventLog();
  w.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueue(makeKnotEvent(1, 'int', '#9b5de5', 500));
  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.equal(knotCtx.knot, 'int');
  assert.equal(log.lastKnot, 'int');
  assert.equal(log.eventsApplied, 1);
  assert.equal(log.recent.length, 1);
  assert.equal(log.recent[0]?.type, 'knot.context');
});

test('director system: applies ve.budget.update + scales VeilBudget by tier', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockDirectorBridge();
  bridge.start();
  const knotCtx = new KnotContextResource();
  const log: DirectorEventLog = createDirectorEventLog();
  const budget: VeilBudgetResource = createVeilBudgetResource();
  w.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);
  w.resources.set(RESOURCE_VEIL_BUDGET, budget);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // green tier - default scalars
  bridge.enqueue(makeBudgetEvent(1, 'green', 8000));
  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(budget.audioBudget, 1.0);
  assert.equal(budget.particleBudget, 4096);

  // amber tier - 0.5 particle, 0.7 audio
  bridge.enqueue(makeBudgetEvent(2, 'amber', 3000));
  w.update(0.016);
  assert.equal(budget.audioBudget, 0.7);
  assert.equal(budget.particleBudget, 2048);

  // red tier - minimal
  bridge.enqueue(makeBudgetEvent(3, 'red', 500));
  w.update(0.016);
  assert.equal(budget.audioBudget, 0.4);
  assert.ok(budget.particleBudget < 500, 'red tier dramatically cuts particles');
  assert.equal(log.lastTier, 'red');
});

test('director system: encounter.spawn + encounter.end track activeEncounterId', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockDirectorBridge();
  bridge.start();
  const log: DirectorEventLog = createDirectorEventLog();
  w.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const spawn: DirectorEvent = {
    id: 1, ts: 1, type: 'encounter.spawn',
    character_id: 'c', encounter_id: 'enc_1',
    data: {
      encounter_id: 'enc_1', zone_id: 'iron_reach', level: 5, knot: 'str',
      mobs: [], boss: null, narrator_line: 'Bones rattle.', difficulty_score: 1.0,
    },
  };
  const end: DirectorEvent = {
    id: 2, ts: 2, type: 'encounter.end',
    character_id: 'c', encounter_id: 'enc_1',
    data: { encounter_id: 'enc_1', outcome: 'victory', duration_ms: 5000, mob_killed: [], next_step: 'loot' },
  };
  bridge.enqueueAll([spawn, end]);
  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  // Both events processed in same tick. encounter.end clears activeEncounterId.
  assert.equal(log.activeEncounterId, null);
  assert.equal(log.lastNarratorLine, 'Bones rattle.');
  assert.equal(log.recent.length, 2);
});

test('director system: ring buffer caps at 32 events', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockDirectorBridge();
  bridge.start();
  const log: DirectorEventLog = createDirectorEventLog();
  w.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  for (let i = 1; i <= 50; i++) {
    bridge.enqueue(makeKnotEvent(i, 'str', '#b04a24', 0));
  }
  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(log.recent.length, 32);
  assert.equal(log.eventsApplied, 50);
  // Newest first - so log.recent[0] is event id 50.
  assert.equal(log.recent[0]?.id, 50);
});

test('director system: tolerates missing bridge / KnotContext (no-op)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  // No resources registered.
  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  // Should not throw.
  w.update(0.016);
});

test('director system: narrator.line writes to log', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockDirectorBridge();
  bridge.start();
  const log = createDirectorEventLog();
  w.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_DIRECTOR_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueue({
    id: 1, ts: 1, type: 'narrator.line',
    character_id: 'c', encounter_id: null,
    data: { line: 'The Loom keeps a tally.', voice: 'ambient', ttl_ms: 4000 },
  });
  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.equal(log.lastNarratorLine, 'The Loom keeps a tally.');
  assert.equal(log.lastNarratorTtlMs, 4000);
});
