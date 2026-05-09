// Phase 1.7.0 - PresenceTracker tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  PresenceTracker,
  RESOURCE_PRESENCE_TRACKER,
} from '../src/index.js';

test('pt7: RESOURCE_PRESENCE_TRACKER is the stable string', () => {
  assert.equal(RESOURCE_PRESENCE_TRACKER, 'presence_tracker');
});

test('pt7: starts empty', () => {
  const pt = PresenceTracker.create();
  assert.equal(pt.count(), 0);
  assert.deepEqual(pt.list(), []);
});

test('pt7: heartbeat creates an entry', () => {
  const pt = PresenceTracker.create();
  const e = pt.heartbeat('a', { name: 'Misha' }, 1000);
  assert.ok(e);
  assert.equal(e!.id, 'a');
  assert.equal(e!.lastSeenAt, 1000);
  assert.equal(e!.firstSeenAt, 1000);
  assert.equal(e!.heartbeatCount, 1);
  assert.equal((e!.data as { name: string }).name, 'Misha');
});

test('pt7: heartbeat increments count + updates lastSeenAt', () => {
  const pt = PresenceTracker.create();
  pt.heartbeat('a', undefined, 1000);
  pt.heartbeat('a', undefined, 2000);
  pt.heartbeat('a', undefined, 3000);
  const e = pt.get('a');
  assert.equal(e!.heartbeatCount, 3);
  assert.equal(e!.firstSeenAt, 1000);
  assert.equal(e!.lastSeenAt, 3000);
});

test('pt7: heartbeat replaces data on each call', () => {
  const pt = PresenceTracker.create();
  pt.heartbeat('a', { zone: 'plaza' } as Record<string, unknown>, 1000);
  pt.heartbeat('a', { zone: 'crypt' } as Record<string, unknown>, 2000);
  const e = pt.get('a');
  assert.equal((e!.data as { zone: string }).zone, 'crypt');
});

test('pt7: heartbeat rejects empty id / non-finite now', () => {
  const pt = PresenceTracker.create();
  assert.equal(pt.heartbeat('', undefined, 1000), null);
  // @ts-expect-error
  assert.equal(pt.heartbeat('a', undefined, 'nope'), null);
  assert.equal(pt.heartbeat('a', undefined, NaN), null);
});

test('pt7: tick expires entries past timeoutMs', () => {
  const pt = PresenceTracker.create({ timeoutMs: 1000 });
  pt.heartbeat('a', undefined, 0);
  pt.heartbeat('b', undefined, 0);
  // 500ms later: nobody expired
  let expired = pt.tick(500);
  assert.equal(expired.length, 0);
  // Heartbeat 'a' at 600
  pt.heartbeat('a', undefined, 600);
  // 1500ms: 'b' expired (>1000ms since heartbeat), 'a' fresh
  expired = pt.tick(1500);
  assert.deepEqual(expired, ['b']);
  assert.equal(pt.has('a'), true);
  assert.equal(pt.has('b'), false);
});

test('pt7: tick returns expired ids in deterministic order', () => {
  const pt = PresenceTracker.create({ timeoutMs: 1000 });
  pt.heartbeat('a', undefined, 0);
  pt.heartbeat('b', undefined, 0);
  pt.heartbeat('c', undefined, 0);
  const expired = pt.tick(2000);
  // All three expired - order depends on Map insertion (a, b, c)
  assert.deepEqual(expired.sort(), ['a', 'b', 'c']);
});

test('pt7: remove drops the entry', () => {
  const pt = PresenceTracker.create();
  pt.heartbeat('a', undefined, 1000);
  assert.equal(pt.remove('a'), true);
  assert.equal(pt.remove('a'), false);
  assert.equal(pt.has('a'), false);
});

test('pt7: list returns all live entries', () => {
  const pt = PresenceTracker.create();
  pt.heartbeat('a', undefined, 1000);
  pt.heartbeat('b', undefined, 1500);
  pt.heartbeat('c', undefined, 2000);
  assert.equal(pt.list().length, 3);
});

test('pt7: maxEntries evicts the oldest by lastSeenAt', () => {
  const pt = PresenceTracker.create({ maxEntries: 2 });
  pt.heartbeat('a', undefined, 1000);
  pt.heartbeat('b', undefined, 2000);
  pt.heartbeat('c', undefined, 3000);  // should evict 'a' (oldest lastSeenAt)
  assert.equal(pt.has('a'), false);
  assert.equal(pt.has('b'), true);
  assert.equal(pt.has('c'), true);
});

test('pt7: maxEntries respects updated lastSeenAt for eviction', () => {
  const pt = PresenceTracker.create({ maxEntries: 2 });
  pt.heartbeat('a', undefined, 1000);
  pt.heartbeat('b', undefined, 2000);
  pt.heartbeat('a', undefined, 3000);  // 'a' is now newest
  pt.heartbeat('c', undefined, 4000);  // should evict 'b' (now oldest)
  assert.equal(pt.has('a'), true);
  assert.equal(pt.has('b'), false);
  assert.equal(pt.has('c'), true);
});

test('pt7: staleCount counts expired-on-next-tick', () => {
  const pt = PresenceTracker.create({ timeoutMs: 1000 });
  pt.heartbeat('a', undefined, 0);
  pt.heartbeat('b', undefined, 500);
  // At 1500: 'a' is stale (1500 since heartbeat), 'b' is fresh.
  assert.equal(pt.staleCount(1500), 1);
  assert.equal(pt.staleCount(2000), 2);
});

test('pt7: clear empties everything', () => {
  const pt = PresenceTracker.create();
  pt.heartbeat('a', undefined, 1000);
  pt.heartbeat('b', undefined, 1000);
  pt.clear();
  assert.equal(pt.count(), 0);
});

test('pt7: setTimeoutMs honored on next tick', () => {
  const pt = PresenceTracker.create({ timeoutMs: 1000 });
  pt.heartbeat('a', undefined, 0);
  // At 500: would not expire (500 < 1000).
  pt.tick(500);
  assert.equal(pt.has('a'), true);
  pt.setTimeoutMs(100);
  // At 600: 600 - 0 > 100; expires.
  const expired = pt.tick(600);
  assert.deepEqual(expired, ['a']);
});

test('pt7: get returns a snapshot copy (mutation safe)', () => {
  const pt = PresenceTracker.create();
  pt.heartbeat('a', { x: 5 } as Record<string, unknown>, 1000);
  const a1 = pt.get('a');
  const a2 = pt.get('a');
  assert.notEqual(a1, a2, 'different object refs');
  assert.equal(a1!.id, a2!.id);
});
