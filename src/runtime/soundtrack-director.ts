// SoundtrackDirector - context-driven music orchestration (Wave 1.4 milestone).
//
// 1.4.5 CAPSTONE primitive (Wave 1.4 audio cinematic depth
// milestone). The conductor that ties all audio primitives
// together. MusicPlaylist (0.95) shuffles tracks within a mood.
// AmbientLayerMixer (1.4.0) layers ambient stems. AudioDuck
// (1.4.1) ducks music for SFX. SoundtrackDirector is the
// orchestrator on top: define music states (peace, combat,
// dialog, boss, victory), define transitions between them with
// per-pair fade timings + min-hold rules, and play one-shot
// stingers (cinematic flourishes) over the current state.
//
//   var st = SoundtrackDirector.create();
//   st.defineState({
//     id: 'peace', trackIds: ['vil_day_a', 'vil_day_b'],
//     defaultFadeMs: 3000,
//   });
//   st.defineState({
//     id: 'combat', trackIds: ['fight_a', 'fight_b'],
//     defaultFadeMs: 500,
//     minHoldMs: 8000,
//   });
//   st.defineState({
//     id: 'boss', trackIds: ['boss_phase_1'],
//     transitions: { combat: { fadeMs: 200 } },
//   });
//
//   on combat start: st.setState('combat');
//   on boss reveal:  st.setState('boss');
//   on victory:      st.playStinger({
//     id: 'fanfare', trackId: 'victory_fanfare',
//     durationMs: 4000, resumeAfter: true,
//   });
//
//   each frame:
//     st.tick(dtMs);
//     var snap = st.getSnapshot();
//     audioBus.crossfadeTo(snap.currentTrackId, snap.fadeProgress);
//     if (snap.stinger) audioBus.playStinger(snap.stinger.trackId);
//
// Pairs with MusicPlaylist (0.95, the per-state track shuffler),
// AmbientLayerMixer (1.4.0), AudioCueQueue (0.94), AudioDuck
// (1.4.1).
//
// Code style: var-only in browser source.

export interface StateTransition {
  // ms to crossfade when transitioning into the target state.
  fadeMs?: number;
}

export interface MusicStateSpec {
  // Stable state id ('peace' / 'combat' / 'boss' / etc).
  id: string;
  // Track ids in this state's pool. Consumer audio system maps
  // ids to actual audio assets. Can be empty (state acts as
  // silence).
  trackIds: string[];
  // Per-source-state transition overrides. Key = source state id;
  // value = { fadeMs }. If not present, defaultFadeMs is used.
  transitions?: Record<string, StateTransition>;
  // Default fade time when transitioning INTO this state. ms.
  // Default 1000.
  defaultFadeMs?: number;
  // Once this state is entered, hold for at least this long
  // before transitioning out (unless setState is called with
  // force: true). ms. Default 0.
  minHoldMs?: number;
  data?: Record<string, unknown>;
}

export interface SetStateOptions {
  // Override transition fadeMs.
  fadeMs?: number;
  // Bypass minHoldMs restriction. Default false.
  force?: boolean;
}

export interface StingerSpec {
  // Stable id for cancellation.
  id: string;
  // Track id (consumer plays this).
  trackId: string;
  // ms duration.
  durationMs: number;
  // If true, after stinger ends, resume whatever state was active
  // before. If false, leave the state alone (stinger overlays).
  // Default true.
  resumeAfter?: boolean;
}

export interface SoundtrackSnapshot {
  // Current state id (or null if no state set).
  currentState: string | null;
  // Currently selected track within the state (rotates).
  currentTrackId: string | null;
  // Previous state if mid-fade.
  previousState: string | null;
  previousTrackId: string | null;
  // 0..1 progress of the active state fade. 1 = fade complete.
  fadeProgress: number;
  // Active stinger if any.
  stinger: { id: string; trackId: string; remainingMs: number } | null;
}

