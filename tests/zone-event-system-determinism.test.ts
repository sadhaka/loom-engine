// Loom Engine - ZoneEventSystem determinism tests (Phase 0.18 polish).
//
// Two HeadlessTickers seeded the same and fed the same trace replay
// must arrive at byte-identical internal state. This is the
// determinism cornerstone for trace replay (E2) + smoke tests (E4) -
// without it, the rest of the determinism contract has nothing to
// build on.
//
// What we assert:
//   1. Identical bridges + same seed + same trace -> identical
//      ZoneEventLog ring buffer (entry-by-entry, type + id + zone),
//      identical activeBossId / lastNarratorLine, identical
//      DirectorZoneStateResource map contents, identical
//      KnotContextResource fields and palette numbers.
//   2. Iteration order is stable: a fresh shuffle of MockZoneBridge
//      ingestion order (same set, different enqueue sequence) does
//      change observable state (the system honours envelope id /
//      arrival order; this is the test for "we are NOT walking an
//      unordered map").
//   3. ZoneEventSystem does NOT consume the entropy resource - so
//      reseeding mid-replay must not affect zone state. (Tripwire
//      that catches a regression where someone wires entropy into
//      zone-event handling without thinking through replay impact.)
//
// Per CLAUDE.md tests can use modern JS (const, arrow fns, template
// literals) - only src/ has the var-only style.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createHeadlessTicker } from './headless-tick-harness.js';
import { TraceReplayer, type ZoneTraceFile } from './trace-replay/replay.js';
import {
  MockZoneBridge,
  ZoneEventSystem,
  RESOURCE_ZONE_EVENT_BRIDGE,
  RESOURCE_ZONE_EVENT_LOG,
  RESOURCE_DIRECTOR_ZONE_STATE,
  RESOURCE_KNOT_CONTEXT,
  RESOURCE_ENTROPY,
  createEntropy,
  type ZoneEventLog,
  type DirectorZoneStateResource,
  type KnotContextResource,
  type World,
  SYSTEM_PHASE_INPUT,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'trace-replay', 'fixtures', 'sample-trace.json');

function loadFixture(): ZoneTraceFile {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as ZoneTraceFile;
}

interface SystemSnapshot {
  zoneLog: {
    eventsApplied: number;
    activeBossId: string | null;
    lastNarratorLine: string | null;
    lastNarratorTtlMs: number;
    recentTypes: string[];
    recentIds: number[];
  };
  zoneStateMap: Array<[string, unknown]>;
  knot: {
    knot: string;
    mood: string;
    targetPrimary: { r: number; g: number; b: number; a: number };
    targetSecondary: { r: number; g: number; b: number; a: number };
    targetAccent: { r: number; g: number; b: number; a: number };
    fadeStartMs: number;
    fadeDurationMs: number;
  };
}

function snapshotZoneState(world: World, zoneId: string): SystemSnapshot {
  const log = world.resources.require<ZoneEventLog>(RESOURCE_ZONE_EVENT_LOG);
  const stateRes = world.resources.require<DirectorZoneStateResource>(RESOURCE_DIRECTOR_ZONE_STATE);
  const knotCtx = world.resources.require<KnotContextResource>(RESOURCE_KNOT_CONTEXT);

  const entry = log.byZone.get(zoneId);
  const stateMap = stateRes.byZone.get(zoneId);

  return {
    zoneLog: {
      eventsApplied: entry?.eventsApplied ?? 0,
      activeBossId: entry?.activeBossId ?? null,
      lastNarratorLine: entry?.lastNarratorLine ?? null,
      lastNarratorTtlMs: entry?.lastNarratorTtlMs ?? 0,
      recentTypes: (entry?.recent ?? []).map((e) => e.type),
      recentIds: (entry?.recent ?? []).map((e) => e.id),
    },
    zoneStateMap: stateMap ? Array.from(stateMap.entries()) : [],
    knot: {
      knot: knotCtx.knot,
      mood: knotCtx.mood,
      targetPrimary: { ...knotCtx.target.primary },
      targetSecondary: { ...knotCtx.target.secondary },
      targetAccent: { ...knotCtx.target.accent },
      fadeStartMs: knotCtx.fadeStartMs,
      fadeDurationMs: knotCtx.fadeDurationMs,
    },
  };
}

async function runReplayWithSeed(seed: number): Promise<SystemSnapshot> {
  const ticker = createHeadlessTicker({ tps: 60 });
  const w = ticker.getWorld();

  // Same seed => same entropy stream. ZoneEventSystem should NOT
  // consume entropy, but we wire it for parity with future systems
  // that might (and so the test catches such a regression as a
  // diff in this snapshot).
  w.resources.set(RESOURCE_ENTROPY, createEntropy(seed));

  const bridge = new MockZoneBridge();
  bridge.start();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  ticker.addSystem(
    new ZoneEventSystem({ currentZone: () => 'iron_reach' }),
    SYSTEM_PHASE_INPUT,
  );

  const trace = loadFixture();
  const replayer = new TraceReplayer(trace);
  await replayer.replayInto(ticker);

  return snapshotZoneState(w, 'iron_reach');
}

// ----- Core determinism: same seed -> same internal state -----

test('zone-event determinism: two tickers with seed=42 produce identical state after replay', async () => {
  const a = await runReplayWithSeed(42);
  const b = await runReplayWithSeed(42);
  assert.deepEqual(a, b);
});

