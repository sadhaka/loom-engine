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
const LEVEL_RANKS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};
const DEFAULT_CAPACITY = 1024;
function defaultNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
export class LogRingBuffer {
    buffer;
    capacityNum;
    head = 0; // index where the next entry will land
    size = 0; // entries currently retained
    nextId = 1;
    droppedCount = 0;
    minLevel;
    nowMs;
    sink;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
        this.minLevel = opts.minLevel ?? 'debug';
        this.nowMs = opts.now ?? defaultNowMs;
        this.sink = opts.sink ?? null;
        this.buffer = new Array(this.capacityNum).fill(null);
    }
    static create(opts = {}) {
        return new LogRingBuffer(opts);
    }
    // Generic append. Returns the entry id (or 0 if filtered / disposed).
    log(level, message, extras) {
        if (this.disposed)
            return 0;
        if (LEVEL_RANKS[level] < LEVEL_RANKS[this.minLevel])
            return 0;
        var id = this.nextId++;
        var entry = {
            id: id,
            level: level,
            message: typeof message === 'string' ? message : String(message),
            timestampMs: this.nowMs(),
        };
        if (extras) {
            if (extras.channel !== undefined)
                entry.channel = extras.channel;
            if (extras.data !== undefined)
                entry.data = extras.data;
        }
        var slotWillEvict = this.size === this.capacityNum;
        if (slotWillEvict)
            this.droppedCount++;
        this.buffer[this.head] = entry;
        this.head = (this.head + 1) % this.capacityNum;
        if (this.size < this.capacityNum)
            this.size++;
        if (this.sink) {
            try {
                this.sink(entry);
            }
            catch {
                // Best-effort: a misbehaving sink never takes down the
                // ring buffer.
            }
        }
        return id;
    }
    // Convenience methods.
    debug(message, extras) {
        return this.log('debug', message, extras);
    }
    info(message, extras) {
        return this.log('info', message, extras);
    }
    warn(message, extras) {
        return this.log('warn', message, extras);
    }
    error(message, extras) {
        return this.log('error', message, extras);
    }
    fatal(message, extras) {
        return this.log('fatal', message, extras);
    }
    // Mutate the active level filter at runtime.
    setMinLevel(level) {
        if (this.disposed)
            return;
        if (LEVEL_RANKS[level] !== undefined) {
            this.minLevel = level;
        }
    }
    getMinLevel() {
        return this.minLevel;
    }
    // Number of currently retained entries (capped at capacity).
    count() {
        return this.size;
    }
    capacity() {
        return this.capacityNum;
    }
    // Total entries dropped due to ring eviction since construction.
    droppedSinceStart() {
        return this.droppedCount;
    }
    // Last `n` entries, newest first. Pass nothing to get all retained.
    tail(n) {
        if (this.disposed)
            return [];
        var max = (typeof n === 'number' && n > 0) ? Math.floor(n) : this.size;
        var out = [];
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
    all() {
        return this.tail(this.size);
    }
    filter(opts) {
        if (this.disposed)
            return [];
        var allEntries = this.all();
        var minRank = opts.minLevel !== undefined
            ? LEVEL_RANKS[opts.minLevel]
            : LEVEL_RANKS[this.minLevel];
        var since = opts.since;
        var channels = null;
        if (opts.channel !== undefined) {
            channels = Array.isArray(opts.channel) ? opts.channel.slice() : [opts.channel];
        }
        var out = [];
        for (var i = 0; i < allEntries.length; i++) {
            var e = allEntries[i];
            if (LEVEL_RANKS[e.level] < minRank)
                continue;
            if (since !== undefined && e.timestampMs < since)
                continue;
            if (channels) {
                if (!e.channel)
                    continue;
                if (channels.indexOf(e.channel) < 0)
                    continue;
            }
            out.push(e);
        }
        return out;
    }
    // Clear all entries; nextId is preserved so external references
    // don't resolve to stale entries by accident.
    clear() {
        if (this.disposed)
            return;
        for (var i = 0; i < this.buffer.length; i++)
            this.buffer[i] = null;
        this.head = 0;
        this.size = 0;
    }
    dispose() {
        this.buffer.length = 0;
        this.size = 0;
        this.head = 0;
        this.sink = null;
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_LOG_RING_BUFFER = 'log_ring_buffer';
//# sourceMappingURL=log-ring-buffer.js.map