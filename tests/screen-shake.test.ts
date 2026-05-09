// Phase 0.92.0 - ScreenShake tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ScreenShake,
  RESOURCE_SCREEN_SHAKE,
} from '../src/index.js';

test('screen-shake: RESOURCE_SCREEN_SHAKE is the stable string', () => {
  assert.equal(RESOURCE_SCREEN_SHAKE, 'screen_shake');
});

test('screen-shake: defaults to trauma 0', () => {
  const s = ScreenShake.create();
  assert.equal(s.getTrauma(), 0);
  assert.equal(s.isShaking(), false);
  const off = s.getOffset();
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
  assert.equal(off.angle, 0);
});

test('screen-shake: addTrauma clamps to [0, 1]', () => {
  const s = ScreenShake.create();
  s.addTrauma(0.4);
  assert.ok(Math.abs(s.getTrauma() - 0.4) < 1e-6);
  s.addTrauma(0.4);
  assert.ok(Math.abs(s.getTrauma() - 0.8) < 1e-6);
  s.addTrauma(99);
  assert.equal(s.getTrauma(), 1); // clamped at 1
});

test('screen-shake: addTrauma negative reduces; clamped at 0', () => {
  const s = ScreenShake.create();
  s.addTrauma(0.5);
  s.addTrauma(-0.3);
  assert.ok(Math.abs(s.getTrauma() - 0.2) < 1e-6);
  s.addTrauma(-99);
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: setTrauma direct + clamping', () => {
  const s = ScreenShake.create();
  s.setTrauma(0.7);
  assert.ok(Math.abs(s.getTrauma() - 0.7) < 1e-6);
  s.setTrauma(99);
  assert.equal(s.getTrauma(), 1);
  s.setTrauma(-99);
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: tick decays trauma linearly per second', () => {
  const s = ScreenShake.create({ decayPerSecond: 1.0 });
  s.setTrauma(1.0);
  s.tick(500); // 1.0 * 0.5 = 0.5 decay -> trauma 0.5
  assert.ok(Math.abs(s.getTrauma() - 0.5) < 1e-6);
  s.tick(500);
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: tick floors trauma at 0', () => {
  const s = ScreenShake.create({ decayPerSecond: 10.0 });
  s.setTrauma(0.2);
  s.tick(1000); // 10 * 1 = 10 decay; floors at 0
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: trauma 0 -> getOffset zeros', () => {
  const s = ScreenShake.create();
  const off = s.getOffset();
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
  assert.equal(off.angle, 0);
});

test('screen-shake: trauma 1 + max=10 -> offset within +/-10', () => {
  const s = ScreenShake.create({
    maxOffsetPx: 10,
    rng: () => 0.5, // 0.5*2-1 = 0; offset = 0
  });
  s.setTrauma(1.0);
  const off = s.getOffset();
  // rng returns 0.5 -> jitter factor = 0
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
});

test('screen-shake: rng=1 -> max positive offset', () => {
  const s = ScreenShake.create({
    maxOffsetPx: 10,
    rng: () => 0.999999, // ~+1
  });
  s.setTrauma(1.0);
  const off = s.getOffset();
  // (0.999999 * 2 - 1) ~ 0.999998 * 10 * 1^2 ~ 9.99998
  assert.ok(off.x > 9.99);
  assert.ok(off.y > 9.99);
});

test('screen-shake: rng=0 -> max negative offset', () => {
  const s = ScreenShake.create({
    maxOffsetPx: 10,
    rng: () => 0,
  });
  s.setTrauma(1.0);
  const off = s.getOffset();
  // (0 * 2 - 1) * 10 * 1 = -10
  assert.equal(off.x, -10);
});

test('screen-shake: quadratic dampening at trauma 0.5', () => {
  // trauma^2 = 0.25; max=10; rng=1 -> offset = 0.999998 * 10 * 0.25 ~= 2.5
  const s = ScreenShake.create({
    maxOffsetPx: 10,
    rng: () => 0.999999,
  });
  s.setTrauma(0.5);
  const off = s.getOffset();
  assert.ok(Math.abs(off.x - 2.5) < 0.01);
});

