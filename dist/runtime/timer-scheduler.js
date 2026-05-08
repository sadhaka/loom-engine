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
const DEFAULT_MAX_FIRES = 64;
export class TimerScheduler {
    timers = new Map();
    nextId = 1;
    firedCount = 0;
    cancelledCount = 0;
    maxFires;
    disposed = false;
    constructor(opts) {
        this.maxFires = opts.maxFiresPerTick !== undefined && opts.maxFiresPerTick >= 0
            ? opts.maxFiresPerTick : DEFAULT_MAX_FIRES;
    }
    static create(opts = {}) {
        return new TimerScheduler(opts);
    }
    // One-shot timer. Fires once at the first tick where elapsed >=
    // delayMs from schedule time. delayMs <= 0 fires on the next tick().
    setTimeout(fn, delayMs) {
        return this.schedule(fn, delayMs, false);
    }
    // Repeating timer. Fires every delayMs of accumulated tick time.
    // Catches up if a single tick crosses multiple thresholds (capped
    // by maxFiresPerTick).
    setInterval(fn, delayMs) {
        return this.schedule(fn, delayMs, true);
    }
    clearTimeout(handle) {
        if (!handle)
            return;
        var id = typeof handle === 'number' ? handle : handle.id;
        this.cancelInternal(id);
    }
    // Alias for clearTimeout - same identity for both timer kinds, the
    // scheduler doesn't distinguish at cancel time.
    clearInterval(handle) {
        this.clearTimeout(handle);
    }
    // Cancel every active timer. Useful on scene transition.
    cancelAll() {
        if (this.disposed)
            return;
        var ids = Array.from(this.timers.keys());
        for (var i = 0; i < ids.length; i++) {
            this.cancelInternal(ids[i]);
        }
    }
    has(id) {
        var t = this.timers.get(id);
        return t ? t.active : false;
    }
    pendingCount() {
        var n = 0;
        this.timers.forEach((t) => { if (t.active)
            n++; });
        return n;
    }
    // Advance scheduled time by dtMs. Fires every timer whose remaining
    // time has elapsed; intervals can fire multiple times in a single
    // tick if dt > delayMs (subject to maxFiresPerTick).
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        // Snapshot active timers so newly-scheduled timers from inside a
        // callback don't fire in the same tick.
        var ids = Array.from(this.timers.keys());
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            var t = this.timers.get(id);
            if (!t || !t.active)
                continue;
            t.remainingMs -= dt;
            var fires = 0;
            while (t.remainingMs <= 0 && t.active) {
                if (this.maxFires > 0 && fires >= this.maxFires) {
                    // Burst cap hit; drop remaining fires this tick.
                    t.remainingMs = t.delayMs > 0 ? t.delayMs : 1;
                    break;
                }
                try {
                    t.fn();
                }
                catch {
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
    stats() {
        return {
            pending: this.pendingCount(),
            fired: this.firedCount,
            cancelled: this.cancelledCount,
        };
    }
    dispose() {
        this.timers.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    schedule(fn, delayMs, repeating) {
        if (this.disposed) {
            return makeNoopHandle(0);
        }
        var id = this.nextId++;
        var safeDelay = isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
        var timer = {
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
    cancelInternal(id) {
        var t = this.timers.get(id);
        if (!t)
            return;
        if (!t.active) {
            this.timers.delete(id);
            return;
        }
        t.active = false;
        this.timers.delete(id);
        this.cancelledCount++;
    }
}
function makeNoopHandle(id) {
    return {
        id: id,
        cancel: function () { },
        isActive: function () { return false; },
    };
}
// Resource key for the world's resource registry.
export const RESOURCE_TIMER_SCHEDULER = 'timer_scheduler';
//# sourceMappingURL=timer-scheduler.js.map