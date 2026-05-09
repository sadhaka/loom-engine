// Phase 0.75.0 - Achievements tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Achievements,
  RESOURCE_ACHIEVEMENTS,
  type AchievementSpec,
} from '../src/index.js';

test('achievements: RESOURCE_ACHIEVEMENTS is the stable string', () => {
  assert.equal(RESOURCE_ACHIEVEMENTS, 'achievements');
});

test('achievements: register adds; duplicate / invalid return false', () => {
  const a = Achievements.create();
  assert.ok(a.register({ id: 'first-kill' }));
  assert.ok(a.has('first-kill'));
  assert.equal(a.register({ id: 'first-kill' }), false);
  assert.equal(a.register({ id: '' }), false);
  assert.equal(a.register({} as AchievementSpec), false);
});

test('achievements: target defaults to 1 when omitted', () => {
  let unlocked = 0;
  const a = Achievements.create({ onUnlocked: () => { unlocked++; } });
  a.register({ id: 'binary' });
  a.add('binary', 1);
  assert.ok(a.isUnlocked('binary'));
  assert.equal(unlocked, 1);
});

test('achievements: invalid (non-positive) target falls back to 1', () => {
  const a = Achievements.create();
  a.register({ id: 'a', target: 0 });
  a.register({ id: 'b', target: -5 });
  a.register({ id: 'c', target: NaN });
  a.add('a', 1); a.add('b', 1); a.add('c', 1);
  assert.ok(a.isUnlocked('a'));
  assert.ok(a.isUnlocked('b'));
  assert.ok(a.isUnlocked('c'));
});

test('achievements: add increments progress + clamps at target', () => {
  const log: number[] = [];
  const a = Achievements.create({
    onProgress: (_s, n) => log.push(n),
  });
  a.register({ id: 'centurion', target: 100 });
  a.add('centurion', 30);
  a.add('centurion', 30);
  a.add('centurion', 50); // would land at 110; clamps to 100
  assert.equal(a.getProgress('centurion'), 100);
  assert.deepEqual(log, [30, 60, 100]);
});

test('achievements: set replaces progress', () => {
  const a = Achievements.create();
  a.register({ id: 'ctr', target: 50 });
  a.add('ctr', 10);
  a.set('ctr', 25);
  assert.equal(a.getProgress('ctr'), 25);
  a.set('ctr', 999); // clamps to 50
  assert.equal(a.getProgress('ctr'), 50);
});

test('achievements: onUnlocked fires once when progress crosses target', () => {
  let unlocks = 0;
  const a = Achievements.create({ onUnlocked: () => { unlocks++; } });
  a.register({ id: 'goal', target: 5 });
  a.add('goal', 4);
  assert.equal(unlocks, 0);
  a.add('goal', 1);
  assert.equal(unlocks, 1);
  // Subsequent adds do not re-fire (already at clamp).
  a.add('goal', 1);
  assert.equal(unlocks, 1);
});

test('achievements: progressing past target via set does not double-unlock', () => {
  let unlocks = 0;
  const a = Achievements.create({ onUnlocked: () => { unlocks++; } });
  a.register({ id: 'g', target: 10 });
  a.set('g', 100);
  assert.equal(unlocks, 1);
  a.set('g', 100);
  assert.equal(unlocks, 1);
});

test('achievements: NaN delta / non-finite values rejected', () => {
  const a = Achievements.create();
  a.register({ id: 'g', target: 10 });
  assert.equal(a.add('g', NaN), false);
  assert.equal(a.add('g', 0), false);
  assert.equal(a.set('g', NaN), false);
  assert.equal(a.set('g', Infinity), false);
});

test('achievements: add to unknown id returns false', () => {
  const a = Achievements.create();
  assert.equal(a.add('does-not-exist', 1), false);
  assert.equal(a.set('does-not-exist', 5), false);
});

test('achievements: unregister drops', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 5 });
  assert.ok(a.unregister('x'));
  assert.equal(a.has('x'), false);
  assert.equal(a.unregister('x'), false);
});

test('achievements: reset zeros progress + unlocks', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 5 });
  a.add('x', 5);
  assert.ok(a.isUnlocked('x'));
  assert.ok(a.reset('x'));
  assert.equal(a.getProgress('x'), 0);
  assert.equal(a.isUnlocked('x'), false);
});

