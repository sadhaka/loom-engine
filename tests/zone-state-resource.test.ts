// Loom Engine - Phase 16 DirectorZoneStateResource tests.
//
// State mutation via zone.state events; wholesale replace via
// zone.snapshot; per-zone isolation. Pure resource tests + a couple
// of system-level integration checks.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  createDirectorZoneStateResource,
  applyZoneStateChanges,
  replaceZoneStateFromSnapshot,
  getOrCreateZoneStateMap,
  RESOURCE_DIRECTOR_ZONE_STATE,
  RESOURCE_ZONE_EVENT_BRIDGE,
  RESOURCE_ZONE_EVENT_LOG,
  MockZoneBridge,
  ZoneEventSystem,
  createZoneEventLog,
  RESOURCE_TIME,
  createTimeResource,
  SYSTEM_PHASE_INPUT,
  type ZoneEvent,
  type ZoneEventEnvelope,
} from '../src/index.js';

function ev<T extends ZoneEvent['type']>(
  id: number,
  type: T,
  zone_id: string,
  data: Extract<ZoneEvent, { type: T }>['data'],
): ZoneEventEnvelope<T> {
  return { id, ts: 1700000000000 + id, type, zone_id, emitter_id: null, data };
}

// ----- Pure resource API -----

test('zone state resource: empty by default', () => {
  const res = createDirectorZoneStateResource();
  assert.equal(res.byZone.size, 0);
});

test('zone state resource: applyZoneStateChanges seeds + mutates per-zone map', () => {
  const res = createDirectorZoneStateResource();
  applyZoneStateChanges(res, 'iron_reach', [
    { key: 'door.gate_north', value: 'open' },
    { key: 'fire.altar', value: false },
  ]);
  const map = res.byZone.get('iron_reach');
  assert.ok(map);
  assert.equal(map.get('door.gate_north'), 'open');
  assert.equal(map.get('fire.altar'), false);
});

test('zone state resource: applyZoneStateChanges accumulates across calls', () => {
  const res = createDirectorZoneStateResource();
  applyZoneStateChanges(res, 'iron_reach', [{ key: 'a', value: 1 }]);
  applyZoneStateChanges(res, 'iron_reach', [{ key: 'b', value: 2 }]);
  const map = res.byZone.get('iron_reach');
  assert.equal(map?.get('a'), 1);
  assert.equal(map?.get('b'), 2);
});

test('zone state resource: applyZoneStateChanges later calls overwrite earlier values', () => {
  const res = createDirectorZoneStateResource();
  applyZoneStateChanges(res, 'iron_reach', [{ key: 'a', value: 1 }]);
  applyZoneStateChanges(res, 'iron_reach', [{ key: 'a', value: 2 }]);
  assert.equal(res.byZone.get('iron_reach')?.get('a'), 2);
});

test('zone state resource: empty changes array is a no-op', () => {
  const res = createDirectorZoneStateResource();
  applyZoneStateChanges(res, 'iron_reach', []);
  assert.equal(res.byZone.size, 0, 'no-op does not lazily create the zone map');
});

test('zone state resource: replaceZoneStateFromSnapshot wipes existing keys', () => {
  const res = createDirectorZoneStateResource();
  applyZoneStateChanges(res, 'iron_reach', [
    { key: 'a', value: 1 },
    { key: 'b', value: 2 },
    { key: 'c', value: 3 },
  ]);
  // Snapshot only has key b with new value.
  replaceZoneStateFromSnapshot(res, 'iron_reach', [{ key: 'b', value: 99 }]);
  const map = res.byZone.get('iron_reach');
  assert.ok(map);
  assert.equal(map.has('a'), false);
  assert.equal(map.get('b'), 99);
  assert.equal(map.has('c'), false);
});

test('zone state resource: replaceZoneStateFromSnapshot creates fresh map for unknown zone', () => {
  const res = createDirectorZoneStateResource();
  replaceZoneStateFromSnapshot(res, 'crystwell', [{ key: 'k', value: 'v' }]);
  assert.equal(res.byZone.get('crystwell')?.get('k'), 'v');
});

test('zone state resource: per-zone isolation - mutations to A do not affect B', () => {
  const res = createDirectorZoneStateResource();
  applyZoneStateChanges(res, 'iron_reach', [{ key: 'shared', value: 'iron' }]);
  applyZoneStateChanges(res, 'saltsprig', [{ key: 'shared', value: 'salt' }]);
  assert.equal(res.byZone.get('iron_reach')?.get('shared'), 'iron');
  assert.equal(res.byZone.get('saltsprig')?.get('shared'), 'salt');
});

test('zone state resource: getOrCreateZoneStateMap is idempotent', () => {
  const res = createDirectorZoneStateResource();
  const a = getOrCreateZoneStateMap(res, 'iron_reach');
  const b = getOrCreateZoneStateMap(res, 'iron_reach');
  assert.strictEqual(a, b, 'second call returns the same map instance');
  a.set('k', 'v');
  assert.equal(b.get('k'), 'v');
});

test('zone state resource: complex value types preserved verbatim', () => {
  const res = createDirectorZoneStateResource();
  const complex = { layers: [1, 2, 3], meta: { tier: 'amber' } };
  applyZoneStateChanges(res, 'iron_reach', [{ key: 'world', value: complex }]);
  const out = res.byZone.get('iron_reach')?.get('world');
  assert.deepStrictEqual(out, complex);
});

// ----- System-level integration -----

test('zone state resource (system): zone.state event mutates the resource', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const stateRes = createDirectorZoneStateResource();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_DIRECTOR_ZONE_STATE, stateRes);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(ev(1, 'zone.state', 'iron_reach', {
    changes: [{ key: 'door.gate_north', value: 'open' }],
  }));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(stateRes.byZone.get('iron_reach')?.get('door.gate_north'), 'open');
});

test('zone state resource (system): zone.snapshot replaces existing zone state wholesale', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const stateRes = createDirectorZoneStateResource();
  applyZoneStateChanges(stateRes, 'iron_reach', [{ key: 'stale', value: 'yes' }]);
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_DIRECTOR_ZONE_STATE, stateRes);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(ev(1, 'zone.snapshot', 'iron_reach', {
    active_boss: null,
    knot: null,
    state: [{ key: 'fresh', value: 'yes' }],
    last_event_id: 1,
  }));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);

  const map = stateRes.byZone.get('iron_reach');
  assert.ok(map);
  assert.equal(map.has('stale'), false, 'snapshot wiped stale key');
  assert.equal(map.get('fresh'), 'yes');
});

test('zone state resource (system): foreign zone state still mutates the resource (observation grade)', async () => {
  // The local-zone filter only gates GAMEPLAY effects (knot palette,
  // narrator). The state map is observation grade so debug HUDs that
  // flip to a foreign zone still see the right values.
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const stateRes = createDirectorZoneStateResource();
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_DIRECTOR_ZONE_STATE, stateRes);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(ev(1, 'zone.state', 'saltsprig', {
    changes: [{ key: 'tide', value: 'rising' }],
  }));
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'iron_reach' }), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(stateRes.byZone.get('saltsprig')?.get('tide'), 'rising');
});

test('zone state resource: RESOURCE_DIRECTOR_ZONE_STATE key is stable string', () => {
  // Lock the string contract; consumers identify the resource by this
  // key. Bumping it is a breaking change.
  assert.equal(RESOURCE_DIRECTOR_ZONE_STATE, 'director_zone_state');
});
