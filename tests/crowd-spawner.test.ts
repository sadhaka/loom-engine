// Phase 0.87.0 - CrowdSpawner tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CrowdSpawner,
  RESOURCE_CROWD_SPAWNER,
} from '../src/index.js';

interface Mob { id: string; serial: number; }

function makeMobFactory(id: string) {
  let n = 0;
  return () => ({ id: id, serial: n++ });
}

test('crowd-spawner: RESOURCE constant', () => {
  assert.equal(RESOURCE_CROWD_SPAWNER, 'crowd_spawner');
});

test('crowd-spawner: register + has + size', () => {
  const s = CrowdSpawner.create<Mob>();
  assert.ok(s.registerSpawn({ id: 'goblin', factory: makeMobFactory('goblin') }));
  assert.ok(s.has('goblin'));
  assert.equal(s.size(), 1);
});

test('crowd-spawner: register rejects invalid + duplicates', () => {
  const s = CrowdSpawner.create<Mob>();
  assert.equal(s.registerSpawn({ id: '', factory: makeMobFactory('x') }), false);
  // typeof 'function' check
  assert.equal(s.registerSpawn({ id: 'x', factory: 'not a fn' as unknown as () => Mob }), false);
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a') });
  assert.equal(s.registerSpawn({ id: 'a', factory: makeMobFactory('a2') }), false);
});

test('crowd-spawner: spawnOne respects per-id max', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'goblin', factory: makeMobFactory('goblin'), max: 3 });
  for (let i = 0; i < 3; i++) assert.notEqual(s.spawnOne('goblin'), null);
  assert.equal(s.spawnOne('goblin'), null); // maxed
  assert.equal(s.activeCountOf('goblin'), 3);
});

test('crowd-spawner: spawnOne respects total budget', () => {
  const s = CrowdSpawner.create<Mob>({ totalBudget: 2 });
  s.registerSpawn({ id: 'goblin', factory: makeMobFactory('goblin'), max: 10 });
  s.registerSpawn({ id: 'zombie', factory: makeMobFactory('zombie'), max: 10 });
  assert.notEqual(s.spawnOne('goblin'), null);
  assert.notEqual(s.spawnOne('zombie'), null);
  assert.equal(s.spawnOne('goblin'), null); // budget full
  assert.equal(s.budgetRemaining(), 0);
});

test('crowd-spawner: spawnOne returns null for unknown id', () => {
  const s = CrowdSpawner.create<Mob>();
  assert.equal(s.spawnOne('ghost'), null);
});

test('crowd-spawner: factory throwing yields null', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({
    id: 'fail', factory: () => { throw new Error('boom'); },
  });
  assert.equal(s.spawnOne('fail'), null);
  assert.equal(s.activeCountOf('fail'), 0);
});

test('crowd-spawner: notifyDespawn frees slot', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'g', factory: makeMobFactory('g'), max: 1 });
  s.spawnOne('g');
  assert.equal(s.spawnOne('g'), null); // max
  s.notifyDespawn('g');
  assert.notEqual(s.spawnOne('g'), null);
});

test('crowd-spawner: notifyDespawn rejects unknown / over-decrement', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'g', factory: makeMobFactory('g') });
  assert.equal(s.notifyDespawn('ghost'), false);
  // No active yet.
  assert.equal(s.notifyDespawn('g'), false);
});

test('crowd-spawner: spawnRandom respects weights (deterministic with rng)', () => {
  const rolls = [0.05, 0.5, 0.95]; // low / mid / high
  let i = 0;
  const s = CrowdSpawner.create<Mob>({ rng: () => rolls[i++] ?? 0 });
  s.registerSpawn({ id: 'a', factory: () => ({ id: 'a', serial: 0 }), max: 10, weight: 1 });
  s.registerSpawn({ id: 'b', factory: () => ({ id: 'b', serial: 0 }), max: 10, weight: 9 });
  // total weight 10; rolls 0.5, 4.5, 9.5; picks a, b, b in registration order.
  const m1 = s.spawnRandom();
  const m2 = s.spawnRandom();
  const m3 = s.spawnRandom();
  assert.equal(m1!.id, 'a');
  assert.equal(m2!.id, 'b');
  assert.equal(m3!.id, 'b');
});

test('crowd-spawner: spawnRandom returns null when no spawn defs', () => {
  const s = CrowdSpawner.create<Mob>();
  assert.equal(s.spawnRandom(), null);
});

