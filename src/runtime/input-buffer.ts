// InputBuffer - input intent buffer with windowed expiry.
//
// 1.1.0 enabling primitive (Wave 1.1 combat depth start). Fighting
// games and ARPGs all face the same UX problem: the player presses
// "attack" 80ms before the previous animation finishes. If that
// input is dropped, combat feels janky. If it's just held until
// the animation ends, repeated taps stack into a sloppy spam.
// InputBuffer is the answer: stash recent inputs with a per-input
// time-to-live, let the gameplay layer consume the oldest matching
// input when it's ready to act on it, and age out anything stale.
//
//   var buf = InputBuffer.create({ defaultWindowMs: 200 });
//   on key press 'X': buf.buffer({ kind: 'attack' });
//   on animation end:
//     var input = buf.consume((i) => i.value.kind === 'attack');
//     if (input) startAttackCombo();
//   each frame:    buf.tick(dtMs);
//
// Pairs with InputActions (0.31), InputChord (0.39, simultaneous /
// sequence / hold patterns), HotKeyProfile (0.85). InputChord
// detects PATTERNS; InputBuffer queues INTENTS for delayed
// consumption.
//
// Pure type-generic over the input payload T. Consumer can pass
// any shape - opaque strings, action records, whatever fits.
//
// Code style: var-only in browser source.

export interface BufferedInput<T = unknown> {
  // Monotonic id assigned by the buffer.
  id: number;
  // The input payload (kind + optional data, or any opaque shape).
  value: T;
  // ms since buffer() was called.
  ageMs: number;
  // ms left before this input expires. -1 = sticky.
  remainingMs: number;
}

export interface BufferOptions {
  // Override the per-input lifetime. -1 = sticky (never expires).
  // Defaults to InputBufferOptions.defaultWindowMs.
  windowMs?: number;
}

export type RemovedReason = 'consumed' | 'expired' | 'evicted' | 'cleared';

export interface InputBufferOptions<T = unknown> {
  // ms each input lives before being aged out. Default 200.
  defaultWindowMs?: number;
  // Max simultaneous buffered inputs. Default 16. When the cap
  // is hit, the oldest input is evicted to make room.
  capacity?: number;
  // Fired when an input is added.
  onBuffer?: (i: BufferedInput<T>) => void;
  // Fired when an input is removed (consumed, expired, evicted,
  // cleared).
  onRemoved?: (i: BufferedInput<T>, reason: RemovedReason) => void;
}

const DEFAULT_WINDOW_MS = 200;
const DEFAULT_CAPACITY = 16;

interface InternalEntry<T> extends BufferedInput<T> {}

export class InputBuffer<T = unknown> {
  private items: InternalEntry<T>[] = [];
  private nextId: number = 1;
  private capacityNum: number;
  private defaultWindow: number;
  private onBuffer: ((i: BufferedInput<T>) => void) | null;
  private onRemoved: ((i: BufferedInput<T>, r: RemovedReason) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: InputBufferOptions<T>) {
    this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.defaultWindow = opts.defaultWindowMs !== undefined
        && isFinite(opts.defaultWindowMs)
      ? (opts.defaultWindowMs < 0 ? -1 : Math.floor(opts.defaultWindowMs))
      : DEFAULT_WINDOW_MS;
    this.onBuffer = opts.onBuffer ?? null;
    this.onRemoved = opts.onRemoved ?? null;
  }

  static create<T = unknown>(opts: InputBufferOptions<T> = {}): InputBuffer<T> {
    return new InputBuffer<T>(opts);
  }

  // Add an input. Returns the buffered id.
  buffer(value: T, opts: BufferOptions = {}): number {
    if (this.disposed) return 0;
    var window: number;
    if (opts.windowMs !== undefined) {
      window = opts.windowMs < 0 ? -1 : Math.floor(opts.windowMs);
    } else {
      window = this.defaultWindow;
    }
    if (this.items.length >= this.capacityNum) {
      this.evictOldest();
    }
    var entry: InternalEntry<T> = {
      id: this.nextId++,
      value: value,
      ageMs: 0,
      remainingMs: window,
    };
    this.items.push(entry);
    if (this.onBuffer) {
      try { this.onBuffer(this.snapshot(entry)); } catch { /* ignore */ }
    }
    return entry.id;
  }

