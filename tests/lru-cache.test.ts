// Phase 0.53.0 - LRUCache tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LRUCache,
  RESOURCE_LRU_CACHE,
} from '../src/index.js';

test('lru: RESOURCE_LRU_CACHE is the stable string', () => {
  assert.equal(RESOURCE_LRU_CACHE, 'lru_cache');
});

test('lru: starts empty with default capacity 128', () => {
  const c = LRUCache.create<number>();
  assert.equal(c.size(), 0);
  assert.equal(c.capacity(), 128);
  assert.equal(c.get('missing'), undefined);
});

test('lru: set + get roundtrip', () => {
  const c = LRUCache.create<number>();
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
});

test('lru: set updates existing key in place', () => {
  const c = LRUCache.create<number>();
  c.set('a', 1);
  c.set('a', 2);
  assert.equal(c.get('a'), 2);
  assert.equal(c.size(), 1);
});

test('lru: capacity eviction drops oldest', () => {
  const c = LRUCache.create<number>({ capacity: 3 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.set('d', 4); // evicts 'a'
  assert.equal(c.has('a'), false);
  assert.equal(c.has('b'), true);
  assert.equal(c.has('c'), true);
  assert.equal(c.has('d'), true);
});

test('lru: get marks key as most-recently-used', () => {
  const c = LRUCache.create<number>({ capacity: 3 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.get('a'); // a is now most-recently-used
  c.set('d', 4); // evicts b (now oldest)
  assert.equal(c.has('a'), true);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('c'), true);
  assert.equal(c.has('d'), true);
});

test('lru: set returns evicted entry on overflow', () => {
  const c = LRUCache.create<number>({ capacity: 2 });
  c.set('a', 1);
  c.set('b', 2);
  const ev = c.set('c', 3);
  assert.deepEqual(ev, { key: 'a', value: 1 });
});

test('lru: set on update returns undefined (no eviction)', () => {
  const c = LRUCache.create<number>({ capacity: 2 });
  c.set('a', 1);
  const ev = c.set('a', 99);
  assert.equal(ev, undefined);
});

test('lru: set with empty cache returns undefined', () => {
  const c = LRUCache.create<number>({ capacity: 2 });
  assert.equal(c.set('a', 1), undefined);
});

test('lru: peek does NOT change access order', () => {
  const c = LRUCache.create<number>({ capacity: 3 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.peek('a'); // peek does not promote a
  c.set('d', 4); // evicts a (still oldest)
  assert.equal(c.has('a'), false);
});

test('lru: peek returns value or undefined', () => {
  const c = LRUCache.create<number>();
  c.set('a', 42);
  assert.equal(c.peek('a'), 42);
  assert.equal(c.peek('missing'), undefined);
});

test('lru: delete removes a key', () => {
  const c = LRUCache.create<number>();
  c.set('a', 1);
  assert.equal(c.delete('a'), true);
  assert.equal(c.has('a'), false);
});

test('lru: delete on missing returns false', () => {
  const c = LRUCache.create<number>();
  assert.equal(c.delete('nope'), false);
});

test('lru: delete does NOT fire onEvict', () => {
  let evicted = false;
  const c = LRUCache.create<number>({
    capacity: 5,
    onEvict: () => { evicted = true; },
  });
  c.set('a', 1);
  c.delete('a');
  assert.equal(evicted, false);
});

test('lru: capacity-driven eviction fires onEvict', () => {
  const evictions: Array<{ key: string; value: number }> = [];
  const c = LRUCache.create<number>({
    capacity: 2,
    onEvict: (k, v) => evictions.push({ key: k, value: v }),
  });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3); // evicts a
  assert.deepEqual(evictions, [{ key: 'a', value: 1 }]);
});

test('lru: throwing onEvict is isolated', () => {
  const c = LRUCache.create<number>({
    capacity: 2,
    onEvict: () => { throw new Error('boom'); },
  });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3); // evicts a; should not throw
  assert.equal(c.has('a'), false);
});

test('lru: clear empties cache + does NOT fire onEvict', () => {
  let fired = 0;
  const c = LRUCache.create<number>({
    capacity: 5,
    onEvict: () => { fired++; },
  });
  c.set('a', 1);
  c.set('b', 2);
  c.clear();
  assert.equal(c.size(), 0);
  assert.equal(fired, 0);
});

test('lru: setCapacity smaller evicts oldest entries', () => {
  const evictions: string[] = [];
  const c = LRUCache.create<number>({
    capacity: 5,
    onEvict: (k) => evictions.push(k),
  });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.set('d', 4);
  c.set('e', 5);
  c.setCapacity(2); // evicts a, b, c
  assert.deepEqual(evictions, ['a', 'b', 'c']);
  assert.equal(c.size(), 2);
});

test('lru: setCapacity larger does not evict', () => {
  const c = LRUCache.create<number>({ capacity: 2 });
  c.set('a', 1);
  c.set('b', 2);
  c.setCapacity(5);
  assert.equal(c.size(), 2);
  c.set('c', 3); // no eviction
  assert.equal(c.size(), 3);
});

test('lru: setCapacity 0 or negative ignored', () => {
  const c = LRUCache.create<number>({ capacity: 2 });
  c.setCapacity(0);
  assert.equal(c.capacity(), 2);
  c.setCapacity(-5);
  assert.equal(c.capacity(), 2);
});

test('lru: keys + values in eviction order (oldest first)', () => {
  const c = LRUCache.create<number>({ capacity: 5 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.get('a'); // promote a
  assert.deepEqual(c.keys(), ['b', 'c', 'a']);
  assert.deepEqual(c.values(), [2, 3, 1]);
});

test('lru: stats reflect hits / misses / evictions', () => {
  const c = LRUCache.create<number>({ capacity: 2 });
  c.set('a', 1);
  c.get('a');     // hit
  c.get('a');     // hit
  c.get('missing'); // miss
  c.set('b', 2);
  c.set('c', 3);  // eviction
  const s = c.stats();
  assert.equal(s.size, 2);
  assert.equal(s.capacity, 2);
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.evictions, 1);
});

test('lru: dispose makes ops no-op', () => {
  const c = LRUCache.create<number>();
  c.set('a', 1);
  c.dispose();
  assert.equal(c.get('a'), undefined);
  assert.equal(c.set('b', 2), undefined);
  assert.equal(c.has('a'), false);
});

test('lru: works with arbitrary value types', () => {
  const c = LRUCache.create<{ name: string }>();
  c.set('hero', { name: 'Misha' });
  const v = c.get('hero');
  assert.equal(v?.name, 'Misha');
});

test('lru: realistic example - asset cache with onEvict cleanup', () => {
  const released: string[] = [];
  const cache = LRUCache.create<{ id: string }>({
    capacity: 3,
    onEvict: (_k, asset) => { released.push(asset.id); },
  });
  cache.set('atlas-1', { id: 'atlas-1' });
  cache.set('atlas-2', { id: 'atlas-2' });
  cache.set('atlas-3', { id: 'atlas-3' });
  cache.get('atlas-1'); // promote
  cache.set('atlas-4', { id: 'atlas-4' }); // evicts atlas-2
  assert.deepEqual(released, ['atlas-2']);
});

test('lru: deterministic eviction order matches set + access pattern', () => {
  function run(): string[] {
    const c = LRUCache.create<number>({ capacity: 3 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.get('a');
    c.set('d', 4);
    c.set('e', 5);
    return c.keys();
  }
  // Should be deterministic across runs.
  assert.deepEqual(run(), run());
});
