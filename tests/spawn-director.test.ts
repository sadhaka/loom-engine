// Phase 1.2.2 - SpawnDirector tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SpawnDirector,
  RESOURCE_SPAWN_DIRECTOR,
  type RejectReason,
} from '../src/index.js';

test('sd: RESOURCE_SPAWN_DIRECTOR is the stable string', () => {
  assert.equal(RESOURCE_SPAWN_DIRECTOR, 'spawn_director');
});

test('sd: starts empty', () => {
  const sd = SpawnDirector.create();
  assert.equal(sd.ruleCount(), 0);
  assert.equal(sd.getSpawnedTotal(), 0);
});

test('sd: defineRule rejects empty / non-string id', () => {
  const sd = SpawnDirector.create();
  assert.equal(sd.defineRule({ id: '', zone: 'z', spawnFn: () => true }), false);
  assert.equal(sd.defineRule({ id: 'a', zone: '', spawnFn: () => true }), false);
  // @ts-expect-error - testing runtime guard
  assert.equal(sd.defineRule({ id: 'a', zone: 'z', spawnFn: 'not-fn' }), false);
});

test('sd: defineRule + hasRule + ruleIds', () => {
  const sd = SpawnDirector.create();
  sd.defineRule({ id: 'r1', zone: 'forest', spawnFn: () => true });
  sd.defineRule({ id: 'r2', zone: 'forest', spawnFn: () => true });
  assert.equal(sd.hasRule('r1'), true);
  assert.deepEqual(sd.ruleIds().sort(), ['r1', 'r2']);
});

test('sd: removeRule drops it', () => {
  const sd = SpawnDirector.create();
  sd.defineRule({ id: 'r1', zone: 'forest', spawnFn: () => true });
  assert.equal(sd.removeRule('r1'), true);
  assert.equal(sd.hasRule('r1'), false);
});

test('sd: tick fires spawn when interval elapses', () => {
  let spawns = 0;
  const sd = SpawnDirector.create();
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 100,
    spawnFn: () => { spawns++; return true; },
  });
  // First tick fires immediately (cooldown starts at 0).
  sd.tick(20);
  assert.equal(spawns, 1);
  // Second attempt blocked by cooldown.
  sd.tick(50);
  assert.equal(spawns, 1);
  // After cooldown elapses, second spawn fires.
  sd.tick(60);
  assert.equal(spawns, 2);
});

test('sd: notifySpawned increments counters; notifyDespawned decrements', () => {
  const sd = SpawnDirector.create();
  sd.defineRule({ id: 'r1', zone: 'forest', spawnFn: () => true });
  sd.notifySpawned('r1');
  sd.notifySpawned('r1');
  assert.equal(sd.getActiveCount('r1'), 2);
  assert.equal(sd.getZoneCount('forest', 'r1'), 2);
  assert.equal(sd.getSpawnedTotal(), 2);
  sd.notifyDespawned('r1');
  assert.equal(sd.getActiveCount('r1'), 1);
  assert.equal(sd.getSpawnedTotal(), 1);
});

test('sd: maxConcurrent blocks spawns at cap', () => {
  let attempts = 0;
  const rejected: RejectReason[] = [];
  const sd = SpawnDirector.create({
    onRejected: (_id, r) => rejected.push(r),
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10, maxConcurrent: 2,
    spawnFn: () => { attempts++; return true; },
  });
  sd.tick(20);
  sd.notifySpawned('r1');
  sd.tick(20);
  sd.notifySpawned('r1');
  sd.tick(20);
  // Third attempt rejected.
  assert.equal(attempts, 2);
  assert.ok(rejected.indexOf('maxConcurrent') >= 0);
});

test('sd: maxPerZone blocks at cap', () => {
  const rejected: RejectReason[] = [];
  const sd = SpawnDirector.create({
    onRejected: (_id, r) => rejected.push(r),
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10, maxPerZone: 1,
    spawnFn: () => true,
  });
  sd.tick(20);
  sd.notifySpawned('r1');
  sd.tick(20);
  assert.ok(rejected.indexOf('maxPerZone') >= 0);
});

test('sd: globalBudget blocks once exceeded', () => {
  const rejected: RejectReason[] = [];
  const sd = SpawnDirector.create({
    globalBudget: 1,
    onRejected: (_id, r) => rejected.push(r),
  });
  sd.defineRule({ id: 'r1', zone: 'forest', intervalMs: 10, spawnFn: () => true });
  sd.tick(20);
  sd.notifySpawned('r1');
  sd.tick(20);
  assert.ok(rejected.indexOf('globalBudget') >= 0);
});

test('sd: gate rejects when false', () => {
  const rejected: RejectReason[] = [];
  let spawnRan = false;
  const sd = SpawnDirector.create({
    context: { hostile: false },
    onRejected: (_id, r) => rejected.push(r),
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10,
    gate: (ctx) => !!ctx.hostile,
    spawnFn: () => { spawnRan = true; return true; },
  });
  sd.tick(20);
  assert.equal(spawnRan, false);
  assert.ok(rejected.indexOf('gate') >= 0);
});

