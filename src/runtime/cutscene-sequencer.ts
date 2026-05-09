// CutsceneSequencer - generic timed-cue event timeline.
//
// 1.1.4 enabling primitive (Wave 1.1 combat depth). CameraDirector
// (1.1.3) is camera-specific. CutsceneSequencer is the broader
// orchestrator: schedule ARBITRARY events at specific times in a
// scripted sequence. "At t=0 play voice line, at t=500 emit a
// particle effect, at t=1000 trigger dialog X, at t=2000 end."
// The consumer's onCue callback dispatches each cue to the right
// subsystem (audio bus, camera director, particle pool, dialog
// tree, etc.).
//
//   var seq = CutsceneSequencer.create();
//   seq.play({
//     totalMs: 4000,
//     cues: [
//       { atMs: 0,    kind: 'camera', payload: { sequence: bossRevealCam } },
//       { atMs: 200,  kind: 'audio',  payload: { cueId: 'boss_horn' } },
//       { atMs: 1500, kind: 'dialog', payload: { lineId: 'boss_taunt' } },
//       { atMs: 3500, kind: 'emit',   payload: { event: 'boss_active' } },
//     ],
//     onCue: (cue) => dispatch(cue.kind, cue.payload),
//     onFinish: () => returnToGameplay(),
//   });
//   each frame: seq.tick(dtMs);
//
// Pairs with CameraDirector (1.1.3, camera channel), AudioCueQueue
// (0.94, audio channel), Coroutine (0.69, multi-frame logic), all
// the various render-state primitives.
//
// Code style: var-only in browser source.

export interface Cue {
  // Time in ms since play() start at which this cue should fire.
  atMs: number;
  // Channel name. Engine does not interpret; consumer's onCue
  // routes by kind.
  kind: string;
  // Optional payload for the consumer.
  payload?: Record<string, unknown>;
  // Optional stable identifier for diagnostics / replay.
  id?: string;
}

export interface CutsceneState {
  elapsedMs: number;
  totalMs: number;
  isPlaying: boolean;
  isPaused: boolean;
  // 0..1 over the whole sequence.
  progress: number;
  speed: number;
  // Number of cues fired so far in the current play.
  firedCount: number;
}

export interface PlayOptions {
  cues: Cue[];
  // Total sequence length. Default = last cue's atMs (rounded up).
  // Pass an explicit totalMs to add tail time after the last cue.
  totalMs?: number;
  // Speed multiplier (1 = normal). Default 1.
  speed?: number;
  // Fired when a cue's atMs is crossed.
  onCue?: (cue: Cue) => void;
  // Fired when the sequence completes naturally (elapsedMs reaches
  // totalMs). NOT fired on stop().
  onFinish?: () => void;
}

export interface CutsceneSequencerOptions {
  // Reserved for future use (e.g. global onCue hook).
}

interface InternalCue extends Cue {
  fired: boolean;
}

export class CutsceneSequencer {
  private cues: InternalCue[] = [];
  private elapsed: number = 0;
  private totalMs: number = 0;
  private speed: number = 1;
  private playing: boolean = false;
  private paused: boolean = false;
  private firedCount: number = 0;
  private onCue: ((c: Cue) => void) | null = null;
  private onFinish: (() => void) | null = null;
  private disposed: boolean = false;

  private constructor(_opts: CutsceneSequencerOptions) {
    // Reserved.
  }

  static create(opts: CutsceneSequencerOptions = {}): CutsceneSequencer {
    return new CutsceneSequencer(opts);
  }

  play(opts: PlayOptions): boolean {
    if (this.disposed) return false;
    if (!opts || !Array.isArray(opts.cues) || opts.cues.length === 0) return false;
    var sorted: InternalCue[] = opts.cues.slice().map(function (c) {
      var copy: InternalCue = {
        atMs: isFinite(c.atMs) && c.atMs >= 0 ? c.atMs : 0,
        kind: typeof c.kind === 'string' ? c.kind : '',
        fired: false,
      };
      if (c.payload !== undefined) copy.payload = c.payload;
      if (c.id !== undefined) copy.id = c.id;
      return copy;
    }).sort(function (a, b) { return a.atMs - b.atMs; });
    var lastAt = sorted.length > 0 ? (sorted[sorted.length - 1] as InternalCue).atMs : 0;
    var total = opts.totalMs !== undefined && isFinite(opts.totalMs)
        && opts.totalMs >= lastAt ? opts.totalMs : lastAt;
    this.cues = sorted;
    this.totalMs = total;
    this.elapsed = 0;
    this.speed = opts.speed !== undefined && isFinite(opts.speed) && opts.speed > 0
      ? opts.speed : 1;
    this.firedCount = 0;
    this.onCue = opts.onCue ?? null;
    this.onFinish = opts.onFinish ?? null;
    this.playing = true;
    this.paused = false;
    // Fire any cues at atMs=0.
    this.fireCuesUpTo(0);
    return true;
  }

