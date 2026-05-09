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
const DEFAULT_FADE_MS = 1000;
function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
}
export class SoundtrackDirector {
    states = new Map();
    currentStateId = null;
    currentTrackId = null;
    currentStateAge = 0;
    prevStateId = null;
    prevTrackId = null;
    fadeRemainingMs = 0;
    fadeTotalMs = 0;
    stinger = null;
    rng;
    disposed = false;
    constructor(opts) {
        if (typeof opts.rng === 'function') {
            this.rng = opts.rng;
        }
        else {
            var seed = opts.seed !== undefined && isFinite(opts.seed) ? opts.seed : 1;
            this.rng = mulberry32(seed);
        }
    }
    static create(opts = {}) {
        return new SoundtrackDirector(opts);
    }
    // ---------- state management ----------
    defineState(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (!Array.isArray(spec.trackIds))
            return false;
        var internal = {
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
        if (spec.data !== undefined)
            internal.data = spec.data;
        this.states.set(spec.id, internal);
        return true;
    }
    hasState(id) {
        return this.states.has(id);
    }
    stateIds() {
        var out = [];
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
    setState(stateId, opts = {}) {
        if (this.disposed)
            return false;
        var target = this.states.get(stateId);
        if (!target)
            return false;
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
        var fadeMs;
        if (opts.fadeMs !== undefined && isFinite(opts.fadeMs) && opts.fadeMs >= 0) {
            fadeMs = opts.fadeMs;
        }
        else if (this.currentStateId !== null
            && target.transitions[this.currentStateId]
            && target.transitions[this.currentStateId].fadeMs !== undefined) {
            fadeMs = target.transitions[this.currentStateId].fadeMs;
        }
        else {
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
    getCurrentState() {
        return this.currentStateId;
    }
    // Pick a track from the given state's pool (or current state).
    // Returns null if state has no tracks.
    pickTrack(stateId) {
        var id = stateId !== undefined ? stateId : this.currentStateId;
        if (id === null)
            return null;
        var state = this.states.get(id);
        if (!state)
            return null;
        return this.pickTrackForState(state);
    }
    // ---------- stingers ----------
    playStinger(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (typeof spec.trackId !== 'string' || spec.trackId.length === 0)
            return false;
        if (!isFinite(spec.durationMs) || spec.durationMs < 0)
            return false;
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
    cancelStinger(id) {
        if (this.disposed)
            return false;
        if (!this.stinger || this.stinger.id !== id)
            return false;
        this.stinger = null;
        return true;
    }
    // ---------- snapshot ----------
    getSnapshot() {
        var fadeProgress = this.fadeTotalMs > 0
            ? Math.max(0, Math.min(1, 1 - this.fadeRemainingMs / this.fadeTotalMs))
            : 1;
        var snap = {
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
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
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
    clear() {
        if (this.disposed)
            return;
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
    dispose() {
        this.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    pickTrackForState(state) {
        if (state.trackIds.length === 0)
            return null;
        if (state.trackIds.length === 1)
            return state.trackIds[0];
        var r = 0;
        try {
            r = this.rng();
        }
        catch {
            r = 0;
        }
        if (!isFinite(r) || r < 0)
            r = 0;
        if (r >= 1)
            r = 0.9999;
        var idx = Math.floor(r * state.trackIds.length);
        return state.trackIds[idx];
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_SOUNDTRACK_DIRECTOR = 'soundtrack_director';
//# sourceMappingURL=soundtrack-director.js.map