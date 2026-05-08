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
export class EngineClock {
    paused = false;
    // Current time scale. Mutable via setter.
    scaleValue;
    // ms accumulated under the simulated clock (subject to pause +
    // scale).
    simulatedMs = 0;
    // ms of real wall-clock time observed since construction.
    realMs = 0;
    // Counter for step() calls so consumers can detect "did we step
    // this frame?"
    stepCount = 0;
    defaultStepMsValue;
    constructor(opts = {}) {
        this.scaleValue = opts.timeScale !== undefined
            ? Math.max(0, opts.timeScale)
            : 1.0;
        this.defaultStepMsValue = opts.defaultStepMs !== undefined
            && opts.defaultStepMs > 0
            ? opts.defaultStepMs
            : 16.6667; // ~60fps
    }
    // Pause / resume.
    pause() { this.paused = true; }
    resume() { this.paused = false; }
    isPaused() { return this.paused; }
    // Time scale. Negative or 0 clamps to 0 (effectively paused).
    setTimeScale(scale) {
        var s = Number(scale);
        if (!isFinite(s) || s < 0)
            s = 0;
        this.scaleValue = s;
    }
    timeScale() { return this.scaleValue; }
    // Default fixed-dt for step() calls. Read-only after construction;
    // a consumer can pass a custom dt per step() call.
    defaultStepMs() { return this.defaultStepMsValue; }
    // Per-frame entry point. Call once per render frame with the real
    // wall-clock delta in ms. Returns the simulated dt to pass to
    // world.update(). While paused (or scale=0) returns 0; the world
    // sees no time passing.
    tick(realDtMs) {
        var rdt = Number(realDtMs);
        if (!isFinite(rdt) || rdt < 0)
            rdt = 0;
        this.realMs += rdt;
        if (this.paused || this.scaleValue === 0)
            return 0;
        var simDt = rdt * this.scaleValue;
        this.simulatedMs += simDt;
        return simDt;
    }
    // Manually emit a fixed-dt tick. Bumps simulatedMs even while
    // paused (the point: debug stepping). Returns the dt that should
    // be passed to world.update(). Optional `stepMs` override; default
    // is the value passed to the constructor (or 16.67ms).
    step(stepMs) {
        var dt = stepMs !== undefined && stepMs > 0
            ? stepMs : this.defaultStepMsValue;
        this.simulatedMs += dt;
        this.stepCount++;
        return dt;
    }
    // Cumulative simulated ms since construction (consumer-tickable
    // clock; can lag wall clock if paused or scaled < 1).
    totalSimulatedMs() { return this.simulatedMs; }
    // Cumulative real wall-clock ms accumulated by tick() calls.
    totalRealMs() { return this.realMs; }
    // How many step() calls have happened. Useful for "did the user
    // press the step button this frame?" gating.
    totalSteps() { return this.stepCount; }
    // Reset all internal counters. Does NOT change pause / scale.
    resetCounters() {
        this.simulatedMs = 0;
        this.realMs = 0;
        this.stepCount = 0;
    }
}
// Resource key for the world-attached clock.
export const RESOURCE_ENGINE_CLOCK = 'loom.engine_clock';
//# sourceMappingURL=engine-clock.js.map