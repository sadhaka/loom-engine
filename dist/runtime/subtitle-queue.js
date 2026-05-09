// SubtitleQueue - timed subtitle display + fade for dialog,
// captions, narrator text.
//
// 1.4.2 enabling primitive (Wave 1.4 audio cinematic depth).
// ToastQueue (0.65) is global notifications. TooltipQueue (0.97)
// is anchored UI hints. SubtitleQueue is the dialog-bottom-of-
// screen surface: speaker-attributed lines that appear in sync
// with voice, fade in / out, queue or display concurrently. Used
// for dialog subtitles, accessibility captions ("WIND HOWLS"),
// tutorial hints, on-screen narration.
//
//   var sub = SubtitleQueue.create({ maxConcurrent: 2 });
//   sub.push({
//     id: 'mira_001',
//     text: 'You came back. I was waiting.',
//     speakerId: 'mira',
//     durationMs: 3000,
//   });
//
//   each frame:
//     sub.tick(dtMs);
//     sub.forEach((line) => renderer.drawSubtitle(line.text,
//                                                 line.alpha,
//                                                 line.speakerId));
//
// Pairs with DialogVoice (1.3.3, the audio side - share `id` to
// link subtitle to spoken line), DialogTree (0.61, branching
// dialog), VoiceLineQueue (1.4.3 next, audio-side queue).
//
// Code style: var-only in browser source.
const DEFAULT_FADE_IN = 150;
const DEFAULT_FADE_OUT = 250;
const DEFAULT_MAX_CONCURRENT = 3;
export class SubtitleQueue {
    lines = [];
    maxConcurrent;
    onPush;
    onRemoved;
    disposed = false;
    constructor(opts) {
        this.maxConcurrent = opts.maxConcurrent !== undefined && opts.maxConcurrent > 0
            ? Math.floor(opts.maxConcurrent) : DEFAULT_MAX_CONCURRENT;
        this.onPush = opts.onPush ?? null;
        this.onRemoved = opts.onRemoved ?? null;
    }
    static create(opts = {}) {
        return new SubtitleQueue(opts);
    }
    push(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (typeof spec.text !== 'string')
            return false;
        if (!isFinite(spec.durationMs))
            return false;
        var fadeIn = spec.fadeInMs !== undefined && isFinite(spec.fadeInMs)
            && spec.fadeInMs >= 0 ? spec.fadeInMs : DEFAULT_FADE_IN;
        var fadeOut = spec.fadeOutMs !== undefined && isFinite(spec.fadeOutMs)
            && spec.fadeOutMs >= 0 ? spec.fadeOutMs : DEFAULT_FADE_OUT;
        var dur = spec.durationMs < 0 ? -1 : Math.floor(spec.durationMs);
        var line = {
            id: spec.id,
            text: spec.text,
            speakerId: typeof spec.speakerId === 'string' ? spec.speakerId : null,
            priority: spec.priority !== undefined && isFinite(spec.priority)
                ? spec.priority : 0,
            durationMs: dur,
            fadeInMs: fadeIn,
            fadeOutMs: fadeOut,
            state: fadeIn > 0 ? 'fadeIn' : 'visible',
            ageMs: 0,
            remainingMs: dur,
            fadeOutAge: 0,
            alpha: fadeIn > 0 ? 0 : 1,
        };
        if (spec.data !== undefined)
            line.data = spec.data;
        // Replace existing line with same id.
        var existingIdx = this.findIndex(spec.id);
        if (existingIdx >= 0)
            this.lines[existingIdx] = line;
        else
            this.lines.push(line);
        if (this.onPush) {
            try {
                this.onPush(this.snapshot(line));
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Force a line into fade-out state. Returns true if found.
    cancel(id) {
        if (this.disposed)
            return false;
        var idx = this.findIndex(id);
        if (idx < 0)
            return false;
        var line = this.lines[idx];
        if (line.state === 'fadeOut')
            return false;
        line.state = 'fadeOut';
        line.fadeOutAge = 0;
        return true;
    }
    // Remove all lines immediately (no fade-out). Fires onRemoved
    // with reason 'cleared' for each.
    cancelAll() {
        if (this.disposed)
            return;
        var toRemove = this.lines.slice();
        this.lines.length = 0;
        if (this.onRemoved) {
            var cb = this.onRemoved;
            for (var i = 0; i < toRemove.length; i++) {
                try {
                    cb(this.snapshot(toRemove[i]), 'cleared');
                }
                catch { /* ignore */ }
            }
        }
    }
    // Convenience aliases.
    clear() { this.cancelAll(); }
    isShowing(id) {
        return this.findIndex(id) >= 0;
    }
    count() { return this.lines.length; }
    // Sorted by priority desc, then push order. Caps at maxConcurrent.
    visible(maxLines) {
        var cap = maxLines !== undefined && isFinite(maxLines) && maxLines > 0
            ? Math.floor(maxLines) : this.maxConcurrent;
        var sorted = this.lines.slice().sort(function (a, b) {
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            // Stable: preserve insertion order for same priority.
            return 0;
        });
        var out = [];
        for (var i = 0; i < sorted.length && out.length < cap; i++) {
            out.push(this.snapshot(sorted[i]));
        }
        return out;
    }
    list() {
        var out = [];
        for (var i = 0; i < this.lines.length; i++) {
            out.push(this.snapshot(this.lines[i]));
        }
        return out;
    }
    forEach(cb) {
        if (this.disposed)
            return;
        var v = this.visible();
        for (var i = 0; i < v.length; i++) {
            try {
                cb(v[i]);
            }
            catch { /* ignore */ }
        }
    }
    // Tick advances state (fadeIn -> visible -> fadeOut -> removed).
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var removed = [];
        var keep = [];
        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];
            line.ageMs += dt;
            var dtRem = dt;
            if (line.state === 'fadeIn') {
                if (line.fadeInMs <= 0 || line.ageMs >= line.fadeInMs) {
                    line.state = 'visible';
                    line.alpha = 1;
                    dtRem = Math.max(0, line.ageMs - line.fadeInMs);
                }
                else {
                    line.alpha = Math.max(0, Math.min(1, line.ageMs / line.fadeInMs));
                    dtRem = 0;
                }
            }
            if (line.state === 'visible' && dtRem > 0 && line.remainingMs >= 0) {
                var consumed = Math.min(dtRem, line.remainingMs);
                line.remainingMs -= consumed;
                dtRem -= consumed;
                if (line.remainingMs <= 0) {
                    line.state = 'fadeOut';
                    line.fadeOutAge = 0;
                }
            }
            if (line.state === 'fadeOut') {
                if (dtRem > 0)
                    line.fadeOutAge += dtRem;
                if (line.fadeOutMs <= 0 || line.fadeOutAge >= line.fadeOutMs) {
                    line.alpha = 0;
                    removed.push(line);
                    continue;
                }
                line.alpha = Math.max(0, 1 - line.fadeOutAge / line.fadeOutMs);
            }
            keep.push(line);
        }
        this.lines = keep;
        if (this.onRemoved) {
            var cb = this.onRemoved;
            for (var j = 0; j < removed.length; j++) {
                try {
                    cb(this.snapshot(removed[j]), 'expired');
                }
                catch { /* ignore */ }
            }
        }
    }
    dispose() {
        this.lines.length = 0;
        this.onPush = null;
        this.onRemoved = null;
        this.disposed = true;
    }
    // ---------- private ----------
    findIndex(id) {
        for (var i = 0; i < this.lines.length; i++) {
            if (this.lines[i].id === id)
                return i;
        }
        return -1;
    }
    snapshot(line) {
        var out = {
            id: line.id,
            text: line.text,
            speakerId: line.speakerId,
            priority: line.priority,
            state: line.state,
            alpha: line.alpha,
            ageMs: line.ageMs,
            remainingMs: line.remainingMs,
        };
        if (line.data !== undefined)
            out.data = line.data;
        return out;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_SUBTITLE_QUEUE = 'subtitle_queue';
//# sourceMappingURL=subtitle-queue.js.map