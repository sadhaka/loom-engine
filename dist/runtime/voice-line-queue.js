// VoiceLineQueue - per-channel interruption-aware VO queue.
//
// 1.4.3 enabling primitive (Wave 1.4 audio cinematic depth).
// DialogVoice (1.3.3) is dialog-tree-bound - one active line per
// instance, tied to dialog flow. VoiceLineQueue is the general
// VO surface: per-channel queues for narrator, system
// announcements, NPC barks, training prompts. Each channel has
// its own queue. Higher-priority lines interrupt lower on the
// same channel; interrupted lines optionally resume.
//
//   var vo = VoiceLineQueue.create();
//   vo.enqueue({
//     id: 'narrator_intro',
//     cueId: 'vo_intro_001', durationMs: 4000,
//     channel: 'narrator', priority: 0,
//   });
//   vo.enqueue({
//     id: 'critical_alert',
//     cueId: 'vo_alert_001', durationMs: 1500,
//     channel: 'system', priority: 100,  // independent channel
//   });
//
//   // Boss intro interrupts narrator.
//   vo.enqueue({
//     id: 'boss_taunt',
//     cueId: 'vo_boss_001', durationMs: 3000,
//     channel: 'narrator', priority: 50,
//     resumeOnInterrupt: true,
//   });
//
//   each frame:
//     vo.tick(dtMs);
//     vo.activeChannels().forEach((line) => {
//       audioBus.playCue(line.cueId);
//     });
//
// Pairs with DialogVoice (1.3.3, dialog-bound), AudioCueQueue
// (0.94, the actual audio playback), AudioDuck (1.4.1, ducks
// music when high-priority lines play), SubtitleQueue (1.4.2,
// the visual side).
//
// Code style: var-only in browser source.
export class VoiceLineQueue {
    channels = new Map();
    onStart;
    onEnd;
    onInterrupt;
    disposed = false;
    constructor(opts) {
        this.onStart = opts.onStart ?? null;
        this.onEnd = opts.onEnd ?? null;
        this.onInterrupt = opts.onInterrupt ?? null;
    }
    static create(opts = {}) {
        return new VoiceLineQueue(opts);
    }
    enqueue(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (typeof spec.cueId !== 'string' || spec.cueId.length === 0)
            return false;
        if (!isFinite(spec.durationMs) || spec.durationMs < 0)
            return false;
        var channelId = typeof spec.channel === 'string' && spec.channel.length > 0
            ? spec.channel : 'default';
        var line = {
            id: spec.id,
            cueId: spec.cueId,
            channel: channelId,
            priority: spec.priority !== undefined && isFinite(spec.priority)
                ? spec.priority : 0,
            durationMs: Math.floor(spec.durationMs),
            elapsedMs: 0,
            resumeOnInterrupt: !!spec.resumeOnInterrupt,
        };
        if (spec.data !== undefined)
            line.data = spec.data;
        var ch = this.getOrCreateChannel(channelId);
        if (ch.active === null) {
            // Channel idle: start immediately.
            ch.active = line;
            this.fireStart(line);
            return true;
        }
        // Compare priority.
        if (line.priority > ch.active.priority) {
            // Interrupt active.
            var prev = ch.active;
            this.fireInterrupt(prev, line);
            if (prev.resumeOnInterrupt && prev.elapsedMs < prev.durationMs) {
                // Re-queue the interrupted line at front so it resumes
                // when the interrupting line ends.
                ch.queue.unshift(prev);
            }
            ch.active = line;
            this.fireStart(line);
        }
        else {
            // Insert into queue sorted by priority desc.
            var insertAt = ch.queue.length;
            for (var i = 0; i < ch.queue.length; i++) {
                if (ch.queue[i].priority < line.priority) {
                    insertAt = i;
                    break;
                }
            }
            ch.queue.splice(insertAt, 0, line);
        }
        return true;
    }
    // Cancel a specific line by id. If active, advances to next
    // queued line. If queued, just removes from queue. Returns true
    // if found.
    cancelLine(id) {
        if (this.disposed)
            return false;
        var iter = this.channels.values();
        var v = iter.next();
        while (!v.done) {
            var ch = v.value;
            if (ch.active && ch.active.id === id) {
                ch.active = null;
                this.advance(ch);
                return true;
            }
            for (var i = 0; i < ch.queue.length; i++) {
                if (ch.queue[i].id === id) {
                    ch.queue.splice(i, 1);
                    return true;
                }
            }
            v = iter.next();
        }
        return false;
    }
    // Stop and clear a channel's active + queue.
    cancelChannel(channelId) {
        if (this.disposed)
            return false;
        var ch = this.channels.get(channelId);
        if (!ch)
            return false;
        ch.active = null;
        ch.queue.length = 0;
        return true;
    }
    pauseChannel(channelId) {
        if (this.disposed)
            return false;
        var ch = this.channels.get(channelId);
        if (!ch)
            return false;
        ch.paused = true;
        return true;
    }
    resumeChannel(channelId) {
        if (this.disposed)
            return false;
        var ch = this.channels.get(channelId);
        if (!ch)
            return false;
        ch.paused = false;
        return true;
    }
    setChannelMute(channelId, muted) {
        if (this.disposed)
            return false;
        var ch = this.channels.get(channelId);
        if (!ch)
            return false;
        ch.muted = muted;
        return true;
    }
    isMuted(channelId) {
        var ch = this.channels.get(channelId);
        return !!(ch && ch.muted);
    }
    // Active line on a channel (null if idle, paused, or muted).
    getActive(channelId) {
        var ch = this.channels.get(channelId);
        if (!ch || ch.muted || ch.paused || !ch.active)
            return null;
        return this.snapshot(ch.active);
    }
    // True if any channel has an active (non-muted, non-paused) line.
    isPlaying(channelId) {
        if (channelId !== undefined) {
            var ch = this.channels.get(channelId);
            return !!(ch && ch.active && !ch.muted && !ch.paused);
        }
        var iter = this.channels.values();
        var v = iter.next();
        while (!v.done) {
            var c = v.value;
            if (c.active && !c.muted && !c.paused)
                return true;
            v = iter.next();
        }
        return false;
    }
    channelIds() {
        var out = [];
        var keys = this.channels.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    // Returns active lines on every channel that has activity.
    activeChannels() {
        var out = [];
        var iter = this.channels.values();
        var v = iter.next();
        while (!v.done) {
            var ch = v.value;
            if (ch.active && !ch.muted && !ch.paused) {
                out.push(this.snapshot(ch.active));
            }
            v = iter.next();
        }
        return out;
    }
    queueLength(channelId) {
        var ch = this.channels.get(channelId);
        return ch ? ch.queue.length : 0;
    }
    // Tick advances elapsed time on each non-paused, non-muted
    // channel's active line. Completed lines fire onEnd; queue
    // advances.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var iter = this.channels.values();
        var v = iter.next();
        while (!v.done) {
            var ch = v.value;
            if (ch.paused || ch.muted || !ch.active) {
                v = iter.next();
                continue;
            }
            ch.active.elapsedMs += dt;
            if (ch.active.elapsedMs >= ch.active.durationMs) {
                var done = ch.active;
                ch.active = null;
                this.fireEnd(done);
                this.advance(ch);
            }
            v = iter.next();
        }
    }
    clear() {
        if (this.disposed)
            return;
        this.channels.clear();
    }
    dispose() {
        this.channels.clear();
        this.onStart = null;
        this.onEnd = null;
        this.onInterrupt = null;
        this.disposed = true;
    }
    // ---------- private ----------
    getOrCreateChannel(id) {
        var ch = this.channels.get(id);
        if (ch)
            return ch;
        ch = { id: id, active: null, queue: [], paused: false, muted: false };
        this.channels.set(id, ch);
        return ch;
    }
    // Pop the next queued line and start it.
    advance(ch) {
        if (ch.queue.length === 0)
            return;
        var next = ch.queue.shift();
        ch.active = next;
        this.fireStart(next);
    }
    fireStart(line) {
        if (!this.onStart)
            return;
        try {
            this.onStart(this.snapshot(line));
        }
        catch { /* ignore */ }
    }
    fireEnd(line) {
        if (!this.onEnd)
            return;
        try {
            this.onEnd(this.snapshot(line));
        }
        catch { /* ignore */ }
    }
    fireInterrupt(line, by) {
        if (!this.onInterrupt)
            return;
        try {
            this.onInterrupt(this.snapshot(line), this.snapshot(by));
        }
        catch { /* ignore */ }
    }
    snapshot(line) {
        var out = {
            id: line.id,
            cueId: line.cueId,
            channel: line.channel,
            priority: line.priority,
            durationMs: line.durationMs,
            elapsedMs: line.elapsedMs,
            remainingMs: Math.max(0, line.durationMs - line.elapsedMs),
            resumeOnInterrupt: line.resumeOnInterrupt,
        };
        if (line.data !== undefined)
            out.data = line.data;
        return out;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_VOICE_LINE_QUEUE = 'voice_line_queue';
//# sourceMappingURL=voice-line-queue.js.map