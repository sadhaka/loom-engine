// Phase 0.20.1 - SSEZoneBridge networking polish tests.
//
// Coverage: status state machine + arpg:zone-bridge-status CustomEvents,
// connection-timing stats (lastConnected/Disconnected, totalConnects/
// Disconnects). The zone-bridge does NOT own EventSource lifecycle
// (presence layer does), so backoff and snapshot-required handling
// are out of scope for these tests; the underlying ES drives the
// transitions and the bridge mirrors them.
//
// Critical contract preserved from 0.20.0: out-of-order events MUST
// still be queued. The fuzzer test in tests/fuzzer/fuzzer.test.ts
// already enforces this; these tests assert the new transitions
// without disturbing it.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { SSEZoneBridge } from '../../src/director/zone/sse-zone-bridge.js';

// ----- Fakes -----

class FakeEventSource {
  readyState: number = 0;  // 0=connecting, 1=open, 2=closed
  private listeners: Map<string, Array<(e: { data?: unknown }) => void>> = new Map();

  addEventListener(type: string, listener: (e: { data?: unknown }) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (e: { data?: unknown }) => void): void {
    var arr = this.listeners.get(type);
    if (!arr) return;
    var i = arr.indexOf(listener);
    if (i >= 0) arr.splice(i, 1);
  }

  // Test helpers.
  setReadyState(s: number): void { this.readyState = s; }
  dispatch(type: string, data: string): void {
    var arr = this.listeners.get(type);
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) arr[i]({ data: data });
  }
}

function makeBridge(opts: {
  events?: EventTarget | null;
  initialReadyState?: number;
  now?: () => number;
} = {}) {
  var fakeEs = new FakeEventSource();
  fakeEs.readyState = opts.initialReadyState !== undefined
    ? opts.initialReadyState : 1; // open by default
  var bridge = new SSEZoneBridge({
    eventSource: fakeEs,
    characterId: 'c_test',
    currentZone: () => 'lastlight_plaza',
    statusEventTarget: opts.events !== undefined ? opts.events : null,
    nowFn: opts.now,
  });
  return { bridge: bridge, fakeEs: fakeEs };
}


// ----- Tests -----

test('zone bridge: initial status is idle; start with open ES -> connected', function () {
  var rig = makeBridge();
  assert.equal(rig.bridge.status(), 'idle');
  rig.bridge.start();
  assert.equal(rig.bridge.status(), 'connected');
});

test('zone bridge: start with connecting ES -> connecting status', function () {
  var rig = makeBridge({ initialReadyState: 0 });
  rig.bridge.start();
  assert.equal(rig.bridge.status(), 'connecting');
});

test('zone bridge: start with closed ES -> closed status', function () {
  var rig = makeBridge({ initialReadyState: 2 });
  rig.bridge.start();
  assert.equal(rig.bridge.status(), 'closed');
});

test('zone bridge: status() reflects underlying ES readyState transitions', function () {
  var rig = makeBridge({ initialReadyState: 0 });
  rig.bridge.start();
  assert.equal(rig.bridge.status(), 'connecting');
  // Underlying ES opens.
  rig.fakeEs.setReadyState(1);
  assert.equal(rig.bridge.status(), 'connected');
  // Underlying ES closes.
  rig.fakeEs.setReadyState(2);
  assert.equal(rig.bridge.status(), 'closed');
});

test('zone bridge: stop() transitions to closed', function () {
  var rig = makeBridge();
  rig.bridge.start();
  assert.equal(rig.bridge.status(), 'connected');
  rig.bridge.stop();
  assert.equal(rig.bridge.status(), 'closed');
});

test('zone bridge: connected transition bumps lastConnectedAtMs + totalConnectsCount', function () {
  var clock = 1700000000000;
  var rig = makeBridge({ now: () => clock });
  rig.bridge.start();
  var stats = rig.bridge.stats();
  assert.equal(stats.totalConnectsCount, 1);
  assert.equal(stats.lastConnectedAtMs, clock);
});

