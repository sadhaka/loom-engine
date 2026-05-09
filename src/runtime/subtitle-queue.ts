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

export type SubtitleState = 'fadeIn' | 'visible' | 'fadeOut';

export interface SubtitleSpec {
  // Stable id (often matches DialogVoice line id).
  id: string;
  // Display text.
  text: string;
  // Visible duration in ms (excluding fades). -1 = sticky (manual
  // cancel only).
  durationMs: number;
  // Optional speaker identifier ('mira' / 'narrator' / 'sfx_caption').
  // Engine doesn't interpret; consumer renders accordingly.
  speakerId?: string;
  // Priority for ordering when maxConcurrent caps the visible
  // set. Higher wins. Default 0.
  priority?: number;
  // ms fade-in. Default 150.
  fadeInMs?: number;
  // ms fade-out. Default 250.
  fadeOutMs?: number;
  data?: Record<string, unknown>;
}

export interface SubtitleSnapshot {
  id: string;
  text: string;
  speakerId: string | null;
  priority: number;
  state: SubtitleState;
  // 0..1 render alpha computed each tick.
  alpha: number;
  ageMs: number;
  remainingMs: number;
  data?: Record<string, unknown>;
}

export interface SubtitleQueueOptions {
  // Max lines visible at once. Lower-priority lines are still
  // queued but not in the visible() result. Default 3.
  maxConcurrent?: number;
  // Fired when a line is added.
  onPush?: (line: SubtitleSnapshot) => void;
  // Fired when a line is removed (auto-expire / manual cancel /
  // cleared).
  onRemoved?: (line: SubtitleSnapshot, reason: 'expired' | 'cancelled' | 'cleared') => void;
}

interface InternalLine {
  id: string;
  text: string;
  speakerId: string | null;
  priority: number;
  durationMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  state: SubtitleState;
  ageMs: number;
  remainingMs: number;
  fadeOutAge: number;
  alpha: number;
  data?: Record<string, unknown>;
}

const DEFAULT_FADE_IN = 150;
const DEFAULT_FADE_OUT = 250;
const DEFAULT_MAX_CONCURRENT = 3;

export class SubtitleQueue {
  private lines: InternalLine[] = [];
  private maxConcurrent: number;
  private onPush: ((l: SubtitleSnapshot) => void) | null;
  private onRemoved: ((l: SubtitleSnapshot, r: 'expired' | 'cancelled' | 'cleared') => void) | null;
  private disposed: boolean = false;

  private constructor(opts: SubtitleQueueOptions) {
    this.maxConcurrent = opts.maxConcurrent !== undefined && opts.maxConcurrent > 0
      ? Math.floor(opts.maxConcurrent) : DEFAULT_MAX_CONCURRENT;
    this.onPush = opts.onPush ?? null;
    this.onRemoved = opts.onRemoved ?? null;
  }

  static create(opts: SubtitleQueueOptions = {}): SubtitleQueue {
    return new SubtitleQueue(opts);
  }

