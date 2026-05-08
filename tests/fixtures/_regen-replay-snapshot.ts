// Loom Engine - replay snapshot regenerator (Phase 0.18 polish).
//
// Hand-run when a system change legitimately changes the snapshot
// produced by replaying tests/trace-replay/fixtures/sample-trace.json
// with seed=42. The output is written to:
//   tests/fixtures/expected-final-state-seed-42.json
//
// Usage (engine repo root):
//   npx tsx tests/fixtures/_regen-replay-snapshot.ts
//
// Then commit the regenerated file alongside the system change so
// tests/replay-snapshot.test.ts passes.
//
// Author note: this is the same buildSnapshot routine that
// replay-snapshot.test.ts uses, kept inline here so the regen path
// has zero implicit dependencies on the test runner.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createHeadlessTicker } from '../headless-tick-harness.js';
import { TraceReplayer, type ZoneTraceFile } from '../trace-replay/replay.js';
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
} from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACE_PATH = join(__dirname, '..', 'trace-replay', 'fixtures', 'sample-trace.json');
const SNAPSHOT_PATH = join(__dirname, 'expected-final-state-seed-42.json');

const SEED = 42;
const ZONE_ID = 'iron_reach';

function cloneColor(c: { r: number; g: number; b: number; a: number }): { r: number; g: number; b: number; a: number } {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

function buildSnapshot(world: World): unknown {
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

async function main(): Promise<void> {
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
  const snap = buildSnapshot(w);
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  console.log('wrote ' + SNAPSHOT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
