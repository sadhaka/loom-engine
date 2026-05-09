// ToastQueue - notification queue with severity + auto-dismiss.
//
// 0.65.0 enabling primitive. "+ 50 gold", "Boss spawned in Plaza",
// "Connection lost", "Quest accepted: Slay the Dragon" - every game
// surface notification follows the same shape: severity, message,
// optional payload, auto-dismiss timer, optional manual dismiss.
//
// ToastQueue is that machinery: post() pushes a notification with a
// severity tier and lifetime, tick(dt) ages active toasts, and the
// consumer reads forEach() / list() to render. Capacity-bounded so a
// flood of notifications doesn't grow unbounded.
//
// Code style: var-only in browser source.
const SEVERITY_RANK = {
    info: 0,
    success: 1,
    warn: 2,
    error: 3,
    critical: 4,
};
const DEFAULT_CAPACITY = 16;
const DEFAULT_LIFETIMES = {
    info: 3000,
    success: 3000,
    warn: 5000,
    error: 8000,
    critical: -1, // sticky
};
export class ToastQueue {
    toasts = [];
    nextId = 1;
    capacityNum;
    lifetimes;
    onPost;
    onRemoved;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
        this.lifetimes = { ...DEFAULT_LIFETIMES };
        if (opts.defaultLifetimeMs) {
            var keys = Object.keys(opts.defaultLifetimeMs);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                var v = opts.defaultLifetimeMs[k];
                if (v !== undefined)
                    this.lifetimes[k] = v;
            }
        }
        this.onPost = opts.onPost ?? null;
        this.onRemoved = opts.onRemoved ?? null;
    }
    static create(opts = {}) {
        return new ToastQueue(opts);
    }
    // Post a notification. Returns the toast id.
    post(severity, message, opts = {}) {
        if (this.disposed)
            return 0;
        if (typeof severity !== 'string' || !(severity in SEVERITY_RANK))
            return 0;
        var lifetime;
        if (opts.lifetimeMs !== undefined) {
            lifetime = opts.lifetimeMs < 0 ? -1 : Math.floor(opts.lifetimeMs);
        }
        else {
            lifetime = this.lifetimes[severity];
        }
        var id = this.nextId++;
        var t = {
            id: id,
            severity: severity,
            message: typeof message === 'string' ? message : String(message),
            remainingMs: lifetime,
            ageMs: 0,
        };
        if (opts.data !== undefined)
            t.data = opts.data;
        // Capacity check: evict lowest-severity oldest if over.
        if (this.toasts.length >= this.capacityNum) {
            this.evictOne();
        }
        this.toasts.push(t);
        if (this.onPost) {
            try {
                this.onPost(t);
            }
            catch { /* ignore */ }
        }
        return id;
    }
    // Severity helpers.
    info(msg, opts) { return this.post('info', msg, opts); }
    success(msg, opts) { return this.post('success', msg, opts); }
    warn(msg, opts) { return this.post('warn', msg, opts); }
    error(msg, opts) { return this.post('error', msg, opts); }
    critical(msg, opts) { return this.post('critical', msg, opts); }
    // Tick the queue. Each toast has remainingMs decremented; those
    // reaching <= 0 are auto-removed and onRemoved('expired') fires.
    // Sticky (remainingMs === -1) toasts only update ageMs.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var expired = [];
        var keep = [];
        for (var i = 0; i < this.toasts.length; i++) {
            var t = this.toasts[i];
            t.ageMs += dt;
            if (t.remainingMs >= 0) {
                t.remainingMs -= dt;
                if (t.remainingMs <= 0) {
                    expired.push(t);
                    continue;
                }
            }
            keep.push(t);
        }
        this.toasts = keep;
        if (this.onRemoved) {
            var cb = this.onRemoved;
            for (var j = 0; j < expired.length; j++) {
                try {
                    cb(expired[j], 'expired');
                }
                catch { /* ignore */ }
            }
        }
    }
    // Manually remove a toast. Returns true if found.
    dismiss(id) {
        if (this.disposed)
            return false;
        for (var i = 0; i < this.toasts.length; i++) {
            var t = this.toasts[i];
            if (t.id === id) {
                this.toasts.splice(i, 1);
                if (this.onRemoved) {
                    try {
                        this.onRemoved(t, 'dismissed');
                    }
                    catch { /* ignore */ }
                }
                return true;
            }
        }
        return false;
    }
    // Drop every toast.
    clear() {
        if (this.disposed)
            return;
        var toRemove = this.toasts.slice();
        this.toasts.length = 0;
        if (this.onRemoved) {
            var cb = this.onRemoved;
            for (var i = 0; i < toRemove.length; i++) {
                try {
                    cb(toRemove[i], 'dismissed');
                }
                catch { /* ignore */ }
            }
        }
    }
    // Iterate every active toast in post order (oldest first).
    forEach(cb) {
        if (this.disposed)
            return;
        for (var i = 0; i < this.toasts.length; i++) {
            try {
                cb(this.toasts[i]);
            }
            catch { /* ignore */ }
        }
    }
    // Defensive copy of the queue.
    list() {
        var out = [];
        for (var i = 0; i < this.toasts.length; i++) {
            var t = this.toasts[i];
            var copy = {
                id: t.id,
                severity: t.severity,
                message: t.message,
                remainingMs: t.remainingMs,
                ageMs: t.ageMs,
            };
            if (t.data !== undefined)
                copy.data = t.data;
            out.push(copy);
        }
        return out;
    }
    count() { return this.toasts.length; }
    capacity() { return this.capacityNum; }
    dispose() {
        this.toasts.length = 0;
        this.onPost = null;
        this.onRemoved = null;
        this.disposed = true;
    }
    // ---------- private ----------
    evictOne() {
        if (this.toasts.length === 0)
            return;
        // Find the oldest lowest-severity toast.
        var bestIdx = 0;
        var best = this.toasts[0];
        for (var i = 1; i < this.toasts.length; i++) {
            var cand = this.toasts[i];
            if (SEVERITY_RANK[cand.severity] < SEVERITY_RANK[best.severity]) {
                best = cand;
                bestIdx = i;
            }
        }
        this.toasts.splice(bestIdx, 1);
        if (this.onRemoved) {
            try {
                this.onRemoved(best, 'evicted');
            }
            catch { /* ignore */ }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_TOAST_QUEUE = 'toast_queue';
//# sourceMappingURL=toast-queue.js.map