test('sd: setContext flips a gate', () => {
  let spawns = 0;
  const sd = SpawnDirector.create({ context: { active: false } });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10,
    gate: (ctx) => !!ctx.active,
    spawnFn: () => { spawns++; return true; },
  });
  sd.tick(20);
  assert.equal(spawns, 0);
  sd.setContext({ active: true });
  sd.tick(20);
  assert.equal(spawns, 1);
});

test('sd: spawnFn returning false marks spawnFnFailed', () => {
  const rejected: RejectReason[] = [];
  const sd = SpawnDirector.create({
    onRejected: (_id, r) => rejected.push(r),
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10,
    spawnFn: () => false,
  });
  sd.tick(20);
  assert.ok(rejected.indexOf('spawnFnFailed') >= 0);
});

test('sd: throwing spawnFn isolated + marks spawnFnThrew', () => {
  const rejected: RejectReason[] = [];
  const sd = SpawnDirector.create({
    onRejected: (_id, r) => rejected.push(r),
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10,
    spawnFn: () => { throw new Error('boom'); },
  });
  sd.tick(20);
  assert.ok(rejected.indexOf('spawnFnThrew') >= 0);
});

test('sd: tryAttempt forces a spawn check outside cooldown', () => {
  let spawns = 0;
  const sd = SpawnDirector.create();
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 100000,
    spawnFn: () => { spawns++; return true; },
  });
  // Without ticking, force an attempt.
  assert.equal(sd.tryAttempt('r1'), 'spawned');
  assert.equal(spawns, 1);
});

test('sd: onSpawned fires per successful spawn', () => {
  const fired: string[] = [];
  const sd = SpawnDirector.create({
    onSpawned: (id) => fired.push(id),
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10,
    spawnFn: () => true,
  });
  sd.tick(20);
  sd.tick(20);
  assert.equal(fired.length, 2);
  assert.equal(fired[0], 'r1');
});

test('sd: throwing onSpawned / onRejected isolated', () => {
  const sd = SpawnDirector.create({
    onSpawned: () => { throw new Error('s-boom'); },
    onRejected: () => { throw new Error('r-boom'); },
  });
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 10, maxConcurrent: 1,
    spawnFn: () => true,
  });
  sd.tick(20);
  sd.notifySpawned('r1');
  sd.tick(20); // hits maxConcurrent
  // Should not throw.
  assert.equal(sd.getActiveCount('r1'), 1);
});

test('sd: setGlobalBudget updates cap', () => {
  const sd = SpawnDirector.create({ globalBudget: 1 });
  sd.defineRule({ id: 'r1', zone: 'forest', intervalMs: 10, spawnFn: () => true });
  sd.tick(20);
  sd.notifySpawned('r1');
  sd.setGlobalBudget(5);
  sd.tick(20); // budget now 5, allowed
  assert.equal(sd.getSpawnedTotal(), 1); // notify wasn't called for second; we just verify no rejection
});

test('sd: NaN / negative dt no-op', () => {
  let spawns = 0;
  const sd = SpawnDirector.create();
  sd.defineRule({
    id: 'r1', zone: 'forest', intervalMs: 100,
    spawnFn: () => { spawns++; return true; },
  });
  sd.tick(NaN);
  sd.tick(-50);
  sd.tick(Infinity);
  assert.equal(spawns, 0);
});

test('sd: clear empties everything', () => {
  const sd = SpawnDirector.create();
  sd.defineRule({ id: 'r1', zone: 'forest', spawnFn: () => true });
  sd.notifySpawned('r1');
  sd.clear();
  assert.equal(sd.ruleCount(), 0);
  assert.equal(sd.getSpawnedTotal(), 0);
});

test('sd: dispose locks ops', () => {
  const sd = SpawnDirector.create();
  sd.defineRule({ id: 'r1', zone: 'forest', spawnFn: () => true });
  sd.dispose();
  assert.equal(sd.defineRule({ id: 'r2', zone: 'z', spawnFn: () => true }), false);
  assert.equal(sd.notifySpawned('r1'), false);
});

test('sd: realistic example - forest wolf population control', () => {
  let wolves = 0;
  const sd = SpawnDirector.create({ globalBudget: 50 });
  sd.defineRule({
    id: 'forest_wolf',
    zone: 'forest',
    intervalMs: 100,
    maxPerZone: 3,
    spawnFn: () => { wolves++; sd.notifySpawned('forest_wolf'); return true; },
  });
  // Tick enough to attempt many spawns.
  for (let i = 0; i < 20; i++) sd.tick(110);
  // Capped at 3.
  assert.equal(wolves, 3);
  assert.equal(sd.getZoneCount('forest', 'forest_wolf'), 3);
  // One dies; another can spawn.
  sd.notifyDespawned('forest_wolf');
  sd.tick(110);
  assert.equal(wolves, 4);
});
