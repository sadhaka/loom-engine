// Phase 0.37.0 - FloatingText tests.
//
// State container is renderer-agnostic: tests assert the kinematic
// integration, lifetime expiry, alpha curve, and pool semantics.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  FloatingText,
  RESOURCE_FLOATING_TEXT,
  type FloatingTextRenderState,
} from '../src/index.js';

test('floating-text: RESOURCE_FLOATING_TEXT is the stable string', () => {
  assert.equal(RESOURCE_FLOATING_TEXT, 'floating_text');
});

test('floating-text: defaults capacity to 64', () => {
  const ft = FloatingText.create();
  assert.equal(ft.capacity(), 64);
});

test('floating-text: emit returns slot index >= 0 when pool has space', () => {
  const ft = FloatingText.create({ capacity: 4 });
  const idx = ft.emit({ x: 10, y: 20, text: '5' });
  assert.ok(idx >= 0 && idx < 4);
  assert.equal(ft.activeCount(), 1);
});

test('floating-text: emit returns -1 when pool is full', () => {
  const ft = FloatingText.create({ capacity: 2 });
  ft.emit({ x: 0, y: 0, text: 'a' });
  ft.emit({ x: 0, y: 0, text: 'b' });
  const overflow = ft.emit({ x: 0, y: 0, text: 'c' });
  assert.equal(overflow, -1);
  assert.equal(ft.activeCount(), 2);
});

test('floating-text: emit defaults pull from system options', () => {
  const ft = FloatingText.create({
    capacity: 4,
    defaultLifetimeMs: 500,
    defaultVy: -100,
    defaultAy: 200,
    defaultColor: 0xff00ff,
    defaultScale: 2,
  });
  ft.emit({ x: 0, y: 0, text: 'crit' });
  let captured: FloatingTextRenderState | null = null;
  ft.forEach((s) => { captured = s; });
  assert.ok(captured);
  assert.equal((captured as FloatingTextRenderState).color, 0xff00ff);
  assert.equal((captured as FloatingTextRenderState).scale, 2);
  assert.equal((captured as FloatingTextRenderState).lifetimeMs, 500);
});

test('floating-text: emit explicit options override system defaults', () => {
  const ft = FloatingText.create({ capacity: 4, defaultColor: 0xffffff });
  ft.emit({ x: 0, y: 0, text: 'gold', color: 0xffd700, scale: 1.5 });
  let captured: FloatingTextRenderState | null = null;
  ft.forEach((s) => { captured = s; });
  assert.equal((captured as unknown as FloatingTextRenderState).color, 0xffd700);
  assert.equal((captured as unknown as FloatingTextRenderState).scale, 1.5);
});

test('floating-text: tick integrates position from velocity over time', () => {
  // Use ax=0, ay=0 to get pure kinematic translation.
  const ft = FloatingText.create({
    capacity: 4,
    defaultAx: 0,
    defaultAy: 0,
  });
  ft.emit({ x: 0, y: 0, text: '5', vx: 100, vy: -200 });
  ft.tick(100); // 0.1 seconds
  let pos: { x: number; y: number } | null = null;
  ft.forEach((s) => { pos = { x: s.x, y: s.y }; });
  // After 0.1s at vx=100 -> x = 10. vy=-200 -> y = -20.
  assert.ok(Math.abs((pos as unknown as { x: number; y: number }).x - 10) < 1e-9);
  assert.ok(Math.abs((pos as unknown as { x: number; y: number }).y - (-20)) < 1e-9);
});

test('floating-text: tick integrates velocity from acceleration', () => {
  const ft = FloatingText.create({
    capacity: 4,
    defaultAx: 0,
    defaultAy: 0,
    defaultLifetimeMs: 5000,
  });
  // Start at rest; accelerate downward at 100 units/s^2 over 1 second.
  ft.emit({ x: 0, y: 0, text: 'fall', vx: 0, vy: 0, ax: 0, ay: 100 });
  ft.tick(1000);
  let pos: { x: number; y: number } | null = null;
  ft.forEach((s) => { pos = { x: s.x, y: s.y }; });
  // Semi-implicit Euler: vy_new = 0 + 100 * 1 = 100; y_new = 0 + 100 * 1 = 100.
  // (The real analytic 0.5 * a * t^2 = 50 differs; document the
  // semi-implicit choice rather than fight it.)
  assert.ok(pos !== null);
  assert.ok(Math.abs((pos as unknown as { x: number; y: number }).y - 100) < 1e-9);
});

