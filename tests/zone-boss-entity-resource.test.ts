// Loom Engine - Phase 18 ZoneBossEntityResource tests
// (LOOM-BOSS-RENDER-SPEC §3.3).
//
// Pure resource + helper API. Verifies:
//   - factory creates an empty byZone Map
//   - byZone is per-zone isolated (mutation in one zone does not bleed)
//   - null -> spawn -> null lifecycle works (death transition)
//   - buildEntityFromSpawn maps all 12 fields correctly
//   - applyTick updates HP + position + appends to recent_hits ring
//   - applyTick caps recent_hits at RECENT_HITS_RING_SIZE
//   - buildEntityFromSpawn supports zone.snapshot's active_boss path
//   - RESOURCE_ZONE_BOSS_ENTITY key is stable

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  createZoneBossEntityResource,
  buildEntityFromSpawn,
  applyTick,
  RESOURCE_ZONE_BOSS_ENTITY,
  RECENT_HITS_RING_SIZE,
  type ZoneBossEntity,
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
  return { id, ts: 1700000000000 + id, type, zone_id, emitter_id: null, data };
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

// ----- Factory -----

test('zone boss entity resource: factory creates empty byZone map', () => {
  const res = createZoneBossEntityResource();
  assert.equal(res.byZone.size, 0);
  assert.ok(res.byZone instanceof Map);
});

test('zone boss entity resource: RESOURCE_ZONE_BOSS_ENTITY key is stable string', () => {
  // Lock the string contract; consumers identify the resource by this
  // key. Bumping it is a breaking change.
  assert.equal(RESOURCE_ZONE_BOSS_ENTITY, 'zone_boss_entity');
});

test('zone boss entity resource: RECENT_HITS_RING_SIZE is 32', () => {
  // Spec §3.1 locks the ring size at 32 for floating-damage-number
  // renderers. Renderers depend on this constant for diff calculations.
  assert.equal(RECENT_HITS_RING_SIZE, 32);
});

// ----- byZone isolation -----

test('zone boss entity resource: byZone per-zone isolation - mutation in A does not affect B', () => {
  const res = createZoneBossEntityResource();
  const a = buildEntityFromSpawn(spawnEvent(1, 'iron_reach', { boss_id: 'b_a', x: 1, y: 1 }));
  const b = buildEntityFromSpawn(spawnEvent(2, 'saltsprig', { boss_id: 'b_b', x: 99, y: 99 }));
  res.byZone.set('iron_reach', a);
  res.byZone.set('saltsprig', b);

  // Mutate A's hp + position via tick.
  applyTick(a, tickEvent(3, 'iron_reach', 'b_a', 500, 2, 2));

  // B is untouched.
  const bAfter = res.byZone.get('saltsprig');
  assert.ok(bAfter);
  assert.equal(bAfter.hp_current, 1000);
  assert.equal(bAfter.x, 99);
  assert.equal(bAfter.y, 99);
  // A IS touched.
  const aAfter = res.byZone.get('iron_reach');
  assert.ok(aAfter);
  assert.equal(aAfter.hp_current, 500);
  assert.equal(aAfter.x, 2);
});

// ----- Lifecycle: null -> spawn -> null -----

test('zone boss entity resource: null -> spawn -> null lifecycle', () => {
  const res = createZoneBossEntityResource();
  // Initially: zone has no entry.
  assert.equal(res.byZone.has('iron_reach'), false);

  // Pre-existing null is a valid state too (e.g. zone observed but no
  // boss active).
  res.byZone.set('iron_reach', null);
  assert.equal(res.byZone.get('iron_reach'), null);

  // Spawn populates.
  const e = buildEntityFromSpawn(spawnEvent(1, 'iron_reach'));
  res.byZone.set('iron_reach', e);
  assert.ok(res.byZone.get('iron_reach'));

  // End sets back to null.
  res.byZone.set('iron_reach', null);
  assert.equal(res.byZone.get('iron_reach'), null);

  // Re-spawn populates again (different boss).
  const e2 = buildEntityFromSpawn(spawnEvent(5, 'iron_reach', { boss_id: 'b_resurrected' }));
  res.byZone.set('iron_reach', e2);
  assert.equal(res.byZone.get('iron_reach')?.boss_id, 'b_resurrected');
});

// ----- buildEntityFromSpawn: 12-field mapping -----

test('zone boss entity resource: buildEntityFromSpawn maps all 12 fields from envelope', () => {
  const env = spawnEvent(42, 'crystwell', {
    boss_id: 'b_warden',
    type: 'lastlight_warden',
    name: 'Lastlight Warden',
    hp_max: 5000,
    hp_current: 5000,
    dmg: 120,
    x: 12.5,
    y: 7.25,
    knot_flavor: 'center',
  });
  const e: ZoneBossEntity = buildEntityFromSpawn(env);

  // Spec §3.1 lists 12 fields. Verify each.
  assert.equal(e.zone_id, 'crystwell');
  assert.equal(e.boss_id, 'b_warden');
  assert.equal(e.name, 'Lastlight Warden');
  assert.equal(e.type, 'lastlight_warden');
  assert.equal(e.hp_max, 5000);
  assert.equal(e.hp_current, 5000);
  assert.equal(e.dmg, 120);
  assert.equal(e.x, 12.5);
  assert.equal(e.y, 7.25);
  assert.equal(e.knot_flavor, 'center');
  assert.equal(e.spawned_at_ms, env.ts, 'spawned_at_ms is the envelope ts');
  assert.equal(e.last_tick_ms, env.ts, 'last_tick_ms is initialized to spawn ts');
  assert.deepEqual(e.recent_hits, [], 'recent_hits is empty on spawn');
});

