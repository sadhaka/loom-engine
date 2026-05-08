// EngineClock - pause / step / timeScale controls for the world tick.
//
// 0.25.0 enabling primitive. The world's update(dt) is called by the
// consumer's render loop with a real-wall-clock dt. EngineClock is a
// self-contained wrapper that lets a consumer:
//
//   - pause / resume the simulation (dt becomes 0 while paused).
//   - scale time (slow-mo at 0.5; fast-forward at 2.0).
//   - step a fixed number of frames while paused (debug stepping).
//   - track total simulated vs real ms for HUD / debug.
//
// Usage pattern:
//
//   var clock = new EngineClock();
//   function frame(realDt) {
//     var simDt = clock.tick(realDt);
//     world.update(simDt);
//   }
//
// EngineClock owns no DOM / network state; it's pure timing math.

export interface EngineClockOptions {
  // Initial timescale. 1.0 = realtime. < 1 = slow-mo. > 1 = fast-fwd.
  // Negative or 0 values are clamped to 0 (paused).
  timeScale?: number;
  // Default fixed-dt for step(). 16ms = ~60fps.
  defaultStepMs?: number;
}

export class EngineClock {
  private paused: boolean = false;
  // Current time scale. Mutable via setter.
  private scaleValue: number;
  // ms accumulated under the simulated clock (subject to pause +
  // scale).
  private simulatedMs: number = 0;
  // ms of real wall-clock time observed since construction.
  private realMs: number = 0;
  // Counter for step() calls so consumers can detect "did we step
  // this frame?"
  private stepCount: number = 0;
  private readonly defaultStepMsValue: number;

  constructor(opts: EngineClockOptions = {}) {
    this.scaleValue = opts.timeScale !== undefined
      ? Math.max(0, opts.timeScale)
      : 1.0;
    this.defaultStepMsValue = opts.defaultStepMs !== undefined
      && opts.defaultStepMs > 0
      ? opts.defaultStepMs
      : 16.6667;  // ~60fps
  }

  // Pause / resume.
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  isPaused(): boolean { return this.paused; }

  // Time scale. Negative or 0 clamps to 0 (effectively paused).
  setTimeScale(scale: number): void {
    var s = Number(scale);
    if (!isFinite(s) || s < 0) s = 0;
    this.scaleValue = s;
  }
  timeScale(): number { return this.scaleValue; }

  // Default fixed-dt for step() calls. Read-only after construction;
  // a consumer can pass a custom dt per step() call.
  defaultStepMs(): number { return this.defaultStepMsValue; }

  // Per-frame entry point. Call once per render frame with the real
  // wall-clock delta in ms. Returns the simulated dt to pass to
  // world.update(). While paused (or scale=0) returns 0; the world
  // sees no time passing.
  tick(realDtMs: number): number {
    var rdt = Number(realDtMs);
    if (!isFinite(rdt) || rdt < 0) rdt = 0;
    this.realMs += rdt;
    if (this.paused || this.scaleValue === 0) return 0;
    var simDt = rdt * this.scaleValue;
    this.simulatedMs += simDt;
    return simDt;
  }

  // Manually emit a fixed-dt tick. Bumps simulatedMs even while
  // paused (the point: debug stepping). Returns the dt that should
  // be passed to world.update(). Optional `stepMs` override; default
  // is the value passed to the constructor (or 16.67ms).
  step(stepMs?: number): number {
    var dt = stepMs !== undefined && stepMs > 0
      ? stepMs : this.defaultStepMsValue;
    this.simulatedMs += dt;
    this.stepCount++;
    return dt;
  }

  // Cumulative simulated ms since construction (consumer-tickable
  // clock; can lag wall clock if paused or scaled < 1).
  totalSimulatedMs(): number { return this.simulatedMs; }

  // Cumulative real wall-clock ms accumulated by tick() calls.
  totalRealMs(): number { return this.realMs; }

  // How many step() calls have happened. Useful for "did the user
  // press the step button this frame?" gating.
  totalSteps(): number { return this.stepCount; }

  // Reset all internal counters. Does NOT change pause / scale.
  resetCounters(): void {
    this.simulatedMs = 0;
    this.realMs = 0;
    this.stepCount = 0;
  }
}

// Resource key for the world-attached clock.
export const RESOURCE_ENGINE_CLOCK = 'loom.engine_clock';
