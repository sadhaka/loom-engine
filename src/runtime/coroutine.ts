// Coroutine - generator-based multi-tick async over EngineClock.
//
// 0.68.0 enabling primitive. Some game logic naturally spans
// multiple ticks: cinematic scripting, AI scripts, scripted boss
// patterns, tutorial overlays, NPC dialogue beats. Promises don't
// fit (they resolve on the JS microtask queue, not the engine
// clock); FrameBudgetScheduler (0.36) is for short-lived work,
// not state machines.
//
// Coroutine wraps a JavaScript generator. The generator yields
// values that tell the runtime "wait this long" or "wait until
// this predicate" before resuming. Each Coroutine.tick(dtMs)
// advances every active routine.
//
//   var co = Coroutine.create();
//   co.start(function* () {
//     console.log('boss spawn cinematic begin');
//     yield waitMs(1000);              // pause 1s
//     audio.play('boss-roar');
//     yield waitMs(500);
//     yield waitUntil(() => bossSpawned);
//     console.log('boss revealed');
//   });
//   each frame: co.tick(dtMs);
//
// Code style: var-only in browser source.

// Yielded "wait" instructions.
export interface WaitMs {
  kind: 'ms';
  remainingMs: number;
}

export interface WaitUntil {
  kind: 'until';
  predicate: () => boolean;
}

export interface WaitFrames {
  kind: 'frames';
  remainingFrames: number;
}

export type Yieldable = WaitMs | WaitUntil | WaitFrames | null | undefined;

// Helpers consumers yield from inside their generators.
export function waitMs(ms: number): WaitMs {
  return { kind: 'ms', remainingMs: ms > 0 ? ms : 0 };
}

export function waitUntil(predicate: () => boolean): WaitUntil {
  return { kind: 'until', predicate: predicate };
}

export function waitFrames(n: number): WaitFrames {
  return { kind: 'frames', remainingFrames: n > 0 ? Math.floor(n) : 0 };
}

interface RoutineEntry {
  id: number;
  iterator: Generator<Yieldable, void, void>;
  pending: Yieldable;
  done: boolean;
  // Optional onDone callback for completion tracking.
  onDone?: () => void;
  // Optional onError callback for thrown generators.
  onError?: (err: unknown) => void;
}

export interface CoroutineOptions {
  // Fired whenever a routine completes (returns).
  onCompleted?: (id: number) => void;
}

export interface StartOptions {
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

export class Coroutine {
  private routines: Map<number, RoutineEntry> = new Map();
  private nextId: number = 1;
  private onCompleted: ((id: number) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: CoroutineOptions) {
    this.onCompleted = opts.onCompleted ?? null;
  }

  static create(opts: CoroutineOptions = {}): Coroutine {
    return new Coroutine(opts);
  }

  // Begin a new routine. The generator function is invoked
  // immediately to obtain its iterator; the first yield is
  // captured but the routine doesn't actually advance until the
  // first tick().
  start(genFn: () => Generator<Yieldable, void, void>, opts: StartOptions = {}): number {
    if (this.disposed) return 0;
    var iter: Generator<Yieldable, void, void>;
    try {
      iter = genFn();
    } catch (err) {
      if (opts.onError) {
        try { opts.onError(err); } catch { /* ignore */ }
      }
      return 0;
    }
    var id = this.nextId++;
    var entry: RoutineEntry = {
      id: id,
      iterator: iter,
      pending: null,
      done: false,
    };
    if (opts.onDone) entry.onDone = opts.onDone;
    if (opts.onError) entry.onError = opts.onError;
    this.routines.set(id, entry);
    // Pull the first yielded value immediately so .tick() can
    // start advancing. This also catches synchronous throws.
    this.advance(entry, 0);
    return id;
  }

  // Cancel a running routine. Returns true if found.
  cancel(id: number): boolean {
    if (this.disposed) return false;
    var entry = this.routines.get(id);
    if (!entry) return false;
    this.routines.delete(id);
    return true;
  }

