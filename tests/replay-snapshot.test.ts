// Loom Engine - replay snapshot regression test (Phase 0.18 polish).
//
// Replays tests/trace-replay/fixtures/sample-trace.json into a fresh
// HeadlessTicker (seed=42) and deep-compares the resulting world state
// against tests/fixtures/expected-final-state-seed-42.json. Any drift
// in zone-event handling, knot palette interpolation, zone state map
// projection, or zone-event log ring buffer ordering will fail this
// test with a clear diff.
//
// Maintenance: when a system change legitimately alters the snapshot
// (e.g. a new event type, a knot palette tweak), regenerate the
// fixture by running `npx tsx tests/replay-snapshot.regen.ts` (see the
// regen helper - the same code lives below in `buildSnapshot`).
//
// Why a hand-checked fixture and not deepEqual against another live
// run? A live-run comparison only catches non-determinism, not
// regressions. A fixture pinned to git is a tripwire for both:
// determinism violation -> the live snapshot diffs against the saved
// snapshot; system-behaviour regression -> the live snapshot diffs
// against what the prior version produced.

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
const TRACE_PATH = join(__dirname, 'trace-replay', 'fixtures', 'sample-trace.json');
const SNAPSHOT_PATH = join(__dirname, 'fixtures', 'expected-final-state-seed-42.json');

const SEED = 42;
const ZONE_ID = 'iron_reach';

// --- Snapshot shape ---
//
// Capture every field that meaningfully describes the world after
// replay. Test failure on any drift forces a deliberate fixture update.

interface Snapshot {
  schema: string;
  seed: number;
  zoneId: string;
  zoneLog: {
    eventsApplied: number;
    activeBossId: string | null;
    lastNarratorLine: string | null;
    lastNarratorTtlMs: number;
    recent: Array<{ id: number; type: string; zone_id: string }>;
  };
  zoneStateMap: Array<[string, unknown]>;
  knotContext: {
    knot: string;
    mood: string;
    target: { primary: NumColor; secondary: NumColor; accent: NumColor };
    current: { primary: NumColor; secondary: NumColor; accent: NumColor };
    fadeStartMs: number;
    fadeDurationMs: number;
  };
  entropyState: number;
}

interface NumColor { r: number; g: number; b: number; a: number }

function cloneColor(c: { r: number; g: number; b: number; a: number }): NumColor {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

// Build the snapshot from a world after the trace finishes. This is
// the same routine the regen helper uses.
function buildSnapshot(world: World): Snapshot {
  const log = world.resources.require<ZoneEventLog>(RESOURCE_ZONE_EVENT_LOG);
  const stateRes = world.resources.require<DirectorZoneStateResource>(RESOURCE_DIRECTOR_ZONE_STATE);
  const knotCtx = world.resources.require<KnotContextResource>(RESOURCE_KNOT_CONTEXT);
  const entry = log.byZone.get(ZONE_ID);
  const stateMap = stateRes.byZone.get(ZONE_ID);
  const entropyAny = world.resources.get<{ getState(): number }>(RESOURCE_ENTROPY);
  const entropyState = entropyAny ? entropyAny.getState() : -1;

  return {
    schema: 'loom.replay-snapshot.v1',
    seed: SEED,
    zoneId: ZONE_ID,
    zoneLog: {
      eventsApplied: entry?.eventsApplied ?? 0,
      activeBossId: entry?.activeBossId ?? null,
      lastNarratorLine: entry?.lastNarratorLine ?? null,
      lastNarratorTtlMs: entry?.lastNarratorTtlMs ?? 0,
      recent: (entry?.recent ?? []).map((e) => ({
        id: e.id,
        type: e.type,
        zone_id: e.zone_id,
      })),
    },
    zoneStateMap: stateMap ? Array.from(stateMap.entries()) : [],
    knotContext: {
      knot: knotCtx.knot,
      mood: knotCtx.mood,
      target: {
        primary: cloneColor(knotCtx.target.primary),
        secondary: cloneColor(knotCtx.target.secondary),
        accent: cloneColor(knotCtx.target.accent),
      },
      current: {
        primary: cloneColor(knotCtx.current.primary),
        secondary: cloneColor(knotCtx.current.secondary),
        accent: cloneColor(knotCtx.current.accent),
      },
      fadeStartMs: knotCtx.fadeStartMs,
      fadeDurationMs: knotCtx.fadeDurationMs,
    },
    entropyState,
  };
}

async function runReplay(): Promise<Snapshot> {
  const ticker = createHeadlessTicker({ tps: 60 });
  const w = ticker.getWorld();
  w.resources.set(RESOURCE_ENTROPY, createEntropy(SEED));
  const bridge = new MockZoneBridge();
  bridge.start();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  ticker.addSystem(
    new ZoneEventSystem({ currentZone: () => ZONE_ID }),
    SYSTEM_PHASE_INPUT,
  );
  const trace = JSON.parse(readFileSync(TRACE_PATH, 'utf8')) as ZoneTraceFile;
  const replayer = new TraceReplayer(trace);
  await replayer.replayInto(ticker);
  return buildSnapshot(w);
}

function loadFixture(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
}

test('replay snapshot: live replay matches the pinned fixture exactly (seed=42)', async () => {
  const live = await runReplay();
  const fixture = loadFixture();
  // Use deepEqual so the failure prints a structured diff.
  assert.deepEqual(live, fixture);
});

test('replay snapshot: fixture metadata is intact (schema, seed, zoneId)', () => {
  const fixture = loadFixture();
  assert.equal(fixture.schema, 'loom.replay-snapshot.v1');
  assert.equal(fixture.seed, SEED);
  assert.equal(fixture.zoneId, ZONE_ID);
});

test('replay snapshot: every event from the trace was applied', () => {
  const fixture = loadFixture();
  // Sample trace has 20 envelopes; if anyone trims it, the fixture
  // must be regenerated alongside the trace.
  assert.equal(fixture.zoneLog.eventsApplied, 20);
});

test('replay snapshot: live snapshot is reproducible across two runs', async () => {
  const a = await runReplay();
  const b = await runReplay();
  assert.deepEqual(a, b);
});