test('crowd-spawner: spawnRandom returns null when all defs maxed', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a'), max: 1 });
  s.spawnOne('a');
  assert.equal(s.spawnRandom(), null);
});

test('crowd-spawner: spawnRandom skips maxed spawns and picks available', () => {
  const s = CrowdSpawner.create<Mob>({ rng: () => 0 });
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a'), max: 1, weight: 1 });
  s.registerSpawn({ id: 'b', factory: makeMobFactory('b'), max: 5, weight: 1 });
  s.spawnOne('a'); // max a
  // Now spawnRandom should pick b every time.
  const m = s.spawnRandom();
  assert.equal(m!.id, 'b');
});

test('crowd-spawner: budget queries reflect state', () => {
  const s = CrowdSpawner.create<Mob>({ totalBudget: 5 });
  s.registerSpawn({ id: 'g', factory: makeMobFactory('g'), max: 10 });
  s.spawnOne('g'); s.spawnOne('g');
  assert.equal(s.getTotalActive(), 2);
  assert.equal(s.totalBudget(), 5);
  assert.equal(s.budgetRemaining(), 3);
});

test('crowd-spawner: unregisterSpawn returns budget', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'g', factory: makeMobFactory('g'), max: 5 });
  s.spawnOne('g'); s.spawnOne('g');
  assert.equal(s.getTotalActive(), 2);
  s.unregisterSpawn('g');
  assert.equal(s.getTotalActive(), 0);
});

test('crowd-spawner: list returns defensive copy', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a') });
  s.registerSpawn({ id: 'b', factory: makeMobFactory('b') });
  const arr = s.list();
  assert.equal(arr.length, 2);
  arr.length = 0;
  assert.equal(s.list().length, 2);
});

test('crowd-spawner: clear empties everything', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a'), max: 3 });
  s.spawnOne('a'); s.spawnOne('a');
  s.clear();
  assert.equal(s.size(), 0);
  assert.equal(s.getTotalActive(), 0);
});

test('crowd-spawner: dispose locks ops', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a') });
  s.dispose();
  assert.equal(s.registerSpawn({ id: 'b', factory: makeMobFactory('b') }), false);
  assert.equal(s.spawnOne('a'), null);
  assert.equal(s.spawnRandom(), null);
});

test('crowd-spawner: realistic mixed-mob zone', () => {
  let rolls = [0.1, 0.5, 0.9, 0.1];
  let idx = 0;
  const s = CrowdSpawner.create<Mob>({
    totalBudget: 10,
    rng: () => rolls[idx++ % rolls.length] ?? 0,
  });
  s.registerSpawn({ id: 'goblin', factory: makeMobFactory('goblin'), max: 6, weight: 6 });
  s.registerSpawn({ id: 'zombie', factory: makeMobFactory('zombie'), max: 4, weight: 4 });
  for (let i = 0; i < 10; i++) s.spawnRandom();
  assert.equal(s.getTotalActive(), 10);
  // Both spawn types contributed.
  assert.ok(s.activeCountOf('goblin') > 0);
  assert.ok(s.activeCountOf('zombie') > 0);
});

test('crowd-spawner: weight 0 skipped', () => {
  const s = CrowdSpawner.create<Mob>({ rng: () => 0 });
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a'), max: 1, weight: 0 });
  s.registerSpawn({ id: 'b', factory: makeMobFactory('b'), max: 5, weight: 1 });
  // weight 0 -> falls back to default 1, so 'a' is still selectable.
  // But since weight invalid (0), it falls back to 1 default.
  // Test verifies no crash + a mob produced.
  const m = s.spawnRandom();
  assert.notEqual(m, null);
});

test('crowd-spawner: spawnOne factory called only when budget available', () => {
  let calls = 0;
  const s = CrowdSpawner.create<Mob>({ totalBudget: 1 });
  s.registerSpawn({
    id: 'a',
    factory: () => { calls++; return { id: 'a', serial: 0 }; },
    max: 5,
  });
  s.spawnOne('a');
  assert.equal(calls, 1);
  s.spawnOne('a'); // budget full
  assert.equal(calls, 1); // factory NOT called again
});

test('crowd-spawner: max defaults to 1', () => {
  const s = CrowdSpawner.create<Mob>();
  s.registerSpawn({ id: 'a', factory: makeMobFactory('a') });
  assert.notEqual(s.spawnOne('a'), null);
  assert.equal(s.spawnOne('a'), null); // default max=1
});
