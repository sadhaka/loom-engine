// Phase 0.54.0 - AABB tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  aabb,
  aabbFromRect,
  aabbFromPoints,
  aabbContainsPoint,
  aabbContainsAabb,
  aabbOverlaps,
  aabbWidth,
  aabbHeight,
  aabbArea,
  aabbCenter,
  aabbExpand,
  aabbTranslate,
  aabbUnion,
  aabbIntersection,
  aabbRangeQuery,
  aabbRaycastSegment,
  RESOURCE_AABB,
} from '../src/index.js';

test('aabb: RESOURCE_AABB is the stable string', () => {
  assert.equal(RESOURCE_AABB, 'aabb');
});

// ---------- constructors ----------

test('aabb: builds from corners', () => {
  const b = aabb(0, 0, 10, 20);
  assert.equal(b.minX, 0);
  assert.equal(b.minY, 0);
  assert.equal(b.maxX, 10);
  assert.equal(b.maxY, 20);
});

test('aabb: tolerates flipped corners (auto-orders)', () => {
  const b = aabb(10, 20, 0, 0);
  assert.equal(b.minX, 0);
  assert.equal(b.maxX, 10);
});

test('aabbFromRect: width/height to corners', () => {
  const b = aabbFromRect(5, 7, 10, 20);
  assert.equal(b.minX, 5);
  assert.equal(b.minY, 7);
  assert.equal(b.maxX, 15);
  assert.equal(b.maxY, 27);
});

