// Phase 0.20.0 - SSEDirectorBridge networking polish tests.
//
// Coverage: backoff with jitter, attempt counter reset on connect,
// status state machine + CustomEvent dispatch, stats counters
// (lastConnected/Disconnected timestamps, totalConnects/Disconnects,
// currentReconnectAttempt).
//
// Strategy: inject setTimeoutFn / clearTimeoutFn / randomFn / nowFn
// + a fake EventSource so we can drive timing + clock deterministically.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { SSEDirectorBridge } from '../../src/director/sse-director-bridge.js';

// ----- Fakes -----

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState: number = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null;
  closed: boolean = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  // Director bridge calls addEventListener for named SSE events
  // (`director.event` etc). Tests don't fire those, so a no-op stub is
  // enough.
  addEventListener(_type: string, _listener: unknown): void { /* noop */ }
  removeEventListener(_type: string, _listener: unknown): void { /* noop */ }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  // Test helpers.
  fireOpen(): void {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }

  fireError(): void {
    this.readyState = 2;
    if (this.onerror) this.onerror();
  }
}

class TimeMachine {
  now: number = 1700000000000;
  pending: Array<{ at: number; fn: () => void; id: number }> = [];
  nextId: number = 1;

  setTimeout = (fn: () => void, ms: number): number => {
    var id = this.nextId++;
    this.pending.push({ at: this.now + ms, fn: fn, id: id });
    this.pending.sort(function (a, b) { return a.at - b.at; });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    var n = Number(id);
    var i = this.pending.findIndex(function (p) { return p.id === n; });
    if (i >= 0) this.pending.splice(i, 1);
  };

  nowFn = (): number => this.now;

  // Advance virtual time by `ms`, firing any scheduled callbacks
  // whose deadline falls in the interval.
  tick(ms: number): void {
    var target = this.now + ms;
    while (this.pending.length > 0 && this.pending[0].at <= target) {
      var entry = this.pending.shift()!;
      this.now = entry.at;
      entry.fn();
    }
    this.now = target;
  }
}

function makeBridge(opts: {
  random?: () => number;
  base?: number;
  max?: number;
  events?: EventTarget | null;
} = {}) {
  var clock = new TimeMachine();
  var bridge = new SSEDirectorBridge({
    baseUrl:           'https://example.test/sse',
    characterId:       'c_test',
    eventSourceFactory: function (url) { return new FakeEventSource(url) as unknown as EventSource; },
    setTimeoutFn:      clock.setTimeout,
    clearTimeoutFn:    clock.clearTimeout,
    randomFn:          opts.random || function () { return 0.0; },
    nowFn:             clock.nowFn,
    baseBackoffMs:     opts.base !== undefined ? opts.base : 500,
    maxBackoffMs:      opts.max !== undefined ? opts.max : 30000,
    statusEventTarget: opts.events !== undefined ? opts.events : null,
  });
  return { bridge: bridge, clock: clock };
}


// ----- Tests -----

test('director bridge: initial status is idle; start transitions to connecting', function () {
  FakeEventSource.instances.length = 0;
  var rig = makeBridge();
  assert.equal(rig.bridge.status(), 'idle');
  rig.bridge.start();
  assert.equal(rig.bridge.status(), 'connecting');
});

test('director bridge: onopen transitions to connected + bumps totalConnectsCount', function () {
  FakeEventSource.instances.length = 0;
  var rig = makeBridge();
  rig.bridge.start();
  assert.equal(FakeEventSource.instances.length, 1);
  FakeEventSource.instances[0].fireOpen();
  assert.equal(rig.bridge.status(), 'connected');
  var stats = rig.bridge.stats();
  assert.equal(stats.totalConnectsCount, 1);
  assert.ok(stats.lastConnectedAtMs > 0,
    'lastConnectedAtMs should be set on open; got ' + String(stats.lastConnectedAtMs));
});

test('director bridge: onerror schedules reconnect with computed backoff (zero jitter)', function () {
  FakeEventSource.instances.length = 0;
  // randomFn=0 means jitter=0; backoff is purely deterministic.
  var rig = makeBridge({ random: function () { return 0.0; }, base: 500, max: 30000 });
  rig.bridge.start();
  FakeEventSource.instances[0].fireOpen();
  FakeEventSource.instances[0].fireError();
  assert.equal(rig.bridge.status(), 'reconnecting');
  // delay_0 = min(30000, 500 * 1) + 0 = 500ms.
  rig.clock.tick(499);
  assert.equal(FakeEventSource.instances.length, 1, 'no new ES yet');
  rig.clock.tick(2);
  assert.equal(FakeEventSource.instances.length, 2, 'second ES created at 500ms');
  assert.equal(rig.bridge.status(), 'connecting');
});

