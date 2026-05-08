// ReplayRecorder - record + replay deterministic timelines.
//
// 0.60.0 enabling primitive. The engine has every ingredient for
// deterministic replays:
//
//   - Entropy (0.17): seeded RNG, replays produce same numbers.
//   - EngineClock (0.25): tick-driven; pause / timeScale.
//   - WorldSnapshot (0.26): serialize/restore resource state.
//   - TimerScheduler (0.48): tick-driven setTimeout/Interval.
//   - PersistentStorage (0.38) + SaveSlots (0.45): save+load.
//
// What's missing: the recorder that captures the per-tick
// dt + input event stream and replays it later against the same
// initial seed + snapshot. ReplayRecorder is that recorder.
//
// Recording:
//   var rec = ReplayRecorder.create({ initialSeed: 1234 });
//   rec.attachInitialSnapshot(serializeWorldSnapshot(...));
//   rec.startRecording();
//   each frame: rec.recordTick(dtMs);
//   on input:    rec.recordEvent('keydown', 'KeyW', { repeat: false });
//   rec.stopRecording();
//   var trace = rec.toTrace();
//   await storage.save('replay/lastrun', trace);
//
// Playback:
//   var rec2 = ReplayRecorder.fromTrace(trace);
//   rec2.startPlayback();
//   for each playback frame: var step = rec2.nextStep();
//     if (step.events) for (var e of step.events) applyInput(e);
//     world.tick(step.dtMs);
//
// The recorder itself does NOT integrate with World - that's the
// consumer's job. This keeps the primitive small and engine-version-
// agnostic.
//
// Code style: var-only in browser source.
const TRACE_SCHEMA_VERSION = 1;
export class ReplayRecorder {
    mode = 'idle';
    initialSeed;
    engineVersion;
    maxSteps;
    initialSnapshot = null;
    steps = [];
    // Pending events accumulated since the last recordTick; flushed
    // into the next step.
    pendingEvents = [];
    // Playback cursor.
    cursor = 0;
    constructor(opts) {
        this.initialSeed = opts.initialSeed ?? 0;
        this.engineVersion = opts.engineVersion ?? '0.0.0';
        this.maxSteps = opts.maxSteps !== undefined && opts.maxSteps >= 0
            ? Math.floor(opts.maxSteps) : 0;
    }
    static create(opts = {}) {
        return new ReplayRecorder(opts);
    }
    // Reconstruct from a trace; the recorder is in 'idle' mode and
    // ready for startPlayback().
    static fromTrace(trace) {
        var rec = new ReplayRecorder({
            initialSeed: trace.initialSeed,
            engineVersion: trace.engineVersion,
        });
        rec.initialSnapshot = trace.initialSnapshot ?? null;
        rec.steps = trace.steps.map((s) => ({
            tick: s.tick,
            dtMs: s.dtMs,
            events: s.events.map(cloneEvent),
        }));
        return rec;
    }
    // Stamp the initial WorldSnapshot. Optional but recommended for
    // playback that doesn't start from world creation.
    attachInitialSnapshot(snap) {
        this.initialSnapshot = snap;
    }
    getInitialSeed() { return this.initialSeed; }
    getEngineVersion() { return this.engineVersion; }
    getInitialSnapshot() { return this.initialSnapshot; }
    getMode() { return this.mode; }
    stepCount() { return this.steps.length; }
    // ---------- recording ----------
    startRecording() {
        if (this.mode !== 'idle' && this.mode !== 'finished') {
            throw new Error('ReplayRecorder.startRecording: cannot start in mode ' + this.mode);
        }
        this.mode = 'recording';
        this.steps.length = 0;
        this.pendingEvents.length = 0;
        this.cursor = 0;
    }
    // Record a player input / external event. Buffers until the next
    // recordTick flushes them into a step.
    recordEvent(type, key, data) {
        if (this.mode !== 'recording')
            return;
        if (typeof type !== 'string' || type.length === 0)
            return;
        var ev = { type: type, tick: this.steps.length };
        if (key !== undefined)
            ev.key = key;
        if (data !== undefined)
            ev.data = data;
        this.pendingEvents.push(ev);
    }
    // Record a tick. The pending events buffer is flushed into the
    // step's events array. Returns the step that was created.
    recordTick(dtMs) {
        if (this.mode !== 'recording')
            return null;
        var dt = +dtMs;
        if (!isFinite(dt))
            dt = 0;
        var step = {
            tick: this.steps.length,
            dtMs: dt,
            events: this.pendingEvents.slice(),
        };
        this.pendingEvents.length = 0;
        this.steps.push(step);
        if (this.maxSteps > 0 && this.steps.length > this.maxSteps) {
            // Drop oldest step to keep the ring bounded.
            this.steps.shift();
        }
        return step;
    }
    stopRecording() {
        if (this.mode !== 'recording')
            return;
        this.mode = 'finished';
        this.pendingEvents.length = 0;
    }
    // ---------- playback ----------
    startPlayback() {
        if (this.mode === 'recording') {
            throw new Error('ReplayRecorder.startPlayback: stop recording first');
        }
        this.mode = 'playback';
        this.cursor = 0;
    }
    // Read the next step in the trace. Returns null when the
    // playback is complete; the recorder transitions to 'finished'.
    nextStep() {
        if (this.mode !== 'playback')
            return null;
        if (this.cursor >= this.steps.length) {
            this.mode = 'finished';
            return null;
        }
        var step = this.steps[this.cursor];
        this.cursor++;
        return {
            tick: step.tick,
            dtMs: step.dtMs,
            events: step.events.map(cloneEvent),
        };
    }
    // True if there is at least one more step queued for playback.
    hasNextStep() {
        return this.mode === 'playback' && this.cursor < this.steps.length;
    }
    // Reset playback cursor to 0; mode stays 'playback'. No-op if not
    // currently in playback.
    rewind() {
        if (this.mode !== 'playback')
            return;
        this.cursor = 0;
    }
    // Stop playback. Idempotent.
    stopPlayback() {
        if (this.mode === 'playback') {
            this.mode = 'finished';
        }
    }
    // ---------- serialization ----------
    // Build a JSON-safe trace envelope ready for storage / network.
    toTrace() {
        return {
            version: TRACE_SCHEMA_VERSION,
            engineVersion: this.engineVersion,
            initialSeed: this.initialSeed,
            initialSnapshot: this.initialSnapshot,
            steps: this.steps.map((s) => ({
                tick: s.tick,
                dtMs: s.dtMs,
                events: s.events.slice(),
            })),
        };
    }
}
function cloneEvent(e) {
    // Build conditionally so exactOptionalPropertyTypes doesn't
    // reject explicit-undefined assignments.
    var out = { type: e.type, tick: e.tick };
    if (e.key !== undefined)
        out.key = e.key;
    if (e.data !== undefined)
        out.data = e.data;
    return out;
}
// Resource key for the world's resource registry.
export const RESOURCE_REPLAY_RECORDER = 'replay_recorder';
//# sourceMappingURL=replay-recorder.js.map