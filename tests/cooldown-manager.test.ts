// Phase 0.52.0 - CooldownManager tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CooldownManager,
  RESOURCE_COOLDOWN_MANAGER,
} from '../src/index.js';

test('cooldown: RESOURCE_COOLDOWN_MANAGER is the stable string', () => {
  assert.equal(RESOURCE_COOLDOWN_MANAGER, 'cooldown_manager');
});

test('cooldown: starts ready (no key on cooldown)', () => {
  const cd = CooldownManager.create();
  assert.equal(cd.isReady('fireball'), true);
  assert.equal(cd.activeCount(), 0);
});

test('cooldown: start places key on cooldown', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  assert.equal(cd.isReady('fireball'), false);
  assert.equal(cd.isOnCooldown('fireball'), true);
  assert.equal(cd.remaining('fireball'), 1000);
});

test('cooldown: tick reduces remaining time', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  cd.tick(300);
  assert.equal(cd.remaining('fireball'), 700);
  cd.tick(300);
  assert.equal(cd.remaining('fireball'), 400);
});

test('cooldown: tick crosses zero, key becomes ready', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  cd.tick(1500);
  assert.equal(cd.isReady('fireball'), true);
  assert.equal(cd.remaining('fireball'), 0);
});

test('cooldown: start replaces existing cooldown', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 5000);
  cd.tick(1000); // remaining 4000
  cd.start('fireball', 2000); // restart
  assert.equal(cd.remaining('fireball'), 2000);
  assert.equal(cd.totalFor('fireball'), 2000);
});

test('cooldown: zero / negative duration treated as ready', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 0);
  assert.equal(cd.isReady('fireball'), true);
  cd.start('fireball', -100);
  assert.equal(cd.isReady('fireball'), true);
});

test('cooldown: empty key string is ignored', () => {
  const cd = CooldownManager.create();
  cd.start('', 1000);
  assert.equal(cd.activeCount(), 0);
});

test('cooldown: tick(0) is a no-op', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  cd.tick(0);
  assert.equal(cd.remaining('fireball'), 1000);
});

test('cooldown: NaN / negative dt ignored', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  cd.tick(NaN);
  cd.tick(-100);
  assert.equal(cd.remaining('fireball'), 1000);
});

test('cooldown: onReady fires when key crosses zero', () => {
  const fired: string[] = [];
  const cd = CooldownManager.create({
    onReady: (k) => fired.push(k),
  });
  cd.start('fireball', 100);
  cd.start('blink', 200);
  cd.tick(150); // fireball ready
  assert.deepEqual(fired, ['fireball']);
  cd.tick(100); // blink ready
  assert.deepEqual(fired, ['fireball', 'blink']);
});

test('cooldown: onReady throwing is isolated', () => {
  const cd = CooldownManager.create({
    onReady: () => { throw new Error('boom'); },
  });
  cd.start('fireball', 100);
  cd.tick(150);
  // No throw propagated; fireball is ready.
  assert.equal(cd.isReady('fireball'), true);
});

test('cooldown: onReady fires once per cycle', () => {
  let fires = 0;
  const cd = CooldownManager.create({
    onReady: () => { fires++; },
  });
  cd.start('fireball', 100);
  cd.tick(150);
  assert.equal(fires, 1);
  cd.tick(100); // already ready, no extra fire
  assert.equal(fires, 1);
});

test('cooldown: clear forces ready and fires onReady', () => {
  let fired = '';
  const cd = CooldownManager.create({
    onReady: (k) => { fired = k; },
  });
  cd.start('fireball', 5000);
  assert.equal(cd.clear('fireball'), true);
  assert.equal(fired, 'fireball');
  assert.equal(cd.isReady('fireball'), true);
});

test('cooldown: clear on inactive key returns false', () => {
  const cd = CooldownManager.create();
  assert.equal(cd.clear('nope'), false);
});

test('cooldown: clearAll empties + fires onReady for each', () => {
  const fired: string[] = [];
  const cd = CooldownManager.create({
    onReady: (k) => fired.push(k),
  });
  cd.start('a', 100);
  cd.start('b', 200);
  cd.start('c', 300);
  cd.clearAll();
  assert.equal(cd.activeCount(), 0);
  assert.deepEqual(fired.sort(), ['a', 'b', 'c']);
});

test('cooldown: activeCount + activeKeys reflect state', () => {
  const cd = CooldownManager.create();
  cd.start('a', 100);
  cd.start('b', 200);
  assert.equal(cd.activeCount(), 2);
  assert.deepEqual(cd.activeKeys().sort(), ['a', 'b']);
});

test('cooldown: fractionElapsed = 0 at start, 1 when ready', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  assert.ok(Math.abs(cd.fractionElapsed('fireball')) < 1e-9);
  cd.tick(500);
  assert.ok(Math.abs(cd.fractionElapsed('fireball') - 0.5) < 1e-9);
  cd.tick(500);
  // After tick crosses zero, key removed -> fraction = 1.
  assert.equal(cd.fractionElapsed('fireball'), 1);
});

test('cooldown: tryUse - ready returns true and starts cooldown', () => {
  const cd = CooldownManager.create();
  assert.equal(cd.tryUse('fireball', 1000), true);
  assert.equal(cd.isOnCooldown('fireball'), true);
});

test('cooldown: tryUse - on cooldown returns false', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  assert.equal(cd.tryUse('fireball', 1000), false);
});

test('cooldown: tryUse - after ready re-fires successfully', () => {
  const cd = CooldownManager.create();
  cd.tryUse('fireball', 100);
  cd.tick(150);
  assert.equal(cd.tryUse('fireball', 100), true);
});

test('cooldown: totalFor returns total duration when active, 0 when ready', () => {
  const cd = CooldownManager.create();
  assert.equal(cd.totalFor('x'), 0);
  cd.start('x', 750);
  assert.equal(cd.totalFor('x'), 750);
  cd.tick(1000);
  assert.equal(cd.totalFor('x'), 0);
});

test('cooldown: dispose makes ops no-op', () => {
  const cd = CooldownManager.create();
  cd.start('fireball', 1000);
  cd.dispose();
  assert.equal(cd.isReady('fireball'), true); // disposed -> always ready
  cd.start('blink', 1000);  // no-op
  assert.equal(cd.activeCount(), 0);
});

test('cooldown: realistic example - skill rotation tracking', () => {
  const cd = CooldownManager.create();
  // All ready at start.
  assert.equal(cd.tryUse('q-strike', 8000), true);
  assert.equal(cd.tryUse('w-blink', 12000), true);
  assert.equal(cd.tryUse('e-shield', 15000), true);
  // Try Q again - on cooldown.
  assert.equal(cd.tryUse('q-strike', 8000), false);
  // Tick forward 8s - Q ready again.
  cd.tick(8000);
  assert.equal(cd.isReady('q-strike'), true);
  assert.equal(cd.isReady('w-blink'), false);
  assert.ok(cd.remaining('w-blink') === 4000);
});

test('cooldown: deterministic across replays - same dt sequence -> same readiness', () => {
  function run(dts: number[]): boolean[] {
    const cd = CooldownManager.create();
    cd.start('a', 500);
    const log: boolean[] = [];
    for (var i = 0; i < dts.length; i++) {
      cd.tick(dts[i] as number);
      log.push(cd.isReady('a'));
    }
    return log;
  }
  const dts = [100, 100, 100, 100, 200];
  assert.deepEqual(run(dts), run(dts));
});