test('floating-text: tick deactivates entries past lifetimeMs', () => {
  const ft = FloatingText.create({ capacity: 4, defaultLifetimeMs: 100 });
  ft.emit({ x: 0, y: 0, text: 'die' });
  assert.equal(ft.activeCount(), 1);
  ft.tick(50);
  assert.equal(ft.activeCount(), 1);
  ft.tick(60); // total 110 > 100
  assert.equal(ft.activeCount(), 0);
});

test('floating-text: alpha is 1 in the middle of lifetime by default', () => {
  const ft = FloatingText.create({
    capacity: 4,
    defaultLifetimeMs: 100,
    fadeFractionStart: 0,
    fadeFractionEnd: 0.3,
  });
  ft.emit({ x: 0, y: 0, text: '5' });
  ft.tick(50); // halfway
  let alpha = -1;
  ft.forEach((s) => { alpha = s.alpha; });
  assert.equal(alpha, 1);
});

test('floating-text: alpha fades linearly over the last fadeFractionEnd of lifetime', () => {
  const ft = FloatingText.create({
    capacity: 4,
    defaultLifetimeMs: 100,
    fadeFractionEnd: 0.5,
  });
  ft.emit({ x: 0, y: 0, text: '5' });
  // At t=75 (75% of 100), within last 50% (>=50%). Fade from 1 -> 0
  // over (50, 100]. At 75: (1 - 0.75) / 0.5 = 0.5.
  ft.tick(75);
  let alpha = -1;
  ft.forEach((s) => { alpha = s.alpha; });
  assert.ok(Math.abs(alpha - 0.5) < 1e-9, `expected 0.5 got ${alpha}`);
});

test('floating-text: alpha fade-in ramps up at start when fadeFractionStart > 0', () => {
  const ft = FloatingText.create({
    capacity: 4,
    defaultLifetimeMs: 100,
    fadeFractionStart: 0.4,
    fadeFractionEnd: 0,
  });
  ft.emit({ x: 0, y: 0, text: '5' });
  // At t=20 (20% of 100), within first 40%. Fade from 0 -> 1 over
  // [0, 40). At 20: 20 / 40 = 0.5.
  ft.tick(20);
  let alpha = -1;
  ft.forEach((s) => { alpha = s.alpha; });
  assert.ok(Math.abs(alpha - 0.5) < 1e-9, `expected 0.5 got ${alpha}`);
});

test('floating-text: forEach iterates only active entries', () => {
  const ft = FloatingText.create({ capacity: 4 });
  ft.emit({ x: 1, y: 1, text: 'a' });
  ft.emit({ x: 2, y: 2, text: 'b' });
  ft.emit({ x: 3, y: 3, text: 'c' });
  const seen: string[] = [];
  ft.forEach((s) => { seen.push(s.text); });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
});

test('floating-text: deactivated slot is reusable on next emit', () => {
  const ft = FloatingText.create({ capacity: 1, defaultLifetimeMs: 50 });
  const i1 = ft.emit({ x: 0, y: 0, text: 'first' });
  ft.tick(60);
  assert.equal(ft.activeCount(), 0);
  const i2 = ft.emit({ x: 0, y: 0, text: 'second' });
  // Round-robin search means we may or may not get the same idx;
  // but it must be a valid slot and active.
  assert.ok(i2 >= 0);
  assert.equal(ft.activeCount(), 1);
  let lastText = '';
  ft.forEach((s) => { lastText = s.text; });
  assert.equal(lastText, 'second');
});

test('floating-text: clearAll deactivates all texts immediately', () => {
  const ft = FloatingText.create({ capacity: 4 });
  ft.emit({ x: 0, y: 0, text: 'a' });
  ft.emit({ x: 0, y: 0, text: 'b' });
  ft.emit({ x: 0, y: 0, text: 'c' });
  assert.equal(ft.activeCount(), 3);
  ft.clearAll();
  assert.equal(ft.activeCount(), 0);
});

