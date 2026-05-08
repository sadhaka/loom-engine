// Phase 0.30.0 - SpatialHash tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { SpatialHash } from '../src/runtime/spatial-hash.js';


test('spatial-hash: insert + query returns the entity', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);
  var results = sh.queryRect(0, 0, 10, 10);
  assert.deepEqual(results, [1]);
});

test('spatial-hash: queryRadius narrows to overlapping cells', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);    // cell (0,0)
  sh.insert(2, 50, 50);  // cell (5,5)
  sh.insert(3, 105, 105); // cell (10,10)
  // Circle at (10,10) radius 20: rect (-10,-10)..(30,30) -> cells (-1,-1)..(3,3).
  var results = sh.queryRadius(10, 10, 20);
  // 1 is in (0,0) - yes; 2 is in (5,5) - no; 3 is in (10,10) - no.
  assert.deepEqual(results.sort(), [1]);
});

test('spatial-hash: remove drops entity + cleans empty bucket', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);
  assert.equal(sh.bucketCount(), 1);
  assert.equal(sh.remove(1), true);
  assert.equal(sh.bucketCount(), 0);
  assert.equal(sh.size(), 0);
  // Removing again returns false.
  assert.equal(sh.remove(1), false);
});

test('spatial-hash: update within same cell is a no-op (no rebucket)', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);  // cell (0, 0)
  sh.update(1, 7, 8);  // still cell (0, 0)
  var s = sh.stats();
  assert.equal(s.entities, 1);
  assert.equal(s.buckets, 1);
});

test('spatial-hash: update across cells rebuckets correctly', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);   // cell (0, 0)
  sh.insert(2, 5, 5);   // cell (0, 0) too
  assert.equal(sh.bucketCount(), 1);

  sh.update(1, 50, 50);  // moves to cell (5, 5)
  assert.equal(sh.bucketCount(), 2);

  // queryRect (0, 0)..(10, 10) only returns 2.
  var inOriginal = sh.queryRect(0, 0, 10, 10);
  assert.deepEqual(inOriginal, [2]);

  // queryRect (50, 50)..(60, 60) only returns 1.
  var inNew = sh.queryRect(50, 50, 60, 60);
  assert.deepEqual(inNew, [1]);
});

test('spatial-hash: insert calls update if entity exists', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);
  sh.insert(1, 50, 50);  // re-insert -> moves
  assert.equal(sh.size(), 1);
  var inOld = sh.queryRect(0, 0, 10, 10);
  assert.deepEqual(inOld, []);
  var inNew = sh.queryRect(50, 50, 60, 60);
  assert.deepEqual(inNew, [1]);
});

test('spatial-hash: queryRect with reversed bounds still works', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 5, 5);
  // Pass max,min instead of min,max - implementation should normalize.
  var results = sh.queryRect(10, 10, 0, 0);
  assert.deepEqual(results, [1]);
});

test('spatial-hash: many entities across many cells - all retrievable', function () {
  var sh = new SpatialHash(10);
  for (var i = 0; i < 100; i++) {
    sh.insert(i, i * 5, i * 5);  // 20 cells (since cellSize=10, every 2 entities share a cell)
  }
  assert.equal(sh.size(), 100);
  // Query the full bounding box - should return everyone.
  var all = sh.queryRect(0, 0, 500, 500);
  assert.equal(all.length, 100);
});

test('spatial-hash: clear() drops everything', function () {
  var sh = new SpatialHash(10);
  for (var i = 0; i < 10; i++) sh.insert(i, i, i);
  assert.equal(sh.size(), 10);
  sh.clear();
  assert.equal(sh.size(), 0);
  assert.equal(sh.bucketCount(), 0);
});

test('spatial-hash: cellSize defaults to 32 if invalid', function () {
  var sh = new SpatialHash(0);
  assert.equal(sh.stats().cellSize, 32);
  var sh2 = new SpatialHash(NaN);
  assert.equal(sh2.stats().cellSize, 32);
  var sh3 = new SpatialHash(-5);
  assert.equal(sh3.stats().cellSize, 32);
});

test('spatial-hash: stats counters increment', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, 0, 0);
  sh.insert(2, 100, 100);
  sh.update(1, 200, 200);
  sh.queryRadius(0, 0, 50);
  sh.remove(2);
  var s = sh.stats();
  assert.equal(s.inserts, 2);
  assert.equal(s.removes, 1);
  assert.equal(s.updates, 1);
  assert.equal(s.queries, 1);
});

test('spatial-hash: negative coordinates work', function () {
  var sh = new SpatialHash(10);
  sh.insert(1, -50, -50);  // cell (-5, -5)
  sh.insert(2, -5, -5);    // cell (-1, -1)
  // Query covering both:
  var results = sh.queryRect(-60, -60, 0, 0);
  assert.deepEqual(results.sort(), [1, 2]);
});

test('spatial-hash: swap-pop maintains correct indexInBucket on remove', function () {
  // Stress test: insert 5 entities into the same cell, remove one
  // from the middle, ensure remaining entities are still queryable.
  var sh = new SpatialHash(100);
  for (var i = 1; i <= 5; i++) sh.insert(i, 1, 1);  // all in cell (0,0)
  sh.remove(3);  // middle of bucket
  var remaining = sh.queryRect(0, 0, 10, 10).sort();
  assert.deepEqual(remaining, [1, 2, 4, 5]);
  // Removing each remaining entity in turn must not throw.
  sh.remove(1);
  sh.remove(2);
  sh.remove(4);
  sh.remove(5);
  assert.equal(sh.size(), 0);
});