test('zone bridge: connected -> closed bumps lastDisconnectedAtMs + totalDisconnectsCount', function () {
  var clock = 1700000000000;
  var rig = makeBridge({ now: () => clock });
  rig.bridge.start();
  // Advance the clock so lastDisconnectedAtMs is distinguishable.
  clock = 1700000005000;
  rig.bridge.stop();
  var stats = rig.bridge.stats();
  assert.equal(stats.totalDisconnectsCount, 1);
  assert.equal(stats.lastDisconnectedAtMs, 1700000005000);
});

test('zone bridge: dispatches arpg:zone-bridge-status CustomEvents on transitions', function () {
  var target = new EventTarget();
  var transitions: Array<{ from: string; to: string; characterId: string }> = [];
  target.addEventListener('arpg:zone-bridge-status', function (e) {
    var detail = (e as CustomEvent).detail;
    transitions.push({
      from: String(detail.from),
      to: String(detail.to),
      characterId: String(detail.characterId),
    });
  });
  var rig = makeBridge({ events: target });
  rig.bridge.start();
  // Should see idle -> connected at minimum.
  assert.ok(transitions.length >= 1);
  var first = transitions[0];
  assert.equal(first.from, 'idle');
  assert.equal(first.to, 'connected');
  assert.equal(first.characterId, 'c_test');

  rig.bridge.stop();
  var closed = transitions.find(function (t) { return t.to === 'closed'; });
  assert.ok(closed, 'expected -> closed transition');
});

test('zone bridge: stats include all 0.20.1 fields without breaking existing fields', function () {
  var rig = makeBridge();
  rig.bridge.start();
  var stats = rig.bridge.stats();
  // 0.20.1 fields.
  assert.equal(typeof stats.lastConnectedAtMs, 'number');
  assert.equal(typeof stats.lastDisconnectedAtMs, 'number');
  assert.equal(typeof stats.totalConnectsCount, 'number');
  assert.equal(typeof stats.totalDisconnectsCount, 'number');
  // Existing fields preserved.
  assert.equal(typeof stats.eventsReceived, 'number');
  assert.equal(typeof stats.reconnects, 'number');
  assert.equal(typeof stats.outOfOrderEvents, 'number');
  assert.ok(stats.lastEventIdByZone instanceof Map);
});

test('zone bridge: out-of-order delivery still works (regression check)', function () {
  // The fuzzer enforces this in tests/fuzzer/fuzzer.test.ts; this is
  // a defensive duplicate so 0.20.1 changes never silently break it.
  var rig = makeBridge();
  rig.bridge.start();
  rig.fakeEs.dispatch('zone.event', JSON.stringify({
    id: 100, ts: 1, type: 'zone.narrator', zone_id: 'lastlight_plaza',
    emitter_id: null, data: { line: 'a', voice: 'ambient', ttl_ms: 1 },
  }));
  rig.fakeEs.dispatch('zone.event', JSON.stringify({
    id: 50, ts: 2, type: 'zone.narrator', zone_id: 'lastlight_plaza',
    emitter_id: null, data: { line: 'b', voice: 'ambient', ttl_ms: 1 },
  }));
  var drained = rig.bridge.pollEvents();
  assert.equal(drained.length, 2,
    'out-of-order events MUST still queue (fuzzer contract preserved)');
  assert.equal(rig.bridge.stats().outOfOrderEvents, 1);
});

test('zone bridge: idempotent transitionTo (same status -> no double-bump)', function () {
  var clock = 1700000000000;
  var rig = makeBridge({ now: () => clock });
  rig.bridge.start();
  // status() polls underlying ES which is already open, so it should
  // not re-trigger a transitionTo('connected') and double-count.
  rig.bridge.status();
  rig.bridge.status();
  rig.bridge.status();
  assert.equal(rig.bridge.stats().totalConnectsCount, 1,
    'redundant status() polls should not bump totalConnectsCount');
});
