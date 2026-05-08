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

  // 0.40.0 - back / elastic / bounce curves (Robert Penner). All
  // accept t in [0, 1] but their range may briefly leave [0, 1]:
  // back curves overshoot past 1 (or under 0); elastic oscillates;
  // bounce stays in [0, 1] but is non-monotonic. Useful for menu
  // pop-in, spring damp, drop-and-settle motion.

  easeInBack: function (t: number): number {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: function (t: number): number {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    var u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  },
  easeInOutBack: function (t: number): number {
    var c1 = 1.70158;
    var c2 = c1 * 1.525;
    if (t < 0.5) {
      return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2;
    }
    return (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },

  easeInElastic: function (t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var c4 = (2 * Math.PI) / 3;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
  easeOutElastic: function (t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeInOutElastic: function (t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var c5 = (2 * Math.PI) / 4.5;
    if (t < 0.5) {
      return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2;
    }
    return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },

  easeOutBounce: function (t: number): number {
    var n1 = 7.5625;
    var d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    }
    if (t < 2 / d1) {
      var u1 = t - 1.5 / d1;
      return n1 * u1 * u1 + 0.75;
    }
    if (t < 2.5 / d1) {
      var u2 = t - 2.25 / d1;
      return n1 * u2 * u2 + 0.9375;
    }
    var u3 = t - 2.625 / d1;
    return n1 * u3 * u3 + 0.984375;
  },
  easeInBounce: function (t: number): number {
    return 1 - Easings.easeOutBounce(1 - t);
  },
  easeInOutBounce: function (t: number): number {
    if (t < 0.5) {
      return (1 - Easings.easeOutBounce(1 - 2 * t)) / 2;
    }
    return (1 + Easings.easeOutBounce(2 * t - 1)) / 2;
  },
} as const;

// 0.40.0 - cubic-bezier easing factory (CSS-style).
//
// CSS animation-timing-function takes four control values:
//   cubic-bezier(x1, y1, x2, y2)
// defining a curve from (0,0) to (1,1) with two interior control
// points (x1, y1) and (x2, y2). x1 and x2 must be in [0, 1]; y1
// and y2 may be outside [0, 1] for overshoot effects.
//
// Given x = t (time in [0, 1]), we solve for the parametric value s
// such that bezier_x(s) = t, then return bezier_y(s). The solver
// uses Newton-Raphson with a bisection fallback - converges to ~1e-6
// accuracy in <8 iterations for typical control points.
//
// Useful CSS presets:
//   ease         = cubicBezier(0.25, 0.1, 0.25, 1.0)
//   easeIn       = cubicBezier(0.42, 0,    1.0,  1.0)
//   easeOut      = cubicBezier(0,    0,    0.58, 1.0)
//   easeInOut    = cubicBezier(0.42, 0,    0.58, 1.0)
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): EasingFn {
  // Clamp x components to [0, 1] - the curve is undefined as a
  // function-of-x outside that range. y components may overshoot.
  var cx1 = clampUnit(x1);
  var cx2 = clampUnit(x2);
  return function (t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var s = solveBezierParam(t, cx1, cx2);
    return bezierComponent(s, y1, y2);
  };
}

function clampUnit(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Bezier component for given parameter s in [0, 1] with control
// points (P0=0, P1=p1, P2=p2, P3=1). Used for both x and y.
function bezierComponent(s: number, p1: number, p2: number): number {
  var u = 1 - s;
  return 3 * u * u * s * p1
       + 3 * u * s * s * p2
       + s * s * s;
}

// Derivative of bezierComponent w.r.t. s.
function bezierComponentDerivative(s: number, p1: number, p2: number): number {
  var u = 1 - s;
  return 3 * u * u * p1
       + 6 * u * s * (p2 - p1)
       + 3 * s * s * (1 - p2);
}

// Solve bezier_x(s) = t for s. Newton-Raphson with bisection
// fallback for stability.
function solveBezierParam(t: number, x1: number, x2: number): number {
  var EPS = 1e-6;
  // Newton-Raphson: ~5 iterations for typical curves.
  var s = t;
  for (var i = 0; i < 8; i++) {
    var x = bezierComponent(s, x1, x2) - t;
    if (Math.abs(x) < EPS) return s;
    var dx = bezierComponentDerivative(s, x1, x2);
    if (Math.abs(dx) < EPS) break;
    s = s - x / dx;
  }
  // Bisection fallback for poorly-conditioned curves.
  var lo = 0;
  var hi = 1;
  s = t;
  for (var j = 0; j < 64; j++) {
    var fx = bezierComponent(s, x1, x2) - t;
    if (Math.abs(fx) < EPS) return s;
    if (fx < 0) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

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
