// Phase 1.2.0 - PathfindingCache tests (Wave 1.2 world depth opens).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  PathfindingCache,
  RESOURCE_PATHFINDING_CACHE,
  type CachedPathResult,
} from '../src/index.js';

const fakeResult = (cost = 5): CachedPathResult => ({
  path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  cost,
  nodesExpanded: 3,
});

test('pcache: RESOURCE_PATHFINDING_CACHE is the stable string', () => {
  assert.equal(RESOURCE_PATHFINDING_CACHE, 'pathfinding_cache');
});

test('pcache: starts empty', () => {
  const c = PathfindingCache.create();
  assert.equal(c.size(), 0);
  assert.equal(c.hits(), 0);
  assert.equal(c.misses(), 0);
});

test('pcache: set + get hit', () => {
  const c = PathfindingCache.create();
  const r = fakeResult(10);
  c.set(0, 0, 5, 5, r);
  assert.equal(c.size(), 1);
  const got = c.get(0, 0, 5, 5);
  assert.ok(got);
  assert.equal(got!.cost, 10);
  assert.equal(c.hits(), 1);
});

test('pcache: get miss returns undefined + bumps misses', () => {
  const c = PathfindingCache.create();
  assert.equal(c.get(1, 1, 9, 9), undefined);
  assert.equal(c.misses(), 1);
});

test('pcache: get with non-finite coords returns undefined', () => {
  const c = PathfindingCache.create();
  assert.equal(c.get(NaN, 0, 5, 5), undefined);
  assert.equal(c.get(0, 0, Infinity, 5), undefined);
});

test('pcache: getOrCompute computes on miss + caches', () => {
  const c = PathfindingCache.create();
  let computed = 0;
  const r = c.getOrCompute(0, 0, 5, 5, () => {
    computed++;
    return fakeResult(7);
  });
  assert.ok(r);
  assert.equal(r!.cost, 7);
  assert.equal(computed, 1);
  // Second call hits cache.
  c.getOrCompute(0, 0, 5, 5, () => {
    computed++;
    return fakeResult(99);
  });
  assert.equal(computed, 1);
});

test('pcache: getOrCompute throwing computeFn returns null + does not cache', () => {
  const c = PathfindingCache.create();
  const r = c.getOrCompute(0, 0, 5, 5, () => { throw new Error('boom'); });
  assert.equal(r, null);
  assert.equal(c.size(), 0);
});

test('pcache: bumpGridVersion invalidates lazily', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, fakeResult());
  assert.equal(c.getGridVersion(), 0);
  c.bumpGridVersion();
  assert.equal(c.getGridVersion(), 1);
  // Get should miss + drop the stale entry.
  assert.equal(c.get(0, 0, 5, 5), undefined);
  assert.equal(c.size(), 0);
});

test('pcache: invalidateAll drops every entry', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, fakeResult());
  c.set(1, 1, 6, 6, fakeResult());
  assert.equal(c.invalidateAll(), 2);
  assert.equal(c.size(), 0);
});

test('pcache: invalidateAt drops entries crossing a cell', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, {
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 5 }],
    cost: 5, nodesExpanded: 4,
  });
  c.set(10, 10, 20, 20, {
    path: [{ x: 10, y: 10 }, { x: 15, y: 15 }, { x: 20, y: 20 }],
    cost: 14, nodesExpanded: 3,
  });
  // Invalidate at (1, 0) - first path crosses, second does not.
  assert.equal(c.invalidateAt(1, 0), 1);
  assert.equal(c.size(), 1);
});

test('pcache: invalidateBySource drops by start cell', () => {
  const c = PathfindingCache.create();
  c.set(5, 5, 10, 10, fakeResult());
  c.set(5, 5, 20, 20, fakeResult());
  c.set(0, 0, 10, 10, fakeResult());
  assert.equal(c.invalidateBySource(5, 5), 2);
  assert.equal(c.size(), 1);
});

