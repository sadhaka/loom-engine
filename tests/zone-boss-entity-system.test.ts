// Loom Engine - Phase 18 ZoneBossEntitySystem tests
// (LOOM-BOSS-RENDER-SPEC §3.3).
//
// Verifies:
//   - spawn populates entity in correct zone
//   - tick updates HP + position + appends hit
//   - mismatched boss_id on tick is ignored (out-of-order safe)
//   - end clears entity to null
//   - snapshot replaces wholesale (entity if active_boss, null if not)
//   - recent_hits ring caps at RECENT_HITS_RING_SIZE
//   - multi-zone isolation (boss in zone A vs zone B)
//   - per-zone cursor advances correctly (no double-apply)
//   - tolerates missing log resource (no-op)
//   - tolerates missing entity resource (no-op)

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  World,
  ZoneBossEntitySystem,
  RESOURCE_ZONE_BOSS_ENTITY,
  RESOURCE_ZONE_EVENT_LOG,
  createZoneBossEntityResource,
  createZoneEventLog,
  getOrCreateZoneEntry,
  pushZoneEvent,
  RECENT_HITS_RING_SIZE,
  type ZoneBossEntityResource,
  type ZoneEventLog,
  type ZoneEvent,
  type ZoneEventEnvelope,
  type ZoneBossSpec,
  type ZoneBossHit,
} from '../src/index.js';

// ----- Helpers -----

function ev<T extends ZoneEvent['type']>(
  id: number,
  type: T,
  zone_id: string,
  data: Extract<ZoneEvent, { type: T }>['data'],
): ZoneEventEnvelope<T> {
  return {
    id,
    ts: 1700000000000 + id,
    type,
    zone_id,
    emitter_id: null,
    data,
  };
}

function spec(overrides: Partial<ZoneBossSpec> = {}): ZoneBossSpec {
  return {
    boss_id: 'b_iron',
    type: 'iron_titan',
    name: 'Iron Titan',
    hp_max: 1000,
    hp_current: 1000,
    dmg: 50,
    x: 5,
    y: 7,
    knot_flavor: 'str',
    ...overrides,
  };
}

function spawnEvent(id: number, zone: string, overrides: Partial<ZoneBossSpec> = {}): ZoneEvent {
  return ev(id, 'zone.boss.spawn', zone, {
    boss: spec(overrides),
    narrator_line: null,
  });
}

function tickEvent(
  id: number,
  zone: string,
  bossId: string,
  hp: number,
  x: number,
  y: number,
  hits: ReadonlyArray<ZoneBossHit> = [],
): ZoneEvent {
  return ev(id, 'zone.boss.tick', zone, {
    boss_id: bossId,
    hp_current: hp,
    x, y,
    recent_hits: hits,
  });
}

function endEvent(id: number, zone: string, bossId: string): ZoneEvent {
  return ev(id, 'zone.boss.end', zone, {
    boss_id: bossId,
    outcome: 'killed',
    killer_character_id: 'c_test',
    loot: [],
    duration_ms: 1000,
  });
}

function snapshotEvent(
  id: number,
  zone: string,
  activeBoss: ZoneBossSpec | null,
): ZoneEvent {
  return ev(id, 'zone.snapshot', zone, {
    active_boss: activeBoss,
    knot: null,
    state: [],
    last_event_id: id,
  });
}

interface Harness {
  world: World;
  log: ZoneEventLog;
  entities: ZoneBossEntityResource;
  system: ZoneBossEntitySystem;
  pushEvent: (zoneId: string, event: ZoneEvent) => void;
  tick: () => void;
}

function makeHarness(): Harness {
  const world = new World();
  const log = createZoneEventLog();
  const entities = createZoneBossEntityResource();
  world.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  world.resources.set(RESOURCE_ZONE_BOSS_ENTITY, entities);
  const system = new ZoneBossEntitySystem();
  return {
    world,
    log,
    entities,
    system,
    pushEvent(zoneId, event) {
      const entry = getOrCreateZoneEntry(log, zoneId);
      pushZoneEvent(entry, event);
    },
    tick() {
      system.update(world, 1 / 60);
    },
  };
}

