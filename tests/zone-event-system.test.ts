// Loom Engine - Phase 16 ZoneEventSystem tests.
//
// Full lifecycle: spawn boss -> tick -> end. Verify per-zone
// ZoneEventLog ring buffer, active boss id, applied counts. Multiple
// zones simultaneously (system filters to local zone for state
// mutation; logs all). PHASE_INPUT ordering relative to v1
// DirectorSystem (the zone system runs AFTER the v1 system).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // v1 reused
  KnotContextResource,
  RESOURCE_KNOT_CONTEXT,
  // v2
  MockZoneBridge,
  ZoneEventSystem,
  RESOURCE_ZONE_EVENT_BRIDGE,
  RESOURCE_ZONE_EVENT_LOG,
  RESOURCE_DIRECTOR_ZONE_STATE,
  createZoneEventLog,
  createDirectorZoneStateResource,
  ZONE_RING_SIZE,
  // World plumbing
  RESOURCE_TIME,
  createTimeResource,
  SYSTEM_PHASE_INPUT,
  type ZoneEvent,
  type ZoneEventEnvelope,
} from '../src/index.js';

// ----- Helpers -----

function ev<T extends ZoneEvent['type']>(
  id: number,
  type: T,
  zone_id: string,
  data: Extract<ZoneEvent, { type: T }>['data'],
  emitter_id: string | null = null,
): ZoneEventEnvelope<T> {
  return { id, ts: 1700000000000 + id, type, zone_id, emitter_id, data };
}

function bossSpawnEvent(id: number, zone: string, bossId: string, line: string | null): ZoneEvent {
  return ev(id, 'zone.boss.spawn', zone, {
    boss: {
      boss_id: bossId,
      type: 'iron_titan',
      name: 'Iron Titan',
      hp_max: 1000,
      hp_current: 1000,
      dmg: 50,
      x: 5, y: 5,
      knot_flavor: 'str',
    },
    narrator_line: line,
  });
}

function bossTickEvent(id: number, zone: string, bossId: string, hp: number): ZoneEvent {
  return ev(id, 'zone.boss.tick', zone, {
    boss_id: bossId,
    hp_current: hp,
    x: 5, y: 5,
    recent_hits: [],
  });
}

function bossEndEvent(id: number, zone: string, bossId: string): ZoneEvent {
  return ev(id, 'zone.boss.end', zone, {
    boss_id: bossId,
    outcome: 'killed',
    killer_character_id: 'c_a',
    loot: [],
    duration_ms: 32000,
  });
}

// ----- Lifecycle: spawn -> tick -> end -----

test('zone system: spawn -> tick -> end lifecycle in single tick (local zone)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const stateRes = createDirectorZoneStateResource();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_DIRECTOR_ZONE_STATE, stateRes);
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    bossSpawnEvent(1, 'iron_reach', 'b_1', 'The Titan rises.'),
    bossTickEvent(2, 'iron_reach', 'b_1', 750),
    bossTickEvent(3, 'iron_reach', 'b_1', 500),
    bossEndEvent(4, 'iron_reach', 'b_1'),
  ]);
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  const entry = log.byZone.get('iron_reach');
  assert.ok(entry);
  assert.equal(entry.eventsApplied, 4);
  assert.equal(entry.activeBossId, null, 'boss.end clears activeBossId');
  assert.equal(entry.lastNarratorLine, 'The Titan rises.');
  assert.equal(entry.recent.length, 4);
  // Newest first
  assert.equal(entry.recent[0]?.type, 'zone.boss.end');
  assert.equal(entry.recent[3]?.type, 'zone.boss.spawn');
});

test('zone system: spawn sets activeBossId; mid-flight tick observable in ring buffer', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossSpawnEvent(1, 'iron_reach', 'b_1', null));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  let entry = log.byZone.get('iron_reach');
  assert.equal(entry?.activeBossId, 'b_1');

  bridge.enqueueIncoming(bossTickEvent(2, 'iron_reach', 'b_1', 800));
  w.update(0.016);
  entry = log.byZone.get('iron_reach');
  assert.equal(entry?.activeBossId, 'b_1');
  assert.equal(entry?.eventsApplied, 2);
  // Most recent event in ring buffer is the tick.
  assert.equal(entry?.recent[0]?.type, 'zone.boss.tick');
});

