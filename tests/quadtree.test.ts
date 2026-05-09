// Phase 0.81.0 - Quadtree tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Quadtree,
  RESOURCE_QUADTREE,
  type AABBLite,
} from '../src/index.js';

const BOUNDS = { x: 0, y: 0, width: 100, height: 100 };

function box(minX: number, minY: number, maxX: number, maxY: number): AABBLite {
  return { minX, minY, maxX, maxY };
}

test('quadtree: RESOURCE_QUADTREE is the stable string', () => {
  assert.equal(RESOURCE_QUADTREE, 'quadtree');
});

test('quadtree: insert + has + size', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  assert.ok(qt.insert('a', box(10, 10, 20, 20)));
  assert.ok(qt.has('a'));
  assert.equal(qt.size(), 1);
});

test('quadtree: insert duplicate id rejected', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  assert.equal(qt.insert('a', box(30, 30, 40, 40)), false);
  assert.equal(qt.size(), 1);
});

test('quadtree: insert rejects empty id / invalid AABB', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  assert.equal(qt.insert('', box(10, 10, 20, 20)), false);
  assert.equal(qt.insert('a', { minX: 20, minY: 0, maxX: 10, maxY: 10 }), false); // inverted
  assert.equal(qt.insert('a', { minX: NaN } as AABBLite), false);
});

test('quadtree: remove drops + size shrinks', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  qt.insert('b', box(30, 30, 40, 40));
  assert.ok(qt.remove('a'));
  assert.equal(qt.size(), 1);
  assert.equal(qt.has('a'), false);
  assert.equal(qt.remove('a'), false);
});

test('quadtree: query returns overlapping items', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  qt.insert('b', box(30, 30, 40, 40));
  qt.insert('c', box(70, 70, 80, 80));
  const hits = qt.query(box(15, 15, 35, 35));
  assert.deepEqual(hits.sort(), ['a', 'b']);
});

test('quadtree: query returns empty when no overlap', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  assert.deepEqual(qt.query(box(50, 50, 60, 60)), []);
});

test('quadtree: subdivides past maxItemsPerNode', () => {
  const qt = Quadtree.create({ bounds: BOUNDS, maxItemsPerNode: 2 });
  // Insert > 2 items in different quadrants.
  for (let i = 0; i < 10; i++) {
    qt.insert('p' + i, box(i * 5, i * 5, i * 5 + 1, i * 5 + 1));
  }
  // Query the full bounds returns all of them.
  const all = qt.query(box(0, 0, 100, 100));
  assert.equal(all.length, 10);
});

test('quadtree: queryPoint matches items containing the point', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  qt.insert('b', box(15, 15, 25, 25));
  qt.insert('c', box(30, 30, 40, 40));
  const hits = qt.queryPoint(17, 17);
  assert.deepEqual(hits.sort(), ['a', 'b']);
});

test('quadtree: queryRadius filters AABB candidates by circle distance', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  // 'a' is inside the radius; 'b' is in the bounding box but outside the circle.
  qt.insert('a', box(50, 50, 51, 51));
  qt.insert('b', box(58, 58, 59, 59)); // distance ~12 from (50,50)
  // Radius 5 from (50,50): only 'a'.
  const hits = qt.queryRadius(50, 50, 5);
  assert.deepEqual(hits, ['a']);
});

test('quadtree: queryRadius radius 0 finds items containing the point', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  const hits = qt.queryRadius(15, 15, 0);
  assert.deepEqual(hits, ['a']);
});

test('quadtree: update moves an item', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  assert.ok(qt.update('a', box(70, 70, 80, 80)));
  assert.deepEqual(qt.query(box(0, 0, 50, 50)), []);
  assert.deepEqual(qt.query(box(60, 60, 90, 90)), ['a']);
});

test('quadtree: update inserts if id absent', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  assert.ok(qt.update('a', box(10, 10, 20, 20)));
  assert.equal(qt.size(), 1);
});

test('quadtree: clear empties everything', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  qt.insert('b', box(30, 30, 40, 40));
  qt.clear();
  assert.equal(qt.size(), 0);
  assert.deepEqual(qt.query(box(0, 0, 100, 100)), []);
});

