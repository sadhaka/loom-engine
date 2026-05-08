// Phase 0.40.0 - bezier easing + back / elastic / bounce curves.
//
// Existing tween tests cover Tween itself + linear / quad / cubic /
// quart / sine. This file covers the new 0.40.0 surface:
//   - cubicBezier(x1, y1, x2, y2) factory
//   - easeIn/Out/InOutBack
//   - easeIn/Out/InOutElastic
//   - easeIn/Out/InOutBounce

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  cubicBezier,
  Easings,
  Tween,
} from '../src/index.js';

// ---------- cubicBezier ----------

test('bezier: t=0 returns 0; t=1 returns 1', () => {
  const ease = cubicBezier(0.42, 0, 0.58, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
});

test('bezier: linear control points approximate the linear curve', () => {
  // (0.25, 0.25) and (0.75, 0.75) lie on y=x; the curve is the
  // identity within numerical tolerance.
  const ease = cubicBezier(0.25, 0.25, 0.75, 0.75);
  for (var i = 0; i <= 10; i++) {
    var t = i / 10;
    assert.ok(Math.abs(ease(t) - t) < 1e-3, `linear bezier off at t=${t}: ${ease(t)}`);
  }
});

test('bezier: ease-out curve front-loads progress', () => {
  // CSS ease-out: cubic-bezier(0, 0, 0.58, 1.0). At t=0.25 the
  // value should be > 0.25 (front-loaded).
  const ease = cubicBezier(0, 0, 0.58, 1);
  const v = ease(0.25);
  assert.ok(v > 0.25, `ease-out should front-load progress; got ${v}`);
  assert.ok(v < 1, `ease-out at t=0.25 should be < 1; got ${v}`);
});

test('bezier: ease-in curve back-loads progress', () => {
  const ease = cubicBezier(0.42, 0, 1, 1);
  const v = ease(0.25);
  assert.ok(v < 0.25, `ease-in should back-load progress; got ${v}`);
  assert.ok(v > 0, `ease-in at t=0.25 should be > 0; got ${v}`);
});

test('bezier: monotonic curves stay monotonic', () => {
  const ease = cubicBezier(0.42, 0, 0.58, 1);
  var prev = -Infinity;
  for (var i = 0; i <= 20; i++) {
    var v = ease(i / 20);
    assert.ok(v >= prev - 1e-6, `expected monotonic ascent; t=${i/20} v=${v} prev=${prev}`);
    prev = v;
  }
});

test('bezier: control points are clamped to [0, 1] for x dimension', () => {
  // Out-of-range x is clamped; should still produce a well-defined
  // monotonic curve.
  const ease = cubicBezier(-0.5, 0, 1.5, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  // Output is finite.
  for (var i = 1; i < 10; i++) {
    var v = ease(i / 10);
    assert.ok(Number.isFinite(v));
  }
});

test('bezier: y can overshoot for spring-like effects', () => {
  // y2 > 1 produces overshoot at the tail.
  const ease = cubicBezier(0.5, 1.5, 0.5, 1.5);
  var sawOver = false;
  for (var i = 0; i <= 20; i++) {
    var v = ease(i / 20);
    if (v > 1.0) sawOver = true;
  }
  assert.equal(sawOver, true);
});

test('bezier: integrates with Tween via custom EasingFn', (_t, done) => {
  const tw = new Tween();
  const ease = cubicBezier(0, 0.6, 0.4, 1);
  const samples: number[] = [];
  tw.to(0, 100, 1.0, function (v) { samples.push(v); }, {
    easing: ease,
    onComplete: function () {
      assert.equal(samples[samples.length - 1], 100);
      done();
    },
  });
  // Drive 5 ticks of 0.2s each.
  for (var i = 0; i < 5; i++) tw.update(0.2);
});

test('bezier: clamps t outside [0, 1] cleanly', () => {
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.equal(ease(-0.5), 0);
  assert.equal(ease(2), 1);
});

// ---------- easeBack ----------

test('easeBack: easeOutBack overshoots past 1 mid-curve', () => {
  var sawOver = false;
  for (var i = 1; i < 20; i++) {
    var v = Easings.easeOutBack(i / 20);
    if (v > 1.0) sawOver = true;
  }
  assert.equal(sawOver, true);
});

test('easeBack: easeInBack dips below 0 mid-curve', () => {
  var sawUnder = false;
  for (var i = 1; i < 20; i++) {
    var v = Easings.easeInBack(i / 20);
    if (v < 0) sawUnder = true;
  }
  assert.equal(sawUnder, true);
});

test('easeBack: endpoints land at 0 and 1 (within FP tolerance)', () => {
  // The Penner back formulas accumulate small FP drift through
  // c1 / c3 multiplications - assert near-equality, not strict.
  assert.ok(Math.abs(Easings.easeInBack(0)) < 1e-12);
  assert.ok(Math.abs(Easings.easeInBack(1) - 1) < 1e-12);
  assert.ok(Math.abs(Easings.easeOutBack(0)) < 1e-12);
  assert.ok(Math.abs(Easings.easeOutBack(1) - 1) < 1e-12);
  assert.ok(Math.abs(Easings.easeInOutBack(0)) < 1e-12);
  assert.ok(Math.abs(Easings.easeInOutBack(1) - 1) < 1e-12);
});

// ---------- easeElastic ----------

test('easeElastic: endpoints clamp exactly to 0 and 1', () => {
  assert.equal(Easings.easeInElastic(0), 0);
  assert.equal(Easings.easeInElastic(1), 1);
  assert.equal(Easings.easeOutElastic(0), 0);
  assert.equal(Easings.easeOutElastic(1), 1);
  assert.equal(Easings.easeInOutElastic(0), 0);
  assert.equal(Easings.easeInOutElastic(1), 1);
});

test('easeElastic: easeOutElastic oscillates around end value', () => {
  // Sample the second half - should cross 1 multiple times.
  var crossings = 0;
  var prev = Easings.easeOutElastic(0.5);
  for (var i = 51; i <= 99; i++) {
    var v = Easings.easeOutElastic(i / 100);
    if ((prev - 1) * (v - 1) < 0) crossings++;
    prev = v;
  }
  assert.ok(crossings >= 1, `expected oscillation; got ${crossings} crossings`);
});

// ---------- easeBounce ----------

test('easeBounce: easeOutBounce hits exactly 1 at t=1', () => {
  assert.ok(Math.abs(Easings.easeOutBounce(1) - 1) < 1e-9);
});

test('easeBounce: easeOutBounce stays in [0, 1] (no overshoot)', () => {
  for (var i = 0; i <= 100; i++) {
    var v = Easings.easeOutBounce(i / 100);
    assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `bounce out of range at t=${i/100}: ${v}`);
  }
});

test('easeBounce: easeOutBounce is non-monotonic (bouncing)', () => {
  // Sample and look for at least one local minimum in the rising
  // portion - that's the bounce.
  var dips = 0;
  var prev = Easings.easeOutBounce(0);
  var prev2 = prev;
  for (var i = 1; i <= 100; i++) {
    var v = Easings.easeOutBounce(i / 100);
    if (prev < prev2 && prev < v) dips++;
    prev2 = prev;
    prev = v;
  }
  assert.ok(dips >= 2, `expected at least 2 bounce dips; got ${dips}`);
});

test('easeBounce: easeInBounce mirrors easeOutBounce', () => {
  // easeInBounce(t) = 1 - easeOutBounce(1 - t).
  for (var i = 0; i <= 10; i++) {
    var t = i / 10;
    var inV = Easings.easeInBounce(t);
    var outV = 1 - Easings.easeOutBounce(1 - t);
    assert.ok(Math.abs(inV - outV) < 1e-9, `mirror failed at t=${t}`);
  }
});

test('easeBounce: easeInOutBounce hits 0.5 at t=0.5 within tolerance', () => {
  // The standard piecewise formula isn't exactly 0.5 at t=0.5 but
  // is close. The midpoint should be within ~0.1.
  const v = Easings.easeInOutBounce(0.5);
  assert.ok(Math.abs(v - 0.5) < 0.05, `midpoint should be ~0.5; got ${v}`);
});

// ---------- name lookups via Tween ----------

test('easings: Tween resolves new easing names by string', () => {
  const tw = new Tween();
  var lastValue = -1;
  var done = false;
  tw.to(0, 100, 1.0, function (v) { lastValue = v; }, {
    easing: 'easeOutBack',
    onComplete: function () { done = true; },
  });
  for (var i = 0; i < 10; i++) tw.update(0.15);
  assert.equal(done, true);
  assert.ok(Math.abs(lastValue - 100) < 1e-6);
});

test('easings: every new easing is callable and produces finite values', () => {
  const names = [
    'easeInBack', 'easeOutBack', 'easeInOutBack',
    'easeInElastic', 'easeOutElastic', 'easeInOutElastic',
    'easeInBounce', 'easeOutBounce', 'easeInOutBounce',
  ] as const;
  for (var i = 0; i < names.length; i++) {
    var n = names[i] as keyof typeof Easings;
    var fn = Easings[n];
    for (var j = 0; j <= 10; j++) {
      var t = j / 10;
      var v = fn(t);
      assert.ok(Number.isFinite(v), `${n}(${t}) is not finite: ${v}`);
    }
  }
});
