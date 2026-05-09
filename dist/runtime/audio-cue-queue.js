// AudioCueQueue - prioritized one-shot SFX queue.
//
// 0.94.0 enabling primitive. Combat is bursty: 5 hits land in
// 200ms, the renderer wants to play 5 hit-sounds, but mixer voices
// are limited. AudioCueQueue is the prioritization layer between
// gameplay events and the audio backend: enqueue cues with a
// priority, pull the highest-priority cue when a voice frees up,
// drop low-priority cues when the queue is full.
//
//   var queue = AudioCueQueue.create({ capacity: 16 });
//   queue.enqueue({ id: 'hit_normal', priority: 1 });
//   queue.enqueue({ id: 'crit', priority: 10 });
//   var next = queue.next(); // 'crit' first (priority 10 > 1)
//
// Insertion order breaks priority ties (FIFO within a priority
// band). Pairs with AudioBus (0.5) and CueCatalog from Phase 17.
//
// Code style: var-only in browser source.
const DEFAULT_CAPACITY = 32;
export class AudioCueQueue {
    entries = [];
    capacityNum;
    nextSeq = 1;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity)
            && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    }
    static create(opts = {}) {
        return new AudioCueQueue(opts);
    }
    // Add a cue. Returns false on invalid input or disposed; true on
    // accepted. When the queue is full, drops the lowest-priority cue
    // before inserting (so an over-cap enqueue with HIGH priority
    // displaces a stale low-priority cue).
    enqueue(cue) {
        if (this.disposed)
            return false;
        if (!cue || typeof cue.id !== 'string' || cue.id.length === 0) {
            return false;
        }
        var copy = { id: cue.id };
        if (cue.priority !== undefined && isFinite(cue.priority)) {
            copy.priority = cue.priority;
        }
        else {
            copy.priority = 0;
        }
        if (cue.data)
            copy.data = cue.data;
        if (this.entries.length >= this.capacityNum) {
            this.dropLowestPriority();
        }
        this.entries.push({ cue: copy, seq: this.nextSeq++ });
        return true;
    }
    // Pull the highest-priority cue (FIFO on ties). Returns null on
    // empty.
    next() {
        if (this.disposed)
            return null;
        if (this.entries.length === 0)
            return null;
        var bestIdx = 0;
        var bestEntry = this.entries[0];
        for (var i = 1; i < this.entries.length; i++) {
            var e = this.entries[i];
            var ePri = e.cue.priority || 0;
            var bestPri = bestEntry.cue.priority || 0;
            if (ePri > bestPri || (ePri === bestPri && e.seq < bestEntry.seq)) {
                bestEntry = e;
                bestIdx = i;
            }
        }
        this.entries.splice(bestIdx, 1);
        return cloneCue(bestEntry.cue);
    }
    // Look at the head without consuming.
    peek() {
        if (this.disposed)
            return null;
        if (this.entries.length === 0)
            return null;
        var bestIdx = 0;
        var bestEntry = this.entries[0];
        for (var i = 1; i < this.entries.length; i++) {
            var e = this.entries[i];
            var ePri = e.cue.priority || 0;
            var bestPri = bestEntry.cue.priority || 0;
            if (ePri > bestPri || (ePri === bestPri && e.seq < bestEntry.seq)) {
                bestEntry = e;
                bestIdx = i;
            }
        }
        void bestIdx;
        return cloneCue(bestEntry.cue);
    }
    size() { return this.entries.length; }
    capacity() { return this.capacityNum; }
    clear() {
        if (this.disposed)
            return;
        this.entries = [];
    }
    // Drop every queued cue matching `id`. Returns the count dropped.
    removeById(id) {
        if (this.disposed)
            return 0;
        if (typeof id !== 'string' || id.length === 0)
            return 0;
        var before = this.entries.length;
        this.entries = this.entries.filter((e) => e.cue.id !== id);
        return before - this.entries.length;
    }
    // Defensive snapshot of the queue (newest-priority order is NOT
    // guaranteed in the returned list - use next/peek for ordering).
    list() {
        return this.entries.map((e) => cloneCue(e.cue));
    }
    dispose() {
        this.entries = [];
        this.disposed = true;
    }
    // ---------- private ----------
    dropLowestPriority() {
        if (this.entries.length === 0)
            return;
        var worstIdx = 0;
        var worst = this.entries[0];
        for (var i = 1; i < this.entries.length; i++) {
            var e = this.entries[i];
            var ePri = e.cue.priority || 0;
            var worstPri = worst.cue.priority || 0;
            if (ePri < worstPri || (ePri === worstPri && e.seq < worst.seq)) {
                worst = e;
                worstIdx = i;
            }
        }
        this.entries.splice(worstIdx, 1);
    }
}
function cloneCue(c) {
    var copy = { id: c.id };
    if (c.priority !== undefined)
        copy.priority = c.priority;
    if (c.data)
        copy.data = c.data;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_AUDIO_CUE_QUEUE = 'audio_cue_queue';
//# sourceMappingURL=audio-cue-queue.js.map