  // Find + remove the oldest input matching the predicate. Returns
  // the consumed input, or null if no match.
  consume(predicate: (i: BufferedInput<T>) => boolean): BufferedInput<T> | null {
    if (this.disposed) return null;
    for (var i = 0; i < this.items.length; i++) {
      var entry = this.items[i] as InternalEntry<T>;
      var match = false;
      try { match = !!predicate(this.snapshot(entry)); } catch { match = false; }
      if (match) {
        this.items.splice(i, 1);
        if (this.onRemoved) {
          try { this.onRemoved(this.snapshot(entry), 'consumed'); } catch { /* ignore */ }
        }
        return this.snapshot(entry);
      }
    }
    return null;
  }

  // Find but do not remove the oldest input matching the predicate.
  peek(predicate: (i: BufferedInput<T>) => boolean): BufferedInput<T> | null {
    if (this.disposed) return null;
    for (var i = 0; i < this.items.length; i++) {
      var entry = this.items[i] as InternalEntry<T>;
      try {
        if (predicate(this.snapshot(entry))) return this.snapshot(entry);
      } catch { /* ignore */ }
    }
    return null;
  }

  // Convenience: remove + return the oldest input regardless of
  // predicate. Returns null if buffer is empty.
  consumeOldest(): BufferedInput<T> | null {
    if (this.disposed || this.items.length === 0) return null;
    var entry = this.items.shift() as InternalEntry<T>;
    if (this.onRemoved) {
      try { this.onRemoved(this.snapshot(entry), 'consumed'); } catch { /* ignore */ }
    }
    return this.snapshot(entry);
  }

  // Remove an input by id. Returns true if found.
  removeById(id: number): boolean {
    if (this.disposed) return false;
    for (var i = 0; i < this.items.length; i++) {
      var entry = this.items[i] as InternalEntry<T>;
      if (entry.id === id) {
        this.items.splice(i, 1);
        if (this.onRemoved) {
          try { this.onRemoved(this.snapshot(entry), 'consumed'); } catch { /* ignore */ }
        }
        return true;
      }
    }
    return false;
  }

  has(id: number): boolean {
    for (var i = 0; i < this.items.length; i++) {
      if ((this.items[i] as InternalEntry<T>).id === id) return true;
    }
    return false;
  }

  // Tick the buffer. Ages inputs and expires those whose
  // remainingMs reaches zero.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var expired: InternalEntry<T>[] = [];
    var keep: InternalEntry<T>[] = [];
    for (var i = 0; i < this.items.length; i++) {
      var entry = this.items[i] as InternalEntry<T>;
      entry.ageMs += dt;
      if (entry.remainingMs >= 0) {
        entry.remainingMs -= dt;
        if (entry.remainingMs <= 0) {
          expired.push(entry);
          continue;
        }
      }
      keep.push(entry);
    }
    this.items = keep;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var j = 0; j < expired.length; j++) {
        try { cb(this.snapshot(expired[j] as InternalEntry<T>), 'expired'); } catch { /* ignore */ }
      }
    }
  }

  forEach(cb: (i: BufferedInput<T>) => void): void {
    if (this.disposed) return;
    for (var i = 0; i < this.items.length; i++) {
      try { cb(this.snapshot(this.items[i] as InternalEntry<T>)); } catch { /* ignore */ }
    }
  }

  list(): BufferedInput<T>[] {
    var out: BufferedInput<T>[] = [];
    for (var i = 0; i < this.items.length; i++) {
      out.push(this.snapshot(this.items[i] as InternalEntry<T>));
    }
    return out;
  }

  count(): number { return this.items.length; }

  capacity(): number { return this.capacityNum; }

  // Drop every buffered input. Fires onRemoved with reason 'cleared'.
  clear(): void {
    if (this.disposed) return;
    var toRemove = this.items.slice();
    this.items.length = 0;
    if (this.onRemoved) {
      var cb = this.onRemoved;
      for (var i = 0; i < toRemove.length; i++) {
        try { cb(this.snapshot(toRemove[i] as InternalEntry<T>), 'cleared'); } catch { /* ignore */ }
      }
    }
  }

  dispose(): void {
    this.items.length = 0;
    this.onBuffer = null;
    this.onRemoved = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private evictOldest(): void {
    if (this.items.length === 0) return;
    var entry = this.items.shift() as InternalEntry<T>;
    if (this.onRemoved) {
      try { this.onRemoved(this.snapshot(entry), 'evicted'); } catch { /* ignore */ }
    }
  }

  private snapshot(entry: InternalEntry<T>): BufferedInput<T> {
    return {
      id: entry.id,
      value: entry.value,
      ageMs: entry.ageMs,
      remainingMs: entry.remainingMs,
    };
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_INPUT_BUFFER = 'input_buffer';