test('zone-event determinism: same seed agrees on event-applied count', async () => {
  const a = await runReplayWithSeed(7);
  const b = await runReplayWithSeed(7);
  assert.equal(a.zoneLog.eventsApplied, 20);
  assert.equal(b.zoneLog.eventsApplied, 20);
});

test('zone-event determinism: ring buffer ids match exactly across runs', async () => {
  const a = await runReplayWithSeed(1234);
  const b = await runReplayWithSeed(1234);
  assert.deepEqual(a.zoneLog.recentIds, b.zoneLog.recentIds);
  // Ring buffer is newest-first: id 20 is the last narrator.
  assert.equal(a.zoneLog.recentIds[0], 20);
});

test('zone-event determinism: ring buffer event types are stable in newest-first order', async () => {
  const snap = await runReplayWithSeed(99);
  // The fixture is 20 envelopes, capped to ZONE_RING_SIZE=32, so all
  // 20 sit in the buffer. Newest first.
  assert.equal(snap.zoneLog.recentTypes.length, 20);
  assert.equal(snap.zoneLog.recentTypes[0], 'zone.narrator');
  // The very first event we sent was id=1 / zone.knot.
  assert.equal(snap.zoneLog.recentTypes[19], 'zone.knot');
});

// ----- Different seeds: same observable state, since zone-events do
// not consume entropy. This is the tripwire test described in the
// docstring above. -----

test('zone-event determinism: different seeds yield same zone state (no entropy reads in zone-event handling)', async () => {
  const a = await runReplayWithSeed(1);
  const b = await runReplayWithSeed(2);
  // If zone-event handling ever started reading from entropy, this
  // test would diverge - which is the cue to either:
  //   (a) put back the seed-blind contract by routing through a
  //       deterministic-only resource, or
  //   (b) change the test, knowing replay then requires the seed
  //       to be propagated everywhere zone events are applied.
  assert.deepEqual(a, b);
});

// ----- Ordering: identical envelope SET in different ENQUEUE orders
// must produce DIFFERENT terminal state (the system is order-sensitive
// by design - id + arrival order matter; we are NOT walking an
// unordered map). -----

test('zone-event determinism: out-of-order replay diverges from canonical order (system is arrival-order sensitive)', async () => {
  // Reverse the trace's envelope sequence and feed it. Final state
  // must differ because the LAST narrator line drives the banner.
  // The narrator id 20 ("The reach awaits...") is canonical; if we
  // reverse, the LAST narrator processed is id 17 ("Silence settles
  // back into the reach.") which becomes the banner.
  const ticker = createHeadlessTicker({ tps: 60 });
  const w = ticker.getWorld();
  const bridge = new MockZoneBridge();
  bridge.start();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  ticker.addSystem(
    new ZoneEventSystem({ currentZone: () => 'iron_reach' }),
    SYSTEM_PHASE_INPUT,
  );

  const trace = loadFixture();
  const reversed: ZoneTraceFile = {
    schema: trace.schema,
    ticksBetween: trace.ticksBetween,
    envelopes: [...trace.envelopes].reverse(),
  };
  const replayer = new TraceReplayer(reversed);
  await replayer.replayInto(ticker);

  const reversedSnap = snapshotZoneState(w, 'iron_reach');
  const forwardSnap = await runReplayWithSeed(0);
  assert.notDeepEqual(reversedSnap, forwardSnap, 'reverse-order replay must produce different terminal state');
  // Newest-first ring: the FIRST event we sent in reverse was id 20,
  // so it is the OLDEST entry now (last in newest-first order).
  assert.equal(reversedSnap.zoneLog.recentIds[19], 20);
  assert.equal(reversedSnap.zoneLog.recentIds[0], 1);
});

// ----- Snapshot comparison across deltaSeconds variants. The system
// uses TimeResource.elapsed * 1000 as the deterministic clock; the
// TPS doesn't change the semantic result (we still see the same
// envelopes applied in the same order). -----

test('zone-event determinism: TPS does not change the terminal state', async () => {
  // Helper that lets us tweak ticker TPS.
  const run = async (tps: number): Promise<SystemSnapshot> => {
    const ticker = createHeadlessTicker({ tps });
    const w = ticker.getWorld();
    w.resources.set(RESOURCE_ENTROPY, createEntropy(0));
    const bridge = new MockZoneBridge();
    bridge.start();
    w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
    ticker.addSystem(
      new ZoneEventSystem({ currentZone: () => 'iron_reach' }),
      SYSTEM_PHASE_INPUT,
    );
    const replayer = new TraceReplayer(loadFixture());
    await replayer.replayInto(ticker);
    return snapshotZoneState(w, 'iron_reach');
  };

  const fast = await run(120);
  const slow = await run(30);
  // Knot fade timing differs because nowMs depends on elapsed seconds,
  // but the SEMANTIC zone state (events applied, ring, active boss,
  // map keys, knot id) must agree.
  assert.equal(fast.zoneLog.eventsApplied, slow.zoneLog.eventsApplied);
  assert.deepEqual(fast.zoneLog.recentIds, slow.zoneLog.recentIds);
  assert.deepEqual(fast.zoneLog.recentTypes, slow.zoneLog.recentTypes);
  assert.equal(fast.zoneLog.activeBossId, slow.zoneLog.activeBossId);
  assert.equal(fast.zoneLog.lastNarratorLine, slow.zoneLog.lastNarratorLine);
  assert.equal(fast.knot.knot, slow.knot.knot);
  assert.deepEqual(fast.zoneStateMap, slow.zoneStateMap);
});
