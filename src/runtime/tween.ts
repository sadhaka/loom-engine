// Tween - animate scalar values over time with easing curves.
//
// 0.29.0 enabling primitive. Many engine features need to animate a
// number from A to B over T seconds with easing (camera zoom, HUD
// fade, color transition, particle alpha decay, audio volume swell).
// Tween is a tiny self-contained scheduler:
//
//   var tw = new Tween();
//   var handle = tw.to(0, 100, 1.0, 'easeOutCubic', function (v) {
//     element.style.opacity = String(v);
//   });
//   // Per frame:
//   tw.update(dtSeconds);
//
// Easings cover the common cases: linear, easeIn/Out/InOut for
// quadratic / cubic / quartic / sine. Custom curves accepted via
// a (t: number) => number function (input + output in [0, 1]).
//
// Code style: var-only in browser-bound source; defensive try/catch
// on user callbacks.

// Easing functions - input t in [0, 1], output also in [0, 1].
// Standard set lifted from Robert Penner's curves.

export type EasingFn = (t: number) => number;

export const Easings = {
  linear: function (t: number): number { return t; },

  easeInQuad: function (t: number): number { return t * t; },
  easeOutQuad: function (t: number): number { return 1 - (1 - t) * (1 - t); },
  easeInOutQuad: function (t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  },

  easeInCubic: function (t: number): number { return t * t * t; },
  easeOutCubic: function (t: number): number {
    var u = 1 - t;
    return 1 - u * u * u;
  },
  easeInOutCubic: function (t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },

  easeInQuart: function (t: number): number { return t * t * t * t; },
  easeOutQuart: function (t: number): number {
    var u = 1 - t;
    return 1 - u * u * u * u;
  },
  easeInOutQuart: function (t: number): number {
    return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
  },

  easeInSine: function (t: number): number {
    return 1 - Math.cos((t * Math.PI) / 2);
  },
  easeOutSine: function (t: number): number {
    return Math.sin((t * Math.PI) / 2);
  },
  easeInOutSine: function (t: number): number {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  },
} as const;

export type EasingName = keyof typeof Easings;

// Resolve an easing argument to a callable. Accepts a name (lookup in
// Easings) OR a custom function. Falls back to linear on unknown.
function resolveEasing(easing: EasingName | EasingFn | undefined): EasingFn {
  if (typeof easing === 'function') return easing;
  if (typeof easing === 'string') {
    var fn = Easings[easing];
    if (fn) return fn;
  }
  return Easings.linear;
}

// One scheduled tween.
interface TweenEntry {
  id: number;
  from: number;
  to: number;
  duration: number;  // seconds; > 0
  elapsed: number;   // seconds since start
  easing: EasingFn;
  onUpdate: (value: number) => void;
  onComplete: (() => void) | null;
  cancelled: boolean;
}

// Handle returned by .to() / .from(). Lets the caller cancel mid-flight
// or query status.
export interface TweenHandle {
  // Cancel the tween. The onUpdate callback receives the current
  // partial value AT cancellation but onComplete does NOT fire.
  cancel(): void;
  // True if still running (not cancelled, not completed).
  isActive(): boolean;
}

export interface TweenOptions {
  // Optional easing - default linear.
  easing?: EasingName | EasingFn;
  // Optional callback when the tween reaches `to`.
  onComplete?: () => void;
}

export class Tween {
  private entries: TweenEntry[] = [];
  private nextId: number = 1;
  private completedCount: number = 0;
  private cancelledCount: number = 0;

  // Animate a value FROM `start` TO `end` over `durationSeconds`.
  // The onUpdate callback receives the current value each tick.
  // Returns a TweenHandle for cancel + isActive. Negative or zero
  // durations snap immediately to `end` and complete on the same call.
  to(
    from: number,
    to: number,
    durationSeconds: number,
    onUpdate: (value: number) => void,
    options: TweenOptions = {},
  ): TweenHandle {
    var dur = +durationSeconds;
    var entry: TweenEntry = {
      id: this.nextId++,
      from: +from,
      to: +to,
      duration: isFinite(dur) && dur > 0 ? dur : 0,
      elapsed: 0,
      easing: resolveEasing(options.easing),
      onUpdate: onUpdate,
      onComplete: options.onComplete || null,
      cancelled: false,
    };
    if (entry.duration === 0) {
      // Snap. Fire onUpdate at the end value, fire onComplete, no
      // queue insert.
      try { onUpdate(entry.to); } catch (e) {
        try { console.error('[Tween] onUpdate threw:', e); } catch { /* ignore */ }
      }
      if (entry.onComplete) {
        try { entry.onComplete(); } catch (e) {
          try { console.error('[Tween] onComplete threw:', e); } catch { /* ignore */ }
        }
      }
      this.completedCount++;
      return {
        cancel: function () { /* already done */ },
        isActive: function () { return false; },
      };
    }
    this.entries.push(entry);
    var bus = this;
    return {
      cancel: function () {
        if (entry.cancelled) return;
        entry.cancelled = true;
        bus.cancelledCount++;
      },
      isActive: function () {
        return !entry.cancelled && entry.elapsed < entry.duration;
      },
    };
  }

  // Per-frame tick. Advances every active tween by dtSeconds; fires
  // onUpdate callbacks with the eased value; removes completed and
  // cancelled tweens.
  update(dtSeconds: number): void {
    var dt = +dtSeconds;
    if (!isFinite(dt) || dt <= 0) return;
    // Iterate forward, accumulate keeps + completes; rebuild entries.
    var keep: TweenEntry[] = [];
    for (var i = 0; i < this.entries.length; i++) {
      var entry = this.entries[i];
      if (!entry) continue;
      if (entry.cancelled) continue;  // dropped
      entry.elapsed += dt;
      var done = entry.elapsed >= entry.duration;
      var t = done ? 1 : entry.elapsed / entry.duration;
      var k = entry.easing(t);
      var value = entry.from + (entry.to - entry.from) * k;
      try {
        entry.onUpdate(value);
      } catch (e) {
        try { console.error('[Tween] onUpdate threw:', e); } catch { /* ignore */ }
      }
      if (done) {
        if (entry.onComplete) {
          try { entry.onComplete(); } catch (e) {
            try { console.error('[Tween] onComplete threw:', e); } catch { /* ignore */ }
          }
        }
        this.completedCount++;
      } else {
        keep.push(entry);
      }
    }
    this.entries = keep;
  }

  // How many tweens are currently running.
  activeCount(): number {
    var n = 0;
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      if (e && !e.cancelled) n++;
    }
    return n;
  }

  // Cancel every active tween. onUpdate / onComplete do NOT fire for
  // cancelled tweens.
  cancelAll(): void {
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      if (e && !e.cancelled) {
        e.cancelled = true;
        this.cancelledCount++;
      }
    }
  }

  // Diagnostic counters.
  stats(): { active: number; completed: number; cancelled: number } {
    return {
      active: this.activeCount(),
      completed: this.completedCount,
      cancelled: this.cancelledCount,
    };
  }
}

// Resource key for the world-attached tween.
export const RESOURCE_TWEEN = 'loom.tween';
