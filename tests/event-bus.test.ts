// Phase 0.28.0 - EventBus tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { EventBus } from '../src/runtime/event-bus.js';


test('event-bus: subscribe + publish delivers data', function () {
  var bus = new EventBus();
  var seen: number[] = [];
  bus.subscribe<number>('count', function (n) { seen.push(n); });
  bus.publish('count', 1);
  bus.publish('count', 2);
  bus.publish('count', 3);
  assert.deepEqual(seen, [1, 2, 3]);
});

test('event-bus: multiple subscribers all receive each publish', function () {
  var bus = new EventBus();
  var a: string[] = [];
  var b: string[] = [];
  bus.subscribe<string>('chat', function (msg) { a.push(msg); });
  bus.subscribe<string>('chat', function (msg) { b.push(msg); });
  bus.publish('chat', 'hello');
  assert.deepEqual(a, ['hello']);
  assert.deepEqual(b, ['hello']);
});

test('event-bus: unsubscribe stops delivery', function () {
  var bus = new EventBus();
  var seen: number[] = [];
  var unsub = bus.subscribe<number>('count', function (n) { seen.push(n); });
  bus.publish('count', 1);
  unsub();
  bus.publish('count', 2);
  assert.deepEqual(seen, [1]);
});

test('event-bus: unsubscribe is idempotent', function () {
  var bus = new EventBus();
  var unsub = bus.subscribe('topic', function () { /* noop */ });
  unsub();
  unsub();
  unsub();
  assert.equal(bus.handlerCount('topic'), 0);
});

test('event-bus: once fires exactly once and auto-removes', function () {
  var bus = new EventBus();
  var calls = 0;
  bus.once('boot', function () { calls++; });
  bus.publish('boot');
  bus.publish('boot');
  bus.publish('boot');
  assert.equal(calls, 1);
  assert.equal(bus.handlerCount('boot'), 0);
});

test('event-bus: handlers added during publish do NOT fire for same publish', function () {
  var bus = new EventBus();
  var late: string[] = [];
  bus.subscribe('topic', function () {
    bus.subscribe('topic', function () { late.push('late'); });
  });
  bus.publish('topic');
  // The "late" handler was added during delivery; it should not
  // have fired this round.
  assert.equal(late.length, 0);
  // But it fires on the next publish.
  bus.publish('topic');
  assert.equal(late.length, 1);
});

test('event-bus: handler that throws does NOT block other handlers', function () {
  var bus = new EventBus();
  var b = false;
  bus.subscribe('t', function () { throw new Error('boom'); });
  bus.subscribe('t', function () { b = true; });
  bus.publish('t');
  assert.equal(b, true,
    'second handler should still receive even if first threw');
});

test('event-bus: handler that throws does NOT block subsequent publishes', function () {
  var bus = new EventBus();
  var calls = 0;
  bus.subscribe('t', function () { throw new Error('boom'); });
  bus.subscribe('t', function () { calls++; });
  bus.publish('t');
  bus.publish('t');
  bus.publish('t');
  assert.equal(calls, 3);
});

test('event-bus: off() drops all handlers for a topic', function () {
  var bus = new EventBus();
  bus.subscribe('a', function () {});
  bus.subscribe('a', function () {});
  bus.subscribe('b', function () {});
  assert.equal(bus.handlerCount('a'), 2);
  bus.off('a');
  assert.equal(bus.handlerCount('a'), 0);
  assert.equal(bus.handlerCount('b'), 1);
});

test('event-bus: clear() drops all topics', function () {
  var bus = new EventBus();
  bus.subscribe('a', function () {});
  bus.subscribe('b', function () {});
  bus.clear();
  assert.deepEqual(bus.topics(), []);
});

test('event-bus: topics() lists subscribed topic names', function () {
  var bus = new EventBus();
  bus.subscribe('a', function () {});
  bus.subscribe('b', function () {});
  bus.subscribe('a', function () {});
  var topics = bus.topics().slice().sort();
  assert.deepEqual(topics, ['a', 'b']);
});

test('event-bus: stats track publish + delivered counts', function () {
  var bus = new EventBus();
  bus.subscribe('t', function () {});
  bus.subscribe('t', function () {});
  bus.publish('t');
  bus.publish('t');
  bus.publish('unknown');  // no subscribers
  var stats = bus.stats();
  assert.equal(stats.publishCount, 3);
  assert.equal(stats.deliveredCount, 4);  // 2 handlers * 2 publishes; 0 for unknown
});

test('event-bus: publish with no subscribers is a silent no-op', function () {
  var bus = new EventBus();
  // Must not throw, regardless of data shape.
  bus.publish('nobody-listening');
  bus.publish('also-nobody', { complex: { data: [1, 2, 3] } });
  assert.equal(bus.stats().deliveredCount, 0);
});
