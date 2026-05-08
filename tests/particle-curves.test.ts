// Phase 0.43.0 - ParticleCurves tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  emitRateAt,
  particlesToEmit,
  colorAtAge,
  sizeAtAge,
  RESOURCE_PARTICLE_CURVES,
  rgba,
  type EmitRateOptions,
  type SizeOverLifeOptions,
  type ColorStop,
} from '../src/index.js';

test('particle-curves: RESOURCE_PARTICLE_CURVES is the stable string', () => {
  assert.equal(RESOURCE_PARTICLE_CURVES, 'particle_curves');
});

// ---------- emitRateAt ----------

test('emitRate: constant returns peakRate at every t', () => {
  const opts: EmitRateOptions = { shape: 'constant', peakRate: 30 };
  for (var i = 0; i <= 10; i++) {
    var t = i / 10;
    assert.equal(emitRateAt(opts, t), 30);
  }
});

test('emitRate: linearRamp interpolates start->peak with default easing=linear', () => {
  const opts: EmitRateOptions = { shape: 'linearRamp', peakRate: 100, startRate: 0 };
  assert.equal(emitRateAt(opts, 0), 0);
  assert.equal(emitRateAt(opts, 0.5), 50);
  assert.equal(emitRateAt(opts, 1), 100);
});

test('emitRate: pulse returns startRate at endpoints + peak at midpoint', () => {
  const opts: EmitRateOptions = { shape: 'pulse', peakRate: 100, startRate: 0 };
  assert.ok(Math.abs(emitRateAt(opts, 0)) < 1e-9);
  assert.ok(Math.abs(emitRateAt(opts, 1)) < 1e-9);
  // At t=0.5, easeOutQuad(1) = 1 -> rate = peak.
  assert.ok(Math.abs(emitRateAt(opts, 0.5) - 100) < 1e-9);
});

test('emitRate: sustainFade ramps to peak then fades to 0', () => {
  const opts: EmitRateOptions = {
    shape: 'sustainFade',
    peakRate: 50,
    startRate: 0,
    sustainFraction: 0.4,
  };
  assert.equal(emitRateAt(opts, 0), 0);
  assert.ok(Math.abs(emitRateAt(opts, 0.4) - 50) < 1e-9, 'at sustainFraction = peak');
  assert.equal(emitRateAt(opts, 1), 0);
});

test('emitRate: t outside [0, 1] clamps to endpoints', () => {
  const opts: EmitRateOptions = { shape: 'linearRamp', peakRate: 100 };
  assert.equal(emitRateAt(opts, -1), 0);
  assert.equal(emitRateAt(opts, 5), 100);
});

test('emitRate: peakRate < 0 clamps to 0', () => {
  const opts: EmitRateOptions = { shape: 'constant', peakRate: -10 };
  assert.equal(emitRateAt(opts, 0.5), 0);
});

// ---------- particlesToEmit ----------

test('particlesToEmit: integrates rate * dt across a frame', () => {
  const acc = { value: 0 };
  const opts: EmitRateOptions = { shape: 'constant', peakRate: 60 };
  // 1 second at 60/s, sampled across t=0->1 over a 1s lifetime.
  // particlesToEmit returns whole particles per call; remainder
  // accumulates.
  var total = 0;
  for (var i = 0; i < 60; i++) {
    var t0 = i / 60;
    var t1 = (i + 1) / 60;
    total += particlesToEmit(opts, t0, t1, 1, acc);
  }
  // 60 particles per second over 1 second = 60 total (allow +/- 1
  // for rounding).
  assert.ok(Math.abs(total - 60) <= 1, `expected ~60 got ${total}`);
});

test('particlesToEmit: accumulator carries fractional particles', () => {
  const acc = { value: 0 };
  const opts: EmitRateOptions = { shape: 'constant', peakRate: 0.5 };
  // 0.5/s for 1s = 0.5 particles. Should emit 0 first call, 1 next.
  var n1 = particlesToEmit(opts, 0, 1, 1, acc);
  assert.equal(n1, 0);
  assert.equal(acc.value, 0.5);
  var n2 = particlesToEmit(opts, 0, 1, 1, acc);
  assert.equal(n2, 1);
  assert.ok(Math.abs(acc.value) < 1e-9);
});

test('particlesToEmit: zero duration returns 0', () => {
  const acc = { value: 0 };
  const opts: EmitRateOptions = { shape: 'constant', peakRate: 100 };
  assert.equal(particlesToEmit(opts, 0, 1, 0, acc), 0);
});

test('particlesToEmit: zero dt returns 0', () => {
  const acc = { value: 0 };
  const opts: EmitRateOptions = { shape: 'constant', peakRate: 100 };
  assert.equal(particlesToEmit(opts, 0.5, 0.5, 1, acc), 0);
});

// ---------- colorAtAge ----------

test('colorAtAge: empty stops returns white', () => {
  const c = colorAtAge([], 0.5);
  assert.equal(c.r, 1);
  assert.equal(c.g, 1);
  assert.equal(c.b, 1);
  assert.equal(c.a, 1);
});

test('colorAtAge: single stop returns that color regardless of age', () => {
  const stops: ColorStop[] = [{ t: 0.5, color: rgba(0.2, 0.4, 0.6, 0.8) }];
  const c = colorAtAge(stops, 0.1);
  assert.equal(c.r, 0.2);
  assert.equal(c.g, 0.4);
  assert.equal(c.b, 0.6);
  assert.equal(c.a, 0.8);
});

