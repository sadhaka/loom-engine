// TimerScheduler - engine-clock-driven setTimeout / setInterval.
//
// 0.48.0 enabling primitive. Browser `setTimeout` / `setInterval`
// fire on the wall clock - they don't respect the engine's frame
// pacing or pause / timeScale (0.25.0 EngineClock). Replays don't
// reproduce them either: a setTimeout at 500ms from a recorded
// session won't land at the same world-tick on replay because the
// browser's scheduler is non-deterministic.
//
// TimerScheduler is a setTimeout / setInterval analog driven by
// `tick(dtMs)`. Time advances ONLY when the consumer ticks; every
// scheduled callback fires at exactly the dt boundary that crosses
// its threshold. Combined with EngineClock as the dt source, this
// is replay-deterministic.
//
//   setTimeout(fn, ms)   -> one-shot; fires once at the first tick
//                           where elapsed >= ms (relative to schedule
//                           time).
//   setInterval(fn, ms)  -> repeating; fires every `ms` of accumulated
//                           tick time.
//   clearTimeout(handle) / clearInterval(handle) - cancel.
//
// Code style: var-only in browser source.

interface Timer {
  id: number;
  delayMs: number;       // initial / interval gap in ms
  remainingMs: number;   // time until next fire
  repeating: boolean;
  fn: () => void;
  active: boolean;
}

export interface TimerHandle {
  // Cancel the timer. onComplete does NOT fire on cancel.
  cancel(): void;
  // True if the timer is still scheduled (not yet fired for one-shots
  // / not yet cancelled for intervals).
  isActive(): boolean;
  // The timer's id. Stable for the timer's lifetime.
  readonly id: number;
}

export interface TimerSchedulerOptions {
  // Optional cap on how many fires can land in a single tick(). If a
  // huge dt (e.g. tab-resume) would fire an interval more times than
  // this cap, the scheduler caps the burst and drops the rest.
  // Default 64. Set to 0 to disable the cap.
  maxFiresPerTick?: number;
}

const DEFAULT_MAX_FIRES = 64;

export class TimerScheduler {
  private timers: Map<number, Timer> = new Map();
  private nextId: number = 1;
  private firedCount: number = 0;
  private cancelledCount: number = 0;
  private maxFires: number;
  private disposed: boolean = false;

  private constructor(opts: TimerSchedulerOptions) {
    this.maxFires = opts.maxFiresPerTick !== undefined && opts.maxFiresPerTick >= 0
      ? opts.maxFiresPerTick : DEFAULT_MAX_FIRES;
  }

  static create(opts: TimerSchedulerOptions = {}): TimerScheduler {
    return new TimerScheduler(opts);
  }

  // One-shot timer. Fires once at the first tick where elapsed >=
  // delayMs from schedule time. delayMs <= 0 fires on the next tick().
  setTimeout(fn: () => void, delayMs: number): TimerHandle {
    return this.schedule(fn, delayMs, false);
  }

  // Repeating timer. Fires every delayMs of accumulated tick time.
  // Catches up if a single tick crosses multiple thresholds (capped
  // by maxFiresPerTick).
  setInterval(fn: () => void, delayMs: number): TimerHandle {
    return this.schedule(fn, delayMs, true);
  }

  clearTimeout(handle: TimerHandle | number | null | undefined): void {
    if (!handle) return;
    var id = typeof handle === 'number' ? handle : handle.id;
    this.cancelInternal(id);
  }

  // Alias for clearTimeout - same identity for both timer kinds, the
  // scheduler doesn't distinguish at cancel time.
  clearInterval(handle: TimerHandle | number | null | undefined): void {
    this.clearTimeout(handle);
  }

  // Cancel every active timer. Useful on scene transition.
  cancelAll(): void {
    if (this.disposed) return;
    var ids = Array.from(this.timers.keys());
    for (var i = 0; i < ids.length; i++) {
      this.cancelInternal(ids[i] as number);
    }
  }

  has(id: number): boolean {
    var t = this.timers.get(id);
    return t ? t.active : false;
  }

  pendingCount(): number {
    var n = 0;
    this.timers.forEach((t) => { if (t.active) n++; });
    return n;
  }

  // Advance scheduled time by dtMs. Fires every timer whose remaining
  // time has elapsed; intervals can fire multiple times in a single
  // tick if dt > delayMs (subject to maxFiresPerTick).
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    // Snapshot active timers so newly-scheduled timers from inside a
    // callback don't fire in the same tick.
    var ids = Array.from(this.timers.keys());
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i] as number;
      var t = this.timers.get(id);
      if (!t || !t.active) continue;
      t.remainingMs -= dt;
      var fires = 0;
      while (t.remainingMs <= 0 && t.active) {
        if (this.maxFires > 0 && fires >= this.maxFires) {
          // Burst cap hit; drop remaining fires this tick.
          t.remainingMs = t.delayMs > 0 ? t.delayMs : 1;
          break;
        }
        try { t.fn(); } catch {
          // Best-effort; never let a misbehaving callback take down
          // the scheduler.
        }
        fires++;
        this.firedCount++;
        if (!t.repeating) {
          t.active = false;
          this.timers.delete(id);
          break;
        }
        // For intervals, schedule next fire by adding delayMs.
        // Carries fractional surplus (negative remainingMs) so cadence
        // is steady even when dt > delayMs.
        if (t.delayMs <= 0) {
          // Pathological: interval=0 would loop forever. Drop the
          // timer to be safe.
          t.active = false;
          this.timers.delete(id);
          break;
        }
        t.remainingMs += t.delayMs;
      }
    }
  }

  // Diagnostics.
  stats(): {
    pending: number;
    fired: number;
    cancelled: number;
  } {
    return {
      pending: this.pendingCount(),
      fired: this.firedCount,
      cancelled: this.cancelledCount,
    };
  }

  dispose(): void {
    this.timers.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private schedule(fn: () => void, delayMs: number, repeating: boolean): TimerHandle {
    if (this.disposed) {
      return makeNoopHandle(0);
    }
    var id = this.nextId++;
    var safeDelay = isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
    var timer: Timer = {
      id: id,
      delayMs: safeDelay,
      remainingMs: safeDelay,
      repeating: repeating,
      fn: fn,
      active: true,
    };
    this.timers.set(id, timer);
    var self = this;
    return {
      id: id,
      cancel: function () { self.cancelInternal(id); },
      isActive: function () {
        var t = self.timers.get(id);
        return t ? t.active : false;
      },
    };
  }

  private cancelInternal(id: number): void {
    var t = this.timers.get(id);
    if (!t) return;
    if (!t.active) {
      this.timers.delete(id);
      return;
    }
    t.active = false;
    this.timers.delete(id);
    this.cancelledCount++;
  }
}

function makeNoopHandle(id: number): TimerHandle {
  return {
    id: id,
    cancel: function () { /* no-op */ },
    isActive: function () { return false; },
  };
}

// Resource key for the world's resource registry.
export const RESOURCE_TIMER_SCHEDULER = 'timer_scheduler';
