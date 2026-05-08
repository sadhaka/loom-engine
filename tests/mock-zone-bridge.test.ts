// Loom Engine - Phase 16 v2 MockZoneBridge tests.
//
// enqueueIncoming / pollEvents contract, per-zone last-id tracking,
// snapshot recovery shape, JSON enqueue parsing edge cases.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MockZoneBridge,
  type ZoneEvent,
  type ZoneEventEnvelope,
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

function narrator(id: number, zone: string, line: string): ZoneEvent {
  return ev(id, 'zone.narrator', zone, { line, voice: 'ambient', ttl_ms: 1000 });
}

function bossSpawn(id: number, zone: string, bossId: string): ZoneEvent {
  return ev(id, 'zone.boss.spawn', zone, {
    boss: {
      boss_id: bossId,
      type: 'iron_titan',
      name: 'Iron Titan',
      hp_max: 1000,
      hp_current: 1000,
      dmg: 50,
      x: 0, y: 0,
      knot_flavor: 'str',
    },
    narrator_line: null,
  });
}

// ----- Lifecycle -----

test('mock zone bridge: starts idle, becomes connected after start()', () => {
  const b = new MockZoneBridge();
  assert.equal(b.status(), 'idle');
  assert.equal(b.isConnected(), false);
  b.start();
  assert.equal(b.status(), 'connected');
  assert.equal(b.isConnected(), true);
});

test('mock zone bridge: stop sets closed', () => {
  const b = new MockZoneBridge();
  b.start();
  b.stop();
  assert.equal(b.status(), 'closed');
  assert.equal(b.isConnected(), false);
});

// ----- enqueue / poll contract -----

test('mock zone bridge: enqueue / pollEvents drains FIFO + tracks per-zone last id', () => {
  const b = new MockZoneBridge();
  b.start();
  b.enqueueIncoming(narrator(1, 'iron_reach', 'A'));
  b.enqueueIncoming(narrator(2, 'iron_reach', 'B'));
  b.enqueueIncoming(narrator(1, 'saltsprig', 'C'));   // zone B id 1
  assert.equal(b.pending(), 3);
  const drained = b.pollEvents();
  assert.equal(drained.length, 3);
  assert.equal(drained[0]?.id, 1);
  assert.equal(drained[2]?.zone_id, 'saltsprig');
  assert.equal(b.pending(), 0);
  assert.equal(b.getLastEventId('iron_reach'), 2);
  assert.equal(b.getLastEventId('saltsprig'), 1);
  assert.equal(b.getLastEventId('unknown'), 0);
  // Second poll empty.
  assert.equal(b.pollEvents().length, 0);
});

test('mock zone bridge: out-of-order enqueue increments stat without rewinding lastEventId', () => {
  const b = new MockZoneBridge();
  b.start();
  b.enqueueIncoming(narrator(5, 'iron_reach', 'A'));
  b.enqueueIncoming(narrator(2, 'iron_reach', 'B'));   // out of order
  assert.equal(b.stats().outOfOrderEvents, 1);
  assert.equal(b.getLastEventId('iron_reach'), 5);
});

test('mock zone bridge: enqueueAll batch respects order and counts events', () => {
  const b = new MockZoneBridge();
  b.start();
  b.enqueueAll([
    narrator(1, 'iron_reach', 'A'),
    narrator(2, 'iron_reach', 'B'),
    narrator(3, 'iron_reach', 'C'),
  ]);
  assert.equal(b.pending(), 3);
  assert.equal(b.stats().eventsReceived, 3);
});

// ----- enqueueIncomingJson -----

test('mock zone bridge: enqueueIncomingJson parses + accepts valid JSON', () => {
  const b = new MockZoneBridge();
  b.start();
  const json = JSON.stringify(narrator(1, 'iron_reach', 'X'));
  const ok = b.enqueueIncomingJson(json);
  assert.equal(ok, true);
  assert.equal(b.pending(), 1);
});

test('mock zone bridge: enqueueIncomingJson silently drops malformed JSON', () => {
  const b = new MockZoneBridge();
  b.start();
  const ok = b.enqueueIncomingJson('{not even json');
  assert.equal(ok, false);
  assert.equal(b.pending(), 0);
});

test('mock zone bridge: enqueueIncomingJson silently drops shape errors', () => {
  const b = new MockZoneBridge();
  b.start();
  const ok = b.enqueueIncomingJson('{"id": -1, "type": "zone.narrator"}');
  assert.equal(ok, false);
  assert.equal(b.pending(), 0);
});

// ----- snapshot recovery shape -----

test('mock zone bridge: snapshot recovery presents lastEventIdByZone via stats()', () => {
  const b = new MockZoneBridge();
  b.start();
  // Simulate a snapshot for zone A advancing the bridge's id pointer.
  const snap: ZoneEvent = ev(42, 'zone.snapshot', 'iron_reach', {
    active_boss: null,
    knot: null,
    state: [],
    last_event_id: 42,
  });
  b.enqueueIncoming(snap);
  assert.equal(b.getLastEventId('iron_reach'), 42);
  const stats = b.stats();
  assert.equal(stats.eventsReceived, 1);
  assert.equal(stats.lastEventIdByZone.get('iron_reach'), 42);
});

test('mock zone bridge: snapshot recovery isolates zones (per-zone monotonic ids)', () => {
  const b = new MockZoneBridge();
  b.start();
  // Zone A snapshot at id 30, then Zone B starts fresh at id 1.
  b.enqueueIncoming(ev(30, 'zone.snapshot', 'iron_reach', {
    active_boss: null, knot: null, state: [], last_event_id: 30,
  }));
  b.enqueueIncoming(bossSpawn(1, 'saltsprig', 'b_kraken'));
  assert.equal(b.getLastEventId('iron_reach'), 30);
  assert.equal(b.getLastEventId('saltsprig'), 1);
});

// ----- stats -----

test('mock zone bridge: stats() reflects bumpReconnect + setServerDrops', () => {
  const b = new MockZoneBridge();
  b.start();
  b.bumpReconnect();
  b.bumpReconnect();
  b.setServerDrops(7, 11);
  const s = b.stats();
  assert.equal(s.reconnects, 2);
  assert.equal(s.serverDropsP1, 7);
  assert.equal(s.serverDropsP2, 11);
});

test('mock zone bridge: stats().lastEventIdByZone is a snapshot, not live', () => {
  const b = new MockZoneBridge();
  b.start();
  b.enqueueIncoming(narrator(1, 'iron_reach', 'A'));
  const before = b.stats();
  b.enqueueIncoming(narrator(2, 'iron_reach', 'B'));
  // The earlier snapshot must NOT mutate after the fact.
  assert.equal(before.lastEventIdByZone.get('iron_reach'), 1);
  const after = b.stats();
  assert.equal(after.lastEventIdByZone.get('iron_reach'), 2);
});
