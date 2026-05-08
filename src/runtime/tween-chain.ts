// TweenChain - sequential composition of tweens, delays, and callbacks.
//
// 0.47.0 enabling primitive. Tween (0.29.0) animates a single scalar
// from A to B over T seconds. TweenChain composes a sequence of
// such steps (with optional delays + callbacks between them) into
// a single timeline:
//
//   var chain = TweenChain.create()
//     .to(0, 100, 0.5, function (v) { hud.alpha = v; }, 'easeOutCubic')
//     .delay(1.0)
//     .call(function () { audio.play('ding'); })
//     .to(100, 0, 0.5, function (v) { hud.alpha = v; });
//   chain.start({ onComplete: function () { console.log('done'); } });
//   // per frame:
//   chain.update(dtSeconds);
//
// Strictly sequential. Consumers needing parallel composition can
// instantiate two chains and update both each frame, OR use the
// underlying Tween class directly for ad-hoc parallel animations.
//
// Loop support: start({ loop: true }) repeats forever; start({ loop: 3 })
// repeats 3 additional times (4 total runs).
//
// Code style: var-only in browser source.

import { Easings, type EasingFn, type EasingName } from './tween.js';

function resolveEasing(easing: EasingFn | EasingName | undefined): EasingFn {
  if (typeof easing === 'function') return easing;
  if (typeof easing === 'string') {
    var fn = Easings[easing];
    if (fn) return fn;
  }
  return Easings.linear;
}

type StepKind = 'tween' | 'delay' | 'call';

interface BaseStep {
  kind: StepKind;
  duration: number;
}

interface TweenStep extends BaseStep {
  kind: 'tween';
  from: number;
  to: number;
  easing: EasingFn;
  onUpdate: (value: number) => void;
}

interface DelayStep extends BaseStep {
  kind: 'delay';
}

interface CallStep extends BaseStep {
  kind: 'call';
  fn: () => void;
  fired: boolean;
}

type Step = TweenStep | DelayStep | CallStep;

export interface TweenChainStartOptions {
  // Fired exactly once when the chain finishes (after the final
  // step's callback, or after the final tween's onUpdate(end)).
  // For loop=true, never fires.
  onComplete?: () => void;
  // true = repeat forever; positive integer = repeat N more times
  // (so total runs = N + 1). Default false (single pass).
  loop?: boolean | number;
}

export class TweenChain {
  private steps: Step[] = [];
  private active: boolean = false;
  private cancelled: boolean = false;
  private completed: boolean = false;
  private cursor: number = 0;
  private elapsedInStep: number = 0;
  private remainingLoops: number = 0;
  private loopForever: boolean = false;
  private onComplete: (() => void) | null = null;

  private constructor() { /* nothing */ }

  static create(): TweenChain {
    return new TweenChain();
  }

  // Add a tween step. Snaps to the end value on a 0-or-negative
  // duration (single-frame jump).
  to(
    from: number,
    to: number,
    durationSeconds: number,
    onUpdate: (value: number) => void,
    easing?: EasingFn | EasingName,
  ): TweenChain {
    var dur = +durationSeconds;
    var safeDur = isFinite(dur) && dur > 0 ? dur : 0;
    this.steps.push({
      kind: 'tween',
      duration: safeDur,
      from: +from,
      to: +to,
      easing: resolveEasing(easing),
      onUpdate: onUpdate,
    });
    return this;
  }

  // Add a delay (no callback, just elapsed time).
  delay(durationSeconds: number): TweenChain {
    var dur = +durationSeconds;
    this.steps.push({
      kind: 'delay',
      duration: isFinite(dur) && dur > 0 ? dur : 0,
    });
    return this;
  }

  // Add an instant callback step. Duration is 0; the function fires
  // exactly once when the cursor lands on this step.
  call(fn: () => void): TweenChain {
    this.steps.push({
      kind: 'call',
      duration: 0,
      fn: fn,
      fired: false,
    });
    return this;
  }

  // Begin (or restart) execution. Resets cursor + per-step state.
  // Idempotent if already active: replaces opts.
  start(opts: TweenChainStartOptions = {}): TweenChain {
    this.active = true;
    this.cancelled = false;
    this.completed = false;
    this.cursor = 0;
    this.elapsedInStep = 0;
    this.onComplete = opts.onComplete ?? null;
    if (opts.loop === true) {
      this.loopForever = true;
      this.remainingLoops = 0;
    } else if (typeof opts.loop === 'number' && opts.loop > 0) {
      this.loopForever = false;
      this.remainingLoops = Math.floor(opts.loop);
    } else {
      this.loopForever = false;
      this.remainingLoops = 0;
    }
    // Reset per-step state on every start.
    for (var i = 0; i < this.steps.length; i++) {
      var s = this.steps[i] as Step;
      if (s.kind === 'call') (s as CallStep).fired = false;
    }
    return this;
  }

