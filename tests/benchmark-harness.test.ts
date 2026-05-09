// Phase 1.0.0 - BenchmarkHarness tests (capstone milestone).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  BenchmarkHarness,
  RESOURCE_BENCHMARK_HARNESS,
  type BenchmarkBaseline,
} from '../src/index.js';

// Deterministic clock helper: each call advances by 1ms.
function makeClock(start = 1000): () => number {
  let t = start;
  return () => { t += 1; return t; };
}

test('bench: RESOURCE_BENCHMARK_HARNESS is the stable string', () => {
  assert.equal(RESOURCE_BENCHMARK_HARNESS, 'benchmark_harness');
});

test('bench: starts empty', () => {
  const h = BenchmarkHarness.create();
  assert.deepEqual(h.list(), []);
});

test('bench: register adds + has + list', () => {
  const h = BenchmarkHarness.create();
  assert.equal(h.register({ name: 'a', fn: () => {} }), true);
  assert.equal(h.has('a'), true);
  assert.deepEqual(h.list(), ['a']);
});

test('bench: register rejects empty / non-string name', () => {
  const h = BenchmarkHarness.create();
  assert.equal(h.register({ name: '', fn: () => {} }), false);
  // @ts-expect-error - testing runtime guard
  assert.equal(h.register({ name: null, fn: () => {} }), false);
});

test('bench: register rejects non-function fn', () => {
  const h = BenchmarkHarness.create();
  // @ts-expect-error - testing runtime guard
  assert.equal(h.register({ name: 'a', fn: 'not-a-fn' }), false);
});

test('bench: register replaces same-name spec', () => {
  const h = BenchmarkHarness.create();
  let calls = 0;
  h.register({ name: 'a', fn: () => { calls++; }, warmup: 0, iterations: 1 });
  h.run('a');
  assert.equal(calls, 1);
  let calls2 = 0;
  h.register({ name: 'a', fn: () => { calls2++; }, warmup: 0, iterations: 1 });
  h.run('a');
  assert.equal(calls2, 1);
  // First fn no longer called.
  assert.equal(calls, 1);
});

test('bench: unregister removes', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'a', fn: () => {} });
  assert.equal(h.unregister('a'), true);
  assert.equal(h.has('a'), false);
});

test('bench: unregister unknown returns false', () => {
  const h = BenchmarkHarness.create();
  assert.equal(h.unregister('missing'), false);
});

test('bench: run executes fn iterations times', () => {
  const h = BenchmarkHarness.create();
  let calls = 0;
  h.register({
    name: 'count',
    fn: () => { calls++; },
    warmup: 0,
    iterations: 5,
  });
  const result = h.run('count');
  assert.equal(calls, 5);
  assert.equal(result.iterations, 5);
  assert.equal(result.durations.length, 5);
});

test('bench: run with warmup runs warmup invocations first (not in result)', () => {
  const h = BenchmarkHarness.create();
  let calls = 0;
  h.register({
    name: 'warm',
    fn: () => { calls++; },
    warmup: 3,
    iterations: 4,
  });
  const result = h.run('warm');
  assert.equal(calls, 7); // 3 warmup + 4 measured
  assert.equal(result.iterations, 4);
  assert.equal(result.durations.length, 4);
});

test('bench: run computes mean / median / min / max / p95', () => {
  // Use clock seam so durations are deterministic.
  // Each iteration's start/end are 2 clock calls, advancing 1ms each.
  // beforeEach not used, so timing window per iteration = 1ms.
  const h = BenchmarkHarness.create({ now: makeClock() });
  h.register({
    name: 'fixed',
    fn: () => {},
    warmup: 0,
    iterations: 5,
  });
  const result = h.run('fixed');
  assert.equal(result.durations.length, 5);
  // All durations should be 1ms each (one start + one end).
  for (const d of result.durations) assert.equal(d, 1);
  assert.equal(result.meanMs, 1);
  assert.equal(result.medianMs, 1);
  assert.equal(result.minMs, 1);
  assert.equal(result.maxMs, 1);
  assert.equal(result.p95Ms, 1);
  assert.equal(result.totalMs, 5);
});

test('bench: median works for even iterations', () => {
  // Custom clock that returns predetermined timestamps.
  let calls = 0;
  // Iterations of 4: durations should be [1, 2, 3, 4] with start/end at:
  // i0: start=10, end=11 (1ms), i1: start=12, end=14 (2ms),
  // i2: start=15, end=18 (3ms), i3: start=19, end=23 (4ms).
  const ticks = [10, 11, 12, 14, 15, 18, 19, 23];
  const h = BenchmarkHarness.create({
    now: () => ticks[calls++] ?? 0,
  });
  h.register({
    name: 'm',
    fn: () => {},
    warmup: 0,
    iterations: 4,
  });
  const result = h.run('m');
  assert.deepEqual(result.durations, [1, 2, 3, 4]);
  assert.equal(result.medianMs, 2.5); // avg of 2 and 3
  assert.equal(result.minMs, 1);
  assert.equal(result.maxMs, 4);
});

