// Loom Engine - Phase 1 smoke test.
//
// Node-based, no DOM. Asserts the math, entity allocator, transform
// pool, iso projection, and color helpers behave correctly without
// rendering. The Canvas2DDevice itself is browser-only and tested
// by demo/index.html landing in the preview.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Math
  vec2,
  vec3,
  rect,
  clamp,
  lerp,
  approxEq,
  rectIntersects,
  // Color
  hexToRgba,
  rgbaToHexString,
  rgbaToCssString,
  COLOR_KNOT_STR,
  // Entity
  EntityAllocator,
  entityIndex,
  entityGeneration,
  NULL_ENTITY,
  // Transform
  TransformPool,
  TRANSFORM_FLAG_DIRTY,
  TRANSFORM_FLAG_VISIBLE,
  // Iso
  tileToIso,
  worldToIso,
  isoToTile,
  isoDepthKey,
  ISO_HALF_W,
  ISO_HALF_H,
  // Camera
  createCamera,
  worldToScreen,
  screenToWorld,
  getCameraViewRect,
  // Engine
  LOOM_ENGINE_VERSION,
} from '../src/index.js';

test('engine version constant agrees with package.json', () => {
  // Audit L-01 (0.10.0): the constant drifted from package.json after
  // the productization bump. Pin both together; bump in the same
  // commit when cutting a release.
  assert.equal(LOOM_ENGINE_VERSION, '1.6.5');
});

test('math: clamp + lerp + approxEq', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.ok(approxEq(0.1 + 0.2, 0.3));
  assert.ok(!approxEq(0.1, 0.2));
});

test('math: rect intersects', () => {
  const a = rect(0, 0, 10, 10);
  const b = rect(5, 5, 10, 10);
  const c = rect(20, 20, 5, 5);
  assert.ok(rectIntersects(a, b));
  assert.ok(!rectIntersects(a, c));
});

test('color: hex roundtrip preserves channel values', () => {
  const c = hexToRgba(0xb04a24);
  assert.equal(rgbaToHexString(c), '#b04a24');
});

test('color: knot palette reflects spec', () => {
  // Strknot is 0xb04a24 per LOOM-CLASS-SYSTEM-SPEC Section 4.
  assert.ok(approxEq(COLOR_KNOT_STR.r, 0xb0 / 255));
  assert.ok(approxEq(COLOR_KNOT_STR.g, 0x4a / 255));
  assert.ok(approxEq(COLOR_KNOT_STR.b, 0x24 / 255));
});

test('color: rgba css string format', () => {
  const css = rgbaToCssString(hexToRgba(0xff0000));
  assert.equal(css, 'rgba(255,0,0,1.000)');
});

test('entity: index + generation pack/unpack', () => {
  const a = new EntityAllocator();
  const e1 = a.create();
  const e2 = a.create();
  assert.notEqual(e1, NULL_ENTITY);
  assert.notEqual(e1, e2);
  assert.equal(entityGeneration(e1), 0);
  assert.equal(a.count(), 2);
});

test('entity: generation bumps on destroy/recreate', () => {
  const a = new EntityAllocator();
  const e1 = a.create();
  const idx1 = entityIndex(e1);
  assert.ok(a.destroy(e1));
  assert.ok(!a.isAlive(e1));
  // Stale handle rejected.
  assert.ok(!a.destroy(e1));
  // Recycled index, generation bumped.
  const e2 = a.create();
  assert.equal(entityIndex(e2), idx1);
  assert.equal(entityGeneration(e2), 1);
  assert.ok(a.isAlive(e2));
  assert.ok(!a.isAlive(e1));
});

test('entity: allocator grows past initial capacity', () => {
  const a = new EntityAllocator();
  const created: number[] = [];
  for (let i = 0; i < 200; i++) created.push(a.create());
  assert.equal(a.count(), 200);
  // All handles unique.
  assert.equal(new Set(created).size, 200);
});

test('transform: attach sets defaults + dirty + visible', () => {
  const pool = new TransformPool();
  const a = new EntityAllocator();
  const e = a.create();
  pool.attach(e, 1, 2, 3);
  const i = entityIndex(e);
  assert.equal(pool.x[i], 1);
  assert.equal(pool.y[i], 2);
  assert.equal(pool.z[i], 3);
  assert.equal(pool.scaleX[i], 1);
  assert.equal(pool.scaleY[i], 1);
  assert.ok(pool.isVisible(e));
  assert.equal((pool.flags[i] ?? 0) & TRANSFORM_FLAG_DIRTY, TRANSFORM_FLAG_DIRTY);
});