test('zone boss entity resource: buildEntityFromSpawn from zone.snapshot active_boss path', () => {
  // Snapshot recovery (cold join + reconnect) carries the same
  // ZoneBossSpec under data.active_boss; helper supports both paths.
  const snapshotEnv = ev(99, 'zone.snapshot', 'iron_reach', {
    active_boss: spec({ boss_id: 'b_resumed', hp_current: 200 }),
    knot: null,
    state: [],
    last_event_id: 99,
  });
  const e = buildEntityFromSpawn(snapshotEnv);
  assert.equal(e.boss_id, 'b_resumed');
  assert.equal(e.hp_current, 200);
  assert.equal(e.spawned_at_ms, snapshotEnv.ts);
  assert.equal(e.zone_id, 'iron_reach');
});

test('zone boss entity resource: buildEntityFromSpawn throws on snapshot with no active_boss', () => {
  // Caller is expected to pre-check before calling on a snapshot path
  // - this assertion documents that the helper is strict.
  const snapshotEnv = ev(99, 'zone.snapshot', 'iron_reach', {
    active_boss: null,
    knot: null,
    state: [],
    last_event_id: 99,
  });
  assert.throws(() => buildEntityFromSpawn(snapshotEnv));
});

test('zone boss entity resource: buildEntityFromSpawn throws on unsupported envelope type', () => {
  const tickEnv = tickEvent(1, 'iron_reach', 'b_x', 100, 0, 0);
  assert.throws(() => buildEntityFromSpawn(tickEnv));
});

// ----- applyTick mutation -----

test('zone boss entity resource: applyTick updates HP, position, last_tick_ms', () => {
  const e = buildEntityFromSpawn(spawnEvent(1, 'iron_reach', { boss_id: 'b_iron' }));
  const tick = tickEvent(2, 'iron_reach', 'b_iron', 750, 6, 8);
  applyTick(e, tick);
  assert.equal(e.hp_current, 750);
  assert.equal(e.x, 6);
  assert.equal(e.y, 8);
  assert.equal(e.last_tick_ms, tick.ts);
});

test('zone boss entity resource: applyTick appends recent_hits in receive order', () => {
  const e = buildEntityFromSpawn(spawnEvent(1, 'iron_reach', { boss_id: 'b_iron' }));
  const tick = tickEvent(2, 'iron_reach', 'b_iron', 700, 5, 5, [
    { from_character_id: 'c_a', amount: 100, ts_ms: 1700000002001 },
    { from_character_id: 'c_b', amount: 200, ts_ms: 1700000002005 },
  ]);
  applyTick(e, tick);
  assert.equal(e.recent_hits.length, 2);
  assert.equal(e.recent_hits[0]?.from_character_id, 'c_a');
  assert.equal(e.recent_hits[0]?.amount, 100);
  assert.equal(e.recent_hits[0]?.at_ms, 1700000002001);
  assert.equal(e.recent_hits[1]?.from_character_id, 'c_b');
  assert.equal(e.recent_hits[1]?.amount, 200);
});

test('zone boss entity resource: applyTick across multiple ticks accumulates recent_hits', () => {
  const e = buildEntityFromSpawn(spawnEvent(1, 'iron_reach', { boss_id: 'b_iron' }));
  applyTick(e, tickEvent(2, 'iron_reach', 'b_iron', 900, 5, 5, [
    { from_character_id: 'c_a', amount: 50, ts_ms: 1 },
  ]));
  applyTick(e, tickEvent(3, 'iron_reach', 'b_iron', 800, 5, 5, [
    { from_character_id: 'c_a', amount: 50, ts_ms: 2 },
    { from_character_id: 'c_b', amount: 50, ts_ms: 3 },
  ]));
  assert.equal(e.recent_hits.length, 3);
  assert.equal(e.recent_hits[0]?.at_ms, 1);
  assert.equal(e.recent_hits[2]?.at_ms, 3);
});

test('zone boss entity resource: applyTick caps recent_hits at RECENT_HITS_RING_SIZE (32)', () => {
  const e = buildEntityFromSpawn(spawnEvent(1, 'iron_reach', { boss_id: 'b_iron' }));
  // Pump 50 hits in a single tick - drop the oldest 18.
  const hits: ZoneBossHit[] = [];
  for (let i = 0; i < 50; i++) {
    hits.push({ from_character_id: 'c_a', amount: i, ts_ms: i });
  }
  applyTick(e, tickEvent(2, 'iron_reach', 'b_iron', 0, 5, 5, hits));
  assert.equal(e.recent_hits.length, RECENT_HITS_RING_SIZE);
  // Oldest preserved is at index 18 (0..17 dropped) - amount = 18.
  assert.equal(e.recent_hits[0]?.amount, 18);
  // Newest at the tail.
  assert.equal(e.recent_hits[RECENT_HITS_RING_SIZE - 1]?.amount, 49);
});

test('zone boss entity resource: applyTick throws on non-tick envelope', () => {
  const e = buildEntityFromSpawn(spawnEvent(1, 'iron_reach'));
  assert.throws(() => applyTick(e, spawnEvent(2, 'iron_reach')));
});
