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

export interface ReplayEvent {
  // Logical type ('keydown', 'click', 'cue', ... — consumer-defined).
  type: string;
  // Optional payload key (key code, mouse button, etc.).
  key?: string;
  // Optional structured data.
  data?: Record<string, unknown>;
  // Recorded tick index (the tick this event was associated with).
  // Set by the recorder; never authored manually.
  tick: number;
}

export interface ReplayStep {
  // Tick index in the trace (0-based).
  tick: number;
  // dt in ms for this tick (captured from recordTick).
  dtMs: number;
  // Events that fired during this tick (between previous tick and
  // this one; recorded via recordEvent).
  events: ReplayEvent[];
}

export interface ReplayTrace {
  // Schema version of the trace envelope. Bump when the shape
  // itself changes (not when consumer events change).
  version: number;
  // Engine version that produced the trace. Useful for migration
  // decisions on playback.
  engineVersion: string;
  // Initial RNG seed; consumer reseeds Entropy with this on
  // playback for deterministic random number reproduction.
  initialSeed: number;
  // Optional initial WorldSnapshot for the consumer to deserialize
  // before playback begins.
  initialSnapshot: unknown;
  // Per-tick dt + events array.
  steps: ReplayStep[];
}

export interface ReplayRecorderOptions {
  // The seed Entropy was initialized with at the start of the
  // recorded session. Required for deterministic playback.
  initialSeed?: number;
  // Optional engineVersion stamp. Defaults to '0.0.0'.
  engineVersion?: string;
  // Optional cap on number of steps recorded (oldest dropped on
  // overflow). Useful for replay-on-crash reports. 0 = unbounded.
  maxSteps?: number;
}

const TRACE_SCHEMA_VERSION = 1;

export type RecorderMode = 'idle' | 'recording' | 'playback' | 'finished';

export class ReplayRecorder {
  private mode: RecorderMode = 'idle';
  private initialSeed: number;
  private engineVersion: string;
  private maxSteps: number;
  private initialSnapshot: unknown = null;
  private steps: ReplayStep[] = [];
  // Pending events accumulated since the last recordTick; flushed
  // into the next step.
  private pendingEvents: ReplayEvent[] = [];
  // Playback cursor.
  private cursor: number = 0;

  private constructor(opts: ReplayRecorderOptions) {
    this.initialSeed = opts.initialSeed ?? 0;
    this.engineVersion = opts.engineVersion ?? '0.0.0';
    this.maxSteps = opts.maxSteps !== undefined && opts.maxSteps >= 0
      ? Math.floor(opts.maxSteps) : 0;
  }

  static create(opts: ReplayRecorderOptions = {}): ReplayRecorder {
    return new ReplayRecorder(opts);
  }

  // Reconstruct from a trace; the recorder is in 'idle' mode and
  // ready for startPlayback().
  static fromTrace(trace: ReplayTrace): ReplayRecorder {
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
  attachInitialSnapshot(snap: unknown): void {
    this.initialSnapshot = snap;
  }

  getInitialSeed(): number { return this.initialSeed; }
  getEngineVersion(): string { return this.engineVersion; }
  getInitialSnapshot(): unknown { return this.initialSnapshot; }
  getMode(): RecorderMode { return this.mode; }
  stepCount(): number { return this.steps.length; }

  // ---------- recording ----------

  startRecording(): void {
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
  recordEvent(type: string, key?: string, data?: Record<string, unknown>): void {
    if (this.mode !== 'recording') return;
    if (typeof type !== 'string' || type.length === 0) return;
    var ev: ReplayEvent = { type: type, tick: this.steps.length };
    if (key !== undefined) ev.key = key;
    if (data !== undefined) ev.data = data;
    this.pendingEvents.push(ev);
  }

  // Record a tick. The pending events buffer is flushed into the
  // step's events array. Returns the step that was created.
  recordTick(dtMs: number): ReplayStep | null {
    if (this.mode !== 'recording') return null;
    var dt = +dtMs;
    if (!isFinite(dt)) dt = 0;
    var step: ReplayStep = {
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

  stopRecording(): void {
    if (this.mode !== 'recording') return;
    this.mode = 'finished';
    this.pendingEvents.length = 0;
  }

  // ---------- playback ----------

  startPlayback(): void {
    if (this.mode === 'recording') {
      throw new Error('ReplayRecorder.startPlayback: stop recording first');
    }
    this.mode = 'playback';
    this.cursor = 0;
  }

  // Read the next step in the trace. Returns null when the
  // playback is complete; the recorder transitions to 'finished'.
  nextStep(): ReplayStep | null {
    if (this.mode !== 'playback') return null;
    if (this.cursor >= this.steps.length) {
      this.mode = 'finished';
      return null;
    }
    var step = this.steps[this.cursor] as ReplayStep;
    this.cursor++;
    return {
      tick: step.tick,
      dtMs: step.dtMs,
      events: step.events.map(cloneEvent),
    };
  }

  // True if there is at least one more step queued for playback.
  hasNextStep(): boolean {
    return this.mode === 'playback' && this.cursor < this.steps.length;
  }

  // Reset playback cursor to 0; mode stays 'playback'. No-op if not
  // currently in playback.
  rewind(): void {
    if (this.mode !== 'playback') return;
    this.cursor = 0;
  }

  // Stop playback. Idempotent.
  stopPlayback(): void {
    if (this.mode === 'playback') {
      this.mode = 'finished';
    }
  }

  // ---------- serialization ----------

  // Build a JSON-safe trace envelope ready for storage / network.
  toTrace(): ReplayTrace {
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

function cloneEvent(e: ReplayEvent): ReplayEvent {
  // Build conditionally so exactOptionalPropertyTypes doesn't
  // reject explicit-undefined assignments.
  var out: ReplayEvent = { type: e.type, tick: e.tick };
  if (e.key !== undefined) out.key = e.key;
  if (e.data !== undefined) out.data = e.data;
  return out;
}

// Resource key for the world's resource registry.
export const RESOURCE_REPLAY_RECORDER = 'replay_recorder';
