// MemoryBudget - per-pool / per-resource memory size estimator.
//
// 0.42.0 enabling primitive. Component pools (TransformPool,
// SpritePool, ParticlePool, etc.) own Float32Arrays that take real
// memory; ObjectPool (0.32.0) owns plain objects. As scenes grow,
// knowing roughly where the memory lives is useful for: a debug
// HUD line, a hot-loop "are we leaking?" check, mobile-budget
// warnings, comparing two builds.
//
// MemoryBudget is a thin registry: consumers register named sources
// that implement `IMemorySource.estimateBytes()`, and the manager
// produces a snapshot report with per-source bytes + total. The
// engine ships estimator helpers for the common cases (TypedArray,
// Map, ObjectPool, plain object) so consumers don't have to write
// the same byte-counting boilerplate.
//
// The estimates are deliberately HEURISTIC. JavaScript engines do
// not expose object size; what we report are typed-array
// byteLengths plus rough constants for managed objects (which V8 /
// SpiderMonkey allocate at varying granularity). The numbers are
// "order-of-magnitude correct," not exact - good enough for budget
// decisions, not good enough for dashboarding to MB precision.
//
// Code style: var-only in browser source.
export class MemoryBudget {
    sources = new Map();
    order = [];
    onReport;
    disposed = false;
    constructor(opts) {
        this.onReport = opts.onReport ?? null;
    }
    static create(opts = {}) {
        return new MemoryBudget(opts);
    }
    // Register or replace a memory source under `name`. Re-registering
    // an existing name overwrites in place (preserves insertion order).
    register(name, source) {
        if (this.disposed)
            return;
        var key = String(name);
        if (!this.sources.has(key))
            this.order.push(key);
        this.sources.set(key, source);
    }
    unregister(name) {
        if (this.disposed)
            return false;
        var key = String(name);
        var existed = this.sources.delete(key);
        if (existed) {
            var idx = this.order.indexOf(key);
            if (idx >= 0)
                this.order.splice(idx, 1);
        }
        return existed;
    }
    has(name) {
        return this.sources.has(String(name));
    }
    sources_() {
        return this.order.slice();
    }
    // Returns bytes for a single named source. 0 if missing or if the
    // estimator returned NaN / negative / non-finite.
    getBytes(name) {
        var src = this.sources.get(String(name));
        if (!src)
            return 0;
        return safeBytes(src);
    }
    // Sum across every registered source.
    totalBytes() {
        if (this.disposed)
            return 0;
        var total = 0;
        for (var i = 0; i < this.order.length; i++) {
            var src = this.sources.get(this.order[i]);
            if (src)
                total += safeBytes(src);
        }
        return total;
    }
    // Build a fresh report. If onReport is registered, fires the
    // callback synchronously after the report is built.
    report() {
        var bySource = [];
        var total = 0;
        if (!this.disposed) {
            for (var i = 0; i < this.order.length; i++) {
                var key = this.order[i];
                var src = this.sources.get(key);
                if (!src)
                    continue;
                var b = safeBytes(src);
                bySource.push({ name: key, bytes: b });
                total += b;
            }
        }
        var rep = {
            bySource: bySource,
            totalBytes: total,
            sourceCount: bySource.length,
        };
        if (this.onReport) {
            try {
                this.onReport(rep);
            }
            catch {
                // Best-effort: a misbehaving callback never takes down the
                // budget tracker.
            }
        }
        return rep;
    }
    clear() {
        if (this.disposed)
            return;
        this.sources.clear();
        this.order.length = 0;
    }
    dispose() {
        this.sources.clear();
        this.order.length = 0;
        this.onReport = null;
        this.disposed = true;
    }
}
function safeBytes(src) {
    var v;
    try {
        v = src.estimateBytes();
    }
    catch {
        return 0;
    }
    if (typeof v !== 'number' || !isFinite(v) || v < 0)
        return 0;
    return v;
}
// ---------- Estimator helpers ----------
//
// Common shapes you can drop straight into a memorySource:
//   { estimateBytes: () => estimateTypedArrayBytes(pool.x, pool.y, pool.z) }
//
// They're plain functions so they tree-shake cleanly.
// Typed-array byte length sum. ArrayBufferViews report exact bytes
// regardless of underlying type (Float32Array, Uint8Array, etc.).
export function estimateTypedArrayBytes(...arrs) {
    var total = 0;
    for (var i = 0; i < arrs.length; i++) {
        var a = arrs[i];
        if (a && typeof a.byteLength === 'number')
            total += a.byteLength;
    }
    return total;
}
// Map<K, V> heuristic: 64 bytes overhead per entry on V8 (key+value
// pointers + hash table slot + pointer to next bucket on collision).
// Plus the user's per-key + per-value bytes.
//
// For Map<string, number>, default is 64 + 32 (string slot) + 8
// (number) = ~104 bytes / entry. The default tuning here uses 96
// bytes / entry for small string keys + scalar values.
export function estimateMapBytes(map, perEntryBytes = 96) {
    if (!map)
        return 0;
    return map.size * perEntryBytes;
}
// Set<T>: roughly half the per-entry cost of Map (no separate
// value slot). Default 64 bytes / entry.
export function estimateSetBytes(set, perEntryBytes = 64) {
    if (!set)
        return 0;
    return set.size * perEntryBytes;
}
// Flat array of plain objects. Caller supplies the per-element
// estimate; we multiply by length. Useful for ObjectPool when you
// know a rough per-object size (e.g. floating-text slot ~80 bytes,
// damage-event ~64 bytes).
export function estimateArrayBytes(arr, perElementBytes) {
    if (!arr)
        return 0;
    return arr.length * perElementBytes;
}
// Plain-object property count heuristic: 32 bytes per property slot
// on V8 (hidden class transition + pointer). Use sparingly - for
// most engine pools the typed-array path is more accurate.
export function estimateObjectBytes(obj, perPropertyBytes = 32) {
    if (!obj)
        return 0;
    return Object.keys(obj).length * perPropertyBytes;
}
// Resource key for the world's resource registry.
export const RESOURCE_MEMORY_BUDGET = 'memory_budget';
//# sourceMappingURL=memory-budget.js.map