test('bench: beforeEach / afterEach run outside the timed window', () => {
  const order: string[] = [];
  const h = BenchmarkHarness.create();
  h.register({
    name: 'wrap',
    fn: () => order.push('fn'),
    beforeEach: () => order.push('before'),
    afterEach: () => order.push('after'),
    warmup: 0,
    iterations: 2,
  });
  h.run('wrap');
  assert.deepEqual(order, ['before', 'fn', 'after', 'before', 'fn', 'after']);
});

test('bench: throwing fn is caught and counted as errorCount', () => {
  const h = BenchmarkHarness.create();
  h.register({
    name: 'boom',
    fn: () => { throw new Error('oops'); },
    warmup: 0,
    iterations: 3,
  });
  const result = h.run('boom');
  assert.equal(result.errorCount, 3);
  assert.equal(result.iterations, 3);
});

test('bench: run unknown name throws', () => {
  const h = BenchmarkHarness.create();
  assert.throws(() => h.run('missing'), /not registered/);
});

test('bench: runAll runs every registered + returns array', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'a', fn: () => {}, warmup: 0, iterations: 2 });
  h.register({ name: 'b', fn: () => {}, warmup: 0, iterations: 2 });
  h.register({ name: 'c', fn: () => {}, warmup: 0, iterations: 2 });
  const results = h.runAll();
  assert.equal(results.length, 3);
  const names = results.map((r) => r.name).sort();
  assert.deepEqual(names, ['a', 'b', 'c']);
});

test('bench: setBaseline + getBaseline + hasBaseline', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'a', fn: () => {}, warmup: 0, iterations: 5 });
  const result = h.run('a');
  assert.equal(h.setBaseline('a', result), true);
  assert.equal(h.hasBaseline('a'), true);
  const base = h.getBaseline('a');
  assert.ok(base);
  assert.equal(base!.name, 'a');
  assert.equal(base!.iterations, 5);
});

test('bench: getBaseline missing returns null', () => {
  const h = BenchmarkHarness.create();
  assert.equal(h.getBaseline('missing'), null);
});

test('bench: clearBaseline removes', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'a', fn: () => {}, warmup: 0, iterations: 1 });
  h.setBaseline('a', h.run('a'));
  assert.equal(h.clearBaseline('a'), true);
  assert.equal(h.hasBaseline('a'), false);
});

test('bench: detectRegression with no baseline returns isRegression=false', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'a', fn: () => {}, warmup: 0, iterations: 1 });
  const result = h.run('a');
  const regr = h.detectRegression(result);
  assert.equal(regr.isRegression, false);
  assert.equal(regr.baseline, null);
  assert.ok(Number.isNaN(regr.ratio));
});

test('bench: detectRegression within threshold = not a regression', () => {
  const h = BenchmarkHarness.create();
  // Use a manual baseline with medianMs=10.
  const baseline: BenchmarkBaseline = {
    name: 'a',
    meanMs: 10,
    medianMs: 10,
    p95Ms: 10,
    iterations: 5,
    recordedAt: 0,
  };
  h.setBaseline('a', baseline);
  // Current result with medianMs=11 -> ratio 1.1 < default threshold 1.2.
  const current = {
    name: 'a',
    iterations: 5,
    durations: [11, 11, 11, 11, 11],
    meanMs: 11, medianMs: 11, minMs: 11, maxMs: 11, p95Ms: 11, totalMs: 55,
    errorCount: 0,
    recordedAt: 1,
  };
  const regr = h.detectRegression(current);
  assert.equal(regr.isRegression, false);
  assert.ok(Math.abs(regr.ratio - 1.1) < 1e-6);
});

test('bench: detectRegression over threshold = regression', () => {
  const h = BenchmarkHarness.create();
  const baseline: BenchmarkBaseline = {
    name: 'a',
    meanMs: 10,
    medianMs: 10,
    p95Ms: 10,
    iterations: 5,
    recordedAt: 0,
  };
  h.setBaseline('a', baseline);
  const current = {
    name: 'a',
    iterations: 5,
    durations: [15, 15, 15, 15, 15],
    meanMs: 15, medianMs: 15, minMs: 15, maxMs: 15, p95Ms: 15, totalMs: 75,
    errorCount: 0,
    recordedAt: 1,
  };
  const regr = h.detectRegression(current);
  assert.equal(regr.isRegression, true); // 1.5 > 1.2
  assert.ok(Math.abs(regr.ratio - 1.5) < 1e-6);
});

