// ObjectPool - generic reusable object pool.
//
// 0.32.0 enabling primitive. Allocating short-lived objects every
// frame (damage numbers, particles, projectiles, hit-flash overlays)
// creates GC pressure that surfaces as frame-rate hitches in the
// browser. ObjectPool lets a system pre-allocate N instances and
// reuse them: acquire() pops a free one, release() returns it.
//
// The pool is generic over any object type; the user supplies a
// factory and an optional reset function.
//
// Usage:
//   var pool = new ObjectPool({
//     factory: () => ({ x: 0, y: 0, life: 0 }),
//     reset: (p) => { p.x = 0; p.y = 0; p.life = 0; },
//     initialSize: 64,
//   });
//   var p = pool.acquire();
//   p.x = 100; p.y = 200; p.life = 1.0;
//   // ... use p
//   pool.release(p);
//
// Code style: var-only in browser source.
export class ObjectPool {
    factory;
    resetFn;
    maxSize;
    free = [];
    // Total instances ever allocated by this pool (free + currently in use).
    allocated = 0;
    // Diagnostic counters.
    acquireCount = 0;
    releaseCount = 0;
    capRejectCount = 0;
    constructor(opts) {
        if (typeof opts.factory !== 'function') {
            throw new Error('ObjectPool: factory function required');
        }
        this.factory = opts.factory;
        this.resetFn = opts.reset || null;
        this.maxSize = opts.maxSize !== undefined && opts.maxSize > 0
            ? (opts.maxSize | 0) : 0;
        var initial = opts.initialSize !== undefined && opts.initialSize > 0
            ? (opts.initialSize | 0) : 0;
        if (this.maxSize > 0 && initial > this.maxSize) {
            initial = this.maxSize;
        }
        for (var i = 0; i < initial; i++) {
            this.free.push(this.factory());
            this.allocated++;
        }
    }
    // Get an instance. Reuses a free one if available; otherwise
    // allocates a fresh one (unless the cap is hit, in which case
    // returns null).
    acquire() {
        this.acquireCount++;
        var existing = this.free.pop();
        if (existing !== undefined)
            return existing;
        if (this.maxSize > 0 && this.allocated >= this.maxSize) {
            this.capRejectCount++;
            return null;
        }
        var fresh = this.factory();
        this.allocated++;
        return fresh;
    }
    // Return an instance to the pool. Calls reset() if configured.
    // Idempotent: releasing the same object twice keeps it at one
    // copy in the free list (we don't dedupe but the cost is one
    // extra slot, not corruption).
    release(obj) {
        if (this.resetFn) {
            try {
                this.resetFn(obj);
            }
            catch (e) {
                try {
                    console.error('[ObjectPool] reset() threw:', e);
                }
                catch { /* ignore */ }
            }
        }
        this.free.push(obj);
        this.releaseCount++;
    }
    // How many free instances are immediately available without
    // allocation.
    freeCount() { return this.free.length; }
    // How many instances are currently checked out (acquired but not
    // yet released).
    inUseCount() {
        return this.allocated - this.free.length;
    }
    // Total ever allocated (free + in use).
    totalAllocated() { return this.allocated; }
    // Drop ALL instances (free list cleared, allocated counter reset).
    // Subsequent acquire() will allocate fresh from the factory.
    // Use case: zone change wipes a pool whose contents are scoped
    // to the prior zone.
    clear() {
        this.free.length = 0;
        this.allocated = 0;
    }
    // Pre-fill the free list with `count` more instances (capped by
    // maxSize). Useful for warming a pool before a known burst.
    warm(count) {
        var c = (count | 0);
        if (c <= 0)
            return 0;
        var added = 0;
        for (var i = 0; i < c; i++) {
            if (this.maxSize > 0 && this.allocated >= this.maxSize)
                break;
            this.free.push(this.factory());
            this.allocated++;
            added++;
        }
        return added;
    }
    // Diagnostic counters.
    stats() {
        return {
            free: this.free.length,
            inUse: this.inUseCount(),
            allocated: this.allocated,
            maxSize: this.maxSize,
            acquires: this.acquireCount,
            releases: this.releaseCount,
            capRejects: this.capRejectCount,
        };
    }
}
//# sourceMappingURL=object-pool.js.map