// ----- Multi-zone: log all, apply only local -----

test('zone system: multi-zone fanout - log everything, only local zone narrator applied', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    ev(1, 'zone.narrator', 'iron_reach', { line: 'IRON', voice: 'ambient', ttl_ms: 3000 }),
    ev(1, 'zone.narrator', 'saltsprig', { line: 'SALT', voice: 'ambient', ttl_ms: 3000 }),
  ]);
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  const ironEntry = log.byZone.get('iron_reach');
  const saltEntry = log.byZone.get('saltsprig');
  assert.ok(ironEntry);
  assert.ok(saltEntry);
  // Both zones logged.
  assert.equal(ironEntry.eventsApplied, 1);
  assert.equal(saltEntry.eventsApplied, 1);
  // Only the local zone's narrator stuck.
  assert.equal(ironEntry.lastNarratorLine, 'IRON');
  assert.equal(saltEntry.lastNarratorLine, null, 'foreign zone narrator does not bleed into entry');
});

test('zone system: multi-zone activeBossId tracked independently per zone', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    bossSpawnEvent(1, 'iron_reach', 'b_iron', null),
    bossSpawnEvent(1, 'saltsprig', 'b_kraken', null),
  ]);
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  // activeBossId tracked per zone regardless of local filter.
  assert.equal(log.byZone.get('iron_reach')?.activeBossId, 'b_iron');
  assert.equal(log.byZone.get('saltsprig')?.activeBossId, 'b_kraken');
});

test('zone system: local-zone filter skips foreign-zone knot palette mutation', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const knotCtx = new KnotContextResource();
  const initialPrimary = knotCtx.current.primary.r;
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // Foreign-zone knot pulse should NOT affect local KnotContext.
  bridge.enqueueIncoming(ev(1, 'zone.knot', 'saltsprig', {
    knot: 'dex',
    palette: { primary: '#000000', secondary: '#000000', accent: '#000000' },
    mood: 'climactic',
    fade_ms: 0,
  }));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  // Target should remain unchanged - the foreign-zone event was logged
  // but did not mutate the shared KnotContext.
  assert.equal(knotCtx.target.primary.r, initialPrimary);
  assert.equal(knotCtx.knot, 'str', 'knot id stays default after foreign zone event');
});

test('zone system: local zone knot pulse mutates KnotContext (parallel to v1)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const knotCtx = new KnotContextResource();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(ev(1, 'zone.knot', 'iron_reach', {
    knot: 'int',
    palette: { primary: '#9b5de5', secondary: '#5ac9d6', accent: '#ffd86a' },
    mood: 'climactic',
    fade_ms: 500,
  }));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(knotCtx.knot, 'int');
  assert.equal(knotCtx.mood, 'climactic');
  // beginFade was called - fade in progress.
  assert.equal(knotCtx.isFading(), true);
});

// ----- PHASE_INPUT ordering vs v1 DirectorSystem -----

test('zone system: PHASE_INPUT ordering - DirectorSystem runs first, then ZoneEventSystem', async () => {
  // Both systems registered in PHASE_INPUT in the order recommended
  // by the spec: DirectorSystem (v1) first, ZoneEventSystem (v2)
  // second. Verify both observe the same tick boundary and the v2
  // narrator overrides the v1 narrator when both fire.
  const { World } = await import('../src/world.js');
  const {
    DirectorSystem,
    MockDirectorBridge,
    RESOURCE_DIRECTOR_BRIDGE,
    RESOURCE_DIRECTOR_LOG,
    createDirectorEventLog,
  } = await import('../src/index.js');
  const w = new World();
  const v1Bridge = new MockDirectorBridge();
  v1Bridge.start();
  const v1Log = createDirectorEventLog();

  const v2Bridge = new MockZoneBridge();
  v2Bridge.start();
  const v2Log = createZoneEventLog();

  const knotCtx = new KnotContextResource();
  w.resources.set(RESOURCE_DIRECTOR_BRIDGE, v1Bridge);
  w.resources.set(RESOURCE_DIRECTOR_LOG, v1Log);
  w.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, v2Bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, v2Log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // v1 narrator first.
  v1Bridge.enqueue({
    id: 1, ts: 1, type: 'narrator.line',
    character_id: 'c', encounter_id: null,
    data: { line: 'V1 LINE', voice: 'ambient', ttl_ms: 1000 },
  });
  // v2 narrator AFTER (zone.narrator is per-zone; v1 is per-character).
  v2Bridge.enqueueIncoming(ev(1, 'zone.narrator', 'iron_reach', {
    line: 'V2 LINE', voice: 'urgent', ttl_ms: 2000,
  }));

  w.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  // v1 log got its line.
  assert.equal(v1Log.lastNarratorLine, 'V1 LINE');
  // v2 log got its (different) line.
  assert.equal(v2Log.byZone.get('iron_reach')?.lastNarratorLine, 'V2 LINE');
});

