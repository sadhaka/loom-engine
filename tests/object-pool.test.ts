// Phase 0.32.0 - ObjectPool tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ObjectPool } from '../src/runtime/object-pool.js';


interface DamageNumber {
  x: number;
  y: number;
  life: number;
}

function makeDamageNumber(): DamageNumber {
  return { x: 0, y: 0, life: 0 };
}

function resetDamageNumber(d: DamageNumber): void {
  d.x = 0;
  d.y = 0;
  d.life = 0;
}


test('object-pool: factory required', function () {
  assert.throws(function () {
    // @ts-expect-error - testing runtime check
    new ObjectPool({});
  }, /factory function required/);
});

test('object-pool: acquire allocates from factory when free list empty', function () {
  var pool = new ObjectPool<DamageNumber>({ factory: makeDamageNumber });
  var a = pool.acquire();
  assert.ok(a !== null);
  assert.equal(pool.freeCount(), 0);
  assert.equal(pool.inUseCount(), 1);
});

test('object-pool: release returns object to free list', function () {
  var pool = new ObjectPool<DamageNumber>({ factory: makeDamageNumber });
  var a = pool.acquire()!;
  pool.release(a);
  assert.equal(pool.freeCount(), 1);
  assert.equal(pool.inUseCount(), 0);
});

test('object-pool: subsequent acquire reuses released instance', function () {
  var pool = new ObjectPool<DamageNumber>({ factory: makeDamageNumber });
  var a = pool.acquire()!;
  pool.release(a);
  var b = pool.acquire();
  assert.equal(a, b, 'same instance returned via free-list');
});

test('object-pool: reset() called on release', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    reset: resetDamageNumber,
  });
  var a = pool.acquire()!;
  a.x = 100;
  a.y = 200;
  a.life = 1.0;
  pool.release(a);
  // Re-acquire and inspect.
  var b = pool.acquire()!;
  assert.equal(b.x, 0);
  assert.equal(b.y, 0);
  assert.equal(b.life, 0);
});

test('object-pool: no reset() means released state persists', function () {
  var pool = new ObjectPool<DamageNumber>({ factory: makeDamageNumber });
  var a = pool.acquire()!;
  a.x = 999;
  pool.release(a);
  var b = pool.acquire()!;
  assert.equal(b.x, 999);
});

test('object-pool: initialSize pre-fills the free list', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    initialSize: 10,
  });
  assert.equal(pool.freeCount(), 10);
  assert.equal(pool.totalAllocated(), 10);
});

test('object-pool: maxSize caps total allocations', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    maxSize: 3,
  });
  var a = pool.acquire()!;
  var b = pool.acquire()!;
  var c = pool.acquire()!;
  void a; void b; void c;
  // 4th should fail.
  var d = pool.acquire();
  assert.equal(d, null);
  assert.equal(pool.stats().capRejects, 1);
});

test('object-pool: warm() pre-allocates more (capped by maxSize)', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    maxSize: 5,
  });
  var added = pool.warm(10);
  // Capped to 5.
  assert.equal(added, 5);
  assert.equal(pool.freeCount(), 5);
  assert.equal(pool.totalAllocated(), 5);
});

test('object-pool: clear() drops everything', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    initialSize: 10,
  });
  var a = pool.acquire()!;
  void a;
  pool.clear();
  assert.equal(pool.freeCount(), 0);
  assert.equal(pool.inUseCount(), 0);
  assert.equal(pool.totalAllocated(), 0);
});

test('object-pool: stats counters track acquires + releases + capRejects', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    maxSize: 2,
  });
  var a = pool.acquire()!;
  var b = pool.acquire()!;
  pool.acquire();  // null - cap reject
  pool.release(a);
  pool.release(b);
  pool.acquire();  // hit free list
  var s = pool.stats();
  assert.equal(s.acquires, 4);
  assert.equal(s.releases, 2);
  assert.equal(s.capRejects, 1);
});

test('object-pool: throwing reset is caught; release still adds to free', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    reset: function () { throw new Error('boom'); },
  });
  var a = pool.acquire()!;
  pool.release(a);  // must not throw
  assert.equal(pool.freeCount(), 1);
});

test('object-pool: large initial > maxSize is clamped', function () {
  var pool = new ObjectPool<DamageNumber>({
    factory: makeDamageNumber,
    initialSize: 100,
    maxSize: 5,
  });
  assert.equal(pool.totalAllocated(), 5);
});
