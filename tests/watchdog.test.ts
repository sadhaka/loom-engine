// Phase 0.69.0 - Watchdog tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Watchdog,
  RESOURCE_WATCHDOG,
} from '../src/index.js';

test('watchdog: RESOURCE_WATCHDOG is the stable string', () => {
  assert.equal(RESOURCE_WATCHDOG, 'watchdog');
});

test('watchdog: starts empty', () => {
  const w = Watchdog.create();
  assert.equal(w.count(), 0);
});

test('watchdog: register adds entry; initial state alive', () => {
  const w = Watchdog.create();
  assert.equal(w.register('a'), true);
  assert.equal(w.has('a'), true);
  assert.equal(w.isAlive('a'), true);
});

test('watchdog: register duplicate returns false', () => {
  const w = Watchdog.create();
  w.register('a');
  assert.equal(w.register('a'), false);
});

test('watchdog: register ignores empty name', () => {
  const w = Watchdog.create();
  assert.equal(w.register(''), false);
});

test('watchdog: unregister removes entry', () => {
  const w = Watchdog.create();
  w.register('a');
  assert.equal(w.unregister('a'), true);
  assert.equal(w.has('a'), false);
});

test('watchdog: unregister missing returns false', () => {
  const w = Watchdog.create();
  assert.equal(w.unregister('nope'), false);
});

test('watchdog: tick decrements age - entry stays alive within timeout', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 1000 });
  w.register('a');
  w.tick(500);
  assert.equal(w.isAlive('a'), true);
});

test('watchdog: tick crosses timeout - entry becomes stale', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 1000 });
  w.register('a');
  w.tick(1500);
  assert.equal(w.isAlive('a'), false);
});

test('watchdog: heartbeat resets age + revives stale', () => {
  let aliveFires = 0;
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('a', { onAlive: () => { aliveFires++; } });
  w.tick(150);
  assert.equal(w.isAlive('a'), false);
  w.heartbeat('a');
  assert.equal(w.isAlive('a'), true);
  assert.equal(aliveFires, 1);
});

test('watchdog: onStale fires once when entry first crosses timeout', () => {
  let staleFires = 0;
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('a', { onStale: () => { staleFires++; } });
  w.tick(150);
  assert.equal(staleFires, 1);
  // Subsequent ticks while stale don't re-fire.
  w.tick(150);
  assert.equal(staleFires, 1);
});

test('watchdog: onAlive fires only when stale -> alive flip', () => {
  let aliveFires = 0;
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('a', { onAlive: () => { aliveFires++; } });
  // Heartbeat while alive: no fire.
  w.heartbeat('a');
  assert.equal(aliveFires, 0);
  // Go stale, then heartbeat: fires.
  w.tick(150);
  w.heartbeat('a');
  assert.equal(aliveFires, 1);
});

test('watchdog: throwing onStale / onAlive isolated', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('a', {
    onStale: () => { throw new Error('boom'); },
    onAlive: () => { throw new Error('boom'); },
  });
  // Should not throw.
  w.tick(150);
  w.heartbeat('a');
  assert.equal(w.isAlive('a'), true);
});

test('watchdog: per-entry timeoutMs override', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 1000 });
  w.register('quick', { timeoutMs: 50 });
  w.register('slow');
  w.tick(100);
  assert.equal(w.isAlive('quick'), false);
  assert.equal(w.isAlive('slow'), true);
});

test('watchdog: setTimeout updates threshold', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('a');
  w.setTimeout('a', 1000);
  w.tick(500);
  assert.equal(w.isAlive('a'), true);
});

test('watchdog: setTimeout on missing returns false', () => {
  const w = Watchdog.create();
  assert.equal(w.setTimeout('nope', 1000), false);
});

test('watchdog: heartbeat on missing returns false', () => {
  const w = Watchdog.create();
  assert.equal(w.heartbeat('nope'), false);
});

test('watchdog: status returns full info', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 1000 });
  w.register('a');
  w.tick(300);
  const s = w.status('a');
  assert.ok(s !== null);
  assert.equal(s!.name, 'a');
  assert.equal(s!.ageMs, 300);
  assert.equal(s!.timeoutMs, 1000);
  assert.equal(s!.alive, true);
});

test('watchdog: status missing returns null', () => {
  const w = Watchdog.create();
  assert.equal(w.status('nope'), null);
});

test('watchdog: list + staleNames', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('alive');
  w.register('dead');
  w.tick(50);
  w.heartbeat('alive');  // reset to 0
  w.tick(80);
  // alive total age 80 (under 100 timeout) - alive
  // dead total age 130 - stale
  assert.deepEqual(w.staleNames(), ['dead']);
  assert.equal(w.list().length, 2);
});

test('watchdog: NaN / negative dt ignored', () => {
  const w = Watchdog.create({ defaultTimeoutMs: 100 });
  w.register('a');
  w.tick(NaN);
  w.tick(-50);
  assert.equal(w.status('a')!.ageMs, 0);
});

test('watchdog: clear empties entries', () => {
  const w = Watchdog.create();
  w.register('a');
  w.register('b');
  w.clear();
  assert.equal(w.count(), 0);
});

test('watchdog: dispose locks ops', () => {
  const w = Watchdog.create();
  w.register('a');
  w.dispose();
  assert.equal(w.register('b'), false);
  assert.equal(w.heartbeat('a'), false);
});

test('watchdog: realistic example - multiple connections', () => {
  const reconnects: string[] = [];
  const w = Watchdog.create({ defaultTimeoutMs: 200 });
  w.register('director', { onStale: () => reconnects.push('director') });
  w.register('multiplayer', { timeoutMs: 500, onStale: () => reconnects.push('multiplayer') });
  // 200ms passes - director goes stale.
  w.tick(250);
  assert.deepEqual(reconnects, ['director']);
  // multiplayer still alive at 250ms (timeout 500).
  assert.equal(w.isAlive('multiplayer'), true);
  // Director heartbeat revives it.
  w.heartbeat('director');
  assert.equal(w.isAlive('director'), true);
});
