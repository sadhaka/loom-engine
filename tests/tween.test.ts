// Phase 0.29.0 - Tween tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { Tween, Easings } from '../src/runtime/tween.js';


test('tween: linear interpolates from -> to over duration', function () {
  var tw = new Tween();
  var values: number[] = [];
  tw.to(0, 100, 1.0, function (v) { values.push(v); }, { easing: 'linear' });
  // Half-way: 0.5s elapsed, value should be ~50.
  tw.update(0.5);
  assert.ok(Math.abs(values[values.length - 1]! - 50) < 0.001);
  // Full: 1.0s elapsed total, value should be 100.
  tw.update(0.5);
  assert.equal(values[values.length - 1], 100);
});

test('tween: completes after duration; no further updates', function () {
  var tw = new Tween();
  var calls = 0;
  tw.to(0, 1, 0.5, function () { calls++; });
  tw.update(0.5);
  var afterFirst = calls;
  tw.update(0.5);
  // Should not fire more; tween has completed.
  assert.equal(calls, afterFirst);
});

test('tween: onComplete fires once at the end', function () {
  var tw = new Tween();
  var done = 0;
  tw.to(0, 10, 0.5, function () {}, {
    onComplete: function () { done++; },
  });
  tw.update(0.5);
  assert.equal(done, 1);
  // Subsequent updates do not re-fire.
  tw.update(0.1);
  assert.equal(done, 1);
});

test('tween: zero duration snaps immediately to `to` + completes', function () {
  var tw = new Tween();
  var lastValue = 0;
  var done = 0;
  tw.to(10, 99, 0, function (v) { lastValue = v; }, {
    onComplete: function () { done++; },
  });
  // No update call needed - it snapped during to().
  assert.equal(lastValue, 99);
  assert.equal(done, 1);
});

test('tween: cancel stops further updates; onComplete does NOT fire', function () {
  var tw = new Tween();
  var calls = 0;
  var done = 0;
  var h = tw.to(0, 100, 1, function () { calls++; }, {
    onComplete: function () { done++; },
  });
  tw.update(0.3);
  var beforeCancel = calls;
  h.cancel();
  tw.update(1.0);
  assert.equal(calls, beforeCancel,
    'no further onUpdate calls after cancel');
  assert.equal(done, 0,
    'onComplete must NOT fire on cancelled tween');
});

test('tween: handle.isActive reflects status', function () {
  var tw = new Tween();
  var h = tw.to(0, 1, 1, function () {});
  assert.equal(h.isActive(), true);
  tw.update(1);
  // After completion the entry was dropped; isActive cannot easily
  // tell completed-vs-cancelled; we just check not-active.
  // Note: isActive on a completed entry returns false because elapsed
  // >= duration in the snapshot, but since we drop on update, the
  // closure's entry no longer exists in the active list. The
  // closure-bound elapsed is what matters.
  assert.equal(h.isActive(), false);
});

test('tween: multiple tweens run in parallel', function () {
  var tw = new Tween();
  var a = 0;
  var b = 0;
  tw.to(0, 100, 1, function (v) { a = v; });
  tw.to(0, 200, 1, function (v) { b = v; });
  tw.update(0.5);
  assert.ok(Math.abs(a - 50) < 0.001);
  assert.ok(Math.abs(b - 100) < 0.001);
  assert.equal(tw.activeCount(), 2);
});

test('tween: cancelAll cancels every running tween', function () {
  var tw = new Tween();
  tw.to(0, 1, 1, function () {});
  tw.to(0, 1, 1, function () {});
  tw.to(0, 1, 1, function () {});
  assert.equal(tw.activeCount(), 3);
  tw.cancelAll();
  // activeCount counts non-cancelled entries; all are now cancelled.
  assert.equal(tw.activeCount(), 0);
});

test('tween: easing function customizable via name', function () {
  var tw = new Tween();
  var values: number[] = [];
  tw.to(0, 1, 1, function (v) { values.push(v); }, { easing: 'easeInQuad' });
  // At 0.5 t, easeInQuad gives 0.25, so value = 0 + 0.25 * 1 = 0.25.
  tw.update(0.5);
  assert.ok(Math.abs(values[values.length - 1]! - 0.25) < 0.001,
    'easeInQuad at half = 0.25; got ' + values[values.length - 1]);
});

test('tween: easing function customizable via callable', function () {
  var tw = new Tween();
  var values: number[] = [];
  // Custom: t * t * t * t (steeper than ease-in-quart slightly).
  tw.to(0, 1, 1, function (v) { values.push(v); }, {
    easing: function (t) { return t * t * t * t; },
  });
  tw.update(0.5);
  // 0.5^4 = 0.0625
  assert.ok(Math.abs(values[values.length - 1]! - 0.0625) < 0.001);
});

test('tween: unknown easing name falls back to linear', function () {
  var tw = new Tween();
  var values: number[] = [];
  tw.to(0, 100, 1, function (v) { values.push(v); }, {
    easing: 'unknownEasing' as never,
  });
  tw.update(0.5);
  // Linear = 50.
  assert.ok(Math.abs(values[values.length - 1]! - 50) < 0.001);
});

test('tween: invalid dt is ignored (no NaN propagation)', function () {
  var tw = new Tween();
  var lastValue = 0;
  tw.to(0, 100, 1, function (v) { lastValue = v; });
  tw.update(NaN);
  tw.update(-1);
  assert.equal(lastValue, 0,
    'invalid dt must not advance the tween');
});

test('tween: throwing onUpdate is caught; tween still completes', function () {
  var tw = new Tween();
  var done = 0;
  tw.to(0, 1, 0.5, function () { throw new Error('boom'); }, {
    onComplete: function () { done++; },
  });
  // Must not throw.
  tw.update(0.5);
  assert.equal(done, 1);
});

test('tween: stats track active + completed + cancelled', function () {
  var tw = new Tween();
  var h1 = tw.to(0, 1, 1, function () {});
  var h2 = tw.to(0, 1, 1, function () {});
  void h1;
  void h2;
  tw.to(0, 1, 0.5, function () {});  // will complete first
  tw.update(0.5);  // 1 completes, 2 still active
  var s = tw.stats();
  assert.equal(s.completed, 1);
  assert.equal(s.active, 2);
  h1.cancel();
  assert.equal(tw.stats().cancelled, 1);
});

test('tween: Easings table has 22 named functions', function () {
  // 0.29.0 base set:    1 + 3 quad + 3 cubic + 3 quart + 3 sine = 13.
  // 0.40.0 extension:   3 back + 3 elastic + 3 bounce             = 9.
  // Total: 22.
  var keys = Object.keys(Easings);
  assert.equal(keys.length, 22);
  assert.ok(typeof Easings.easeInQuad === 'function');
  assert.ok(typeof Easings.easeOutCubic === 'function');
  assert.ok(typeof Easings.easeInOutSine === 'function');
  assert.ok(typeof Easings.easeOutBack === 'function');
  assert.ok(typeof Easings.easeOutElastic === 'function');
  assert.ok(typeof Easings.easeOutBounce === 'function');
});