  tick(dtMs: number): void {
    if (this.disposed) return;
    if (!this.playing || this.paused) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    this.elapsed += dt * this.speed;
    if (this.elapsed >= this.totalMs) {
      this.elapsed = this.totalMs;
      this.fireCuesUpTo(this.totalMs);
      this.playing = false;
      var cb = this.onFinish;
      this.onFinish = null;
      if (cb) {
        try { cb(); } catch { /* ignore */ }
      }
      return;
    }
    this.fireCuesUpTo(this.elapsed);
  }

  pause(): void {
    if (this.disposed || !this.playing) return;
    this.paused = true;
  }

  resume(): void {
    if (this.disposed || !this.playing) return;
    this.paused = false;
  }

  // Stop without firing onFinish; resets elapsed + cue state.
  stop(): void {
    if (this.disposed) return;
    this.playing = false;
    this.paused = false;
    this.elapsed = 0;
    this.cues = [];
    this.firedCount = 0;
    this.onCue = null;
    this.onFinish = null;
  }

  setSpeed(multiplier: number): void {
    if (this.disposed) return;
    if (!isFinite(multiplier) || multiplier <= 0) return;
    this.speed = multiplier;
  }

  // Scrub to a specific elapsed time. Cues between current elapsed
  // and target time are fired (forward scrub fires intervening
  // cues; backward scrub does NOT un-fire or re-fire). Target is
  // clamped to [0, totalMs].
  jumpTo(ms: number): void {
    if (this.disposed || !this.playing) return;
    if (!isFinite(ms)) return;
    var target = Math.max(0, Math.min(this.totalMs, ms));
    if (target > this.elapsed) {
      this.elapsed = target;
      this.fireCuesUpTo(target);
    } else {
      // Backward scrub: just move cursor; don't replay cues.
      this.elapsed = target;
    }
  }

  isPlaying(): boolean { return this.playing; }
  isPaused(): boolean { return this.paused; }

  getState(): CutsceneState {
    var progress = this.totalMs > 0
      ? Math.max(0, Math.min(1, this.elapsed / this.totalMs)) : 0;
    return {
      elapsedMs: this.elapsed,
      totalMs: this.totalMs,
      isPlaying: this.playing,
      isPaused: this.paused,
      progress: progress,
      speed: this.speed,
      firedCount: this.firedCount,
    };
  }

  dispose(): void {
    this.cues = [];
    this.onCue = null;
    this.onFinish = null;
    this.playing = false;
    this.paused = false;
    this.disposed = true;
  }

  // ---------- private ----------

  private fireCuesUpTo(ms: number): void {
    if (!this.onCue) {
      // Still mark cues as fired so firedCount is accurate.
      for (var i = 0; i < this.cues.length; i++) {
        var c = this.cues[i] as InternalCue;
        if (!c.fired && c.atMs <= ms) {
          c.fired = true;
          this.firedCount++;
        }
      }
      return;
    }
    for (var j = 0; j < this.cues.length; j++) {
      var cue = this.cues[j] as InternalCue;
      if (!cue.fired && cue.atMs <= ms) {
        cue.fired = true;
        this.firedCount++;
        try { this.onCue(this.publicView(cue)); } catch { /* ignore */ }
      }
    }
  }

  private publicView(c: InternalCue): Cue {
    var copy: Cue = { atMs: c.atMs, kind: c.kind };
    if (c.payload !== undefined) copy.payload = c.payload;
    if (c.id !== undefined) copy.id = c.id;
    return copy;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_CUTSCENE_SEQUENCER = 'cutscene_sequencer';
