// Phase 1.7.1 - LobbyState tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LobbyState,
  RESOURCE_LOBBY_STATE,
} from '../src/index.js';

test('lb: RESOURCE_LOBBY_STATE is the stable string', () => {
  assert.equal(RESOURCE_LOBBY_STATE, 'lobby_state');
});

test('lb: starts in waiting state', () => {
  const lb = LobbyState.create({ id: 'a' });
  assert.equal(lb.getStatus(), 'waiting');
  assert.equal(lb.count(), 0);
  assert.equal(lb.getHostId(), null);
});

test('lb: rejects empty / missing id', () => {
  // @ts-expect-error
  assert.throws(function () { LobbyState.create({}); });
  assert.throws(function () { LobbyState.create({ id: '' }); });
});

test('lb: join adds member + first joiner becomes host', () => {
  const lb = LobbyState.create({ id: 'a', minSize: 2, maxSize: 4 });
  assert.equal(lb.join('m1', { name: 'Misha' }, 1000), true);
  assert.equal(lb.count(), 1);
  assert.equal(lb.getHostId(), 'm1');
  const m = lb.getMember('m1');
  assert.equal(m!.ready, false);
  assert.equal(m!.joinedAt, 1000);
});

test('lb: join rejects duplicate', () => {
  const lb = LobbyState.create({ id: 'a' });
  lb.join('m1', undefined, 1000);
  assert.equal(lb.join('m1', undefined, 2000), false);
  assert.equal(lb.count(), 1);
});

test('lb: join rejects past maxSize', () => {
  const lb = LobbyState.create({ id: 'a', maxSize: 2 });
  lb.join('m1', undefined, 1000);
  lb.join('m2', undefined, 1000);
  assert.equal(lb.join('m3', undefined, 1000), false);
});

test('lb: leave drops member; host migrates to next-oldest', () => {
  const lb = LobbyState.create({ id: 'a' });
  lb.join('m1', undefined, 1000);
  lb.join('m2', undefined, 2000);
  lb.join('m3', undefined, 3000);
  assert.equal(lb.getHostId(), 'm1');
  lb.leave('m1');
  assert.equal(lb.getHostId(), 'm2', 'next-oldest becomes host');
});

test('lb: leave returns false for non-member', () => {
  const lb = LobbyState.create({ id: 'a' });
  assert.equal(lb.leave('nope'), false);
});

test('lb: markReady toggles + canStart respects ready state', () => {
  const lb = LobbyState.create({ id: 'a', minSize: 2 });
  lb.join('m1', undefined, 1000);
  lb.join('m2', undefined, 1000);
  assert.equal(lb.canStart(), false, 'nobody ready');
  lb.markReady('m1', true);
  assert.equal(lb.canStart(), false, 'only m1 ready');
  lb.markReady('m2', true);
  assert.equal(lb.canStart(), true);
});

test('lb: canStart false below minSize', () => {
  const lb = LobbyState.create({ id: 'a', minSize: 3 });
  lb.join('m1', undefined, 1000);
  lb.markReady('m1', true);
  assert.equal(lb.canStart(), false, 'only 1 < min 3');
});

test('lb: start flips to started', () => {
  const lb = LobbyState.create({ id: 'a', minSize: 1 });
  lb.join('m1', undefined, 1000);
  lb.markReady('m1', true);
  assert.equal(lb.start(2000), true);
  assert.equal(lb.getStatus(), 'started');
  assert.equal(lb.getStartedAt(), 2000);
  // Cannot start twice.
  assert.equal(lb.start(3000), false);
});

test('lb: cannot join started lobby', () => {
  const lb = LobbyState.create({ id: 'a', minSize: 1 });
  lb.join('m1', undefined, 1000);
  lb.markReady('m1', true);
  lb.start(2000);
  assert.equal(lb.join('m2', undefined, 3000), false);
});

test('lb: end transitions to ended', () => {
  const lb = LobbyState.create({ id: 'a' });
  assert.equal(lb.end(), true);
  assert.equal(lb.getStatus(), 'ended');
  assert.equal(lb.end(), false, 'second end no-ops');
});

test('lb: setHost only honors existing members', () => {
  const lb = LobbyState.create({ id: 'a' });
  lb.join('m1', undefined, 1000);
  lb.join('m2', undefined, 2000);
  assert.equal(lb.setHost('m2'), true);
  assert.equal(lb.getHostId(), 'm2');
  assert.equal(lb.setHost('nope'), false);
});

test('lb: kick is alias for leave', () => {
  const lb = LobbyState.create({ id: 'a' });
  lb.join('m1', undefined, 1000);
  lb.join('m2', undefined, 1000);
  assert.equal(lb.kick('m2'), true);
  assert.equal(lb.hasMember('m2'), false);
});

test('lb: tick kicks members past memberTimeoutMs', () => {
  const lb = LobbyState.create({ id: 'a', memberTimeoutMs: 1000 });
  lb.join('m1', undefined, 0);
  lb.join('m2', undefined, 0);
  lb.touch('m1', 500); // m1 alive
  // 1500: m2 (no touch since join @0) is past 1000ms
  const kicked = lb.tick(1500);
  assert.deepEqual(kicked, ['m2']);
  assert.equal(lb.hasMember('m1'), true);
  assert.equal(lb.hasMember('m2'), false);
});

test('lb: list returns snapshot of all members', () => {
  const lb = LobbyState.create({ id: 'a' });
  lb.join('m1', undefined, 1000);
  lb.join('m2', undefined, 1500);
  assert.equal(lb.list().length, 2);
});

test('lb: explicit hostId honored', () => {
  const lb = LobbyState.create({ id: 'a', hostId: 'preset_host' });
  lb.join('preset_host', undefined, 1000);
  lb.join('m2', undefined, 2000);
  assert.equal(lb.getHostId(), 'preset_host');
});