test('director bridge: backoff doubles per attempt + caps at maxBackoffMs', function () {
  FakeEventSource.instances.length = 0;
  // No jitter; small base + max for fast iteration.
  var rig = makeBridge({ random: function () { return 0.0; }, base: 100, max: 800 });
  rig.bridge.start();

  function disconnectAndAdvance(expectedDelay: number, attemptLabel: string) {
    var lastIdx = FakeEventSource.instances.length - 1;
    FakeEventSource.instances[lastIdx].fireError();
    rig.clock.tick(expectedDelay - 1);
    var beforeNew = FakeEventSource.instances.length;
    rig.clock.tick(2);
    var afterNew = FakeEventSource.instances.length;
    assert.equal(afterNew, beforeNew + 1,
      attemptLabel + ' delay should be ' + String(expectedDelay) + 'ms');
  }

  // Need at least one successful open before backoff resets are
  // meaningful; skip that and keep firing errors directly to test
  // the geometric progression.
  disconnectAndAdvance(100, 'attempt 0');
  disconnectAndAdvance(200, 'attempt 1');
  disconnectAndAdvance(400, 'attempt 2');
  disconnectAndAdvance(800, 'attempt 3 (caps at max)');
  disconnectAndAdvance(800, 'attempt 4 (still capped)');
});

test('director bridge: backoff jitter adds 0..BASE ms uniformly', function () {
  FakeEventSource.instances.length = 0;
  // randomFn=0.5 means jitter = 0.5 * BASE = 250ms.
  var rig = makeBridge({ random: function () { return 0.5; }, base: 500, max: 30000 });
  rig.bridge.start();
  FakeEventSource.instances[0].fireError();
  // delay_0 = min(30000, 500*1) + 0.5*500 = 750ms.
  rig.clock.tick(749);
  assert.equal(FakeEventSource.instances.length, 1);
  rig.clock.tick(2);
  assert.equal(FakeEventSource.instances.length, 2,
    'jitter=0.5 should yield 750ms total delay');
});

test('director bridge: successful open resets reconnectAttempt counter', function () {
  FakeEventSource.instances.length = 0;
  var rig = makeBridge({ random: function () { return 0.0; }, base: 100, max: 30000 });
  rig.bridge.start();
  FakeEventSource.instances[0].fireOpen();

  // Two error+reconnect cycles.
  FakeEventSource.instances[0].fireError();
  rig.clock.tick(101); // 100ms attempt 0
  FakeEventSource.instances[1].fireError();
  rig.clock.tick(201); // 200ms attempt 1
  // We're now on instance 2; counter is at 2 attempts.
  assert.equal(rig.bridge.stats().currentReconnectAttempt, 2);

  // A fresh connect resets the counter back to 0.
  FakeEventSource.instances[2].fireOpen();
  assert.equal(rig.bridge.stats().currentReconnectAttempt, 0,
    'currentReconnectAttempt should reset on successful onopen');

  // After reset, the next error starts at attempt 0 again (100ms).
  FakeEventSource.instances[2].fireError();
  rig.clock.tick(99);
  var beforeNew = FakeEventSource.instances.length;
  rig.clock.tick(2);
  assert.equal(FakeEventSource.instances.length, beforeNew + 1);
});

test('director bridge: dispatches arpg:director-bridge-status CustomEvents on transitions', function () {
  FakeEventSource.instances.length = 0;
  var target = new EventTarget();
  var transitions: Array<{ from: string; to: string }> = [];
  target.addEventListener('arpg:director-bridge-status', function (e) {
    var detail = (e as CustomEvent).detail;
    transitions.push({ from: String(detail.from), to: String(detail.to) });
  });
  var rig = makeBridge({ events: target });
  rig.bridge.start();
  // Should see idle -> connecting at minimum.
  assert.ok(transitions.length >= 1);
  var first = transitions[0];
  assert.equal(first.from, 'idle');
  assert.equal(first.to, 'connecting');

  // open -> connected.
  FakeEventSource.instances[0].fireOpen();
  var connectedT = transitions.find(function (t) {
    return t.from === 'connecting' && t.to === 'connected';
  });
  assert.ok(connectedT, 'expected connecting -> connected transition');

  // error -> reconnecting.
  FakeEventSource.instances[0].fireError();
  var reconnectingT = transitions.find(function (t) {
    return t.to === 'reconnecting';
  });
  assert.ok(reconnectingT, 'expected -> reconnecting transition');
});

test('director bridge: stats include lastDisconnected + totalDisconnects on error', function () {
  FakeEventSource.instances.length = 0;
  var rig = makeBridge({ random: function () { return 0.0; } });
  rig.bridge.start();
  FakeEventSource.instances[0].fireOpen();
  // Advance the clock so lastDisconnectedAtMs is greater than initial.
  rig.clock.tick(100);
  FakeEventSource.instances[0].fireError();
  var stats = rig.bridge.stats();
  assert.ok(stats.lastDisconnectedAtMs > 0);
  assert.equal(stats.totalDisconnectsCount, 1);
});

test('director bridge: explicit stop() transitions to closed + cancels pending reconnect', function () {
  FakeEventSource.instances.length = 0;
  var rig = makeBridge({ random: function () { return 0.0; } });
  rig.bridge.start();
  FakeEventSource.instances[0].fireOpen();
  FakeEventSource.instances[0].fireError();
  // Reconnect is scheduled; we have a pending timeout in the queue.
  assert.ok(rig.clock.pending.length >= 1);

  rig.bridge.stop();
  assert.equal(rig.bridge.status(), 'closed');
  // Stop should have cleared the pending timeout, so advancing time
  // should NOT create a new EventSource.
  rig.clock.tick(10000);
  assert.equal(FakeEventSource.instances.length, 1,
    'stop() should cancel pending reconnect');
});
