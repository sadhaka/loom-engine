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
export class CutsceneSequencer {
    cues = [];
    elapsed = 0;
    totalMs = 0;
    speed = 1;
    playing = false;
    paused = false;
    firedCount = 0;
    onCue = null;
    onFinish = null;
    disposed = false;
    constructor(_opts) {
        // Reserved.
    }
    static create(opts = {}) {
        return new CutsceneSequencer(opts);
    }
    play(opts) {
        if (this.disposed)
            return false;
        if (!opts || !Array.isArray(opts.cues) || opts.cues.length === 0)
            return false;
        var sorted = opts.cues.slice().map(function (c) {
            var copy = {
                atMs: isFinite(c.atMs) && c.atMs >= 0 ? c.atMs : 0,
                kind: typeof c.kind === 'string' ? c.kind : '',
                fired: false,
            };
            if (c.payload !== undefined)
                copy.payload = c.payload;
            if (c.id !== undefined)
                copy.id = c.id;
            return copy;
        }).sort(function (a, b) { return a.atMs - b.atMs; });
        var lastAt = sorted.length > 0 ? sorted[sorted.length - 1].atMs : 0;
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
    tick(dtMs) {
        if (this.disposed)
            return;
        if (!this.playing || this.paused)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        this.elapsed += dt * this.speed;
        if (this.elapsed >= this.totalMs) {
            this.elapsed = this.totalMs;
            this.fireCuesUpTo(this.totalMs);
            this.playing = false;
            var cb = this.onFinish;
            this.onFinish = null;
            if (cb) {
                try {
                    cb();
                }
                catch { /* ignore */ }
            }
            return;
        }
        this.fireCuesUpTo(this.elapsed);
    }
    pause() {
        if (this.disposed || !this.playing)
            return;
        this.paused = true;
    }
    resume() {
        if (this.disposed || !this.playing)
            return;
        this.paused = false;
    }
    // Stop without firing onFinish; resets elapsed + cue state.
    stop() {
        if (this.disposed)
            return;
        this.playing = false;
        this.paused = false;
        this.elapsed = 0;
        this.cues = [];
        this.firedCount = 0;
        this.onCue = null;
        this.onFinish = null;
    }
    setSpeed(multiplier) {
        if (this.disposed)
            return;
        if (!isFinite(multiplier) || multiplier <= 0)
            return;
        this.speed = multiplier;
    }
    // Scrub to a specific elapsed time. Cues between current elapsed
    // and target time are fired (forward scrub fires intervening
    // cues; backward scrub does NOT un-fire or re-fire). Target is
    // clamped to [0, totalMs].
    jumpTo(ms) {
        if (this.disposed || !this.playing)
            return;
        if (!isFinite(ms))
            return;
        var target = Math.max(0, Math.min(this.totalMs, ms));
        if (target > this.elapsed) {
            this.elapsed = target;
            this.fireCuesUpTo(target);
        }
        else {
            // Backward scrub: just move cursor; don't replay cues.
            this.elapsed = target;
        }
    }
    isPlaying() { return this.playing; }
    isPaused() { return this.paused; }
    getState() {
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
    dispose() {
        this.cues = [];
        this.onCue = null;
        this.onFinish = null;
        this.playing = false;
        this.paused = false;
        this.disposed = true;
    }
    // ---------- private ----------
    fireCuesUpTo(ms) {
        if (!this.onCue) {
            // Still mark cues as fired so firedCount is accurate.
            for (var i = 0; i < this.cues.length; i++) {
                var c = this.cues[i];
                if (!c.fired && c.atMs <= ms) {
                    c.fired = true;
                    this.firedCount++;
                }
            }
            return;
        }
        for (var j = 0; j < this.cues.length; j++) {
            var cue = this.cues[j];
            if (!cue.fired && cue.atMs <= ms) {
                cue.fired = true;
                this.firedCount++;
                try {
                    this.onCue(this.publicView(cue));
                }
                catch { /* ignore */ }
            }
        }
    }
    publicView(c) {
        var copy = { atMs: c.atMs, kind: c.kind };
        if (c.payload !== undefined)
            copy.payload = c.payload;
        if (c.id !== undefined)
            copy.id = c.id;
        return copy;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_CUTSCENE_SEQUENCER = 'cutscene_sequencer';
//# sourceMappingURL=cutscene-sequencer.js.map