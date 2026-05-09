// GhostReplay - record + replay translucent shadow runs.
//
// 1.1.5 CAPSTONE primitive (Wave 1.1 combat depth milestone).
// Souls-likes show "this is how the player who left the message
// died." Racers show your previous best lap as a ghost car.
// Survivor-likes show your last run's path so you can learn from
// it. GhostReplay is the engine-side machinery: record frames of
// an entity (position + rotation + animation), serialize the
// recording, then play it back as one or more concurrent "ghost"
// playbacks the renderer draws translucent.
//
//   var rep = GhostReplay.create();
//
//   // While the player runs:
//   rep.startRecording({ sampleRateMs: 50 });
//   each frame: rep.recordSnapshot({
//     x: player.x, y: player.y, rotation: player.facing,
//     animationId: player.currentAnim,
//   });
//   on death: var recording = rep.stopRecording();
//
//   // On the next run:
//   rep.play(recording, { id: 'last_run', loop: false, speed: 1 });
//   each frame:
//     rep.tick(dtMs);
//     var ghost = rep.getGhost('last_run');
//     if (ghost) renderer.drawGhost(ghost.x, ghost.y, ghost.rotation,
//                                   ghost.animationId, ghost.alpha);
//
// Engine ships zero render path - the consumer reads the snapshot
// and draws the ghost in whatever style fits (translucent sprite,
// outline shader, breadcrumb trail, particle dots).
//
// Pairs with ReplayRecorder (0.58, deterministic event recording),
// CameraDirector (1.1.3), CutsceneSequencer (1.1.4). ReplayRecorder
// records GAMEPLAY EVENTS for full deterministic replay; GhostReplay
// records VISUAL STATE for shadow rendering. Different layer.
//
// Code style: var-only in browser source.
const DEFAULT_SAMPLE_RATE = 50;
const DEFAULT_MAX_FRAMES = 1200;
function lerp(a, b, t) {
    return a + (b - a) * t;
}
export class GhostReplay {
    recording = null;
    ghosts = new Map();
    disposed = false;
    constructor(_opts) { }
    static create(opts = {}) {
        return new GhostReplay(opts);
    }
    // ---------- recording ----------
    startRecording(opts = {}) {
        if (this.disposed)
            return false;
        var sampleRate = opts.sampleRateMs !== undefined
            && isFinite(opts.sampleRateMs) && opts.sampleRateMs >= 0
            ? Math.floor(opts.sampleRateMs) : DEFAULT_SAMPLE_RATE;
        var maxFrames = opts.maxFrames !== undefined
            && isFinite(opts.maxFrames) && opts.maxFrames > 0
            ? Math.floor(opts.maxFrames) : DEFAULT_MAX_FRAMES;
        this.recording = {
            frames: [],
            startedAtMs: 0,
            lastSampleAtMs: -Infinity,
            sampleRateMs: sampleRate,
            maxFrames: maxFrames,
            label: typeof opts.label === 'string' ? opts.label : '',
        };
        return true;
    }
    isRecording() {
        return !!this.recording;
    }
    // Record a snapshot. The first call seeds atMs=0; subsequent
    // calls compute atMs as elapsed since the first.
    // Snapshots are dropped if sampleRateMs hasn't elapsed since the
    // previous recorded snapshot.
    recordSnapshot(s) {
        if (this.disposed || !this.recording)
            return false;
        if (!s || !isFinite(s.x) || !isFinite(s.y))
            return false;
        var rec = this.recording;
        var nextAt;
        if (rec.frames.length === 0) {
            nextAt = 0;
        }
        else {
            // We don't know wall time; advance by sampleRate. Treat each
            // recordSnapshot call as one tick at the configured rate.
            nextAt = rec.lastSampleAtMs + rec.sampleRateMs;
        }
        var frame = {
            atMs: nextAt,
            x: s.x,
            y: s.y,
        };
        if (s.rotation !== undefined && isFinite(s.rotation))
            frame.rotation = s.rotation;
        if (typeof s.animationId === 'string')
            frame.animationId = s.animationId;
        if (s.data !== undefined)
            frame.data = s.data;
        rec.frames.push(frame);
        rec.lastSampleAtMs = nextAt;
        if (rec.frames.length > rec.maxFrames) {
            rec.frames.shift();
            // Re-anchor times so atMs=0 stays the first frame.
            var offset = rec.frames[0].atMs;
            if (offset !== 0) {
                for (var i = 0; i < rec.frames.length; i++) {
                    rec.frames[i].atMs -= offset;
                }
                rec.lastSampleAtMs -= offset;
            }
        }
        return true;
    }
    stopRecording() {
        if (this.disposed || !this.recording)
            return null;
        var rec = this.recording;
        var totalMs = rec.frames.length > 0
            ? rec.frames[rec.frames.length - 1].atMs : 0;
        var out = {
            frames: rec.frames.slice(),
            totalMs: totalMs,
        };
        if (rec.label)
            out.label = rec.label;
        this.recording = null;
        return out;
    }
    cancelRecording() {
        if (this.disposed)
            return;
        this.recording = null;
    }
    // ---------- playback ----------
    play(recording, opts = {}) {
        if (this.disposed)
            return false;
        if (!recording || !Array.isArray(recording.frames) || recording.frames.length === 0) {
            return false;
        }
        var id = typeof opts.id === 'string' && opts.id.length > 0
            ? opts.id : (recording.label || 'ghost');
        var speed = opts.speed !== undefined && isFinite(opts.speed) && opts.speed > 0
            ? opts.speed : 1;
        var fadeIn = opts.fadeInMs !== undefined && isFinite(opts.fadeInMs)
            && opts.fadeInMs >= 0 ? opts.fadeInMs : 0;
        var fadeOut = opts.fadeOutMs !== undefined && isFinite(opts.fadeOutMs)
            && opts.fadeOutMs >= 0 ? opts.fadeOutMs : 0;
        var ghost = {
            id: id,
            recording: { frames: recording.frames.slice(), totalMs: recording.totalMs,
                ...(recording.label !== undefined ? { label: recording.label } : {}) },
            elapsed: 0,
            speed: speed,
            loop: !!opts.loop,
            fadeInMs: fadeIn,
            fadeOutMs: fadeOut,
            paused: false,
            finished: false,
            onFinish: opts.onFinish ?? null,
        };
        this.ghosts.set(id, ghost);
        return true;
    }
    stop(id) {
        if (this.disposed)
            return false;
        return this.ghosts.delete(id);
    }
    stopAll() {
        if (this.disposed)
            return;
        this.ghosts.clear();
    }
    pause(id) {
        if (this.disposed)
            return false;
        var g = this.ghosts.get(id);
        if (!g)
            return false;
        g.paused = true;
        return true;
    }
    resume(id) {
        if (this.disposed)
            return false;
        var g = this.ghosts.get(id);
        if (!g)
            return false;
        g.paused = false;
        return true;
    }
    setSpeed(id, multiplier) {
        if (this.disposed)
            return false;
        var g = this.ghosts.get(id);
        if (!g)
            return false;
        if (!isFinite(multiplier) || multiplier <= 0)
            return false;
        g.speed = multiplier;
        return true;
    }
    has(id) {
        return this.ghosts.has(id);
    }
    // Returns interpolated snapshot at the ghost's current elapsed
    // time. Returns null if no ghost with that id.
    getGhost(id) {
        var g = this.ghosts.get(id);
        if (!g)
            return null;
        return this.snapshotForGhost(g);
    }
    list() {
        var out = [];
        var keys = this.ghosts.keys();
        var k = keys.next();
        while (!k.done) {
            var g = this.ghosts.get(k.value);
            if (g)
                out.push(this.snapshotForGhost(g));
            k = keys.next();
        }
        return out;
    }
    forEach(cb) {
        if (this.disposed)
            return;
        var ghosts = this.list();
        for (var i = 0; i < ghosts.length; i++) {
            try {
                cb(ghosts[i]);
            }
            catch { /* ignore */ }
        }
    }
    count() {
        return this.ghosts.size;
    }
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var finished = [];
        var ids = [];
        var keys = this.ghosts.keys();
        var k = keys.next();
        while (!k.done) {
            ids.push(k.value);
            k = keys.next();
        }
        for (var i = 0; i < ids.length; i++) {
            var g = this.ghosts.get(ids[i]);
            if (!g || g.paused)
                continue;
            g.elapsed += dt * g.speed;
            if (g.elapsed >= g.recording.totalMs) {
                if (g.loop) {
                    if (g.recording.totalMs > 0) {
                        g.elapsed = g.elapsed % g.recording.totalMs;
                    }
                    else {
                        g.elapsed = 0;
                    }
                }
                else {
                    g.elapsed = g.recording.totalMs;
                    if (!g.finished) {
                        g.finished = true;
                        finished.push(g);
                    }
                }
            }
        }
        for (var j = 0; j < finished.length; j++) {
            var fg = finished[j];
            var cb = fg.onFinish;
            fg.onFinish = null;
            if (cb) {
                try {
                    cb();
                }
                catch { /* ignore */ }
            }
        }
    }
    // ---------- serialization ----------
    exportRecording(recording) {
        return JSON.stringify(recording);
    }
    importRecording(data) {
        if (typeof data !== 'string' || data.length === 0)
            return null;
        try {
            var parsed = JSON.parse(data);
            if (!parsed || !Array.isArray(parsed.frames))
                return null;
            return {
                frames: parsed.frames,
                totalMs: typeof parsed.totalMs === 'number' ? parsed.totalMs : 0,
                ...(typeof parsed.label === 'string' ? { label: parsed.label } : {}),
            };
        }
        catch {
            return null;
        }
    }
    dispose() {
        this.recording = null;
        this.ghosts.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    snapshotForGhost(g) {
        var frames = g.recording.frames;
        var snapshot = {
            id: g.id,
            x: 0,
            y: 0,
            rotation: 0,
            animationId: null,
            progress: 0,
            elapsedMs: g.elapsed,
            isPlaying: !g.finished,
            isPaused: g.paused,
            speed: g.speed,
            alpha: 1,
        };
        if (frames.length === 0)
            return snapshot;
        if (g.recording.totalMs > 0) {
            snapshot.progress = Math.max(0, Math.min(1, g.elapsed / g.recording.totalMs));
        }
        // Interpolate position between surrounding frames.
        var first = frames[0];
        var last = frames[frames.length - 1];
        if (g.elapsed <= first.atMs) {
            snapshot.x = first.x;
            snapshot.y = first.y;
            snapshot.rotation = first.rotation ?? 0;
            if (first.animationId !== undefined)
                snapshot.animationId = first.animationId;
            if (first.data !== undefined)
                snapshot.data = first.data;
        }
        else if (g.elapsed >= last.atMs) {
            snapshot.x = last.x;
            snapshot.y = last.y;
            snapshot.rotation = last.rotation ?? 0;
            if (last.animationId !== undefined)
                snapshot.animationId = last.animationId;
            if (last.data !== undefined)
                snapshot.data = last.data;
        }
        else {
            var fromIdx = 0;
            for (var i = 0; i < frames.length - 1; i++) {
                var fi = frames[i];
                if (fi.atMs <= g.elapsed)
                    fromIdx = i;
                else
                    break;
            }
            var from = frames[fromIdx];
            var to = frames[Math.min(frames.length - 1, fromIdx + 1)];
            var span = to.atMs - from.atMs;
            var t = span > 0 ? (g.elapsed - from.atMs) / span : 0;
            snapshot.x = lerp(from.x, to.x, t);
            snapshot.y = lerp(from.y, to.y, t);
            var fromRot = from.rotation ?? 0;
            var toRot = to.rotation ?? 0;
            snapshot.rotation = lerp(fromRot, toRot, t);
            if (from.animationId !== undefined)
                snapshot.animationId = from.animationId;
            if (from.data !== undefined)
                snapshot.data = from.data;
        }
        // Compute alpha for fade-in / fade-out.
        var alpha = 1;
        if (g.fadeInMs > 0 && g.elapsed < g.fadeInMs) {
            alpha = Math.max(0, Math.min(1, g.elapsed / g.fadeInMs));
        }
        else if (g.fadeOutMs > 0
            && g.elapsed > g.recording.totalMs - g.fadeOutMs) {
            var into = g.recording.totalMs - g.elapsed;
            alpha = Math.max(0, Math.min(1, into / g.fadeOutMs));
        }
        snapshot.alpha = alpha;
        return snapshot;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_GHOST_REPLAY = 'ghost_replay';
//# sourceMappingURL=ghost-replay.js.map