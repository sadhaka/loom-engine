// Phase 1.7.3 - AuthorityHandoff tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AuthorityHandoff,
  RESOURCE_AUTHORITY_HANDOFF,
} from '../src/index.js';

test('ah: RESOURCE_AUTHORITY_HANDOFF is the stable string', () => {
  assert.equal(RESOURCE_AUTHORITY_HANDOFF, 'authority_handoff');
});

test('ah: starts with no host + no peers', () => {
  const ah = AuthorityHandoff.create();
  assert.equal(ah.getHostId(), null);
  assert.equal(ah.peerCount(), 0);
  assert.deepEqual(ah.list(), []);
});

test('ah: heartbeat adds peer + updates lastSeenAt', () => {
  const ah = AuthorityHandoff.create();
  ah.heartbeat('alice', 1000);
  ah.heartbeat('alice', 2000);
  ah.heartbeat('bob', 1500);
  assert.equal(ah.peerCount(), 2);
  const peers = ah.list();
  const alice = peers.find(p => p.id === 'alice')!;
  assert.equal(alice.firstSeenAt, 1000);
  assert.equal(alice.lastSeenAt, 2000);
});

test('ah: heartbeat rejects invalid input', () => {
  const ah = AuthorityHandoff.create();
  ah.heartbeat('', 1000);
  ah.heartbeat('a', NaN);
  assert.equal(ah.peerCount(), 0);
});

test('ah: setHost(initial) marks the chosen peer as host', () => {
  const ah = AuthorityHandoff.create();
  ah.heartbeat('alice', 1000);
  const change = ah.setHost('alice', 1100);
  assert.equal(change.kind, 'handoff');
  assert.equal(change.oldHostId, null);
  assert.equal(change.newHostId, 'alice');
  assert.equal(ah.getHostId(), 'alice');
});

test('ah: setHost(unknown) auto-adds them as peer', () => {
  const ah = AuthorityHandoff.create();
  ah.setHost('alice', 1000);
  assert.equal(ah.hasPeer('alice'), true);
  assert.equal(ah.getHostId(), 'alice');
});

test('ah: setHost(same) returns reclaim event', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice' });
  ah.heartbeat('alice', 1000);
  const change = ah.setHost('alice', 1100);
  assert.equal(change.kind, 'reclaim');
});

test('ah: setHost(null) clears the host', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice' });
  ah.heartbeat('alice', 1000);
  const change = ah.setHost(null, 1100);
  assert.equal(change.kind, 'no-host');
  assert.equal(ah.getHostId(), null);
});

test('ah: tick promotes new host when current host times out', () => {
  const ah = AuthorityHandoff.create({
    hostId: 'alice',
    timeoutMs: 1000,
    electionStrategy: 'oldest',
  });
  ah.heartbeat('alice', 0);
  ah.heartbeat('bob', 100);
  ah.heartbeat('carol', 200);
  // All present at t=500
  ah.heartbeat('alice', 500);
  ah.heartbeat('bob', 500);
  ah.heartbeat('carol', 500);
  // bob + carol heartbeat at 1500, alice doesn't
  ah.heartbeat('bob', 1500);
  ah.heartbeat('carol', 1500);
  // At t=2000 (alice 1500ms stale, > 1000ms timeout)
  const change = ah.tick(2000);
  assert.ok(change);
  assert.equal(change!.kind, 'handoff');
  assert.equal(change!.oldHostId, 'alice');
  // bob is the oldest survivor (firstSeenAt = 100 vs carol's 200)
  assert.equal(change!.newHostId, 'bob');
  assert.equal(ah.getHostId(), 'bob');
  assert.equal(ah.peerCount(), 2);  // alice removed
});

test('ah: tick returns null when no host change', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice', timeoutMs: 1000 });
  ah.heartbeat('alice', 100);
  ah.heartbeat('bob', 100);
  ah.heartbeat('alice', 500);
  ah.heartbeat('bob', 500);
  // No timeouts at t=600
  assert.equal(ah.tick(600), null);
  assert.equal(ah.getHostId(), 'alice');
});