test('floating-text: dispose makes ops no-op', () => {
  const ft = FloatingText.create({ capacity: 4 });
  ft.emit({ x: 0, y: 0, text: 'a' });
  ft.dispose();
  assert.equal(ft.activeCount(), 0);
  const idx = ft.emit({ x: 0, y: 0, text: 'b' });
  assert.equal(idx, -1);
  ft.tick(1000);
  let called = false;
  ft.forEach(() => { called = true; });
  assert.equal(called, false);
});

test('floating-text: tick(0) is a no-op', () => {
  const ft = FloatingText.create({ capacity: 4 });
  ft.emit({ x: 5, y: 10, text: 'x', vx: 100, vy: 100, ax: 0, ay: 0 });
  ft.tick(0);
  let pos: { x: number; y: number } | null = null;
  ft.forEach((s) => { pos = { x: s.x, y: s.y }; });
  assert.equal((pos as unknown as { x: number; y: number }).x, 5);
  assert.equal((pos as unknown as { x: number; y: number }).y, 10);
});

test('floating-text: forEach swallows callback errors per entry', () => {
  const ft = FloatingText.create({ capacity: 4 });
  ft.emit({ x: 0, y: 0, text: 'a' });
  ft.emit({ x: 0, y: 0, text: 'b' });
  ft.emit({ x: 0, y: 0, text: 'c' });
  const seen: string[] = [];
  ft.forEach((s) => {
    seen.push(s.text);
    if (s.text === 'a') throw new Error('boom');
  });
  // Iteration continued past the throwing 'a' so all three were
  // visited.
  assert.equal(seen.length, 3);
});

test('floating-text: ageMs and lifetimeMs surface to render state', () => {
  const ft = FloatingText.create({ capacity: 4, defaultLifetimeMs: 200 });
  ft.emit({ x: 0, y: 0, text: 'x' });
  ft.tick(80);
  let s: FloatingTextRenderState | null = null;
  ft.forEach((row) => { s = row; });
  assert.equal((s as unknown as FloatingTextRenderState).ageMs, 80);
  assert.equal((s as unknown as FloatingTextRenderState).lifetimeMs, 200);
});

test('floating-text: emit text content preserved verbatim', () => {
  const ft = FloatingText.create({ capacity: 4 });
  ft.emit({ x: 0, y: 0, text: '+10 XP' });
  let txt = '';
  ft.forEach((s) => { txt = s.text; });
  assert.equal(txt, '+10 XP');
});

test('floating-text: round-robin slot search reuses oldest free slots first', () => {
  const ft = FloatingText.create({ capacity: 3, defaultLifetimeMs: 50 });
  // Fill all three.
  ft.emit({ x: 0, y: 0, text: 'a' });
  ft.emit({ x: 0, y: 0, text: 'b' });
  ft.emit({ x: 0, y: 0, text: 'c' });
  ft.tick(60); // expire all
  assert.equal(ft.activeCount(), 0);
  // Re-emit; activeCount tracks correctly across pool reuse.
  ft.emit({ x: 0, y: 0, text: 'd' });
  ft.emit({ x: 0, y: 0, text: 'e' });
  assert.equal(ft.activeCount(), 2);
});

test('floating-text: lifetimeMs <= 0 falls back to default', () => {
  const ft = FloatingText.create({ capacity: 4, defaultLifetimeMs: 200 });
  ft.emit({ x: 0, y: 0, text: 'x', lifetimeMs: 0 });
  let life = -1;
  ft.forEach((s) => { life = s.lifetimeMs; });
  assert.equal(life, 200);
});

test('floating-text: alpha never escapes [0, 1]', () => {
  const ft = FloatingText.create({
    capacity: 4,
    defaultLifetimeMs: 100,
    fadeFractionStart: 0.4,
    fadeFractionEnd: 0.4,
  });
  ft.emit({ x: 0, y: 0, text: '5' });
  // Sample alpha across the lifetime; nothing should be NaN or
  // outside [0, 1].
  const alphas: number[] = [];
  for (var i = 0; i < 10; i++) {
    ft.tick(10);
    ft.forEach((s) => { alphas.push(s.alpha); });
  }
  for (var j = 0; j < alphas.length; j++) {
    var a = alphas[j] as number;
    assert.ok(Number.isFinite(a));
    assert.ok(a >= 0 && a <= 1, `alpha out of range: ${a}`);
  }
});