// ----- Spawn -----

test('zone boss entity system: spawn populates entity in correct zone', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', {
    boss_id: 'b_warden', name: 'Warden', x: 3, y: 4,
  }));
  h.tick();

  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.boss_id, 'b_warden');
  assert.equal(entity.name, 'Warden');
  assert.equal(entity.x, 3);
  assert.equal(entity.y, 4);
  assert.equal(entity.recent_hits.length, 0);
  assert.equal(entity.spawned_at_ms, 1700000000001);
});

// ----- Tick -----

test('zone boss entity system: tick updates HP + position + appends hit', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_x', hp_max: 100, hp_current: 100 }));
  h.tick();

  h.pushEvent('iron_reach', tickEvent(2, 'iron_reach', 'b_x', 60, 8, 9, [
    { from_character_id: 'c_a', amount: 40, ts_ms: 1700000000002 },
  ]));
  h.tick();

  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.hp_current, 60);
  assert.equal(entity.x, 8);
  assert.equal(entity.y, 9);
  assert.equal(entity.recent_hits.length, 1);
  assert.equal(entity.recent_hits[0]?.amount, 40);
  assert.equal(entity.recent_hits[0]?.from_character_id, 'c_a');
});

// ----- Out-of-order tick -----

test('zone boss entity system: mismatched boss_id on tick is ignored', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_correct', hp_max: 100, hp_current: 100 }));
  h.tick();

  // Tick references a different boss_id - should be ignored without
  // mutating the active boss.
  h.pushEvent('iron_reach', tickEvent(2, 'iron_reach', 'b_stale', 50, 10, 10));
  h.tick();

  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.boss_id, 'b_correct');
  assert.equal(entity.hp_current, 100); // unchanged
  assert.equal(entity.x, 5);
  assert.equal(entity.y, 7);
});

// ----- End -----

test('zone boss entity system: end clears entity to null when boss_id matches', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_x' }));
  h.tick();
  assert.ok(h.entities.byZone.get('iron_reach'));

  h.pushEvent('iron_reach', endEvent(2, 'iron_reach', 'b_x'));
  h.tick();
  assert.equal(h.entities.byZone.get('iron_reach'), null);
});

test('zone boss entity system: end with mismatched boss_id leaves active boss intact', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_correct' }));
  h.tick();

  h.pushEvent('iron_reach', endEvent(2, 'iron_reach', 'b_stale'));
  h.tick();

  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.boss_id, 'b_correct');
});

// ----- Snapshot -----

test('zone boss entity system: snapshot with active_boss replaces wholesale', () => {
  const h = makeHarness();
  // Pre-existing boss in zone (will be replaced).
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_old' }));
  h.tick();

  h.pushEvent('iron_reach', snapshotEvent(2, 'iron_reach', spec({
    boss_id: 'b_snapshot', name: 'Snapshot Boss', hp_current: 750, x: 12, y: 13,
  })));
  h.tick();

  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.boss_id, 'b_snapshot');
  assert.equal(entity.hp_current, 750);
  assert.equal(entity.x, 12);
  assert.equal(entity.y, 13);
  // Snapshot resets recent_hits (rebuilt fresh from spec).
  assert.equal(entity.recent_hits.length, 0);
});

test('zone boss entity system: snapshot with null active_boss clears entity', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_old' }));
  h.tick();
  assert.ok(h.entities.byZone.get('iron_reach'));

  h.pushEvent('iron_reach', snapshotEvent(2, 'iron_reach', null));
  h.tick();

  assert.equal(h.entities.byZone.get('iron_reach'), null);
});

// ----- Ring cap -----

