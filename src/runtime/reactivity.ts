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

export interface Signal<T> {
  get(): T;
  set(value: T): void;
  // Read without registering a dependency.
  peek(): T;
}

export interface Computed<T> {
  get(): T;
  peek(): T;
  // Disconnect from dependencies; subsequent get() returns last
  // value but no longer recomputes.
  dispose(): void;
}

export interface EffectHandle {
  dispose(): void;
  isDisposed(): boolean;
}

export interface ReactivityOptions {
  // Equality function for change detection. Default Object.is.
  equals?: (a: unknown, b: unknown) => boolean;
}

interface Source {
  observers: Set<InternalObserver>;
}

interface InternalObserver {
  disposed: boolean;
  deps: Set<Source>;
  rerun(): void;
}

const DEFAULT_EQUALS: (a: unknown, b: unknown) => boolean = Object.is;

export class Reactivity {
  private trackStack: InternalObserver[] = [];
  private untrackDepth: number = 0;
  private pending: Set<InternalObserver> = new Set();
  private batchDepth: number = 0;
  private equals: (a: unknown, b: unknown) => boolean;
  private allObservers: Set<InternalObserver> = new Set();
  private disposed: boolean = false;

  private constructor(opts: ReactivityOptions) {
    this.equals = opts.equals ?? DEFAULT_EQUALS;
  }

  static create(opts: ReactivityOptions = {}): Reactivity {
    return new Reactivity(opts);
  }

  signal<T>(initial: T): Signal<T> {
    var rx = this;
    var value = initial;
    var source: Source = { observers: new Set() };
    return {
      get(): T {
        rx.subscribeCurrent(source);
        return value;
      },
      peek(): T {
        return value;
      },
      set(next: T): void {
        if (rx.disposed) {
          value = next;
          return;
        }
        if (rx.equals(value, next)) return;
        value = next;
        rx.notifyAll(source);
      },
    };
  }

  computed<T>(fn: () => T): Computed<T> {
    var rx = this;
    var source: Source = { observers: new Set() };
    var value: T = undefined as unknown as T;
    var hasRun = false;

    var observer: InternalObserver = {
      disposed: false,
      deps: new Set(),
      rerun: function (): void {
        if (this.disposed) return;
        // Detach from old deps.
        this.deps.forEach((d) => d.observers.delete(this));
        this.deps.clear();
        var prev = value;
        rx.trackStack.push(this);
        try {
          value = fn();
        } catch {
          // Body threw - keep prior value.
        } finally {
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
      get(): T {
        rx.subscribeCurrent(source);
        return value;
      },
      peek(): T { return value; },
      dispose(): void {
        if (observer.disposed) return;
        observer.disposed = true;
        observer.deps.forEach((d) => d.observers.delete(observer));
        observer.deps.clear();
        rx.allObservers.delete(observer);
      },
    };
  }

  effect(fn: () => void): EffectHandle {
    var rx = this;
    var observer: InternalObserver = {
      disposed: false,
      deps: new Set(),
      rerun: function (): void {
        if (this.disposed) return;
        this.deps.forEach((d) => d.observers.delete(this));
        this.deps.clear();
        rx.trackStack.push(this);
        try {
          fn();
        } catch {
          // Best-effort.
        } finally {
          rx.trackStack.pop();
        }
      },
    };
    rx.allObservers.add(observer);
    observer.rerun();

    return {
      dispose(): void {
        if (observer.disposed) return;
        observer.disposed = true;
        observer.deps.forEach((d) => d.observers.delete(observer));
        observer.deps.clear();
        rx.allObservers.delete(observer);
      },
      isDisposed(): boolean { return observer.disposed; },
    };
  }

  // Batch: signal sets inside the callback queue notifications;
  // queued observers fire ONCE at the end of the outer batch.
  batch<T>(fn: () => T): T {
    this.batchDepth += 1;
    try {
      return fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) this.flush();
    }
  }

  // Untrack: reads inside the callback don't subscribe.
  untrack<T>(fn: () => T): T {
    this.untrackDepth += 1;
    try {
      return fn();
    } finally {
      this.untrackDepth -= 1;
    }
  }

  // Drop the entire reactive graph.
  dispose(): void {
    if (this.disposed) return;
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

  private subscribeCurrent(source: Source): void {
    if (this.untrackDepth > 0) return;
    if (this.trackStack.length === 0) return;
    var top = this.trackStack[this.trackStack.length - 1] as InternalObserver;
    if (top.disposed) return;
    source.observers.add(top);
    top.deps.add(source);
  }

  private notifyAll(source: Source): void {
    var snapshot: InternalObserver[] = [];
    source.observers.forEach((o) => { if (!o.disposed) snapshot.push(o); });
    for (var i = 0; i < snapshot.length; i++) {
      this.queueRerun(snapshot[i] as InternalObserver);
    }
  }

  private queueRerun(observer: InternalObserver): void {
    this.pending.add(observer);
    if (this.batchDepth > 0) return;
    this.flush();
  }

  private flush(): void {
    var iter = 0;
    while (this.pending.size > 0 && iter < 1000) {
      iter += 1;
      var batch: InternalObserver[] = [];
      this.pending.forEach((o) => batch.push(o));
      this.pending.clear();
      for (var i = 0; i < batch.length; i++) {
        var o = batch[i] as InternalObserver;
        if (o.disposed) continue;
        try { o.rerun(); } catch { /* ignore */ }
      }
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_REACTIVITY = 'reactivity';