  // Number of currently active routines.
  activeCount(): number {
    return this.routines.size;
  }

  isActive(id: number): boolean {
    return this.routines.has(id);
  }

  // Drive every active routine forward by dtMs. waitMs decrements;
  // waitFrames decrements by 1 per tick (regardless of dtMs);
  // waitUntil polls the predicate every tick. Routines that
  // complete are removed.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt < 0) dt = 0;
    var done: number[] = [];
    var iter = this.routines.values();
    var step = iter.next();
    while (!step.done) {
      var entry = step.value as RoutineEntry;
      if (entry.done) {
        done.push(entry.id);
        step = iter.next();
        continue;
      }
      // Walk waits. Time waits carry their surplus forward (single
      // large tick can drain multi-stage timed routines). Frame
      // waits decrement only on the ticks where they were the
      // PENDING-AT-TICK-START wait — placing a new waitFrames
      // mid-tick doesn't immediately consume a frame from it.
      // waitUntil polls every tick.
      var resume = false;
      var dtRemaining = dt;
      var initialPending = entry.pending;
      var safety = 1024;
      while (!resume && safety > 0) {
        safety--;
        var pend = entry.pending;
        if (!pend) {
          // Bare yield (cooperative). Advance once and exit so the
          // routine doesn't spin for free.
          this.advance(entry, dt);
          resume = true;
          continue;
        }
        if (pend.kind === 'ms') {
          pend.remainingMs -= dtRemaining;
          if (pend.remainingMs <= 0) {
            dtRemaining = -pend.remainingMs;
            entry.pending = null;
            this.advance(entry, dt);
            continue;
          }
          resume = true;
        } else if (pend.kind === 'frames') {
          if (pend === initialPending) {
            // Was pending at tick start — count this tick.
            pend.remainingFrames -= 1;
            if (pend.remainingFrames <= 0) {
              entry.pending = null;
              this.advance(entry, dt);
              continue;
            }
          }
          // Either we just decremented and aren't done, OR this
          // waitFrames was placed mid-tick — either way, exit and
          // wait for the next tick to count.
          resume = true;
        } else if (pend.kind === 'until') {
          var passed = false;
          try { passed = !!pend.predicate(); } catch { passed = false; }
          if (passed) {
            entry.pending = null;
            this.advance(entry, dt);
            continue;
          }
          resume = true;
        }
      }
      if (entry.done) done.push(entry.id);
      step = iter.next();
    }
    for (var i = 0; i < done.length; i++) {
      var id = done[i] as number;
      var e = this.routines.get(id);
      if (!e) continue;
      this.routines.delete(id);
      if (e.onDone) {
        try { e.onDone(); } catch { /* ignore */ }
      }
      if (this.onCompleted) {
        try { this.onCompleted(id); } catch { /* ignore */ }
      }
    }
  }

  // Wipe all routines. Throwing onError callbacks isolated.
  cancelAll(): void {
    if (this.disposed) return;
    this.routines.clear();
  }

  dispose(): void {
    this.routines.clear();
    this.onCompleted = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private advance(entry: RoutineEntry, _dt: number): void {
    try {
      var result = entry.iterator.next();
      if (result.done) {
        entry.done = true;
        entry.pending = null;
      } else {
        entry.pending = result.value as Yieldable;
      }
    } catch (err) {
      entry.done = true;
      entry.pending = null;
      if (entry.onError) {
        try { entry.onError(err); } catch { /* ignore */ }
      }
    }
  }
}

// Heuristic: a "real" pause yields a wait shape; null/undefined
// means "let me run again next tick" (pure cooperative yield).
function isYieldingPause(pend: Yieldable): boolean {
  if (!pend) return false;
  return pend.kind === 'ms' || pend.kind === 'frames' || pend.kind === 'until';
}

// Resource key for the world's resource registry.
export const RESOURCE_COROUTINE = 'coroutine';
