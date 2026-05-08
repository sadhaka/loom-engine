// Phase 0.49.0 - Spline tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  linearPath,
  catmullRomPath,
  hermitePath,
  RESOURCE_SPLINE,
  type Vec2Like,
  type HermiteKey,
} from '../src/index.js';

function approx(a: number, b: number, eps: number = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

test('spline: RESOURCE_SPLINE is the stable string', () => {
  assert.equal(RESOURCE_SPLINE, 'spline');
});

// ---------- linearPath ----------

test('linearPath: empty points returns origin', () => {
  const v = linearPath([], 0.5);
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('linearPath: single point returns that point at any t', () => {
  const pts: Vec2Like[] = [{ x: 5, y: 7 }];
  const v = linearPath(pts, 0.5);
  assert.equal(v.x, 5);
  assert.equal(v.y, 7);
});

test('linearPath: t=0 returns first; t=1 returns last', () => {
  const pts: Vec2Like[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
  const start = linearPath(pts, 0);
  const end = linearPath(pts, 1);
  assert.equal(start.x, 0);
  assert.equal(start.y, 0);
  assert.equal(end.x, 10);
  assert.equal(end.y, 20);
});

test('linearPath: midpoint of 2-point path is the midpoint', () => {
  const pts: Vec2Like[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
  const v = linearPath(pts, 0.5);
  assert.equal(v.x, 5);
  assert.equal(v.y, 10);
});

test('linearPath: 3-point path - quarter t lands on first segment', () => {
  const pts: Vec2Like[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  // t=0.25 maps to scaled=0.5, segment 0, local=0.5 -> midpoint of (0,0)-(10,0).
  const v = linearPath(pts, 0.25);
  assert.equal(v.x, 5);
  assert.equal(v.y, 0);
});

test('linearPath: t=0.5 in 3-point path lands at the second control point', () => {
  const pts: Vec2Like[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  // t=0.5 -> scaled=1, segment 1, local=0 -> point[1] = (10, 0).
  const v = linearPath(pts, 0.5);
  assert.equal(v.x, 10);
  assert.equal(v.y, 0);
});

test('linearPath: t outside [0, 1] clamps to endpoints', () => {
  const pts: Vec2Like[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
  const before = linearPath(pts, -1);
  const after = linearPath(pts, 5);
  assert.equal(before.x, 0);
  assert.equal(after.x, 10);
});

test('linearPath: returns a fresh object (no shared mutation)', () => {
  const pts: Vec2Like[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
  const a = linearPath(pts, 0.5);
  const b = linearPath(pts, 0.5);
  assert.notEqual(a, b);
});

// ---------- catmullRomPath ----------

test('catmullRom: empty / single / 2-point all match linearPath fallback', () => {
  const empty = catmullRomPath([], 0.5);
  assert.equal(empty.x, 0);
  assert.equal(empty.y, 0);
  const single = catmullRomPath([{ x: 5, y: 5 }], 0.7);
  assert.equal(single.x, 5);
  assert.equal(single.y, 5);
  const twoPoint = catmullRomPath([{ x: 0, y: 0 }, { x: 10, y: 10 }], 0.5);
  assert.equal(twoPoint.x, 5);
  assert.equal(twoPoint.y, 5);
});

test('catmullRom: t=0 returns first point exactly', () => {
  const pts: Vec2Like[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const v = catmullRomPath(pts, 0);
  assert.ok(approx(v.x, 0));
  assert.ok(approx(v.y, 0));
});

test('catmullRom: t=1 returns last point exactly', () => {
  const pts: Vec2Like[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const v = catmullRomPath(pts, 1);
  assert.equal(v.x, 0);
  assert.equal(v.y, 10);
});

test('catmullRom: passes through every interior control point at boundary t', () => {
  const pts: Vec2Like[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // 4 points, 3 segments. Boundary ts: 0, 1/3, 2/3, 1.
  const at1 = catmullRomPath(pts, 1 / 3);
  assert.ok(approx(at1.x, 10), `at 1/3 expected x=10, got ${at1.x}`);
  assert.ok(approx(at1.y, 0));
  const at2 = catmullRomPath(pts, 2 / 3);
  assert.ok(approx(at2.x, 10));
  assert.ok(approx(at2.y, 10));
});

test('catmullRom: produces points different from linear (curve shape)', () => {
  const pts: Vec2Like[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // Sample at non-control t and verify Catmull-Rom does NOT match
  // linear (it produces a curve through the points).
  const t = 0.5;
  const linear = linearPath(pts, t);
  const cr = catmullRomPath(pts, t);
  // They will rarely coincide except at control points.
  const same = approx(cr.x, linear.x) && approx(cr.y, linear.y);
  assert.equal(same, false);
});

test('catmullRom: closed loop wraps neighbors', () => {
  const pts: Vec2Like[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // Closed: t=0 and t=1 both wrap to first point.
  const start = catmullRomPath(pts, 0, { closed: true });
  const wrap = catmullRomPath(pts, 1, { closed: true });
  assert.ok(approx(start.x, 0));
  assert.ok(approx(start.y, 0));
  assert.ok(approx(wrap.x, 0));
  assert.ok(approx(wrap.y, 0));
});

test('catmullRom: t outside [0, 1] clamps gracefully', () => {
  const pts: Vec2Like[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const v = catmullRomPath(pts, 5);
  assert.equal(v.x, 10);
  assert.equal(v.y, 10);
});

// ---------- hermitePath ----------

test('hermite: empty returns origin', () => {
  const v = hermitePath([], 0.5);
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('hermite: single key returns its position', () => {
  const keys: HermiteKey[] = [{ p: { x: 7, y: 9 }, m: { x: 1, y: 1 } }];
  const v = hermitePath(keys, 0.5);
  assert.equal(v.x, 7);
  assert.equal(v.y, 9);
});

test('hermite: t=0 returns first key position; t=1 returns last', () => {
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 5, y: 0 } },
    { p: { x: 10, y: 5 }, m: { x: 0, y: 5 } },
  ];
  const start = hermitePath(keys, 0);
  const end = hermitePath(keys, 1);
  assert.ok(approx(start.x, 0));
  assert.ok(approx(start.y, 0));
  assert.ok(approx(end.x, 10));
  assert.ok(approx(end.y, 5));
});

test('hermite: zero tangents reduce to linear interpolation between keys', () => {
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 0, y: 0 } },
    { p: { x: 10, y: 20 }, m: { x: 0, y: 0 } },
  ];
  // With zero tangents the Hermite basis becomes h00*p0 + h01*p1 +
  // 0 + 0. h00 + h01 = 1 always (Hermite identity at zero
  // tangents). So at t=0.5: h00=0.5, h01=0.5 -> midpoint.
  const mid = hermitePath(keys, 0.5);
  assert.ok(approx(mid.x, 5));
  assert.ok(approx(mid.y, 10));
});

test('hermite: outgoing tangent shapes the curve', () => {
  // Tangent pointing strongly to the right at start; pulls the
  // curve right of the linear interpolation midpoint.
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 30, y: 0 } },
    { p: { x: 10, y: 0 }, m: { x: 0, y: 0 } },
  ];
  const mid = hermitePath(keys, 0.5);
  // Linear midpoint would be x=5; with the strong outgoing tangent
  // the curve should be > 5 at midpoint.
  assert.ok(mid.x > 5, `expected x > 5; got ${mid.x}`);
});

test('hermite: t outside [0, 1] clamps to endpoints', () => {
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 0, y: 0 } },
    { p: { x: 10, y: 10 }, m: { x: 0, y: 0 } },
  ];
  const before = hermitePath(keys, -1);
  const after = hermitePath(keys, 5);
  assert.equal(before.x, 0);
  assert.equal(after.x, 10);
});

test('hermite: 3-key path picks the correct segment', () => {
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 0, y: 0 } },
    { p: { x: 10, y: 0 }, m: { x: 0, y: 0 } },
    { p: { x: 10, y: 10 }, m: { x: 0, y: 0 } },
  ];
  // 2 segments, 0.5 -> segment 1 at local=0 -> key[1] = (10, 0).
  const at = hermitePath(keys, 0.5);
  assert.ok(approx(at.x, 10));
  assert.ok(approx(at.y, 0));
});

test('hermite: smooth motion - sequential samples are continuous', () => {
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 5, y: 0 } },
    { p: { x: 10, y: 5 }, m: { x: 5, y: 5 } },
    { p: { x: 20, y: 0 }, m: { x: 5, y: -5 } },
  ];
  // Sample 21 points; each step should be reasonably close to the
  // previous (no jumps).
  var prev = hermitePath(keys, 0);
  for (var i = 1; i <= 20; i++) {
    var t = i / 20;
    var v = hermitePath(keys, t);
    var dx = v.x - prev.x;
    var dy = v.y - prev.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    // Total path is roughly 20 long; per-step shouldn't exceed
    // half that.
    assert.ok(dist < 10, `discontinuous step at t=${t}: dist=${dist}`);
    prev = v;
  }
});

test('hermite: keys returns fresh object (no shared mutation)', () => {
  const keys: HermiteKey[] = [
    { p: { x: 0, y: 0 }, m: { x: 0, y: 0 } },
    { p: { x: 10, y: 10 }, m: { x: 0, y: 0 } },
  ];
  const a = hermitePath(keys, 0.5);
  const b = hermitePath(keys, 0.5);
  assert.notEqual(a, b);
});
