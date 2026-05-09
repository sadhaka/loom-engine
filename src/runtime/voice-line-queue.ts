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

export interface VOLineSpec {
  // Stable line id.
  id: string;
  // Audio cue id (consumer's audio system uses this).
  cueId: string;
  // Total length in ms.
  durationMs: number;
  // Channel name. Default 'default'. Lines on different channels
  // play simultaneously and don't interrupt each other.
  channel?: string;
  // Priority within channel; higher interrupts lower. Default 0.
  priority?: number;
  // If true, when this line is interrupted by a higher-priority
  // line on the same channel, it gets re-queued at the front
  // (with elapsed time tracked) to resume after the interrupting
  // line ends. Default false (interrupt = lose).
  resumeOnInterrupt?: boolean;
  data?: Record<string, unknown>;
}

export interface VOLineSnapshot {
  id: string;
  cueId: string;
  channel: string;
  priority: number;
  durationMs: number;
  elapsedMs: number;
  remainingMs: number;
  resumeOnInterrupt: boolean;
  data?: Record<string, unknown>;
}

export interface VoiceLineQueueOptions {
  // Fired when a line starts playing on a channel (either fresh
  // or resumed).
  onStart?: (line: VOLineSnapshot) => void;
  // Fired when a line completes naturally.
  onEnd?: (line: VOLineSnapshot) => void;
  // Fired when a line is interrupted by a higher-priority line.
  // Differs from onEnd: this fires for the line getting kicked.
  onInterrupt?: (line: VOLineSnapshot, interruptedBy: VOLineSnapshot) => void;
}

interface InternalLine {
  id: string;
  cueId: string;
  channel: string;
  priority: number;
  durationMs: number;
  elapsedMs: number;
  resumeOnInterrupt: boolean;
  data?: Record<string, unknown>;
}

interface ChannelState {
  id: string;
  active: InternalLine | null;
  queue: InternalLine[];
  paused: boolean;
  muted: boolean;
}

export class VoiceLineQueue {
  private channels: Map<string, ChannelState> = new Map();
  private onStart: ((l: VOLineSnapshot) => void) | null;
  private onEnd: ((l: VOLineSnapshot) => void) | null;
  private onInterrupt: ((l: VOLineSnapshot, by: VOLineSnapshot) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: VoiceLineQueueOptions) {
    this.onStart = opts.onStart ?? null;
    this.onEnd = opts.onEnd ?? null;
    this.onInterrupt = opts.onInterrupt ?? null;
  }

  static create(opts: VoiceLineQueueOptions = {}): VoiceLineQueue {
    return new VoiceLineQueue(opts);
  }