test('screen-shake: angle scales with trauma^2 too', () => {
  const s = ScreenShake.create({
    maxAngleRad: 0.1,
    rng: () => 0.999999,
  });
  s.setTrauma(0.5);
  const off = s.getOffset();
  // 0.999998 * 0.1 * 0.25 ~= 0.025
  assert.ok(Math.abs(off.angle - 0.025) < 0.001);
});

test('screen-shake: setMaxOffset / setDecayPerSecond runtime tuning', () => {
  const s = ScreenShake.create({
    maxOffsetPx: 10,
    rng: () => 0.999999,
  });
  s.setTrauma(1.0);
  let off = s.getOffset();
  assert.ok(off.x > 9.99);
  s.setMaxOffset(20);
  off = s.getOffset();
  assert.ok(off.x > 19.99);
});

test('screen-shake: setDecayPerSecond updates decay rate', () => {
  const s = ScreenShake.create({ decayPerSecond: 0.5 });
  s.setTrauma(1.0);
  s.tick(1000); // 0.5 * 1 = 0.5; trauma 0.5
  assert.ok(Math.abs(s.getTrauma() - 0.5) < 1e-6);
  s.setDecayPerSecond(2.0);
  s.tick(250); // 2.0 * 0.25 = 0.5; trauma 0
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: setMaxAngleRad runtime tuning', () => {
  const s = ScreenShake.create({
    maxAngleRad: 0.1,
    rng: () => 0.999999,
  });
  s.setTrauma(1.0);
  s.setMaxAngleRad(0.5);
  const off = s.getOffset();
  assert.ok(off.angle > 0.49);
});

test('screen-shake: invalid inputs rejected (NaN / negative)', () => {
  const s = ScreenShake.create();
  s.setTrauma(NaN);
  assert.equal(s.getTrauma(), 0);
  s.setMaxOffset(-1);
  s.setMaxOffset(NaN);
  // No crash; previous max preserved.
  s.addTrauma(NaN);
  s.tick(NaN);
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: isShaking reflects trauma > 0', () => {
  const s = ScreenShake.create();
  assert.equal(s.isShaking(), false);
  s.addTrauma(0.1);
  assert.ok(s.isShaking());
  s.setTrauma(0);
  assert.equal(s.isShaking(), false);
});

test('screen-shake: reset zeros trauma', () => {
  const s = ScreenShake.create();
  s.setTrauma(0.8);
  s.reset();
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: dispose locks ops', () => {
  const s = ScreenShake.create();
  s.setTrauma(0.5);
  s.dispose();
  s.addTrauma(0.5);
  s.tick(100);
  s.setTrauma(0.5);
  // After dispose, trauma is locked at 0.
  assert.equal(s.getTrauma(), 0);
});

test('screen-shake: realistic damage reaction', () => {
  let rolls = [0.9, 0.1, 0.5];
  let i = 0;
  const s = ScreenShake.create({
    decayPerSecond: 1.0,
    maxOffsetPx: 20,
    rng: () => rolls[i++ % rolls.length] ?? 0.5,
  });
  // Damage hit -> add 0.5 trauma.
  s.addTrauma(0.5);
  // Frame 1: shake offset visible.
  let off = s.getOffset();
  assert.ok(Math.abs(off.x) > 0);
  // After 600ms, trauma decayed to 0.5 - 0.6 = clamp 0.
  // Actually 0.5 - (1.0 * 0.6) = -0.1 -> 0.
  s.tick(600);
  assert.equal(s.getTrauma(), 0);
  off = s.getOffset();
  assert.equal(off.x, 0);
});

test('screen-shake: deterministic with seeded rng', () => {
  function seeded(seed: number) {
    let s = seed;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }
  const s1 = ScreenShake.create({ rng: seeded(42) });
  const s2 = ScreenShake.create({ rng: seeded(42) });
  s1.setTrauma(0.5);
  s2.setTrauma(0.5);
  const o1 = s1.getOffset();
  const o2 = s2.getOffset();
  assert.equal(o1.x, o2.x);
  assert.equal(o1.y, o2.y);
  assert.equal(o1.angle, o2.angle);
});