test('pcache: invalidateByGoal drops by goal cell', () => {
  const c = PathfindingCache.create();
  c.set(5, 5, 10, 10, fakeResult());
  c.set(0, 0, 10, 10, fakeResult());
  c.set(0, 0, 20, 20, fakeResult());
  assert.equal(c.invalidateByGoal(10, 10), 2);
  assert.equal(c.size(), 1);
});

test('pcache: capacity LRU eviction', () => {
  const c = PathfindingCache.create({ capacity: 2 });
  c.set(0, 0, 1, 1, fakeResult());
  c.set(0, 0, 2, 2, fakeResult());
  // Touch first to make it most recently used.
  c.get(0, 0, 1, 1);
  // Adding third evicts second (least recently used).
  c.set(0, 0, 3, 3, fakeResult());
  assert.equal(c.size(), 2);
  assert.notEqual(c.get(0, 0, 1, 1), undefined);
  assert.equal(c.get(0, 0, 2, 2), undefined);
  assert.notEqual(c.get(0, 0, 3, 3), undefined);
});

test('pcache: ttl expiry on tick', () => {
  const c = PathfindingCache.create({ ttlMs: 100 });
  c.set(0, 0, 5, 5, fakeResult());
  c.tick(50);
  assert.equal(c.size(), 1);
  c.tick(60);
  assert.equal(c.size(), 0);
});

test('pcache: ttl=0 means no expiry', () => {
  const c = PathfindingCache.create({ ttlMs: 0 });
  c.set(0, 0, 5, 5, fakeResult());
  c.tick(60000);
  assert.equal(c.size(), 1);
});

test('pcache: hitRate reports hits / (hits + misses)', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, fakeResult());
  c.get(0, 0, 5, 5); // hit
  c.get(1, 1, 9, 9); // miss
  c.get(0, 0, 5, 5); // hit
  assert.ok(Math.abs(c.hitRate() - 2 / 3) < 1e-6);
});

test('pcache: hitRate=0 when no queries', () => {
  const c = PathfindingCache.create();
  assert.equal(c.hitRate(), 0);
});

test('pcache: resetStats clears counters not entries', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, fakeResult());
  c.get(0, 0, 5, 5);
  c.resetStats();
  assert.equal(c.hits(), 0);
  assert.equal(c.size(), 1);
});

test('pcache: NaN / negative dt no-op', () => {
  const c = PathfindingCache.create({ ttlMs: 100 });
  c.set(0, 0, 5, 5, fakeResult());
  c.tick(NaN);
  c.tick(-50);
  c.tick(Infinity);
  assert.equal(c.size(), 1);
});

test('pcache: set with non-finite coords no-op', () => {
  const c = PathfindingCache.create();
  c.set(NaN, 0, 5, 5, fakeResult());
  assert.equal(c.size(), 0);
});

test('pcache: cached null path is preserved (unreachable goal)', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, { path: null, cost: Infinity, nodesExpanded: 100 });
  const got = c.get(0, 0, 5, 5);
  assert.ok(got);
  assert.equal(got!.path, null);
});

test('pcache: dispose locks ops', () => {
  const c = PathfindingCache.create();
  c.set(0, 0, 5, 5, fakeResult());
  c.dispose();
  assert.equal(c.size(), 0);
  assert.equal(c.get(0, 0, 5, 5), undefined);
});

test('pcache: realistic example - 5 mobs all path to player', () => {
  const c = PathfindingCache.create({ capacity: 32 });
  let computeCalls = 0;
  const compute = () => {
    computeCalls++;
    return fakeResult(10);
  };
  // 5 mobs at different starts, all targeting player at (50, 50).
  c.getOrCompute(10, 10, 50, 50, compute);
  c.getOrCompute(15, 12, 50, 50, compute);
  c.getOrCompute(20, 14, 50, 50, compute);
  // Mob 1 didn't move; same query hits cache.
  c.getOrCompute(10, 10, 50, 50, compute);
  // Mob 2 didn't move either.
  c.getOrCompute(15, 12, 50, 50, compute);
  assert.equal(computeCalls, 3); // only 3 unique queries computed
});