// ----- Snapshot recovery -----

test('zone system: zone.snapshot restores active boss + clears stale state', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const stateRes = createDirectorZoneStateResource();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_DIRECTOR_ZONE_STATE, stateRes);
  w.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // Apply a stale state first.
  bridge.enqueueIncoming(ev(1, 'zone.state', 'iron_reach', {
    changes: [{ key: 'door.gate_north', value: 'open' }, { key: 'fire.altar', value: false }],
  }));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(stateRes.byZone.get('iron_reach')?.get('door.gate_north'), 'open');

  // Now a snapshot wipes it and provides authoritative state.
  bridge.enqueueIncoming(ev(2, 'zone.snapshot', 'iron_reach', {
    active_boss: {
      boss_id: 'b_resumed',
      type: 'iron_titan',
      name: 'Iron Titan',
      hp_max: 1000,
      hp_current: 250,
      dmg: 50,
      x: 0, y: 0,
      knot_flavor: 'str',
    },
    knot: null,
    state: [{ key: 'fire.altar', value: true }],   // door key dropped
    last_event_id: 2,
  }));
  w.update(0.016);

  const map = stateRes.byZone.get('iron_reach');
  assert.ok(map);
  assert.equal(map.get('fire.altar'), true);
  assert.equal(map.has('door.gate_north'), false, 'snapshot replaced wholesale');
  assert.equal(log.byZone.get('iron_reach')?.activeBossId, 'b_resumed');
});

// ----- Ring buffer -----

test('zone system: per-zone ring buffer caps at ZONE_RING_SIZE entries', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  for (let i = 1; i <= ZONE_RING_SIZE + 18; i++) {
    bridge.enqueueIncoming(ev(i, 'zone.narrator', 'iron_reach', {
      line: 'L' + i, voice: 'ambient', ttl_ms: 1000,
    }));
  }
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  const entry = log.byZone.get('iron_reach');
  assert.ok(entry);
  assert.equal(entry.recent.length, ZONE_RING_SIZE);
  assert.equal(entry.eventsApplied, ZONE_RING_SIZE + 18);
  // Newest first.
  assert.equal(entry.recent[0]?.id, ZONE_RING_SIZE + 18);
});

// ----- No-bridge no-op -----

test('zone system: tolerates missing bridge / log (no-op)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  // No resources registered.
  w.addSystem(new ZoneEventSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);   // should not throw
});

test('zone system: when currentZone undefined, applies ALL events (single-zone consumer)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // No currentZone provided. Both events applied as if local.
  bridge.enqueueAll([
    ev(1, 'zone.narrator', 'a', { line: 'A', voice: 'ambient', ttl_ms: 1000 }),
    ev(1, 'zone.narrator', 'b', { line: 'B', voice: 'ambient', ttl_ms: 1000 }),
  ]);
  w.addSystem(new ZoneEventSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(log.byZone.get('a')?.lastNarratorLine, 'A');
  assert.equal(log.byZone.get('b')?.lastNarratorLine, 'B');
});

// ----- Defensive boss.end -----

test('zone system: zone.boss.end with mismatched bossId does not nuke a different active boss', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossSpawnEvent(1, 'iron_reach', 'b_current', null));
  bridge.enqueueIncoming(bossEndEvent(2, 'iron_reach', 'b_stale'));   // different id
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(log.byZone.get('iron_reach')?.activeBossId, 'b_current');
});
