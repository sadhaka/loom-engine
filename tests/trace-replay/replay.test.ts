// Loom Engine - zone-event trace replay test.
//
// Loads tests/trace-replay/fixtures/sample-trace.json (20 envelopes
// covering boss spawn / tick / end / knot / state / snapshot / narrator
// fanout), feeds them into a HeadlessTicker that has a ZoneEventSystem
// + MockZoneBridge wired in, then asserts the resulting world state
// matches the trace's hand-known terminal state.
//
// Acceptance criteria the trace exercises:
//   - boss.spawn -> activeBossId set, narrator line stuck
//   - boss.tick(s) -> log only
//   - boss.end -> activeBossId cleared
//   - zone.knot -> KnotContext mutated, last knot palette set
//   - zone.state -> per-zone state map mutates
//   - zone.snapshot -> state map replaced wholesale, activeBossId reset
//   - final narrator overrides the snapshot's banner

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createHeadlessTicker } from '../headless-tick-harness.js';
import { TraceReplayer, type ZoneTraceFile } from './replay.js';
import {
  MockZoneBridge,
  ZoneEventSystem,
  RESOURCE_ZONE_EVENT_BRIDGE,
  RESOURCE_ZONE_EVENT_LOG,
  RESOURCE_DIRECTOR_ZONE_STATE,
  RESOURCE_KNOT_CONTEXT,
  type ZoneEventLog,
  type DirectorZoneStateResource,
  type KnotContextResource,
  SYSTEM_PHASE_INPUT,
} from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'sample-trace.json');

function loadFixture(): ZoneTraceFile {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as ZoneTraceFile;
}

test('trace replay: TraceReplayer rejects bad shape', () => {
  assert.throws(
    () => new TraceReplayer({ envelopes: 'not an array' as unknown as never[] }),
    /envelopes must be an array/,
  );
});

test('trace replay: envelopeCount reports loaded fixture size', () => {
  const trace = loadFixture();
  const r = new TraceReplayer(trace);
  assert.equal(r.envelopeCount(), 20);
});

test('trace replay: replayInto throws when bridge is missing', async () => {
  const ticker = createHeadlessTicker({ tps: 60 });
  const trace = loadFixture();
  const replayer = new TraceReplayer(trace);
  await assert.rejects(
    () => replayer.replayInto(ticker),
    /no RESOURCE_ZONE_EVENT_BRIDGE/,
  );
});

test('trace replay: 20-envelope iron_reach trace - terminal state matches expectations', async () => {
  const ticker = createHeadlessTicker({ tps: 60 });
  const w = ticker.getWorld();

  // Wire the MockZoneBridge + ZoneEventSystem. The ticker already has
  // ZoneEventLog / DirectorZoneStateResource / KnotContextResource
  // registered by the harness's buildWorld.
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

  // ----- Per-zone log -----
  const log = w.resources.require<ZoneEventLog>(RESOURCE_ZONE_EVENT_LOG);
  const entry = log.byZone.get('iron_reach');
  assert.ok(entry, 'iron_reach entry exists');
  assert.equal(entry.eventsApplied, 20);
  // boss.end (id 15) cleared activeBossId; snapshot (id 19) confirmed
  // null; nothing after spawned a new boss.
  assert.equal(entry.activeBossId, null, 'no active boss at end of trace');
  // The very last narrator (id 20) must be the banner.
  assert.equal(entry.lastNarratorLine, 'The reach awaits the next disturbance.');

  // ----- Knot palette -----
  const knotCtx = w.resources.require<KnotContextResource>(RESOURCE_KNOT_CONTEXT);
  // Last zone.knot was id 16 (dex). The snapshot at id 19 had knot=null
  // so it did NOT override.
  assert.equal(knotCtx.knot, 'dex');
  // Target palette is the dex knot.
  assert.equal(knotCtx.target.primary.r, 0x5a / 255);
  assert.equal(knotCtx.target.primary.g, 0xc9 / 255);

  // ----- Per-zone state map -----
  const stateRes = w.resources.require<DirectorZoneStateResource>(RESOURCE_DIRECTOR_ZONE_STATE);
  const stateMap = stateRes.byZone.get('iron_reach');
  assert.ok(stateMap);
  // Snapshot at id 19 wiped previous state and seeded only
  // door.gate_north=open. fire.altar should NOT be present.
  assert.equal(stateMap.get('door.gate_north'), 'open');
  assert.equal(stateMap.has('fire.altar'), false, 'snapshot wiped the altar key');
});

test('trace replay: ticksBetween > 1 still drains the bridge correctly', async () => {
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
  // Force 3 ticks per envelope - ZoneEventSystem polls each tick, so
  // every envelope still gets exactly one apply, but the time advances
  // 3x faster.
  trace.ticksBetween = 3;

  const replayer = new TraceReplayer(trace);
  await replayer.replayInto(ticker);

  const log = w.resources.require<ZoneEventLog>(RESOURCE_ZONE_EVENT_LOG);
  assert.equal(log.byZone.get('iron_reach')?.eventsApplied, 20);
  // 20 envelopes * 3 ticks = 60 frames.
  assert.equal(ticker.getFrame(), 60);
});
