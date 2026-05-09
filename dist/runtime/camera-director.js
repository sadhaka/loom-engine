// CameraDirector - cinematic camera sequencer.
//
// 1.1.3 enabling primitive (Wave 1.1 combat depth). CameraController
// (0.41) is the runtime camera (player follow, smooth pan, manual
// drag). CameraDirector is the cinematic counterpart: scripted
// keyframed sequences for boss reveals, death cams, dialogue
// close-ups, scripted cutscenes. Handoff: when the director plays,
// the consumer reads getState() and pushes the snapshot to the
// runtime camera; when isPlaying() is false, control returns to
// whatever the consumer normally drives.
//
//   var dir = CameraDirector.create({ initial: { x: 0, y: 0, zoom: 1 } });
//   dir.play({
//     keyframes: [
//       { atMs: 0,    x: 0, y: 0, zoom: 1 },
//       { atMs: 800,  x: 200, y: 100, zoom: 2.5, easing: 'easeInOut' },
//       { atMs: 1500, x: 200, y: 100, zoom: 2.5 }, // hold
//       { atMs: 2000, x: 0, y: 0, zoom: 1, easing: 'easeInOut' },
//     ],
//     onFinish: () => returnControlToPlayerCam(),
//   });
//   each frame:    dir.tick(dtMs); var s = dir.getState();
//                  if (s.isPlaying) cam.set(s.x, s.y, s.zoom, s.rotation);
//
// Engine ships zero render path - the consumer wires the snapshot
// to whatever camera they have.
//
// Pairs with CameraController (0.41), Tween (0.32, single-channel
// easing), CutsceneSequencer (1.1.4 next, broader event timeline).
//
// Code style: var-only in browser source.
const DEFAULT_INITIAL = { x: 0, y: 0, zoom: 1, rotation: 0 };
function easingFn(name, t) {
    if (t <= 0)
        return 0;
    if (t >= 1)
        return 1;
    switch (name) {
        case 'linear': return t;
        case 'easeIn': return t * t;
        case 'easeOut': return 1 - (1 - t) * (1 - t);
        case 'easeInOut': return 0.5 - 0.5 * Math.cos(Math.PI * t);
        case 'step': return 0; // snap to from-frame; 1 only at exact t=1.
    }
    return t;
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
export class CameraDirector {
    current;
    initial;
    keyframes = [];
    elapsed = 0;
    speed = 1;
    playing = false;
    paused = false;
    onFinish = null;
    disposed = false;
    constructor(opts) {
        this.initial = {
            x: opts.initial?.x ?? DEFAULT_INITIAL.x,
            y: opts.initial?.y ?? DEFAULT_INITIAL.y,
            zoom: opts.initial?.zoom ?? DEFAULT_INITIAL.zoom,
            rotation: opts.initial?.rotation ?? DEFAULT_INITIAL.rotation,
        };
        this.current = { ...this.initial };
    }
    static create(opts = {}) {
        return new CameraDirector(opts);
    }
    // Begin playing a keyframed sequence. Replaces any prior
    // sequence. Returns true if accepted.
    play(opts) {
        if (this.disposed)
            return false;
        if (!opts || !Array.isArray(opts.keyframes) || opts.keyframes.length === 0) {
            return false;
        }
        var sorted = opts.keyframes.slice().sort(function (a, b) {
            return a.atMs - b.atMs;
        });
        this.keyframes = sorted;
        this.elapsed = 0;
        this.speed = opts.speed !== undefined && isFinite(opts.speed) && opts.speed > 0
            ? opts.speed : 1;
        this.playing = true;
        this.paused = false;
        this.onFinish = opts.onFinish ?? null;
        // Snap to first keyframe.
        this.applyAtTime(0);
        return true;
    }
    // Advance the sequencer.
    tick(dtMs) {
        if (this.disposed)
            return;
        if (!this.playing || this.paused)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        this.elapsed += dt * this.speed;
        var lastAt = this.keyframes[this.keyframes.length - 1].atMs;
        if (this.elapsed >= lastAt) {
            this.applyAtTime(lastAt);
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
        this.applyAtTime(this.elapsed);
    }
    // Manually scrub to a specific elapsed time. Clamped to
    // [0, lastKeyframe.atMs].
    jumpTo(ms) {
        if (this.disposed || !this.playing || this.keyframes.length === 0)
            return;
        if (!isFinite(ms))
            return;
        var lastAt = this.keyframes[this.keyframes.length - 1].atMs;
        var clamped = Math.max(0, Math.min(lastAt, ms));
        this.elapsed = clamped;
        this.applyAtTime(clamped);
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
    // Stop the sequence WITHOUT firing onFinish. Snaps camera back
    // to initial.
    stop() {
        if (this.disposed)
            return;
        this.playing = false;
        this.paused = false;
        this.onFinish = null;
        this.elapsed = 0;
        this.keyframes = [];
        this.current = { ...this.initial };
    }
    setSpeed(multiplier) {
        if (this.disposed)
            return;
        if (!isFinite(multiplier) || multiplier <= 0)
            return;
        this.speed = multiplier;
    }
    isPlaying() { return this.playing; }
    isPaused() { return this.paused; }
    getState() {
        var lastAt = this.keyframes.length > 0
            ? this.keyframes[this.keyframes.length - 1].atMs : 0;
        var progress = lastAt > 0 ? Math.max(0, Math.min(1, this.elapsed / lastAt)) : 0;
        return {
            x: this.current.x,
            y: this.current.y,
            zoom: this.current.zoom,
            rotation: this.current.rotation,
            isPlaying: this.playing,
            isPaused: this.paused,
            progress: progress,
            elapsedMs: this.elapsed,
            speed: this.speed,
        };
    }
    dispose() {
        this.keyframes = [];
        this.onFinish = null;
        this.playing = false;
        this.paused = false;
        this.disposed = true;
    }
    // ---------- private ----------
    applyAtTime(timeMs) {
        if (this.keyframes.length === 0)
            return;
        if (this.keyframes.length === 1) {
            var only = this.keyframes[0];
            this.setCurrent(only);
            return;
        }
        // Find the segment [from, to] containing timeMs.
        var fromIdx = 0;
        for (var i = 0; i < this.keyframes.length - 1; i++) {
            var kf = this.keyframes[i];
            if (kf.atMs <= timeMs)
                fromIdx = i;
            else
                break;
        }
        var toIdx = Math.min(this.keyframes.length - 1, fromIdx + 1);
        var from = this.keyframes[fromIdx];
        var to = this.keyframes[toIdx];
        if (from === to || to.atMs <= from.atMs) {
            this.setCurrent(to);
            return;
        }
        var span = to.atMs - from.atMs;
        var rawT = (timeMs - from.atMs) / span;
        var t = Math.max(0, Math.min(1, rawT));
        var easedT = easingFn(to.easing ?? 'linear', t);
        this.current.x = lerp(from.x, to.x, easedT);
        this.current.y = lerp(from.y, to.y, easedT);
        this.current.zoom = lerp(from.zoom, to.zoom, easedT);
        var fromRot = from.rotation ?? 0;
        var toRot = to.rotation ?? 0;
        this.current.rotation = lerp(fromRot, toRot, easedT);
    }
    setCurrent(kf) {
        this.current.x = kf.x;
        this.current.y = kf.y;
        this.current.zoom = kf.zoom;
        this.current.rotation = kf.rotation ?? 0;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_CAMERA_DIRECTOR = 'camera_director';
//# sourceMappingURL=camera-director.js.map