// Phase 0.22.0 - ComponentSignature + QueryCache tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ComponentSignature,
  componentMask,
  COMPONENT_SIGNATURE_MAX_BIT,
} from '../src/runtime/component-signature.js';
import { QueryCache } from '../src/runtime/query-cache.js';


// ----- ComponentSignature -----

test('component-signature: setBit / hasAll round-trip', function () {
  var sig = new ComponentSignature();
  sig.setBit(5, 0);
  sig.setBit(5, 3);
  assert.equal(sig.hasAll(5, componentMask(0)), true);
  assert.equal(sig.hasAll(5, componentMask(3)), true);
  assert.equal(sig.hasAll(5, componentMask(0, 3)), true);
  assert.equal(sig.hasAll(5, componentMask(0, 3, 1)), false,
    'bit 1 not set; hasAll should be false');
});

test('component-signature: clearBit removes only that bit', function () {
  var sig = new ComponentSignature();
  sig.setBit(7, 1);
  sig.setBit(7, 2);
  sig.setBit(7, 3);
  sig.clearBit(7, 2);
  assert.equal(sig.hasAll(7, componentMask(1)), true);
  assert.equal(sig.hasAll(7, componentMask(2)), false);
  assert.equal(sig.hasAll(7, componentMask(3)), true);
});

test('component-signature: clearEntity wipes the whole entity', function () {
  var sig = new ComponentSignature();
  sig.setBit(9, 0);
  sig.setBit(9, 1);
  sig.setBit(9, 31);
  sig.clearEntity(9);
  assert.equal(sig.getMask(9), 0);
});

test('component-signature: hasAny matches at least one set bit', function () {
  var sig = new ComponentSignature();
  sig.setBit(2, 5);
  assert.equal(sig.hasAny(2, componentMask(5)), true);
  assert.equal(sig.hasAny(2, componentMask(5, 6, 7)), true);
  assert.equal(sig.hasAny(2, componentMask(0, 1)), false);
});

test('component-signature: setBit out of range throws', function () {
  var sig = new ComponentSignature();
  assert.throws(function () { sig.setBit(0, 32); }, /out of range/);
  assert.throws(function () { sig.setBit(0, -1); }, /out of range/);
});

test('component-signature: capacity grows on demand (pow-2)', function () {
  var sig = new ComponentSignature(8);
  // Initial capacity is nextPow2(8) = 8.
  assert.equal(sig.capacity(), 8);
  // Address index 100; should grow.
  sig.setBit(100, 0);
  // nextPow2(101) = 128.
  assert.equal(sig.capacity(), 128);
  // Existing data preserved.
  assert.equal(sig.hasAll(100, componentMask(0)), true);
});

test('component-signature: version bumps only on actual mutation', function () {
  var sig = new ComponentSignature();
  var v0 = sig.version();
  sig.setBit(1, 0);
  var v1 = sig.version();
  assert.notEqual(v0, v1, 'first set should bump version');
  // Idempotent setBit - already set, no bump.
  sig.setBit(1, 0);
  var v2 = sig.version();
  assert.equal(v1, v2, 'redundant setBit should NOT bump version');
  // clearBit on a never-set bit - no bump.
  sig.clearBit(1, 31);
  assert.equal(sig.version(), v2);
  // clearBit on a set bit - bump.
  sig.clearBit(1, 0);
  assert.notEqual(sig.version(), v2);
});

test('component-signature: collectMatching returns sorted entity indices', function () {
  var sig = new ComponentSignature();
  sig.setBit(0, 0); sig.setBit(0, 1);
  sig.setBit(2, 0);
  sig.setBit(5, 0); sig.setBit(5, 1);
  sig.setBit(7, 1); // missing bit 0; should not match
  var matches = sig.collectMatching(componentMask(0, 1));
  assert.deepEqual(Array.from(matches), [0, 5],
    'only entities with BOTH bits set; sorted by index');
});

test('component-signature: COMPONENT_SIGNATURE_MAX_BIT exported correctly', function () {
  assert.equal(COMPONENT_SIGNATURE_MAX_BIT, 31);
});


// ----- QueryCache -----

test('query-cache: hit on same mask without signature change', function () {
  var sig = new ComponentSignature();
  sig.setBit(0, 0); sig.setBit(0, 1);
  sig.setBit(1, 0);
  var cache = new QueryCache(sig);
  var first = cache.query(componentMask(0, 1));
  var second = cache.query(componentMask(0, 1));
  assert.equal(first, second, 'same Int32Array returned (reference identity)');
  var stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
});

test('query-cache: invalidation on signature mutation', function () {
  var sig = new ComponentSignature();
  sig.setBit(0, 0);
  var cache = new QueryCache(sig);
  var first = cache.query(componentMask(0));
  assert.deepEqual(Array.from(first), [0]);
  sig.setBit(5, 0);  // bumps version
  var second = cache.query(componentMask(0));
  assert.notEqual(first, second, 'fresh result after mutation');
  assert.deepEqual(Array.from(second), [0, 5]);
  var stats = cache.stats();
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 2);
});

test('query-cache: multiple masks cached independently', function () {
  var sig = new ComponentSignature();
  sig.setBit(0, 0); sig.setBit(0, 1);
  sig.setBit(1, 0);
  var cache = new QueryCache(sig);
  cache.query(componentMask(0));      // miss
  cache.query(componentMask(0, 1));   // miss
  cache.query(componentMask(0));      // hit
  cache.query(componentMask(0, 1));   // hit
  var stats = cache.stats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 2);
  assert.equal(stats.entries, 2);
});

test('query-cache: FIFO eviction at maxEntries', function () {
  var sig = new ComponentSignature();
  sig.setBit(0, 0); sig.setBit(0, 1); sig.setBit(0, 2); sig.setBit(0, 3);
  var cache = new QueryCache(sig, 2);  // small cap to force eviction
  cache.query(componentMask(0));  // entry A
  cache.query(componentMask(1));  // entry B
  // Cap reached; next miss evicts A.
  cache.query(componentMask(2));
  assert.equal(cache.stats().entries, 2);
  // Querying A again should miss (evicted).
  var beforeMisses = cache.stats().misses;
  cache.query(componentMask(0));
  assert.equal(cache.stats().misses, beforeMisses + 1,
    'evicted entry should miss on re-query');
});

test('query-cache: clear() resets state', function () {
  var sig = new ComponentSignature();
  sig.setBit(0, 0);
  var cache = new QueryCache(sig);
  cache.query(componentMask(0));
  cache.query(componentMask(0));
  assert.equal(cache.stats().hits, 1);
  cache.clear();
  assert.equal(cache.stats().hits, 0);
  assert.equal(cache.stats().misses, 0);
  assert.equal(cache.stats().entries, 0);
});