  push(spec: SubtitleSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (typeof spec.text !== 'string') return false;
    if (!isFinite(spec.durationMs)) return false;
    var fadeIn = spec.fadeInMs !== undefined && isFinite(spec.fadeInMs)
        && spec.fadeInMs >= 0 ? spec.fadeInMs : DEFAULT_FADE_IN;
    var fadeOut = spec.fadeOutMs !== undefined && isFinite(spec.fadeOutMs)
        && spec.fadeOutMs >= 0 ? spec.fadeOutMs : DEFAULT_FADE_OUT;
    var dur = spec.durationMs < 0 ? -1 : Math.floor(spec.durationMs);
    var line: InternalLine = {
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
    if (spec.data !== undefined) line.data = spec.data;
    // Replace existing line with same id.
    var existingIdx = this.findIndex(spec.id);
    if (existingIdx >= 0) this.lines[existingIdx] = line;
    else this.lines.push(line);
    if (this.onPush) {
      try { this.onPush(this.snapshot(line)); } catch { /* ignore */ }
    }
    return true;
  }

  // Force a line into fade-out state. Returns true if found.
  cancel(id: string): boolean {
    if (this.disposed) return false;
    var idx = this.findIndex(id);
    if (idx < 0) return false;
    var line = this.lines[idx] as InternalLine;
    if (line.state === 'fadeOut') return false;
    line.state = 'fadeOut';
    line.fadeOutAge = 0;
    return true;
  }

  // Remove all lines immediately (no fade-out). Fires onRemoved
  // with reason 'cleared' for each.
  cancelAll(): void {
    if (this.disposed) return;
    var toRemove = this.lines.slice();
    this.lines.length = 0;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var i = 0; i < toRemove.length; i++) {
        try { cb(this.snapshot(toRemove[i] as InternalLine), 'cleared'); } catch { /* ignore */ }
      }
    }
  }

  // Convenience aliases.
  clear(): void { this.cancelAll(); }

  isShowing(id: string): boolean {
    return this.findIndex(id) >= 0;
  }

  count(): number { return this.lines.length; }

  // Sorted by priority desc, then push order. Caps at maxConcurrent.
  visible(maxLines?: number): SubtitleSnapshot[] {
    var cap = maxLines !== undefined && isFinite(maxLines) && maxLines > 0
      ? Math.floor(maxLines) : this.maxConcurrent;
    var sorted = this.lines.slice().sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Stable: preserve insertion order for same priority.
      return 0;
    });
    var out: SubtitleSnapshot[] = [];
    for (var i = 0; i < sorted.length && out.length < cap; i++) {
      out.push(this.snapshot(sorted[i] as InternalLine));
    }
    return out;
  }

  list(): SubtitleSnapshot[] {
    var out: SubtitleSnapshot[] = [];
    for (var i = 0; i < this.lines.length; i++) {
      out.push(this.snapshot(this.lines[i] as InternalLine));
    }
    return out;
  }

  forEach(cb: (line: SubtitleSnapshot) => void): void {
    if (this.disposed) return;
    var v = this.visible();
    for (var i = 0; i < v.length; i++) {
      try { cb(v[i] as SubtitleSnapshot); } catch { /* ignore */ }
    }
  }

  // Tick advances state (fadeIn -> visible -> fadeOut -> removed).
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var removed: InternalLine[] = [];
    var keep: InternalLine[] = [];
    for (var i = 0; i < this.lines.length; i++) {
      var line = this.lines[i] as InternalLine;
      line.ageMs += dt;
      var dtRem = dt;
      if (line.state === 'fadeIn') {
        if (line.fadeInMs <= 0 || line.ageMs >= line.fadeInMs) {
          line.state = 'visible';
          line.alpha = 1;
          dtRem = Math.max(0, line.ageMs - line.fadeInMs);
        } else {
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
        if (dtRem > 0) line.fadeOutAge += dtRem;
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
        try { cb(this.snapshot(removed[j] as InternalLine), 'expired'); } catch { /* ignore */ }
      }
    }
  }

  dispose(): void {
    this.lines.length = 0;
    this.onPush = null;
    this.onRemoved = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private findIndex(id: string): number {
    for (var i = 0; i < this.lines.length; i++) {
      if ((this.lines[i] as InternalLine).id === id) return i;
    }
    return -1;
  }

  private snapshot(line: InternalLine): SubtitleSnapshot {
    var out: SubtitleSnapshot = {
      id: line.id,
      text: line.text,
      speakerId: line.speakerId,
      priority: line.priority,
      state: line.state,
      alpha: line.alpha,
      ageMs: line.ageMs,
      remainingMs: line.remainingMs,
    };
    if (line.data !== undefined) out.data = line.data;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_SUBTITLE_QUEUE = 'subtitle_queue';
