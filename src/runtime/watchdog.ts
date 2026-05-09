// Watchdog - heartbeat monitor with stale-detection.
//
// 0.69.0 enabling primitive. Long-running connections (SSE
// streams, plugin processes, multiplayer peers, asset workers)
// need a "did this thing crash?" check. Watchdog tracks named
// heartbeats, marks them stale when too long passes between
// pings, and fires onStale / onAlive callbacks when state flips.
//
//   var wd = Watchdog.create({ defaultTimeoutMs: 5000 });
//   wd.register('director-bridge', { onStale: () => reconnect() });
//   each frame: wd.tick(dtMs);
//   on heartbeat receipt: wd.heartbeat('director-bridge');
//
// Code style: var-only in browser source.

export interface WatchdogEntryOptions {
  // Override the watchdog's default timeout for this entry.
  timeoutMs?: number;
  // Fired when the entry transitions alive -> stale.
  onStale?: () => void;
  // Fired when the entry transitions stale -> alive.
  onAlive?: () => void;
}

export interface WatchdogStatus {
  name: string;
  // ms since the last heartbeat.
  ageMs: number;
  // Threshold for stale.
  timeoutMs: number;
  // Currently considered alive (recent heartbeat) or stale.
  alive: boolean;
}

export interface WatchdogOptions {
  // Default timeout for entries that don't specify one. Default
  // 5000ms.
  defaultTimeoutMs?: number;
}

interface Entry {
  name: string;
  ageMs: number;
  timeoutMs: number;
  alive: boolean;
  onStale: (() => void) | null;
  onAlive: (() => void) | null;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class Watchdog {
  private entries: Map<string, Entry> = new Map();
  private defaultTimeoutMs: number;
  private disposed: boolean = false;

  private constructor(opts: WatchdogOptions) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs !== undefined && opts.defaultTimeoutMs > 0
      ? opts.defaultTimeoutMs : DEFAULT_TIMEOUT_MS;
  }

  static create(opts: WatchdogOptions = {}): Watchdog {
    return new Watchdog(opts);
  }

  // Begin watching `name`. Initial state is alive (age=0). Returns
  // false if name was already registered (no-op replace).
  register(name: string, opts: WatchdogEntryOptions = {}): boolean {
    if (this.disposed) return false;
    if (typeof name !== 'string' || name.length === 0) return false;
    if (this.entries.has(name)) return false;
    var timeout = opts.timeoutMs !== undefined && opts.timeoutMs > 0
      ? opts.timeoutMs : this.defaultTimeoutMs;
    this.entries.set(name, {
      name: name,
      ageMs: 0,
      timeoutMs: timeout,
      alive: true,
      onStale: opts.onStale ?? null,
      onAlive: opts.onAlive ?? null,
    });
    return true;
  }

  unregister(name: string): boolean {
    if (this.disposed) return false;
    return this.entries.delete(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  // Mark this entry as having received a heartbeat (resets age).
  // If the entry was stale, fires onAlive.
  heartbeat(name: string): boolean {
    if (this.disposed) return false;
    var e = this.entries.get(name);
    if (!e) return false;
    e.ageMs = 0;
    if (!e.alive) {
      e.alive = true;
      if (e.onAlive) {
        try { e.onAlive(); } catch { /* ignore */ }
      }
    }
    return true;
  }

  // Tick advances every entry's age. Entries crossing their
  // timeout flip alive -> stale and fire onStale.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var becameStale: Entry[] = [];
    var iter = this.entries.values();
    var step = iter.next();
    while (!step.done) {
      var e = step.value as Entry;
      e.ageMs += dt;
      if (e.alive && e.ageMs >= e.timeoutMs) {
        e.alive = false;
        becameStale.push(e);
      }
      step = iter.next();
    }
    for (var i = 0; i < becameStale.length; i++) {
      var e2 = becameStale[i] as Entry;
      if (e2.onStale) {
        try { e2.onStale(); } catch { /* ignore */ }
      }
    }
  }

  // Check current state of `name`. Returns null if not registered.
  status(name: string): WatchdogStatus | null {
    var e = this.entries.get(name);
    if (!e) return null;
    return {
      name: e.name,
      ageMs: e.ageMs,
      timeoutMs: e.timeoutMs,
      alive: e.alive,
    };
  }

  isAlive(name: string): boolean {
    var e = this.entries.get(name);
    return e ? e.alive : false;
  }

  // List every registered entry's status.
  list(): WatchdogStatus[] {
    var out: WatchdogStatus[] = [];
    this.entries.forEach((e) => {
      out.push({
        name: e.name,
        ageMs: e.ageMs,
        timeoutMs: e.timeoutMs,
        alive: e.alive,
      });
    });
    return out;
  }

  // List names of entries that are currently stale.
  staleNames(): string[] {
    var out: string[] = [];
    this.entries.forEach((e) => {
      if (!e.alive) out.push(e.name);
    });
    return out;
  }

  // Update an entry's timeout at runtime (e.g. after a successful
  // long-poll, extend the threshold). No-op if missing.
  setTimeout(name: string, timeoutMs: number): boolean {
    if (this.disposed) return false;
    var e = this.entries.get(name);
    if (!e) return false;
    if (timeoutMs > 0) e.timeoutMs = timeoutMs;
    return true;
  }

  count(): number { return this.entries.size; }

  clear(): void {
    if (this.disposed) return;
    this.entries.clear();
  }

  dispose(): void {
    this.entries.clear();
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_WATCHDOG = 'watchdog';