test('zone boss entity system: recent_hits ring caps at RECENT_HITS_RING_SIZE', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_x', hp_max: 100000, hp_current: 100000 }));
  h.tick();

  // 50 hits total, ring should cap at 32. Note ZONE_RING_SIZE for the
  // log is also 32, so we send the hits in batches small enough that
  // the log doesn't drop them - in practice a renderer at 60 Hz will
  // see ticks individually so we test the realistic path.
  for (let i = 0; i < 50; i++) {
    h.pushEvent('iron_reach', tickEvent(2 + i, 'iron_reach', 'b_x', 100000 - (i + 1) * 100, 0, 0, [
      { from_character_id: 'c_a', amount: 100, ts_ms: 1700000000002 + i },
    ]));
    // Tick once per push so the log ring doesn't drop events on us.
    h.tick();
  }

  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.recent_hits.length, RECENT_HITS_RING_SIZE);
  // Newest 32 hits retained; oldest 18 dropped from the front.
  // The 50th hit's amount lives at the tail of the array.
  assert.equal(entity.recent_hits[entity.recent_hits.length - 1]?.amount, 100);
});

// ----- Multi-zone isolation -----

test('zone boss entity system: multi-zone isolation - boss in A vs B independent', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_a', name: 'A' }));
  h.pushEvent('saltsprig', spawnEvent(1, 'saltsprig', { boss_id: 'b_b', name: 'B' }));
  h.tick();

  // Tick boss A in zone A; B should be untouched.
  h.pushEvent('iron_reach', tickEvent(2, 'iron_reach', 'b_a', 500, 1, 1));
  h.tick();

  const a = h.entities.byZone.get('iron_reach');
  const b = h.entities.byZone.get('saltsprig');
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.boss_id, 'b_a');
  assert.equal(a.hp_current, 500);
  assert.equal(b.boss_id, 'b_b');
  assert.equal(b.hp_current, 1000);
  assert.equal(b.x, 5);
  assert.equal(b.y, 7);
});

// ----- Cursor -----

test('zone boss entity system: cursor advances and prevents double-apply across ticks', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(1, 'iron_reach', { boss_id: 'b_x', hp_max: 1000, hp_current: 1000 }));
  h.tick();
  assert.equal(h.system.cursorFor('iron_reach'), 1);

  h.pushEvent('iron_reach', tickEvent(2, 'iron_reach', 'b_x', 800, 0, 0, [
    { from_character_id: 'c_a', amount: 200, ts_ms: 1700000000002 },
  ]));
  h.tick();
  assert.equal(h.system.cursorFor('iron_reach'), 2);

  // Subsequent ticks with no new events should not re-apply the
  // already-processed tick (recent_hits stays at 1, not 2).
  h.tick();
  h.tick();
  const entity = h.entities.byZone.get('iron_reach');
  assert.ok(entity);
  assert.equal(entity.recent_hits.length, 1);
  assert.equal(entity.hp_current, 800);
});

test('zone boss entity system: cursor is per-zone (advancing zone A does not affect zone B)', () => {
  const h = makeHarness();
  h.pushEvent('iron_reach', spawnEvent(5, 'iron_reach', { boss_id: 'b_a' }));
  h.pushEvent('saltsprig', spawnEvent(2, 'saltsprig', { boss_id: 'b_b' }));
  h.tick();

  assert.equal(h.system.cursorFor('iron_reach'), 5);
  assert.equal(h.system.cursorFor('saltsprig'), 2);
  // Zone B's lower id does not bleed into zone A's cursor.
  assert.notEqual(h.system.cursorFor('iron_reach'), 2);
});

// ----- Defensive guards -----

test('zone boss entity system: tolerates missing event log resource (no-op)', () => {
  const world = new World();
  const entities = createZoneBossEntityResource();
  world.resources.set(RESOURCE_ZONE_BOSS_ENTITY, entities);
  // Note: ZoneEventLog resource intentionally NOT set.
  const system = new ZoneBossEntitySystem();
  // Should not throw.
  system.update(world, 1 / 60);
  assert.equal(entities.byZone.size, 0);
});

test('zone boss entity system: tolerates missing entity resource (no-op)', () => {
  const world = new World();
  const log = createZoneEventLog();
  world.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  // Note: ZoneBossEntityResource intentionally NOT set.
  const entry = getOrCreateZoneEntry(log, 'iron_reach');
  pushZoneEvent(entry, spawnEvent(1, 'iron_reach'));
  const system = new ZoneBossEntitySystem();
  // Should not throw.
  system.update(world, 1 / 60);
});
