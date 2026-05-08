// Phase 0.42.0 - MemoryBudget tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MemoryBudget,
  estimateTypedArrayBytes,
  estimateMapBytes,
  estimateSetBytes,
  estimateArrayBytes,
  estimateObjectBytes,
  RESOURCE_MEMORY_BUDGET,
  type IMemorySource,
} from '../src/index.js';

test('memory-budget: RESOURCE_MEMORY_BUDGET is the stable string', () => {
  assert.equal(RESOURCE_MEMORY_BUDGET, 'memory_budget');
});

// ---------- Estimator helpers ----------

test('estimate: typed array byte length sum across multiple arrays', () => {
  const a = new Float32Array(10);   // 40 bytes
  const b = new Uint8Array(5);      // 5 bytes
  const c = new Int32Array(3);      // 12 bytes
  assert.equal(estimateTypedArrayBytes(a, b, c), 57);
});

test('estimate: typed array no-arg returns 0', () => {
  assert.equal(estimateTypedArrayBytes(), 0);
});

test('estimate: map bytes default 96 / entry', () => {
  const m = new Map<string, number>();
  m.set('a', 1);
  m.set('b', 2);
  m.set('c', 3);
  assert.equal(estimateMapBytes(m), 288);
});

test('estimate: map bytes accepts custom per-entry size', () => {
  const m = new Map<string, number>();
  m.set('a', 1);
  m.set('b', 2);
  assert.equal(estimateMapBytes(m, 200), 400);
});

test('estimate: map null/undefined returns 0', () => {
  assert.equal(estimateMapBytes(null), 0);
  assert.equal(estimateMapBytes(undefined), 0);
});

test('estimate: set bytes default 64 / entry', () => {
  const s = new Set<string>();
  s.add('a');
  s.add('b');
  assert.equal(estimateSetBytes(s), 128);
});

test('estimate: array bytes multiplies length by per-element', () => {
  const arr = [{}, {}, {}, {}, {}];
  assert.equal(estimateArrayBytes(arr, 80), 400);
});

test('estimate: array null/undefined returns 0', () => {
  assert.equal(estimateArrayBytes(null, 100), 0);
  assert.equal(estimateArrayBytes(undefined, 100), 0);
});

test('estimate: object bytes counts properties', () => {
  const o = { a: 1, b: 2, c: 3, d: 4 };
  assert.equal(estimateObjectBytes(o), 128);
});

test('estimate: object bytes with custom per-property', () => {
  assert.equal(estimateObjectBytes({ x: 1, y: 2 }, 50), 100);
});

// ---------- MemoryBudget ----------

test('budget: starts empty', () => {
  const mb = MemoryBudget.create();
  assert.deepEqual(mb.sources_(), []);
  assert.equal(mb.totalBytes(), 0);
  assert.equal(mb.report().sourceCount, 0);
});

test('budget: register adds a source', () => {
  const mb = MemoryBudget.create();
  const src: IMemorySource = { estimateBytes: () => 1024 };
  mb.register('transforms', src);
  assert.equal(mb.has('transforms'), true);
  assert.equal(mb.getBytes('transforms'), 1024);
  assert.equal(mb.totalBytes(), 1024);
});

test('budget: register replaces in place + preserves insertion order', () => {
  const mb = MemoryBudget.create();
  mb.register('a', { estimateBytes: () => 100 });
  mb.register('b', { estimateBytes: () => 200 });
  mb.register('a', { estimateBytes: () => 999 }); // overwrite
  const rep = mb.report();
  assert.equal(rep.sourceCount, 2);
  assert.deepEqual(rep.bySource[0], { name: 'a', bytes: 999 });
  assert.deepEqual(rep.bySource[1], { name: 'b', bytes: 200 });
});

test('budget: unregister drops the source', () => {
  const mb = MemoryBudget.create();
  mb.register('a', { estimateBytes: () => 100 });
  assert.equal(mb.unregister('a'), true);
  assert.equal(mb.has('a'), false);
  assert.equal(mb.totalBytes(), 0);
});

test('budget: unregister missing returns false', () => {
  const mb = MemoryBudget.create();
  assert.equal(mb.unregister('nope'), false);
});

test('budget: getBytes for missing source returns 0', () => {
  const mb = MemoryBudget.create();
  assert.equal(mb.getBytes('missing'), 0);
});