  enqueue(spec: VOLineSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (typeof spec.cueId !== 'string' || spec.cueId.length === 0) return false;
    if (!isFinite(spec.durationMs) || spec.durationMs < 0) return false;
    var channelId = typeof spec.channel === 'string' && spec.channel.length > 0
      ? spec.channel : 'default';
    var line: InternalLine = {
      id: spec.id,
      cueId: spec.cueId,
      channel: channelId,
      priority: spec.priority !== undefined && isFinite(spec.priority)
        ? spec.priority : 0,
      durationMs: Math.floor(spec.durationMs),
      elapsedMs: 0,
      resumeOnInterrupt: !!spec.resumeOnInterrupt,
    };
    if (spec.data !== undefined) line.data = spec.data;
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
    } else {
      // Insert into queue sorted by priority desc.
      var insertAt = ch.queue.length;
      for (var i = 0; i < ch.queue.length; i++) {
        if ((ch.queue[i] as InternalLine).priority < line.priority) {
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
  cancelLine(id: string): boolean {
    if (this.disposed) return false;
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
        if ((ch.queue[i] as InternalLine).id === id) {
          ch.queue.splice(i, 1);
          return true;
        }
      }
      v = iter.next();
    }
    return false;
  }

  // Stop and clear a channel's active + queue.
  cancelChannel(channelId: string): boolean {
    if (this.disposed) return false;
    var ch = this.channels.get(channelId);
    if (!ch) return false;
    ch.active = null;
    ch.queue.length = 0;
    return true;
  }

  pauseChannel(channelId: string): boolean {
    if (this.disposed) return false;
    var ch = this.channels.get(channelId);
    if (!ch) return false;
    ch.paused = true;
    return true;
  }

  resumeChannel(channelId: string): boolean {
    if (this.disposed) return false;
    var ch = this.channels.get(channelId);
    if (!ch) return false;
    ch.paused = false;
    return true;
  }

  setChannelMute(channelId: string, muted: boolean): boolean {
    if (this.disposed) return false;
    var ch = this.channels.get(channelId);
    if (!ch) return false;
    ch.muted = muted;
    return true;
  }

  isMuted(channelId: string): boolean {
    var ch = this.channels.get(channelId);
    return !!(ch && ch.muted);
  }

  // Active line on a channel (null if idle, paused, or muted).
  getActive(channelId: string): VOLineSnapshot | null {
    var ch = this.channels.get(channelId);
    if (!ch || ch.muted || ch.paused || !ch.active) return null;
    return this.snapshot(ch.active);
  }

  // True if any channel has an active (non-muted, non-paused) line.
  isPlaying(channelId?: string): boolean {
    if (channelId !== undefined) {
      var ch = this.channels.get(channelId);
      return !!(ch && ch.active && !ch.muted && !ch.paused);
    }
    var iter = this.channels.values();
    var v = iter.next();
    while (!v.done) {
      var c = v.value;
      if (c.active && !c.muted && !c.paused) return true;
      v = iter.next();
    }
    return false;
  }

  channelIds(): string[] {
    var out: string[] = [];
    var keys = this.channels.keys();
    var k = keys.next();
    while (!k.done) {
      out.push(k.value);
      k = keys.next();
    }
    return out;
  }

  // Returns active lines on every channel that has activity.
  activeChannels(): VOLineSnapshot[] {
    var out: VOLineSnapshot[] = [];
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

  queueLength(channelId: string): number {
    var ch = this.channels.get(channelId);
    return ch ? ch.queue.length : 0;
  }

  // Tick advances elapsed time on each non-paused, non-muted
  // channel's active line. Completed lines fire onEnd; queue
  // advances.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var iter = this.channels.values();
    var v = iter.next();
    while (!v.done) {
      var ch = v.value;
      if (ch.paused || ch.muted || !ch.active) { v = iter.next(); continue; }
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

  clear(): void {
    if (this.disposed) return;
    this.channels.clear();
  }

  dispose(): void {
    this.channels.clear();
    this.onStart = null;
    this.onEnd = null;
    this.onInterrupt = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private getOrCreateChannel(id: string): ChannelState {
    var ch = this.channels.get(id);
    if (ch) return ch;
    ch = { id: id, active: null, queue: [], paused: false, muted: false };
    this.channels.set(id, ch);
    return ch;
  }

  // Pop the next queued line and start it.
  private advance(ch: ChannelState): void {
    if (ch.queue.length === 0) return;
    var next = ch.queue.shift() as InternalLine;
    ch.active = next;
    this.fireStart(next);
  }

  private fireStart(line: InternalLine): void {
    if (!this.onStart) return;
    try { this.onStart(this.snapshot(line)); } catch { /* ignore */ }
  }

  private fireEnd(line: InternalLine): void {
    if (!this.onEnd) return;
    try { this.onEnd(this.snapshot(line)); } catch { /* ignore */ }
  }

  private fireInterrupt(line: InternalLine, by: InternalLine): void {
    if (!this.onInterrupt) return;
    try { this.onInterrupt(this.snapshot(line), this.snapshot(by)); } catch { /* ignore */ }
  }

  private snapshot(line: InternalLine): VOLineSnapshot {
    var out: VOLineSnapshot = {
      id: line.id,
      cueId: line.cueId,
      channel: line.channel,
      priority: line.priority,
      durationMs: line.durationMs,
      elapsedMs: line.elapsedMs,
      remainingMs: Math.max(0, line.durationMs - line.elapsedMs),
      resumeOnInterrupt: line.resumeOnInterrupt,
    };
    if (line.data !== undefined) out.data = line.data;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_VOICE_LINE_QUEUE = 'voice_line_queue';
