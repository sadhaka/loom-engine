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

export interface VoiceMarker {
  // ms since the line started playing.
  atMs: number;
  // Marker kind ('phoneme' / 'gesture' / 'emote' / 'beat' /
  // consumer-defined). Engine doesn't interpret.
  kind: string;
  payload?: Record<string, unknown>;
}

export interface VoiceLine {
  // Dialog tree node id this line corresponds to.
  nodeId: string;
  // Opaque audio cue id (consumer routes to actual audio system).
  cueId: string;
  // Total length in ms.
  durationMs: number;
  // Optional inline markers (sorted by atMs at register time).
  markers?: VoiceMarker[];
  data?: Record<string, unknown>;
}

export interface VoiceLineState {
  nodeId: string;
  cueId: string;
  durationMs: number;
  elapsedMs: number;
  isPlaying: boolean;
  isPaused: boolean;
  // 0..1 over the line.
  progress: number;
}

export interface PlayLineOptions {
  // Speed multiplier (1 = normal). Default 1.
  speed?: number;
  // Fired when a marker's atMs is crossed.
  onMarker?: (m: VoiceMarker) => void;
  // Fired when the line completes (elapsed >= duration).
  onLineEnd?: () => void;
  // If true, the next queued line auto-plays when this one ends.
  // Default true.
  autoAdvance?: boolean;
}

export interface QueueOptions extends PlayLineOptions {
  // Queue these node ids; the first plays immediately.
  nodeIds: string[];
}

export interface DialogVoiceOptions {
  // Reserved for future hooks.
}

interface ActiveLine {
  line: VoiceLine;
  elapsed: number;
  speed: number;
  paused: boolean;
  onMarker: ((m: VoiceMarker) => void) | null;
  onLineEnd: (() => void) | null;
  autoAdvance: boolean;
  // Indexes of markers already fired (so we don't re-fire).
  firedMarkers: Set<number>;
}

interface QueuedItem {
  nodeId: string;
  options: PlayLineOptions;
}

export class DialogVoice {
  private lines: Map<string, VoiceLine> = new Map();
  private active: ActiveLine | null = null;
  private queue: QueuedItem[] = [];
  private disposed: boolean = false;

  private constructor(_opts: DialogVoiceOptions) { /* reserved */ }

  static create(opts: DialogVoiceOptions = {}): DialogVoice {
    return new DialogVoice(opts);
  }

  // ---------- line registration ----------

  registerLine(line: VoiceLine): boolean {
    if (this.disposed) return false;
    if (!line || typeof line.nodeId !== 'string' || line.nodeId.length === 0) {
      return false;
    }
    if (typeof line.cueId !== 'string' || line.cueId.length === 0) return false;
    if (!isFinite(line.durationMs) || line.durationMs < 0) return false;
    var clone: VoiceLine = {
      nodeId: line.nodeId,
      cueId: line.cueId,
      durationMs: Math.floor(line.durationMs),
    };
    if (Array.isArray(line.markers) && line.markers.length > 0) {
      clone.markers = line.markers.slice().sort(function (a, b) {
        return a.atMs - b.atMs;
      });
    }
    if (line.data !== undefined) clone.data = line.data;
    this.lines.set(line.nodeId, clone);
    return true;
  }

  unregisterLine(nodeId: string): boolean {
    if (this.disposed) return false;
    return this.lines.delete(nodeId);
  }

  hasLine(nodeId: string): boolean {
    return this.lines.has(nodeId);
  }

  getLine(nodeId: string): VoiceLine | null {
    var line = this.lines.get(nodeId);
    if (!line) return null;
    var copy: VoiceLine = {
      nodeId: line.nodeId,
      cueId: line.cueId,
      durationMs: line.durationMs,
    };
    if (line.markers) copy.markers = line.markers.slice();
    if (line.data !== undefined) copy.data = line.data;
    return copy;
  }

  lineCount(): number { return this.lines.size; }

  // ---------- playback ----------