test('budget: report sums every source in registration order', () => {
  const mb = MemoryBudget.create();
  mb.register('transforms', { estimateBytes: () => 1024 });
  mb.register('sprites',    { estimateBytes: () => 2048 });
  mb.register('particles',  { estimateBytes: () => 4096 });
  const rep = mb.report();
  assert.equal(rep.sourceCount, 3);
  assert.equal(rep.totalBytes, 7168);
  assert.deepEqual(rep.bySource.map((r) => r.name), ['transforms', 'sprites', 'particles']);
});

test('budget: report fires onReport callback synchronously', () => {
  let captured: { totalBytes: number } | null = null;
  const mb = MemoryBudget.create({
    onReport: (rep) => { captured = { totalBytes: rep.totalBytes }; },
  });
  mb.register('a', { estimateBytes: () => 500 });
  mb.report();
  assert.ok(captured !== null);
  assert.equal((captured as unknown as { totalBytes: number }).totalBytes, 500);
});

test('budget: throwing onReport callback does not break dispatch', () => {
  const mb = MemoryBudget.create({
    onReport: () => { throw new Error('boom'); },
  });
  mb.register('a', { estimateBytes: () => 100 });
  // Should not throw.
  const rep = mb.report();
  assert.equal(rep.totalBytes, 100);
});

test('budget: throwing estimator clamps to 0 in the report', () => {
  const mb = MemoryBudget.create();
  mb.register('bad', { estimateBytes: () => { throw new Error('boom'); } });
  mb.register('good', { estimateBytes: () => 500 });
  const rep = mb.report();
  assert.equal(rep.totalBytes, 500);
  // bad still listed, just with 0 bytes.
  assert.equal(rep.bySource.find((r) => r.name === 'bad')!.bytes, 0);
});

test('budget: NaN / negative / Infinity estimators clamp to 0', () => {
  const mb = MemoryBudget.create();
  mb.register('nan', { estimateBytes: () => NaN });
  mb.register('neg', { estimateBytes: () => -100 });
  mb.register('inf', { estimateBytes: () => Infinity });
  mb.register('ok',  { estimateBytes: () => 50 });
  const rep = mb.report();
  assert.equal(rep.totalBytes, 50);
});

test('budget: clear empties all sources', () => {
  const mb = MemoryBudget.create();
  mb.register('a', { estimateBytes: () => 100 });
  mb.register('b', { estimateBytes: () => 200 });
  mb.clear();
  assert.equal(mb.totalBytes(), 0);
  assert.deepEqual(mb.sources_(), []);
});

test('budget: dispose locks subsequent operations', () => {
  const mb = MemoryBudget.create();
  mb.register('a', { estimateBytes: () => 100 });
  mb.dispose();
  assert.equal(mb.totalBytes(), 0);
  // Subsequent register is a no-op.
  mb.register('b', { estimateBytes: () => 999 });
  assert.equal(mb.totalBytes(), 0);
});

test('budget: report is a fresh object each call', () => {
  const mb = MemoryBudget.create();
  mb.register('a', { estimateBytes: () => 100 });
  const r1 = mb.report();
  const r2 = mb.report();
  assert.notEqual(r1, r2);
  assert.deepEqual(r1.bySource, r2.bySource);
});

test('budget: typed-array source via helper', () => {
  const mb = MemoryBudget.create();
  const positions = new Float32Array(100); // 400 bytes
  const flags = new Uint8Array(100);       // 100 bytes
  mb.register('transforms', {
    estimateBytes: () => estimateTypedArrayBytes(positions, flags),
  });
  assert.equal(mb.getBytes('transforms'), 500);
});

test('budget: live source - bytes update as the underlying data changes', () => {
  const mb = MemoryBudget.create();
  const m = new Map<string, number>();
  mb.register('cache', { estimateBytes: () => estimateMapBytes(m) });
  assert.equal(mb.getBytes('cache'), 0);
  m.set('a', 1);
  m.set('b', 2);
  assert.equal(mb.getBytes('cache'), 192);
});

test('budget: estimator returning string is treated as 0', () => {
  const mb = MemoryBudget.create();
  // Cast deliberately to test the safety net.
  const bad: IMemorySource = { estimateBytes: () => ('abc' as unknown as number) };
  mb.register('weird', bad);
  assert.equal(mb.getBytes('weird'), 0);
});
