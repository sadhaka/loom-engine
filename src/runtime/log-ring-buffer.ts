// LogRingBuffer - severity-filtered, fixed-capacity log buffer.
//
// 0.50.0 enabling primitive. The engine has DebugHUD (0.24.0) for
// per-frame diagnostic overlay text, but no place for the
// historical log entries every action game wants: combat events,
// state transitions, network warnings, plugin output, the last 200
// lines of "what happened." Browser console.log works at first but
// has no severity filter, no cap, no programmatic readout for an
// in-game console.
//
// LogRingBuffer is a tiny fixed-capacity ring with severity levels
// (debug / info / warn / error / fatal), per-instance min severity
// filter, optional structured payload per entry, monotonic id +
// timestamp, and an optional sink callback (mirror to console for
// dev / forward to Sentry for prod).
//
// Reading the buffer:
//   - tail(n) -> the last n entries (newest first).
//   - all() -> every retained entry (newest first).
//   - filter({ minLevel, since, channel }) -> server-side filter.
//
// Code style: var-only in browser source.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_RANKS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export interface LogEntry {
  // Monotonically-increasing id. Stable across truncation.
  id: number;
  // Severity.
  level: LogLevel;
  // Human-readable message. Pre-formatted by the caller.
  message: string;
  // Wall-clock timestamp in ms (Date.now() by default).
  timestampMs: number;
  // Optional channel/category ('combat', 'net', 'ai', etc.).
  channel?: string;
  // Optional structured payload for downstream sinks.
  data?: Record<string, unknown>;
}

export interface LogRingBufferOptions {
  // Capacity in entries. Older entries drop when the ring fills.
  // Defaults to 1024.
  capacity?: number;
  // Minimum severity to record. Entries below this level are
  // dropped (fast path). Default 'debug' (record everything).
  minLevel?: LogLevel;
  // Optional sink fired for every accepted entry. Throwing isolated.
  sink?: (entry: LogEntry) => void;
  // Optional clock seam for deterministic replays.
  now?: () => number;
}

export interface LogFilter {
  // Lowest severity to include. Defaults to the buffer's minLevel.
  minLevel?: LogLevel;
  // Earliest timestamp (inclusive) to include.
  since?: number;
  // Restrict to a single channel / array of channels.
  channel?: string | string[];
}

const DEFAULT_CAPACITY = 1024;

function defaultNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export class LogRingBuffer {
  private buffer: Array<LogEntry | null>;
  private capacityNum: number;
  private head: number = 0;       // index where the next entry will land
  private size: number = 0;       // entries currently retained
  private nextId: number = 1;
  private droppedCount: number = 0;
  private minLevel: LogLevel;
  private nowMs: () => number;
  private sink: ((entry: LogEntry) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: LogRingBufferOptions) {
    this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.minLevel = opts.minLevel ?? 'debug';
    this.nowMs = opts.now ?? defaultNowMs;
    this.sink = opts.sink ?? null;
    this.buffer = new Array(this.capacityNum).fill(null);
  }

  static create(opts: LogRingBufferOptions = {}): LogRingBuffer {
    return new LogRingBuffer(opts);
  }

  // Generic append. Returns the entry id (or 0 if filtered / disposed).
  log(
    level: LogLevel,
    message: string,
    extras?: { channel?: string; data?: Record<string, unknown> },
  ): number {
    if (this.disposed) return 0;
    if (LEVEL_RANKS[level] < LEVEL_RANKS[this.minLevel]) return 0;
    var id = this.nextId++;
    var entry: LogEntry = {
      id: id,
      level: level,
      message: typeof message === 'string' ? message : String(message),
      timestampMs: this.nowMs(),
    };
    if (extras) {
      if (extras.channel !== undefined) entry.channel = extras.channel;
      if (extras.data !== undefined) entry.data = extras.data;
    }
    var slotWillEvict = this.size === this.capacityNum;
    if (slotWillEvict) this.droppedCount++;
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacityNum;
    if (this.size < this.capacityNum) this.size++;
    if (this.sink) {
      try { this.sink(entry); } catch {
        // Best-effort: a misbehaving sink never takes down the
        // ring buffer.
      }
    }
    return id;
  }

  // Convenience methods.
  debug(message: string, extras?: { channel?: string; data?: Record<string, unknown> }): number {
    return this.log('debug', message, extras);
  }
  info(message: string, extras?: { channel?: string; data?: Record<string, unknown> }): number {
    return this.log('info', message, extras);
  }
  warn(message: string, extras?: { channel?: string; data?: Record<string, unknown> }): number {
    return this.log('warn', message, extras);
  }
  error(message: string, extras?: { channel?: string; data?: Record<string, unknown> }): number {
    return this.log('error', message, extras);
  }
  fatal(message: string, extras?: { channel?: string; data?: Record<string, unknown> }): number {
    return this.log('fatal', message, extras);
  }

  // Mutate the active level filter at runtime.
  setMinLevel(level: LogLevel): void {
    if (this.disposed) return;
    if (LEVEL_RANKS[level] !== undefined) {
      this.minLevel = level;
    }
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  // Number of currently retained entries (capped at capacity).
  count(): number {
    return this.size;
  }

  capacity(): number {
    return this.capacityNum;
  }

  // Total entries dropped due to ring eviction since construction.
  droppedSinceStart(): number {
    return this.droppedCount;
  }

  // Last `n` entries, newest first. Pass nothing to get all retained.
  tail(n?: number): LogEntry[] {
    if (this.disposed) return [];
    var max = (typeof n === 'number' && n > 0) ? Math.floor(n) : this.size;
    var out: LogEntry[] = [];
    var taken = 0;
    var idx = (this.head - 1 + this.capacityNum) % this.capacityNum;
    while (taken < this.size && taken < max) {
      var entry = this.buffer[idx];
      if (entry) {
        out.push(entry);
        taken++;
      }
      idx = (idx - 1 + this.capacityNum) % this.capacityNum;
    }
    return out;
  }

  all(): LogEntry[] {
    return this.tail(this.size);
  }

  filter(opts: LogFilter): LogEntry[] {
    if (this.disposed) return [];
    var allEntries = this.all();
    var minRank = opts.minLevel !== undefined
      ? LEVEL_RANKS[opts.minLevel]
      : LEVEL_RANKS[this.minLevel];
    var since = opts.since;
    var channels: string[] | null = null;
    if (opts.channel !== undefined) {
      channels = Array.isArray(opts.channel) ? opts.channel.slice() : [opts.channel];
    }
    var out: LogEntry[] = [];
    for (var i = 0; i < allEntries.length; i++) {
      var e = allEntries[i] as LogEntry;
      if (LEVEL_RANKS[e.level] < minRank) continue;
      if (since !== undefined && e.timestampMs < since) continue;
      if (channels) {
        if (!e.channel) continue;
        if (channels.indexOf(e.channel) < 0) continue;
      }
      out.push(e);
    }
    return out;
  }

  // Clear all entries; nextId is preserved so external references
  // don't resolve to stale entries by accident.
  clear(): void {
    if (this.disposed) return;
    for (var i = 0; i < this.buffer.length; i++) this.buffer[i] = null;
    this.head = 0;
    this.size = 0;
  }

  dispose(): void {
    this.buffer.length = 0;
    this.size = 0;
    this.head = 0;
    this.sink = null;
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_LOG_RING_BUFFER = 'log_ring_buffer';