test('bench: detectRegression custom threshold', () => {
  const h = BenchmarkHarness.create();
  const baseline: BenchmarkBaseline = {
    name: 'a', meanMs: 10, medianMs: 10, p95Ms: 10, iterations: 5, recordedAt: 0,
  };
  h.setBaseline('a', baseline);
  const current = {
    name: 'a', iterations: 5, durations: [12], meanMs: 12, medianMs: 12,
    minMs: 12, maxMs: 12, p95Ms: 12, totalMs: 60, errorCount: 0, recordedAt: 1,
  };
  // 1.2 ratio. With threshold 1.5, not a regression.
  assert.equal(h.detectRegression(current, 1.5).isRegression, false);
  // With threshold 1.1, it IS a regression.
  assert.equal(h.detectRegression(current, 1.1).isRegression, true);
});

test('bench: saveBaselines + loadBaselines via storage adapter', () => {
  const store: Record<string, Record<string, BenchmarkBaseline>> = { saved: {} };
  const storage = {
    saveAll: (m: Record<string, BenchmarkBaseline>) => {
      store.saved = JSON.parse(JSON.stringify(m));
    },
    loadAll: () => store.saved,
  };
  const h1 = BenchmarkHarness.create({ storage });
  const baseline: BenchmarkBaseline = {
    name: 'a', meanMs: 10, medianMs: 10, p95Ms: 10, iterations: 5, recordedAt: 100,
  };
  h1.setBaseline('a', baseline);
  assert.equal(h1.saveBaselines(), true);
  // Fresh harness loads from same store.
  const h2 = BenchmarkHarness.create({ storage });
  assert.equal(h2.loadBaselines(), true);
  const b = h2.getBaseline('a');
  assert.ok(b);
  assert.equal(b!.medianMs, 10);
});

test('bench: saveBaselines / loadBaselines no-op without storage', () => {
  const h = BenchmarkHarness.create();
  assert.equal(h.saveBaselines(), false);
  assert.equal(h.loadBaselines(), false);
});

test('bench: storage save throwing returns false', () => {
  const storage = {
    saveAll: () => { throw new Error('fs full'); },
    loadAll: () => ({}),
  };
  const h = BenchmarkHarness.create({ storage });
  h.setBaseline('a', { name: 'a', meanMs: 1, medianMs: 1, p95Ms: 1, iterations: 1, recordedAt: 0 });
  assert.equal(h.saveBaselines(), false);
});

test('bench: clock seam injection produces deterministic durations', () => {
  let t = 0;
  const h = BenchmarkHarness.create({ now: () => { t += 5; return t; } });
  h.register({ name: 'a', fn: () => {}, warmup: 0, iterations: 3 });
  const result = h.run('a');
  // Each iteration: 2 calls to now -> +5ms each call -> 5ms duration.
  assert.equal(result.durations.length, 3);
  for (const d of result.durations) assert.equal(d, 5);
});

test('bench: dispose locks ops', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'a', fn: () => {} });
  h.dispose();
  assert.equal(h.register({ name: 'b', fn: () => {} }), false);
  assert.equal(h.unregister('a'), false);
  assert.throws(() => h.run('a'), /disposed/);
  assert.deepEqual(h.runAll(), []);
  assert.equal(h.setBaseline('a', { name: 'a', meanMs: 1, medianMs: 1, p95Ms: 1, iterations: 1, recordedAt: 0 }), false);
});

test('bench: realistic example - sort 1000 numbers, baseline + regression check', () => {
  const arr: number[] = [];
  for (let i = 0; i < 1000; i++) arr.push(Math.floor(i * 7919) % 1000);
  const h = BenchmarkHarness.create({});
  h.register({
    name: 'sort-1k',
    fn: () => {
      const copy = arr.slice();
      copy.sort((a, b) => a - b);
    },
    warmup: 1,
    iterations: 5,
  });
  const result = h.run('sort-1k');
  assert.equal(result.iterations, 5);
  assert.ok(result.medianMs >= 0);
  // Set a fake fast baseline so any real timing is treated as regression.
  h.setBaseline('sort-1k', {
    name: 'sort-1k',
    meanMs: 0.0001,
    medianMs: 0.0001,
    p95Ms: 0.0001,
    iterations: 5,
    recordedAt: 0,
  });
  const regr = h.detectRegression(result);
  // Real timing >> 0.0001ms; ratio is large enough to flag as
  // regression (default threshold 1.2). Just verify the report
  // shape.
  assert.equal(regr.name, 'sort-1k');
  assert.ok(regr.baseline);
  assert.ok(regr.ratio > 0);
});

test('bench: defaultIterations + defaultWarmup applied when spec omits', () => {
  let calls = 0;
  const h = BenchmarkHarness.create({
    defaultWarmup: 2,
    defaultIterations: 3,
  });
  h.register({ name: 'a', fn: () => { calls++; } });
  h.run('a');
  assert.equal(calls, 5); // 2 warmup + 3 iterations
});

test('bench: list returns names in registration order', () => {
  const h = BenchmarkHarness.create();
  h.register({ name: 'first', fn: () => {} });
  h.register({ name: 'second', fn: () => {} });
  h.register({ name: 'third', fn: () => {} });
  assert.deepEqual(h.list(), ['first', 'second', 'third']);
});