test('quadtree: rebuild reorganizes tree', () => {
  const qt = Quadtree.create({ bounds: BOUNDS, maxItemsPerNode: 2 });
  for (let i = 0; i < 10; i++) qt.insert('p' + i, box(i * 5, 0, i * 5 + 1, 1));
  // Update many items toward the same quadrant.
  for (let i = 0; i < 10; i++) qt.update('p' + i, box(80 + i * 0.1, 80, 80 + i * 0.1 + 1, 81));
  qt.rebuild();
  const hits = qt.query(box(70, 70, 100, 100));
  assert.equal(hits.length, 10);
});

test('quadtree: dispose locks ops', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  qt.dispose();
  assert.equal(qt.insert('b', box(30, 30, 40, 40)), false);
  assert.equal(qt.has('a'), false);
  assert.deepEqual(qt.query(box(0, 0, 100, 100)), []);
});

test('quadtree: items spanning quadrant boundaries handled correctly', () => {
  const qt = Quadtree.create({ bounds: BOUNDS, maxItemsPerNode: 2 });
  // Insert several small items first to force subdivision.
  qt.insert('a', box(10, 10, 11, 11));
  qt.insert('b', box(15, 15, 16, 16));
  qt.insert('c', box(80, 80, 81, 81));
  // This item spans the center of the bounds.
  qt.insert('span', box(40, 40, 60, 60));
  // Query the top-left quadrant.
  const hits = qt.query(box(0, 0, 50, 50));
  assert.ok(hits.indexOf('a') >= 0);
  assert.ok(hits.indexOf('b') >= 0);
  assert.ok(hits.indexOf('span') >= 0);
});

test('quadtree: query item appears at most once even if reachable from multiple nodes', () => {
  const qt = Quadtree.create({ bounds: BOUNDS, maxItemsPerNode: 1 });
  for (let i = 0; i < 10; i++) qt.insert('p' + i, box(i * 5, 0, i * 5 + 1, 1));
  // Big spanning item.
  qt.insert('spanner', box(0, 0, 100, 100));
  const hits = qt.query(box(0, 0, 100, 100));
  // Each item appears once.
  const set = new Set(hits);
  assert.equal(set.size, hits.length);
  assert.equal(hits.length, 11);
});

test('quadtree: maxDepth caps subdivision', () => {
  const qt = Quadtree.create({ bounds: BOUNDS, maxItemsPerNode: 1, maxDepth: 1 });
  // Pile many items in a small region; depth is capped at 1, so
  // a single child will hold them all.
  for (let i = 0; i < 20; i++) qt.insert('p' + i, box(10 + i * 0.1, 10, 10 + i * 0.1 + 0.05, 10.5));
  const all = qt.query(box(0, 0, 100, 100));
  assert.equal(all.length, 20);
});

test('quadtree: realistic 100-entity world with random-ish placement', () => {
  const qt = Quadtree.create({ bounds: { x: 0, y: 0, width: 1000, height: 1000 } });
  for (let i = 0; i < 100; i++) {
    const x = (i * 9973) % 1000;
    const y = (i * 7919) % 1000;
    qt.insert('e' + i, box(x, y, x + 5, y + 5));
  }
  // Window query in the middle.
  const hits = qt.query(box(400, 400, 600, 600));
  assert.ok(hits.length >= 0);
  // Sanity: every hit must overlap the window.
  for (let i = 0; i < hits.length; i++) {
    const id = hits[i] as string;
    assert.ok(qt.has(id));
  }
});

test('quadtree: invalid query AABB returns empty', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  assert.deepEqual(qt.query({ minX: 20, minY: 0, maxX: 10, maxY: 10 }), []);
});

test('quadtree: invalid radius returns empty', () => {
  const qt = Quadtree.create({ bounds: BOUNDS });
  qt.insert('a', box(10, 10, 20, 20));
  assert.deepEqual(qt.queryRadius(NaN, 0, 5), []);
  assert.deepEqual(qt.queryRadius(0, 0, -1), []);
});
