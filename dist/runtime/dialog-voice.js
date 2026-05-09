// DialogVoice - voice-line scheduler for DialogTree nodes.
//
// 1.3.3 enabling primitive (Wave 1.3 AI persona depth). DialogTree
// (0.61) handles the BRANCHING (which line plays next based on
// player choice / state). DialogVoice handles the AUDIO + TIMING
// of those lines: each dialog node maps to a voice cue id with a
// duration and inline markers (phonemes for lip-sync, gesture
// triggers, emote shifts, scene beats). Plays lines, manages a
// queue, supports interruption, fires markers as time passes.
//
//   var dv = DialogVoice.create();
//   dv.registerLine({
//     nodeId: 'mira_greeting',
//     cueId: 'vo_mira_001',
//     durationMs: 3500,
//     markers: [
//       { atMs: 200,  kind: 'phoneme', payload: { v: 'A' } },
//       { atMs: 800,  kind: 'gesture', payload: { id: 'wave' } },
//       { atMs: 2400, kind: 'emote',   payload: { id: 'smile' } },
//     ],
//   });
//
//   // Player triggers dialog node:
//   dv.play('mira_greeting', {
//     onMarker: (m) => dispatchMarker(m),
//     onLineEnd: () => showNextChoices(),
//   });
//
//   each frame: dv.tick(dtMs);
//
//   // Player skips:
//   on key 'space': dv.interrupt();
//
// Pairs with DialogTree (0.61, branching), AudioCueQueue (0.94,
// the actual audio playback), CutsceneSequencer (1.1.4, broader
// scripted timeline), DialogChoiceHistory (0.89, what was chosen
// before).
//
// Engine ships zero audio: consumer reads getCurrent() / handles
// onLineEnd and dispatches the cueId to whatever audio system
// they have (AudioCueQueue, web audio, native bridge).
//
// Code style: var-only in browser source.
export class DialogVoice {
    lines = new Map();
    active = null;
    queue = [];
    disposed = false;
    constructor(_opts) { }
    static create(opts = {}) {
        return new DialogVoice(opts);
    }
    // ---------- line registration ----------
    registerLine(line) {
        if (this.disposed)
            return false;
        if (!line || typeof line.nodeId !== 'string' || line.nodeId.length === 0) {
            return false;
        }
        if (typeof line.cueId !== 'string' || line.cueId.length === 0)
            return false;
        if (!isFinite(line.durationMs) || line.durationMs < 0)
            return false;
        var clone = {
            nodeId: line.nodeId,
            cueId: line.cueId,
            durationMs: Math.floor(line.durationMs),
        };
        if (Array.isArray(line.markers) && line.markers.length > 0) {
            clone.markers = line.markers.slice().sort(function (a, b) {
                return a.atMs - b.atMs;
            });
        }
        if (line.data !== undefined)
            clone.data = line.data;
        this.lines.set(line.nodeId, clone);
        return true;
    }
    unregisterLine(nodeId) {
        if (this.disposed)
            return false;
        return this.lines.delete(nodeId);
    }
    hasLine(nodeId) {
        return this.lines.has(nodeId);
    }
    getLine(nodeId) {
        var line = this.lines.get(nodeId);
        if (!line)
            return null;
        var copy = {
            nodeId: line.nodeId,
            cueId: line.cueId,
            durationMs: line.durationMs,
        };
        if (line.markers)
            copy.markers = line.markers.slice();
        if (line.data !== undefined)
            copy.data = line.data;
        return copy;
    }
    lineCount() { return this.lines.size; }
    // ---------- playback ----------
    play(nodeId, opts = {}) {
        if (this.disposed)
            return false;
        var line = this.lines.get(nodeId);
        if (!line)
            return false;
        // Interrupt current if any (without firing onLineEnd).
        this.active = {
            line: line,
            elapsed: 0,
            speed: opts.speed !== undefined && isFinite(opts.speed) && opts.speed > 0
                ? opts.speed : 1,
            paused: false,
            onMarker: opts.onMarker ?? null,
            onLineEnd: opts.onLineEnd ?? null,
            autoAdvance: opts.autoAdvance !== false,
            firedMarkers: new Set(),
        };
        return true;
    }
    // Queue multiple node ids; first plays now, rest after each line
    // ends (if autoAdvance).
    playQueue(opts) {
        if (this.disposed)
            return false;
        if (!Array.isArray(opts.nodeIds) || opts.nodeIds.length === 0)
            return false;
        // Validate all node ids exist; reject the whole queue if any
        // are missing (caller should pre-check).
        for (var i = 0; i < opts.nodeIds.length; i++) {
            if (!this.lines.has(opts.nodeIds[i]))
                return false;
        }
        var lineOpts = {};
        if (opts.speed !== undefined)
            lineOpts.speed = opts.speed;
        if (opts.onMarker !== undefined)
            lineOpts.onMarker = opts.onMarker;
        if (opts.onLineEnd !== undefined)
            lineOpts.onLineEnd = opts.onLineEnd;
        if (opts.autoAdvance !== undefined)
            lineOpts.autoAdvance = opts.autoAdvance;
        this.queue = [];
        for (var j = 1; j < opts.nodeIds.length; j++) {
            this.queue.push({ nodeId: opts.nodeIds[j], options: lineOpts });
        }
        return this.play(opts.nodeIds[0], lineOpts);
    }
    enqueue(nodeId, opts = {}) {
        if (this.disposed)
            return false;
        if (!this.lines.has(nodeId))
            return false;
        this.queue.push({ nodeId: nodeId, options: opts });
        return true;
    }
    // Interrupt: stop current line + clear queue. Does NOT fire
    // onLineEnd (interrupted, not completed).
    interrupt() {
        if (this.disposed)
            return false;
        if (this.active === null && this.queue.length === 0)
            return false;
        this.active = null;
        this.queue = [];
        return true;
    }
    pause() {
        if (this.disposed || !this.active)
            return;
        this.active.paused = true;
    }
    resume() {
        if (this.disposed || !this.active)
            return;
        this.active.paused = false;
    }
    isPlaying() { return this.active !== null; }
    isPaused() { return !!(this.active && this.active.paused); }
    queueLength() { return this.queue.length; }
    getCurrent() {
        if (!this.active)
            return null;
        var l = this.active.line;
        return {
            nodeId: l.nodeId,
            cueId: l.cueId,
            durationMs: l.durationMs,
            elapsedMs: this.active.elapsed,
            isPlaying: true,
            isPaused: this.active.paused,
            progress: l.durationMs > 0
                ? Math.max(0, Math.min(1, this.active.elapsed / l.durationMs)) : 0,
        };
    }
    tick(dtMs) {
        if (this.disposed)
            return;
        if (!this.active || this.active.paused)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var advance = dt * this.active.speed;
        var prevElapsed = this.active.elapsed;
        this.active.elapsed += advance;
        var line = this.active.line;
        // Fire markers crossed during this tick.
        if (line.markers && this.active.onMarker) {
            var cb = this.active.onMarker;
            for (var i = 0; i < line.markers.length; i++) {
                var m = line.markers[i];
                if (this.active.firedMarkers.has(i))
                    continue;
                if (m.atMs <= this.active.elapsed) {
                    this.active.firedMarkers.add(i);
                    try {
                        cb(m);
                    }
                    catch { /* ignore */ }
                }
            }
        }
        else if (line.markers) {
            // Track fired markers even with no callback so we don't
            // re-fire when consumer attaches a callback later.
            for (var j = 0; j < line.markers.length; j++) {
                var mm = line.markers[j];
                if (mm.atMs <= this.active.elapsed)
                    this.active.firedMarkers.add(j);
            }
        }
        // Check end.
        if (this.active.elapsed >= line.durationMs) {
            var onEnd = this.active.onLineEnd;
            var autoAdv = this.active.autoAdvance;
            this.active = null;
            if (onEnd) {
                try {
                    onEnd();
                }
                catch { /* ignore */ }
            }
            if (autoAdv && this.queue.length > 0) {
                var next = this.queue.shift();
                this.play(next.nodeId, next.options);
            }
        }
        // Suppress unused var warning (prevElapsed kept for future
        // marker-window logic).
        void prevElapsed;
    }
    clear() {
        if (this.disposed)
            return;
        this.lines.clear();
        this.active = null;
        this.queue = [];
    }
    dispose() {
        this.lines.clear();
        this.active = null;
        this.queue = [];
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_DIALOG_VOICE = 'dialog_voice';
//# sourceMappingURL=dialog-voice.js.map