test('colorAtAge: blends two stops at midpoint', () => {
  const stops: ColorStop[] = [
    { t: 0, color: rgba(0, 0, 0, 1) },
    { t: 1, color: rgba(1, 1, 1, 0) },
  ];
  const c = colorAtAge(stops, 0.5);
  assert.ok(Math.abs(c.r - 0.5) < 1e-6);
  assert.ok(Math.abs(c.g - 0.5) < 1e-6);
  assert.ok(Math.abs(c.b - 0.5) < 1e-6);
  assert.ok(Math.abs(c.a - 0.5) < 1e-6);
});

test('colorAtAge: 3-stop curve picks correct segment', () => {
  const stops: ColorStop[] = [
    { t: 0, color: rgba(1, 0, 0, 1) },     // red at start
    { t: 0.5, color: rgba(0, 1, 0, 1) },    // green at mid
    { t: 1, color: rgba(0, 0, 1, 1) },      // blue at end
  ];
  // At t=0.25 (between red and green, halfway): r=0.5, g=0.5.
  const c = colorAtAge(stops, 0.25);
  assert.ok(Math.abs(c.r - 0.5) < 1e-6);
  assert.ok(Math.abs(c.g - 0.5) < 1e-6);
  assert.ok(Math.abs(c.b) < 1e-6);
});

test('colorAtAge: age below first stop clamps to first color', () => {
  const stops: ColorStop[] = [
    { t: 0.2, color: rgba(0.5, 0, 0, 1) },
    { t: 1, color: rgba(0, 0, 0.5, 1) },
  ];
  const c = colorAtAge(stops, 0.1);
  assert.equal(c.r, 0.5);
  assert.equal(c.b, 0);
});

test('colorAtAge: age above last stop clamps to last color', () => {
  const stops: ColorStop[] = [
    { t: 0, color: rgba(1, 0, 0, 1) },
    { t: 0.7, color: rgba(0, 1, 0, 1) },
  ];
  const c = colorAtAge(stops, 0.9);
  assert.equal(c.r, 0);
  assert.equal(c.g, 1);
});

test('colorAtAge: returns a fresh object (no shared mutation)', () => {
  const stops: ColorStop[] = [
    { t: 0, color: rgba(1, 0, 0, 1) },
    { t: 1, color: rgba(0, 0, 1, 1) },
  ];
  const c1 = colorAtAge(stops, 0.5);
  const c2 = colorAtAge(stops, 0.5);
  assert.notEqual(c1, c2);
  c1.r = 999;
  assert.notEqual(c2.r, 999);
});

// ---------- sizeAtAge ----------

test('sizeAtAge: constant returns startScale at every t', () => {
  const opts: SizeOverLifeOptions = { shape: 'constant', startScale: 1.5 };
  assert.equal(sizeAtAge(opts, 0), 1.5);
  assert.equal(sizeAtAge(opts, 1), 1.5);
});

test('sizeAtAge: easeOut interpolates start->end', () => {
  const opts: SizeOverLifeOptions = { shape: 'easeOut', startScale: 0.5, endScale: 2 };
  assert.ok(Math.abs(sizeAtAge(opts, 0) - 0.5) < 1e-9);
  assert.ok(Math.abs(sizeAtAge(opts, 1) - 2) < 1e-9);
});

test('sizeAtAge: easeIn endpoints land correctly', () => {
  const opts: SizeOverLifeOptions = { shape: 'easeIn', startScale: 0, endScale: 1 };
  assert.ok(Math.abs(sizeAtAge(opts, 0)) < 1e-9);
  assert.ok(Math.abs(sizeAtAge(opts, 1) - 1) < 1e-9);
});

test('sizeAtAge: step thresholds correctly', () => {
  const opts: SizeOverLifeOptions = {
    shape: 'step', startScale: 0.1, endScale: 1, stepAt: 0.5,
  };
  assert.equal(sizeAtAge(opts, 0.49), 0.1);
  assert.equal(sizeAtAge(opts, 0.5), 1);
  assert.equal(sizeAtAge(opts, 0.99), 1);
});

test('sizeAtAge: growThenShrink peaks at peakAt', () => {
  const opts: SizeOverLifeOptions = {
    shape: 'growThenShrink', startScale: 0, endScale: 2, peakAt: 0.4,
  };
  assert.ok(Math.abs(sizeAtAge(opts, 0)) < 1e-9);
  assert.ok(Math.abs(sizeAtAge(opts, 0.4) - 2) < 1e-9, 'peak at peakAt');
  assert.ok(Math.abs(sizeAtAge(opts, 1)) < 1e-9);
});

test('sizeAtAge: growThenShrink defaults to peak at 0.5', () => {
  const opts: SizeOverLifeOptions = {
    shape: 'growThenShrink', startScale: 0, endScale: 1,
  };
  assert.ok(Math.abs(sizeAtAge(opts, 0.5) - 1) < 1e-9);
});

test('sizeAtAge: t outside [0, 1] clamps to endpoints', () => {
  const opts: SizeOverLifeOptions = { shape: 'easeOut', startScale: 0, endScale: 1 };
  assert.equal(sizeAtAge(opts, -1), 0);
  assert.equal(sizeAtAge(opts, 2), 1);
});

test('sizeAtAge: defaults startScale=1, endScale=1', () => {
  const opts: SizeOverLifeOptions = { shape: 'easeOut' };
  assert.equal(sizeAtAge(opts, 0.5), 1);
});

test('sizeAtAge: custom easing function', () => {
  const opts: SizeOverLifeOptions = {
    shape: 'easeOut',
    startScale: 0,
    endScale: 1,
    easing: (t: number) => t * t * t * t,  // sharp ease-in (inverted)
  };
  // At t=0.5: 0.5^4 = 0.0625
  assert.ok(Math.abs(sizeAtAge(opts, 0.5) - 0.0625) < 1e-9);
});