test('aabbFromPoints: empty input returns origin AABB', () => {
  const b = aabbFromPoints([]);
  assert.deepEqual(b, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
});

test('aabbFromPoints: single point gives degenerate AABB at that point', () => {
  const b = aabbFromPoints([{ x: 5, y: 7 }]);
  assert.deepEqual(b, { minX: 5, minY: 7, maxX: 5, maxY: 7 });
});

test('aabbFromPoints: tight box around multiple points', () => {
  const b = aabbFromPoints([
    { x: -5, y: 3 },
    { x: 12, y: -4 },
    { x: 0, y: 8 },
  ]);
  assert.equal(b.minX, -5);
  assert.equal(b.minY, -4);
  assert.equal(b.maxX, 12);
  assert.equal(b.maxY, 8);
});

// ---------- containment ----------

test('aabbContainsPoint: inside / outside / boundary', () => {
  const b = aabb(0, 0, 10, 10);
  assert.equal(aabbContainsPoint(b, 5, 5), true);
  assert.equal(aabbContainsPoint(b, 0, 0), true);   // boundary
  assert.equal(aabbContainsPoint(b, 10, 10), true); // boundary
  assert.equal(aabbContainsPoint(b, -1, 5), false);
  assert.equal(aabbContainsPoint(b, 5, 11), false);
});

test('aabbContainsAabb: full / partial / disjoint', () => {
  const outer = aabb(0, 0, 10, 10);
  const inner = aabb(2, 2, 8, 8);
  const partial = aabb(8, 8, 12, 12);
  const disjoint = aabb(20, 20, 30, 30);
  assert.equal(aabbContainsAabb(outer, inner), true);
  assert.equal(aabbContainsAabb(outer, partial), false);
  assert.equal(aabbContainsAabb(outer, disjoint), false);
  // Self-contains.
  assert.equal(aabbContainsAabb(outer, outer), true);
});

// ---------- overlap ----------

test('aabbOverlaps: clearly overlapping returns true', () => {
  const a = aabb(0, 0, 10, 10);
  const b = aabb(5, 5, 15, 15);
  assert.equal(aabbOverlaps(a, b), true);
});

test('aabbOverlaps: edge-touching counts as overlap', () => {
  const a = aabb(0, 0, 5, 5);
  const b = aabb(5, 0, 10, 5);
  assert.equal(aabbOverlaps(a, b), true);
});

test('aabbOverlaps: disjoint returns false', () => {
  const a = aabb(0, 0, 5, 5);
  const b = aabb(10, 10, 20, 20);
  assert.equal(aabbOverlaps(a, b), false);
});

test('aabbOverlaps: one inside the other counts as overlap', () => {
  const a = aabb(0, 0, 10, 10);
  const b = aabb(2, 2, 5, 5);
  assert.equal(aabbOverlaps(a, b), true);
});

// ---------- size + center ----------

test('aabbWidth / height / area', () => {
  const b = aabb(0, 0, 10, 20);
  assert.equal(aabbWidth(b), 10);
  assert.equal(aabbHeight(b), 20);
  assert.equal(aabbArea(b), 200);
});

test('aabbCenter without out object', () => {
  const b = aabb(0, 0, 10, 20);
  const c = aabbCenter(b);
  assert.equal(c.x, 5);
  assert.equal(c.y, 10);
});

test('aabbCenter with out object reuses', () => {
  const b = aabb(0, 0, 10, 20);
  const out = { x: 0, y: 0 };
  const c = aabbCenter(b, out);
  assert.equal(c, out);  // same reference
  assert.equal(out.x, 5);
  assert.equal(out.y, 10);
});

// ---------- mutation ----------

test('aabbExpand: positive margin grows; negative shrinks', () => {
  const b = aabb(0, 0, 10, 10);
  aabbExpand(b, 2);
  assert.deepEqual(b, { minX: -2, minY: -2, maxX: 12, maxY: 12 });
  aabbExpand(b, -3);
  assert.deepEqual(b, { minX: 1, minY: 1, maxX: 9, maxY: 9 });
});

test('aabbTranslate: shifts both corners', () => {
  const b = aabb(0, 0, 10, 10);
  aabbTranslate(b, 5, -3);
  assert.deepEqual(b, { minX: 5, minY: -3, maxX: 15, maxY: 7 });
});

test('aabbUnion: encloses both inputs', () => {
  const a = aabb(0, 0, 5, 5);
  const b = aabb(10, 10, 15, 15);
  const u = aabbUnion(a, b);
  assert.deepEqual(u, { minX: 0, minY: 0, maxX: 15, maxY: 15 });
});

test('aabbIntersection: returns overlap region or null', () => {
  const a = aabb(0, 0, 10, 10);
  const b = aabb(5, 5, 15, 15);
  const x = aabbIntersection(a, b);
  assert.deepEqual(x, { minX: 5, minY: 5, maxX: 10, maxY: 10 });
  const noOverlap = aabbIntersection(a, aabb(20, 20, 30, 30));
  assert.equal(noOverlap, null);
});

// ---------- range query ----------

test('aabbRangeQuery: returns indexes of overlapping boxes', () => {
  const boxes = [
    aabb(0, 0, 10, 10),
    aabb(20, 20, 30, 30),
    aabb(5, 5, 25, 25),
    aabb(100, 100, 110, 110),
  ];
  const query = aabb(0, 0, 12, 12);
  // Box 0 (clearly inside) + box 2 (overlaps top-left of query).
  const hits = aabbRangeQuery(boxes, query);
  assert.deepEqual(hits.sort(), [0, 2]);
});

test('aabbRangeQuery: reuses the out array', () => {
  const out: number[] = [];
  const boxes = [aabb(0, 0, 10, 10), aabb(20, 20, 30, 30)];
  const query = aabb(0, 0, 5, 5);
  const result = aabbRangeQuery(boxes, query, out);
  assert.equal(result, out);
  assert.deepEqual(out, [0]);
});

test('aabbRangeQuery: out array is reset on each call', () => {
  const out: number[] = [99, 88];  // stale data
  const boxes = [aabb(0, 0, 10, 10)];
  const query = aabb(20, 20, 30, 30); // no overlap
  aabbRangeQuery(boxes, query, out);
  assert.deepEqual(out, []);
});

// ---------- raycast ----------

test('aabbRaycastSegment: segment fully outside returns null', () => {
  const b = aabb(0, 0, 10, 10);
  const t = aabbRaycastSegment(b, -5, -5, -1, -1);
  assert.equal(t, null);
});

test('aabbRaycastSegment: segment crossing returns enter t', () => {
  const b = aabb(5, 0, 15, 10);
  // Segment from (0, 5) to (20, 5) — horizontal across the box.
  // Box minX=5; segment start at x=0 with dx=20 over t in [0,1].
  // Enter at x=5 -> t = (5-0)/20 = 0.25.
  const t = aabbRaycastSegment(b, 0, 5, 20, 5);
  assert.ok(t !== null && Math.abs(t - 0.25) < 1e-9);
});

test('aabbRaycastSegment: segment starts inside returns 0', () => {
  const b = aabb(0, 0, 10, 10);
  const t = aabbRaycastSegment(b, 5, 5, 20, 20);
  assert.equal(t, 0);
});

test('aabbRaycastSegment: vertical / horizontal degenerate axes', () => {
  const b = aabb(0, 0, 10, 10);
  // Vertical segment crossing.
  const tV = aabbRaycastSegment(b, 5, -5, 5, 15);
  assert.ok(tV !== null && Math.abs(tV - 0.25) < 1e-9);
  // Horizontal entirely to the left of the box.
  const tMiss = aabbRaycastSegment(b, -10, 5, -5, 5);
  assert.equal(tMiss, null);
});

test('aabbRaycastSegment: parallel-to-axis segment outside slab returns null', () => {
  const b = aabb(0, 0, 10, 10);
  // Horizontal segment at y=20 (above box).
  const t = aabbRaycastSegment(b, -5, 20, 20, 20);
  assert.equal(t, null);
});

test('aabb: realistic example - mob in aggro radius', () => {
  // Hero AABB; mob aggro radius around mob.
  const heroBox = aabb(95, 95, 105, 105);
  const mobAggro = aabb(50, 50, 150, 150);
  assert.equal(aabbOverlaps(heroBox, mobAggro), true);

  const farHero = aabb(200, 200, 210, 210);
  assert.equal(aabbOverlaps(farHero, mobAggro), false);
});