test('ah: tick returns no-host when last peer drops', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice', timeoutMs: 1000 });
  ah.heartbeat('alice', 0);
  // alice never re-pings; at t=2000 she expires
  const change = ah.tick(2000);
  assert.ok(change);
  assert.equal(change!.kind, 'no-host');
  assert.equal(change!.newHostId, null);
  assert.equal(ah.getHostId(), null);
});

test('ah: tick rejects invalid now', () => {
  const ah = AuthorityHandoff.create();
  assert.equal(ah.tick(NaN), null);
});

test('ah: removePeer of host triggers immediate election', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice', electionStrategy: 'oldest' });
  ah.heartbeat('alice', 0);
  ah.heartbeat('bob', 100);
  const change = ah.removePeer('alice', 200);
  assert.ok(change);
  assert.equal(change!.kind, 'host-leave');
  assert.equal(change!.newHostId, 'bob');
  assert.equal(ah.getHostId(), 'bob');
});

test('ah: removePeer of non-host returns null', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice' });
  ah.heartbeat('alice', 0);
  ah.heartbeat('bob', 100);
  assert.equal(ah.removePeer('bob', 200), null);
  assert.equal(ah.getHostId(), 'alice');
});

test('ah: removePeer of last peer leaves no-host', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice' });
  ah.heartbeat('alice', 0);
  const change = ah.removePeer('alice', 100);
  assert.ok(change);
  assert.equal(change!.kind, 'no-host');
  assert.equal(ah.getHostId(), null);
});

test('ah: lowest-id strategy picks lexicographically smallest', () => {
  const ah = AuthorityHandoff.create({
    hostId: 'zoe',
    timeoutMs: 100,
    electionStrategy: 'lowest-id',
  });
  ah.heartbeat('zoe', 0);
  ah.heartbeat('charlie', 50);
  ah.heartbeat('alice', 30);
  ah.heartbeat('bob', 10);
  // Survivors heartbeat
  ah.heartbeat('charlie', 200);
  ah.heartbeat('alice', 200);
  ah.heartbeat('bob', 200);
  // zoe expires at t=300
  const change = ah.tick(300);
  assert.ok(change);
  assert.equal(change!.newHostId, 'alice');  // lexicographic min
});

test('ah: custom strategy function used when provided', () => {
  const ah = AuthorityHandoff.create({
    hostId: 'alice',
    timeoutMs: 100,
    electionStrategy: (peers) => peers.find(p => p.id === 'carol')?.id || null,
  });
  ah.heartbeat('alice', 0);
  ah.heartbeat('bob', 0);
  ah.heartbeat('carol', 0);
  // Survivors
  ah.heartbeat('bob', 200);
  ah.heartbeat('carol', 200);
  const change = ah.tick(300);
  assert.equal(change!.newHostId, 'carol');
});

test('ah: elect() public method usable for diagnostics', () => {
  const ah = AuthorityHandoff.create({ electionStrategy: 'oldest' });
  ah.heartbeat('zoe', 100);
  ah.heartbeat('alice', 50);
  ah.heartbeat('bob', 200);
  assert.equal(ah.elect(), 'alice');  // earliest firstSeenAt
});

test('ah: elect() returns null when empty', () => {
  const ah = AuthorityHandoff.create();
  assert.equal(ah.elect(), null);
});

test('ah: setTimeoutMs / getTimeoutMs round-trip', () => {
  const ah = AuthorityHandoff.create({ timeoutMs: 1000 });
  assert.equal(ah.getTimeoutMs(), 1000);
  ah.setTimeoutMs(5000);
  assert.equal(ah.getTimeoutMs(), 5000);
  // Reject invalid
  ah.setTimeoutMs(-1);
  assert.equal(ah.getTimeoutMs(), 5000);
});

test('ah: clear() resets state', () => {
  const ah = AuthorityHandoff.create({ hostId: 'alice' });
  ah.heartbeat('alice', 0);
  ah.heartbeat('bob', 0);
  ah.clear();
  assert.equal(ah.peerCount(), 0);
  assert.equal(ah.getHostId(), null);
});