  // Cancel mid-chain. The current step's onUpdate / call is NOT
  // re-invoked at cancel time; subsequent steps are skipped.
  // onComplete does NOT fire on cancel.
  cancel(): void {
    if (!this.active) return;
    this.cancelled = true;
    this.active = false;
  }

  // Currently running (started + not cancelled + not completed).
  isActive(): boolean {
    return this.active && !this.cancelled && !this.completed;
  }

  hasCompleted(): boolean {
    return this.completed;
  }

  // Total time across all duration-bearing steps. Callback steps
  // contribute 0.
  totalDuration(): number {
    var total = 0;
    for (var i = 0; i < this.steps.length; i++) {
      total += (this.steps[i] as Step).duration;
    }
    return total;
  }

  stepCount(): number {
    return this.steps.length;
  }

  // Advance the chain. Safe to call before start() (no-op) and
  // after completion (no-op).
  update(dtSeconds: number): void {
    if (!this.active || this.cancelled || this.completed) return;
    var dt = +dtSeconds;
    if (!isFinite(dt) || dt <= 0) return;
    // Empty chain: complete immediately.
    if (this.steps.length === 0) {
      this.finish();
      return;
    }
    // Drain dt across as many steps as fit. Instant steps (callback,
    // zero-duration tween / delay) advance regardless of remaining
    // time so they fire as soon as the cursor lands on them; only
    // time-bearing steps gate on remaining > 0.
    var remaining = dt;
    while (this.cursor < this.steps.length && !this.cancelled) {
      var step = this.steps[this.cursor] as Step;
      if (step.kind === 'call') {
        if (!(step as CallStep).fired) {
          (step as CallStep).fired = true;
          try { (step as CallStep).fn(); } catch {
            // Best-effort; a misbehaving callback never takes down
            // the chain.
          }
        }
        this.cursor++;
        this.elapsedInStep = 0;
        continue;
      }
      // Tween or delay: time-bearing (or zero-duration instant).
      var dur = step.duration;
      if (dur <= 0) {
        if (step.kind === 'tween') {
          try {
            (step as TweenStep).onUpdate((step as TweenStep).to);
          } catch { /* ignore */ }
        }
        this.cursor++;
        this.elapsedInStep = 0;
        continue;
      }
      // Genuine time-bearing step: bail if no time left this tick.
      if (remaining <= 0) break;
      var available = dur - this.elapsedInStep;
      if (remaining < available) {
        this.elapsedInStep += remaining;
        remaining = 0;
        if (step.kind === 'tween') {
          var ts = step as TweenStep;
          var t = this.elapsedInStep / dur;
          var eased = ts.easing(t);
          var val = ts.from + (ts.to - ts.from) * eased;
          try { ts.onUpdate(val); } catch { /* ignore */ }
        }
        // Delay: nothing else to do; elapsedInStep accumulates.
      } else {
        // Step completes within this update.
        if (step.kind === 'tween') {
          try {
            (step as TweenStep).onUpdate((step as TweenStep).to);
          } catch { /* ignore */ }
        }
        remaining -= available;
        this.cursor++;
        this.elapsedInStep = 0;
      }
    }
    if (this.cursor >= this.steps.length) {
      // Chain reached the end this update.
      if (this.loopForever) {
        this.cursor = 0;
        this.elapsedInStep = 0;
        for (var i = 0; i < this.steps.length; i++) {
          var s2 = this.steps[i] as Step;
          if (s2.kind === 'call') (s2 as CallStep).fired = false;
        }
        // Drain any remaining dt into the next pass.
        if (remaining > 0) this.update(remaining);
      } else if (this.remainingLoops > 0) {
        this.remainingLoops--;
        this.cursor = 0;
        this.elapsedInStep = 0;
        for (var j = 0; j < this.steps.length; j++) {
          var s3 = this.steps[j] as Step;
          if (s3.kind === 'call') (s3 as CallStep).fired = false;
        }
        if (remaining > 0) this.update(remaining);
      } else {
        this.finish();
      }
    }
  }

  // ---------- private ----------

  private finish(): void {
    this.completed = true;
    this.active = false;
    var cb = this.onComplete;
    this.onComplete = null;
    if (cb) {
      try { cb(); } catch { /* ignore */ }
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_TWEEN_CHAIN = 'tween_chain';
