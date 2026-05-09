// BenchmarkHarness - performance baseline tracker.
//
// 1.0.0 CAPSTONE primitive - "we measure ourselves" milestone.
// Register named benchmarks, run them across warmup + measurement
// iterations, capture per-iteration timings, compute mean / median
// / p95, persist a baseline (via consumer-supplied storage), and
// detect regressions on subsequent runs against that baseline.
//
//   var bench = BenchmarkHarness.create({});
//   bench.register({
//     name: 'sort-1k',
//     fn: () => arr.slice().sort((a, b) => a - b),
//     warmup: 2,
//     iterations: 50,
//   });
//   var result = bench.run('sort-1k');
//   bench.setBaseline('sort-1k', result);
//
//   // Later, after a refactor:
//   var newResult = bench.run('sort-1k');
//   var regr = bench.detectRegression(newResult);
//   if (regr.isRegression) console.warn(regr.name + ' is ' +
//                                       regr.ratio + 'x slower');
//
// Engine ships zero benchmarks - the consumer registers what they
// care about. The harness is the timing + persistence + comparison
// machinery only.
//
// Sync-only at 1.0. Async benchmarks will be added in 1.x without
// breaking compat.
//
// Code style: var-only in browser source.
const DEFAULT_WARMUP = 1;
const DEFAULT_ITERATIONS = 10;
const DEFAULT_REGRESSION_THRESHOLD = 1.2;
function defaultNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
function computeStats(durations) {
    if (durations.length === 0) {
        return { meanMs: 0, medianMs: 0, minMs: 0, maxMs: 0, p95Ms: 0, totalMs: 0 };
    }
    var total = 0;
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < durations.length; i++) {
        var d = durations[i];
        total += d;
        if (d < min)
            min = d;
        if (d > max)
            max = d;
    }
    var sorted = durations.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var medianIdx = Math.floor(n / 2);
    var medianMs;
    if (n % 2 === 0 && n >= 2) {
        medianMs = (sorted[medianIdx - 1] + sorted[medianIdx]) / 2;
    }
    else {
        medianMs = sorted[medianIdx];
    }
    // p95: index = ceil(0.95 * n) - 1, clamped to last index.
    var p95Idx = Math.max(0, Math.min(n - 1, Math.ceil(0.95 * n) - 1));
    var p95Ms = sorted[p95Idx];
    return {
        meanMs: total / n,
        medianMs: medianMs,
        minMs: min,
        maxMs: max,
        p95Ms: p95Ms,
        totalMs: total,
    };
}
export class BenchmarkHarness {
    specs = new Map();
    baselines = new Map();
    nowMs;
    defaultWarmup;
    defaultIterations;
    storage;
    regressionThreshold;
    disposed = false;
    constructor(opts) {
        this.nowMs = opts.now ?? defaultNowMs;
        this.defaultWarmup = opts.defaultWarmup !== undefined
            && isFinite(opts.defaultWarmup) && opts.defaultWarmup >= 0
            ? Math.floor(opts.defaultWarmup) : DEFAULT_WARMUP;
        this.defaultIterations = opts.defaultIterations !== undefined
            && isFinite(opts.defaultIterations) && opts.defaultIterations > 0
            ? Math.floor(opts.defaultIterations) : DEFAULT_ITERATIONS;
        this.storage = opts.storage ?? null;
        this.regressionThreshold = opts.regressionThreshold !== undefined
            && isFinite(opts.regressionThreshold) && opts.regressionThreshold > 1
            ? opts.regressionThreshold : DEFAULT_REGRESSION_THRESHOLD;
    }
    static create(opts = {}) {
        return new BenchmarkHarness(opts);
    }
    // Register a benchmark. Replaces any prior spec at the same name.
    // Returns true if accepted, false if rejected (disposed, invalid
    // name / fn).
    register(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.name !== 'string' || spec.name.length === 0)
            return false;
        if (typeof spec.fn !== 'function')
            return false;
        var warmup = spec.warmup !== undefined && isFinite(spec.warmup) && spec.warmup >= 0
            ? Math.floor(spec.warmup) : this.defaultWarmup;
        var iterations = spec.iterations !== undefined && isFinite(spec.iterations)
            && spec.iterations > 0
            ? Math.floor(spec.iterations) : this.defaultIterations;
        var internal = {
            name: spec.name,
            fn: spec.fn,
            warmupCount: warmup,
            iterationCount: iterations,
        };
        if (spec.beforeEach !== undefined)
            internal.beforeEach = spec.beforeEach;
        if (spec.afterEach !== undefined)
            internal.afterEach = spec.afterEach;
        this.specs.set(spec.name, internal);
        return true;
    }
    unregister(name) {
        if (this.disposed)
            return false;
        return this.specs.delete(name);
    }
    has(name) {
        return this.specs.has(name);
    }
    list() {
        var out = [];
        var keys = this.specs.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    // Run a single benchmark by name. Throws if name is not
    // registered (registers fail silently, but run requires a real
    // benchmark to do anything meaningful).
    run(name) {
        if (this.disposed)
            throw new Error('BenchmarkHarness disposed');
        var spec = this.specs.get(name);
        if (!spec)
            throw new Error('benchmark not registered: ' + name);
        return this.runSpec(spec);
    }
    // Run every registered benchmark in registration order.
    runAll() {
        if (this.disposed)
            return [];
        var results = [];
        var keys = this.specs.keys();
        var k = keys.next();
        while (!k.done) {
            var spec = this.specs.get(k.value);
            if (spec)
                results.push(this.runSpec(spec));
            k = keys.next();
        }
        return results;
    }
    setBaseline(name, source) {
        if (this.disposed)
            return false;
        if (typeof name !== 'string' || name.length === 0)
            return false;
        if (!source)
            return false;
        var baseline = {
            name: name,
            meanMs: source.meanMs,
            medianMs: source.medianMs,
            p95Ms: source.p95Ms,
            iterations: source.iterations,
            recordedAt: source.recordedAt !== undefined ? source.recordedAt : this.nowMs(),
        };
        this.baselines.set(name, baseline);
        return true;
    }
    getBaseline(name) {
        var b = this.baselines.get(name);
        return b ? { ...b } : null;
    }
    hasBaseline(name) {
        return this.baselines.has(name);
    }
    clearBaseline(name) {
        if (this.disposed)
            return false;
        return this.baselines.delete(name);
    }
    // Persist all current baselines via the storage adapter. No-op
    // if no storage was configured.
    saveBaselines() {
        if (this.disposed || !this.storage)
            return false;
        var map = {};
        var keys = this.baselines.keys();
        var k = keys.next();
        while (!k.done) {
            var name = k.value;
            var b = this.baselines.get(name);
            if (b)
                map[name] = { ...b };
            k = keys.next();
        }
        try {
            this.storage.saveAll(map);
            return true;
        }
        catch {
            return false;
        }
    }
    // Load baselines via the storage adapter, replacing any in-memory
    // baselines for the loaded names. Other in-memory baselines remain
    // untouched. No-op if no storage was configured.
    loadBaselines() {
        if (this.disposed || !this.storage)
            return false;
        var map;
        try {
            map = this.storage.loadAll() || {};
        }
        catch {
            return false;
        }
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i++) {
            var name = keys[i];
            var b = map[name];
            if (b)
                this.baselines.set(name, { ...b });
        }
        return true;
    }
    // Compare a result against the stored baseline. With no baseline,
    // ratio is NaN and isRegression is false (no comparison possible).
    detectRegression(result, threshold) {
        var t = threshold !== undefined && isFinite(threshold) && threshold > 1
            ? threshold : this.regressionThreshold;
        var baseline = this.getBaseline(result.name);
        if (!baseline || baseline.medianMs <= 0) {
            return {
                name: result.name,
                baseline: baseline,
                current: result,
                ratio: NaN,
                isRegression: false,
                threshold: t,
            };
        }
        var ratio = result.medianMs / baseline.medianMs;
        return {
            name: result.name,
            baseline: baseline,
            current: result,
            ratio: ratio,
            isRegression: ratio > t,
            threshold: t,
        };
    }
    dispose() {
        this.specs.clear();
        this.baselines.clear();
        this.storage = null;
        this.disposed = true;
    }
    // ---------- private ----------
    runSpec(spec) {
        // Warm-up: invoke fn N times outside the measurement window.
        for (var w = 0; w < spec.warmupCount; w++) {
            this.invokeOnce(spec, false);
        }
        var durations = [];
        var errorCount = 0;
        for (var i = 0; i < spec.iterationCount; i++) {
            var iter = this.invokeOnce(spec, true);
            durations.push(iter.durationMs);
            if (iter.threw)
                errorCount++;
        }
        var stats = computeStats(durations);
        return {
            name: spec.name,
            iterations: spec.iterationCount,
            durations: durations,
            meanMs: stats.meanMs,
            medianMs: stats.medianMs,
            minMs: stats.minMs,
            maxMs: stats.maxMs,
            p95Ms: stats.p95Ms,
            totalMs: stats.totalMs,
            errorCount: errorCount,
            recordedAt: this.nowMs(),
        };
    }
    invokeOnce(spec, measure) {
        if (spec.beforeEach) {
            try {
                spec.beforeEach();
            }
            catch { /* tolerated */ }
        }
        var start = measure ? this.nowMs() : 0;
        var threw = false;
        try {
            spec.fn();
        }
        catch {
            threw = true;
        }
        var end = measure ? this.nowMs() : 0;
        if (spec.afterEach) {
            try {
                spec.afterEach();
            }
            catch { /* tolerated */ }
        }
        return { durationMs: measure ? end - start : 0, threw: threw };
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_BENCHMARK_HARNESS = 'benchmark_harness';
//# sourceMappingURL=benchmark-harness.js.map