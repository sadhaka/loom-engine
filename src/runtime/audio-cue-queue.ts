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

export interface AudioCue {
  id: string;
  // Higher = pulled sooner. Default 0.
  priority?: number;
  data?: Record<string, unknown>;
}

export interface AudioCueQueueOptions {
  // Max queued cues. Over-cap enqueue drops the lowest-priority
  // cue (oldest if ties). Default 32.
  capacity?: number;
}

const DEFAULT_CAPACITY = 32;

interface InternalEntry {
  cue: AudioCue;
  // Monotonic counter for FIFO tie-breaking.
  seq: number;
}

export class AudioCueQueue {
  private entries: InternalEntry[] = [];
  private capacityNum: number;
  private nextSeq: number = 1;
  private disposed: boolean = false;

  private constructor(opts: AudioCueQueueOptions) {
    this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity)
        && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
  }

  static create(opts: AudioCueQueueOptions = {}): AudioCueQueue {
    return new AudioCueQueue(opts);
  }

  // Add a cue. Returns false on invalid input or disposed; true on
  // accepted. When the queue is full, drops the lowest-priority cue
  // before inserting (so an over-cap enqueue with HIGH priority
  // displaces a stale low-priority cue).
  enqueue(cue: AudioCue): boolean {
    if (this.disposed) return false;
    if (!cue || typeof cue.id !== 'string' || cue.id.length === 0) {
      return false;
    }
    var copy: AudioCue = { id: cue.id };
    if (cue.priority !== undefined && isFinite(cue.priority)) {
      copy.priority = cue.priority;
    } else {
      copy.priority = 0;
    }
    if (cue.data) copy.data = cue.data;
    if (this.entries.length >= this.capacityNum) {
      this.dropLowestPriority();
    }
    this.entries.push({ cue: copy, seq: this.nextSeq++ });
    return true;
  }

  // Pull the highest-priority cue (FIFO on ties). Returns null on
  // empty.
  next(): AudioCue | null {
    if (this.disposed) return null;
    if (this.entries.length === 0) return null;
    var bestIdx = 0;
    var bestEntry = this.entries[0] as InternalEntry;
    for (var i = 1; i < this.entries.length; i++) {
      var e = this.entries[i] as InternalEntry;
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
  peek(): AudioCue | null {
    if (this.disposed) return null;
    if (this.entries.length === 0) return null;
    var bestIdx = 0;
    var bestEntry = this.entries[0] as InternalEntry;
    for (var i = 1; i < this.entries.length; i++) {
      var e = this.entries[i] as InternalEntry;
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

  size(): number { return this.entries.length; }

  capacity(): number { return this.capacityNum; }

  clear(): void {
    if (this.disposed) return;
    this.entries = [];
  }

  // Drop every queued cue matching `id`. Returns the count dropped.
  removeById(id: string): number {
    if (this.disposed) return 0;
    if (typeof id !== 'string' || id.length === 0) return 0;
    var before = this.entries.length;
    this.entries = this.entries.filter((e) => e.cue.id !== id);
    return before - this.entries.length;
  }

  // Defensive snapshot of the queue (newest-priority order is NOT
  // guaranteed in the returned list - use next/peek for ordering).
  list(): AudioCue[] {
    return this.entries.map((e) => cloneCue(e.cue));
  }

  dispose(): void {
    this.entries = [];
    this.disposed = true;
  }

  // ---------- private ----------

  private dropLowestPriority(): void {
    if (this.entries.length === 0) return;
    var worstIdx = 0;
    var worst = this.entries[0] as InternalEntry;
    for (var i = 1; i < this.entries.length; i++) {
      var e = this.entries[i] as InternalEntry;
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

function cloneCue(c: AudioCue): AudioCue {
  var copy: AudioCue = { id: c.id };
  if (c.priority !== undefined) copy.priority = c.priority;
  if (c.data) copy.data = c.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_AUDIO_CUE_QUEUE = 'audio_cue_queue';