test('transform: setPosition updates + sets dirty', () => {
  const pool = new TransformPool();
  const a = new EntityAllocator();
  const e = a.create();
  pool.attach(e, 0, 0, 0);
  const i = entityIndex(e);
  pool.clearDirtyAt(i);
  assert.equal((pool.flags[i] ?? 0) & TRANSFORM_FLAG_DIRTY, 0);
  pool.setPosition(e, 5, 6, 7);
  assert.equal(pool.x[i], 5);
  assert.equal(pool.y[i], 6);
  assert.equal(pool.z[i], 7);
  assert.equal((pool.flags[i] ?? 0) & TRANSFORM_FLAG_DIRTY, TRANSFORM_FLAG_DIRTY);
});

test('transform: pool grows past initial capacity', () => {
  const pool = new TransformPool(4);
  const a = new EntityAllocator();
  for (let i = 0; i < 200; i++) {
    const e = a.create();
    pool.attach(e, i, i * 2, i * 3);
  }
  assert.ok(pool.getCapacity() >= 201);
  // Entity allocator reserves index 0 for NULL, so 200 attaches push
  // the high-water mark to 201 (highest live index 200 + 1).
  assert.equal(pool.getHighWaterMark(), 201);
});

test('transform: setVisible flips the visible bit', () => {
  const pool = new TransformPool();
  const a = new EntityAllocator();
  const e = a.create();
  pool.attach(e, 0, 0, 0);
  assert.ok(pool.isVisible(e));
  pool.setVisible(e, false);
  assert.ok(!pool.isVisible(e));
  pool.setVisible(e, true);
  assert.ok(pool.isVisible(e));
});

test('iso: tile (0,0) projects to origin', () => {
  const out = vec2(0, 0);
  tileToIso(0, 0, out);
  assert.equal(out.x, 0);
  assert.equal(out.y, 0);
});

test('iso: tile (1,0) is east, tile (0,1) is south', () => {
  const out = vec2(0, 0);
  tileToIso(1, 0, out);
  assert.equal(out.x, ISO_HALF_W);
  assert.equal(out.y, ISO_HALF_H);
  tileToIso(0, 1, out);
  assert.equal(out.x, -ISO_HALF_W);
  assert.equal(out.y, ISO_HALF_H);
});

test('iso: world->iso->tile roundtrips integer coords', () => {
  const out = vec2(0, 0);
  for (let tx = -3; tx <= 3; tx++) {
    for (let ty = -3; ty <= 3; ty++) {
      tileToIso(tx, ty, out);
      const back = vec2(0, 0);
      isoToTile(out.x, out.y, back);
      assert.ok(approxEq(back.x, tx, 1e-6), `tx ${tx} -> ${back.x}`);
      assert.ok(approxEq(back.y, ty, 1e-6), `ty ${ty} -> ${back.y}`);
    }
  }
});

test('iso: z lifts the y up', () => {
  const ground = vec2(0, 0);
  const sky = vec2(0, 0);
  worldToIso(vec3(0, 0, 0), ground);
  worldToIso(vec3(0, 0, 5), sky);
  assert.ok(sky.y < ground.y, 'sprite with z>0 must project higher on screen');
});

test('iso: depth key sorts back-to-front by diagonal', () => {
  // Same-y, increasing x: closer to camera (front).
  const back = isoDepthKey(vec3(0, 0, 0));
  const mid = isoDepthKey(vec3(1, 0, 0));
  const front = isoDepthKey(vec3(2, 0, 0));
  assert.ok(back < mid);
  assert.ok(mid < front);
  // Ties broken by z.
  const ground = isoDepthKey(vec3(1, 1, 0));
  const air = isoDepthKey(vec3(1, 1, 5));
  assert.ok(ground < air);
});

test('camera: world->screen->world roundtrips', () => {
  const cam = createCamera(640, 400);
  cam.centerX = 100;
  cam.centerY = 50;
  cam.zoom = 2;
  const screen = vec2(0, 0);
  const back = vec2(0, 0);
  worldToScreen(cam, 100, 50, screen);
  // Center of view at the given world point.
  assert.equal(screen.x, 320);
  assert.equal(screen.y, 200);
  screenToWorld(cam, screen.x, screen.y, back);
  assert.ok(approxEq(back.x, 100));
  assert.ok(approxEq(back.y, 50));
});

test('camera: view rect scales with zoom', () => {
  const cam = createCamera(640, 400);
  cam.zoom = 2;
  const r = rect(0, 0, 0, 0);
  getCameraViewRect(cam, r);
  // 640 / 2 = 320 wide world units, 400 / 2 = 200 tall.
  assert.equal(r.width, 320);
  assert.equal(r.height, 200);
});