test('achievements: resetAll resets every entry', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 5 });
  a.register({ id: 'y', target: 5 });
  a.add('x', 5);
  a.add('y', 5);
  assert.equal(a.resetAll(), 2);
  assert.equal(a.isUnlocked('x'), false);
  assert.equal(a.isUnlocked('y'), false);
});

test('achievements: list returns defensive copies + unlocked-at increasing', () => {
  const a = Achievements.create();
  a.register({ id: 'a', target: 1 });
  a.register({ id: 'b', target: 1 });
  a.register({ id: 'c', target: 1 });
  a.add('a', 1);
  a.add('c', 1);
  const arr = a.list();
  assert.equal(arr.length, 3);
  // Mutating copies doesn't affect state.
  arr[0]!.progress = 999;
  assert.equal(a.getProgress('a'), 1);
  // Unlocked-at increasing in unlock order.
  const aEntry = arr.find((e) => e.spec.id === 'a')!;
  const cEntry = arr.find((e) => e.spec.id === 'c')!;
  assert.ok(aEntry.unlockedAt > 0);
  assert.ok(cEntry.unlockedAt > aEntry.unlockedAt);
});

test('achievements: toSnapshot + fromSnapshot roundtrip', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 100 });
  a.register({ id: 'y', target: 50 });
  a.add('x', 75);
  a.add('y', 50); // unlocks
  const snap = a.toSnapshot();

  const b = Achievements.create();
  b.register({ id: 'x', target: 100 });
  b.register({ id: 'y', target: 50 });
  b.fromSnapshot(snap);
  assert.equal(b.getProgress('x'), 75);
  assert.ok(b.isUnlocked('y'));
});

test('achievements: fromSnapshot does NOT fire callbacks', () => {
  let fired = 0;
  const a = Achievements.create({
    onUnlocked: () => { fired++; },
    onProgress: () => { fired++; },
  });
  a.register({ id: 'x', target: 5 });
  a.fromSnapshot({ x: { progress: 5, unlocked: true, unlockedAt: 1 } });
  assert.equal(fired, 0);
  assert.ok(a.isUnlocked('x'));
});

test('achievements: fromSnapshot ignores unknown ids', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 5 });
  a.fromSnapshot({ x: { progress: 3, unlocked: false }, ghost: { progress: 99, unlocked: true } });
  assert.equal(a.getProgress('x'), 3);
  assert.equal(a.has('ghost'), false);
});

test('achievements: fromSnapshot clamps progress to target', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 10 });
  a.fromSnapshot({ x: { progress: 999, unlocked: true } });
  assert.equal(a.getProgress('x'), 10);
});

test('achievements: throwing onProgress / onUnlocked isolated', () => {
  const a = Achievements.create({
    onProgress: () => { throw new Error('progress boom'); },
    onUnlocked: () => { throw new Error('unlocked boom'); },
  });
  a.register({ id: 'x', target: 1 });
  // Should not throw.
  a.add('x', 1);
  assert.ok(a.isUnlocked('x'));
});

test('achievements: dispose locks ops', () => {
  const a = Achievements.create();
  a.register({ id: 'x', target: 5 });
  a.dispose();
  assert.equal(a.has('x'), false);
  assert.equal(a.register({ id: 'y', target: 1 }), false);
  assert.equal(a.add('x', 1), false);
  assert.equal(a.set('x', 5), false);
  assert.equal(a.reset('x'), false);
  assert.equal(a.resetAll(), 0);
});

test('achievements: realistic - kill-counting + Centurion unlock at kill 100', () => {
  let unlockedSpec: AchievementSpec | null = null;
  const a = Achievements.create({
    onUnlocked: (spec) => { unlockedSpec = spec; },
  });
  a.register({ id: 'centurion', target: 100, data: { label: 'Centurion' } });
  for (let i = 0; i < 99; i++) a.add('centurion', 1);
  assert.equal(unlockedSpec, null);
  a.add('centurion', 1);
  assert.notEqual(unlockedSpec, null);
  assert.equal((unlockedSpec as AchievementSpec | null)!.id, 'centurion');
});

test('achievements: list returns empty array initially', () => {
  const a = Achievements.create();
  assert.deepEqual(a.list(), []);
});