  play(nodeId: string, opts: PlayLineOptions = {}): boolean {
    if (this.disposed) return false;
    var line = this.lines.get(nodeId);
    if (!line) return false;
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
  playQueue(opts: QueueOptions): boolean {
    if (this.disposed) return false;
    if (!Array.isArray(opts.nodeIds) || opts.nodeIds.length === 0) return false;
    // Validate all node ids exist; reject the whole queue if any
    // are missing (caller should pre-check).
    for (var i = 0; i < opts.nodeIds.length; i++) {
      if (!this.lines.has(opts.nodeIds[i] as string)) return false;
    }
    var lineOpts: PlayLineOptions = {};
    if (opts.speed !== undefined) lineOpts.speed = opts.speed;
    if (opts.onMarker !== undefined) lineOpts.onMarker = opts.onMarker;
    if (opts.onLineEnd !== undefined) lineOpts.onLineEnd = opts.onLineEnd;
    if (opts.autoAdvance !== undefined) lineOpts.autoAdvance = opts.autoAdvance;
    this.queue = [];
    for (var j = 1; j < opts.nodeIds.length; j++) {
      this.queue.push({ nodeId: opts.nodeIds[j] as string, options: lineOpts });
    }
    return this.play(opts.nodeIds[0] as string, lineOpts);
  }

  enqueue(nodeId: string, opts: PlayLineOptions = {}): boolean {
    if (this.disposed) return false;
    if (!this.lines.has(nodeId)) return false;
    this.queue.push({ nodeId: nodeId, options: opts });
    return true;
  }

  // Interrupt: stop current line + clear queue. Does NOT fire
  // onLineEnd (interrupted, not completed).
  interrupt(): boolean {
    if (this.disposed) return false;
    if (this.active === null && this.queue.length === 0) return false;
    this.active = null;
    this.queue = [];
    return true;
  }

  pause(): void {
    if (this.disposed || !this.active) return;
    this.active.paused = true;
  }

  resume(): void {
    if (this.disposed || !this.active) return;
    this.active.paused = false;
  }

  isPlaying(): boolean { return this.active !== null; }
  isPaused(): boolean { return !!(this.active && this.active.paused); }
  queueLength(): number { return this.queue.length; }

  getCurrent(): VoiceLineState | null {
    if (!this.active) return null;
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

  tick(dtMs: number): void {
    if (this.disposed) return;
    if (!this.active || this.active.paused) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var advance = dt * this.active.speed;
    var prevElapsed = this.active.elapsed;
    this.active.elapsed += advance;
    var line = this.active.line;
    // Fire markers crossed during this tick.
    if (line.markers && this.active.onMarker) {
      var cb = this.active.onMarker;
      for (var i = 0; i < line.markers.length; i++) {
        var m = line.markers[i] as VoiceMarker;
        if (this.active.firedMarkers.has(i)) continue;
        if (m.atMs <= this.active.elapsed) {
          this.active.firedMarkers.add(i);
          try { cb(m); } catch { /* ignore */ }
        }
      }
    } else if (line.markers) {
      // Track fired markers even with no callback so we don't
      // re-fire when consumer attaches a callback later.
      for (var j = 0; j < line.markers.length; j++) {
        var mm = line.markers[j] as VoiceMarker;
        if (mm.atMs <= this.active.elapsed) this.active.firedMarkers.add(j);
      }
    }
    // Check end.
    if (this.active.elapsed >= line.durationMs) {
      var onEnd = this.active.onLineEnd;
      var autoAdv = this.active.autoAdvance;
      this.active = null;
      if (onEnd) {
        try { onEnd(); } catch { /* ignore */ }
      }
      if (autoAdv && this.queue.length > 0) {
        var next = this.queue.shift() as QueuedItem;
        this.play(next.nodeId, next.options);
      }
    }
    // Suppress unused var warning (prevElapsed kept for future
    // marker-window logic).
    void prevElapsed;
  }

  clear(): void {
    if (this.disposed) return;
    this.lines.clear();
    this.active = null;
    this.queue = [];
  }

  dispose(): void {
    this.lines.clear();
    this.active = null;
    this.queue = [];
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_DIALOG_VOICE = 'dialog_voice';