export interface SoundtrackDirectorOptions {
  // Optional RNG for picking tracks within a state. Default
  // mulberry32 seeded with `seed` (default 1).
  rng?: () => number;
  seed?: number;
}

interface InternalState {
  id: string;
  trackIds: string[];
  transitions: Record<string, StateTransition>;
  defaultFadeMs: number;
  minHoldMs: number;
  data?: Record<string, unknown>;
}

interface ActiveStinger {
  id: string;
  trackId: string;
  remainingMs: number;
  resumeAfter: boolean;
  // State id to resume to (snapshot at trigger time).
  resumeStateId: string | null;
  resumeTrackId: string | null;
}

const DEFAULT_FADE_MS = 1000;

function mulberry32(seed: number): () => number {
  var s = seed >>> 0;
  return function (): number {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export class SoundtrackDirector {
  private states: Map<string, InternalState> = new Map();
  private currentStateId: string | null = null;
  private currentTrackId: string | null = null;
  private currentStateAge: number = 0;
  private prevStateId: string | null = null;
  private prevTrackId: string | null = null;
  private fadeRemainingMs: number = 0;
  private fadeTotalMs: number = 0;
  private stinger: ActiveStinger | null = null;
  private rng: () => number;
  private disposed: boolean = false;

  private constructor(opts: SoundtrackDirectorOptions) {
    if (typeof opts.rng === 'function') {
      this.rng = opts.rng;
    } else {
      var seed = opts.seed !== undefined && isFinite(opts.seed) ? opts.seed : 1;
      this.rng = mulberry32(seed);
    }
  }

  static create(opts: SoundtrackDirectorOptions = {}): SoundtrackDirector {
    return new SoundtrackDirector(opts);
  }

  // ---------- state management ----------

  defineState(spec: MusicStateSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (!Array.isArray(spec.trackIds)) return false;
    var internal: InternalState = {
      id: spec.id,
      trackIds: spec.trackIds.slice(),
      transitions: spec.transitions ? { ...spec.transitions } : {},
      defaultFadeMs: spec.defaultFadeMs !== undefined && isFinite(spec.defaultFadeMs)
          && spec.defaultFadeMs >= 0
        ? spec.defaultFadeMs : DEFAULT_FADE_MS,
      minHoldMs: spec.minHoldMs !== undefined && isFinite(spec.minHoldMs)
          && spec.minHoldMs >= 0
        ? spec.minHoldMs : 0,
    };
    if (spec.data !== undefined) internal.data = spec.data;
    this.states.set(spec.id, internal);
    return true;
  }

  hasState(id: string): boolean {
    return this.states.has(id);
  }

  stateIds(): string[] {
    var out: string[] = [];
    var keys = this.states.keys();
    var k = keys.next();
    while (!k.done) {
      out.push(k.value);
      k = keys.next();
    }
    return out;
  }

  // Set the current state. Returns true if accepted, false if
  // unknown state or minHoldMs not yet elapsed (and !force).
  setState(stateId: string, opts: SetStateOptions = {}): boolean {
    if (this.disposed) return false;
    var target = this.states.get(stateId);
    if (!target) return false;
    if (this.currentStateId === stateId) {
      // Same state; no-op.
      return true;
    }
    // Min-hold check on current state.
    if (this.currentStateId !== null && !opts.force) {
      var current = this.states.get(this.currentStateId);
      if (current && this.currentStateAge < current.minHoldMs) {
        return false;
      }
    }
    // Resolve fade.
    var fadeMs: number;
    if (opts.fadeMs !== undefined && isFinite(opts.fadeMs) && opts.fadeMs >= 0) {
      fadeMs = opts.fadeMs;
    } else if (this.currentStateId !== null
        && target.transitions[this.currentStateId]
        && target.transitions[this.currentStateId]!.fadeMs !== undefined) {
      fadeMs = target.transitions[this.currentStateId]!.fadeMs as number;
    } else {
      fadeMs = target.defaultFadeMs;
    }
    this.prevStateId = this.currentStateId;
    this.prevTrackId = this.currentTrackId;
    this.currentStateId = stateId;
    this.currentTrackId = this.pickTrackForState(target);
    this.currentStateAge = 0;
    this.fadeRemainingMs = fadeMs;
    this.fadeTotalMs = fadeMs;
    if (fadeMs <= 0) {
      this.prevStateId = null;
      this.prevTrackId = null;
    }
    return true;
  }

  getCurrentState(): string | null {
    return this.currentStateId;
  }

  // Pick a track from the given state's pool (or current state).
  // Returns null if state has no tracks.
  pickTrack(stateId?: string): string | null {
    var id = stateId !== undefined ? stateId : this.currentStateId;
    if (id === null) return null;
    var state = this.states.get(id);
    if (!state) return null;
    return this.pickTrackForState(state);
  }

  // ---------- stingers ----------

  playStinger(spec: StingerSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (typeof spec.trackId !== 'string' || spec.trackId.length === 0) return false;
    if (!isFinite(spec.durationMs) || spec.durationMs < 0) return false;
    this.stinger = {
      id: spec.id,
      trackId: spec.trackId,
      remainingMs: Math.floor(spec.durationMs),
      resumeAfter: spec.resumeAfter !== false,
      resumeStateId: this.currentStateId,
      resumeTrackId: this.currentTrackId,
    };
    return true;
  }

  cancelStinger(id: string): boolean {
    if (this.disposed) return false;
    if (!this.stinger || this.stinger.id !== id) return false;
    this.stinger = null;
    return true;
  }

  // ---------- snapshot ----------

  getSnapshot(): SoundtrackSnapshot {
    var fadeProgress = this.fadeTotalMs > 0
      ? Math.max(0, Math.min(1, 1 - this.fadeRemainingMs / this.fadeTotalMs))
      : 1;
    var snap: SoundtrackSnapshot = {
      currentState: this.currentStateId,
      currentTrackId: this.currentTrackId,
      previousState: this.prevStateId,
      previousTrackId: this.prevTrackId,
      fadeProgress: fadeProgress,
      stinger: this.stinger ? {
        id: this.stinger.id,
        trackId: this.stinger.trackId,
        remainingMs: this.stinger.remainingMs,
      } : null,
    };
    return snap;
  }

  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    if (this.currentStateId !== null) {
      this.currentStateAge += dt;
    }
    if (this.fadeRemainingMs > 0) {
      this.fadeRemainingMs -= dt;
      if (this.fadeRemainingMs <= 0) {
        this.fadeRemainingMs = 0;
        this.prevStateId = null;
        this.prevTrackId = null;
      }
    }
    if (this.stinger !== null) {
      this.stinger.remainingMs -= dt;
      if (this.stinger.remainingMs <= 0) {
        var s = this.stinger;
        this.stinger = null;
        if (s.resumeAfter && s.resumeStateId !== null
            && s.resumeStateId !== this.currentStateId) {
          // Resume previous state (force to bypass minHoldMs).
          this.setState(s.resumeStateId, { fadeMs: 0, force: true });
        }
      }
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.states.clear();
    this.currentStateId = null;
    this.currentTrackId = null;
    this.prevStateId = null;
    this.prevTrackId = null;
    this.fadeRemainingMs = 0;
    this.fadeTotalMs = 0;
    this.currentStateAge = 0;
    this.stinger = null;
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private pickTrackForState(state: InternalState): string | null {
    if (state.trackIds.length === 0) return null;
    if (state.trackIds.length === 1) return state.trackIds[0] as string;
    var r = 0;
    try { r = this.rng(); } catch { r = 0; }
    if (!isFinite(r) || r < 0) r = 0;
    if (r >= 1) r = 0.9999;
    var idx = Math.floor(r * state.trackIds.length);
    return state.trackIds[idx] as string;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_SOUNDTRACK_DIRECTOR = 'soundtrack_director';
