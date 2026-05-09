// Reactivity - small Signal / Computed / Effect primitive system.
//
// 0.77.0 enabling primitive. HUD bindings, derived stats, "live"
// inspector views, autosave-on-dirty all share a need: read a value,
// derive something from it, run a side effect when it changes.
// Doing this by hand with subscribe / unsubscribe lists is tedious
// and bug-prone (stale closures, missing unsubscribes, recompute
// loops). Reactivity owns the dependency tracking automatically:
// reading a Signal / Computed inside an Effect or Computed registers
// it as a dependency, and writes propagate to all dependents.
//
//   var rx = Reactivity.create();
//   var hp = rx.signal(100);
//   var max = rx.signal(100);
//   var pct = rx.computed(() => hp.get() / max.get());
//   var disposeEffect = rx.effect(() => {
//     hud.update('hp-bar', pct.get());
//   });
//   hp.set(75); // recomputes pct + reruns the effect
//
// Batching: multiple writes inside `rx.batch(...)` coalesce into a
// single re-evaluation pass at the end. Reads inside `rx.untrack(...)`
// don't register as dependencies (escape hatch for "side-channel"
// reads).
//
// Implementation: simple eager push. Signals + Computeds keep a Set
// of observers. On Signal.set, observers re-run; Computeds notify
// their own observers when their value changes. Cycle / re-entrancy
// guard caps flush at 1000 iterations.
//
// Code style: var-only in browser source.
const DEFAULT_EQUALS = Object.is;
export class Reactivity {
    trackStack = [];
    untrackDepth = 0;
    pending = new Set();
    batchDepth = 0;
    equals;
    allObservers = new Set();
    disposed = false;
    constructor(opts) {
        this.equals = opts.equals ?? DEFAULT_EQUALS;
    }
    static create(opts = {}) {
        return new Reactivity(opts);
    }
    signal(initial) {
        var rx = this;
        var value = initial;
        var source = { observers: new Set() };
        return {
            get() {
                rx.subscribeCurrent(source);
                return value;
            },
            peek() {
                return value;
            },
            set(next) {
                if (rx.disposed) {
                    value = next;
                    return;
                }
                if (rx.equals(value, next))
                    return;
                value = next;
                rx.notifyAll(source);
            },
        };
    }
    computed(fn) {
        var rx = this;
        var source = { observers: new Set() };
        var value = undefined;
        var hasRun = false;
        var observer = {
            disposed: false,
            deps: new Set(),
            rerun: function () {
                if (this.disposed)
                    return;
                // Detach from old deps.
                this.deps.forEach((d) => d.observers.delete(this));
                this.deps.clear();
                var prev = value;
                rx.trackStack.push(this);
                try {
                    value = fn();
                }
                catch {
                    // Body threw - keep prior value.
                }
                finally {
                    rx.trackStack.pop();
                }
                if (!hasRun) {
                    hasRun = true;
                    return;
                }
                if (!rx.equals(prev, value)) {
                    rx.notifyAll(source);
                }
            },
        };
        rx.allObservers.add(observer);
        observer.rerun();
        return {
            get() {
                rx.subscribeCurrent(source);
                return value;
            },
            peek() { return value; },
            dispose() {
                if (observer.disposed)
                    return;
                observer.disposed = true;
                observer.deps.forEach((d) => d.observers.delete(observer));
                observer.deps.clear();
                rx.allObservers.delete(observer);
            },
        };
    }
    effect(fn) {
        var rx = this;
        var observer = {
            disposed: false,
            deps: new Set(),
            rerun: function () {
                if (this.disposed)
                    return;
                this.deps.forEach((d) => d.observers.delete(this));
                this.deps.clear();
                rx.trackStack.push(this);
                try {
                    fn();
                }
                catch {
                    // Best-effort.
                }
                finally {
                    rx.trackStack.pop();
                }
            },
        };
        rx.allObservers.add(observer);
        observer.rerun();
        return {
            dispose() {
                if (observer.disposed)
                    return;
                observer.disposed = true;
                observer.deps.forEach((d) => d.observers.delete(observer));
                observer.deps.clear();
                rx.allObservers.delete(observer);
            },
            isDisposed() { return observer.disposed; },
        };
    }
    // Batch: signal sets inside the callback queue notifications;
    // queued observers fire ONCE at the end of the outer batch.
    batch(fn) {
        this.batchDepth += 1;
        try {
            return fn();
        }
        finally {
            this.batchDepth -= 1;
            if (this.batchDepth === 0)
                this.flush();
        }
    }
    // Untrack: reads inside the callback don't subscribe.
    untrack(fn) {
        this.untrackDepth += 1;
        try {
            return fn();
        }
        finally {
            this.untrackDepth -= 1;
        }
    }
    // Drop the entire reactive graph.
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.allObservers.forEach((o) => {
            o.disposed = true;
            o.deps.forEach((d) => d.observers.delete(o));
            o.deps.clear();
        });
        this.allObservers.clear();
        this.pending.clear();
        this.trackStack = [];
    }
    // ---------- private ----------
    subscribeCurrent(source) {
        if (this.untrackDepth > 0)
            return;
        if (this.trackStack.length === 0)
            return;
        var top = this.trackStack[this.trackStack.length - 1];
        if (top.disposed)
            return;
        source.observers.add(top);
        top.deps.add(source);
    }
    notifyAll(source) {
        var snapshot = [];
        source.observers.forEach((o) => { if (!o.disposed)
            snapshot.push(o); });
        for (var i = 0; i < snapshot.length; i++) {
            this.queueRerun(snapshot[i]);
        }
    }
    queueRerun(observer) {
        this.pending.add(observer);
        if (this.batchDepth > 0)
            return;
        this.flush();
    }
    flush() {
        var iter = 0;
        while (this.pending.size > 0 && iter < 1000) {
            iter += 1;
            var batch = [];
            this.pending.forEach((o) => batch.push(o));
            this.pending.clear();
            for (var i = 0; i < batch.length; i++) {
                var o = batch[i];
                if (o.disposed)
                    continue;
                try {
                    o.rerun();
                }
                catch { /* ignore */ }
            }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_REACTIVITY = 'reactivity';
//# sourceMappingURL=reactivity.js.map