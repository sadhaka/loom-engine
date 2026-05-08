// CooldownManager - per-key cooldown tracking.
//
// 0.52.0 enabling primitive. Skills, item-uses, ability triggers,
// chat throttles, and reconnect attempts all share the same shape:
// "this thing was used at time T; refuse it again until T + delay."
// Each subsystem rolls its own per-key Map. CooldownManager
// factors that out into a single trackable resource:
//
//   var cd = CooldownManager.create();
//   cd.start('fireball', 8000);
//   cd.isReady('fireball');     // false right after start
//   cd.tick(100);
//   cd.remaining('fireball');   // ms until ready (8000 - 100 = 7900)
//
// Tick-driven so the same code is replay-deterministic when fed
// from EngineClock. tick(0) is a no-op; negative dt is ignored.
//
// Code style: var-only in browser source.

interface CooldownEntry {
  remainingMs: number;
  totalMs: number;
}

export interface CooldownManagerOptions {
  // Optional callback fired when a cooldown reaches zero (becomes
  // ready). Receives the key. Throwing isolated.
  onReady?: (key: string) => void;
}

export class CooldownManager {
  private cds: Map<string, CooldownEntry> = new Map();
  private onReady: ((key: string) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: CooldownManagerOptions) {
    this.onReady = opts.onReady ?? null;
  }

  static create(opts: CooldownManagerOptions = {}): CooldownManager {
    return new CooldownManager(opts);
  }

  // Begin a cooldown. If `key` is already on cooldown, replaces it
  // wholesale (same key = single timer; you cannot stack). Use a
  // composite key for stacking semantics.
  start(key: string, durationMs: number): void {
    if (this.disposed) return;
    if (typeof key !== 'string' || key.length === 0) return;
    var dur = +durationMs;
    if (!isFinite(dur) || dur <= 0) {
      // Zero-duration "cooldown" never registers; isReady is true.
      this.cds.delete(key);
      return;
    }
    this.cds.set(key, { remainingMs: dur, totalMs: dur });
  }

  // Reduce all active cooldowns by `dtMs`. Keys that reach zero are
  // removed and onReady fires once for each.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var doneKeys: string[] = [];
    var iter = this.cds.entries();
    var step = iter.next();
    while (!step.done) {
      var entry = step.value as [string, CooldownEntry];
      var key = entry[0];
      var cd = entry[1];
      cd.remainingMs -= dt;
      if (cd.remainingMs <= 0) doneKeys.push(key);
      step = iter.next();
    }
    for (var i = 0; i < doneKeys.length; i++) {
      var dk = doneKeys[i] as string;
      this.cds.delete(dk);
      if (this.onReady) {
        try { this.onReady(dk); } catch {
          // Best-effort.
        }
      }
    }
  }

  // True if `key` has no active cooldown.
  isReady(key: string): boolean {
    if (this.disposed) return true;
    return !this.cds.has(key);
  }

  // True iff `key` has an active cooldown.
  isOnCooldown(key: string): boolean {
    return !this.isReady(key);
  }

  // ms remaining on `key`'s cooldown; 0 if ready.
  remaining(key: string): number {
    var cd = this.cds.get(key);
    return cd ? Math.max(0, cd.remainingMs) : 0;
  }

  // Total duration of `key`'s cooldown when it was started; 0 if
  // not on cooldown. Useful for HUD progress rings.
  totalFor(key: string): number {
    var cd = this.cds.get(key);
    return cd ? cd.totalMs : 0;
  }

  // Fraction in [0, 1] of the cooldown that's elapsed; 1 = ready.
  fractionElapsed(key: string): number {
    var cd = this.cds.get(key);
    if (!cd || cd.totalMs <= 0) return 1;
    var elapsed = cd.totalMs - cd.remainingMs;
    if (elapsed < 0) return 0;
    if (elapsed > cd.totalMs) return 1;
    return elapsed / cd.totalMs;
  }

  // Force a key to become ready immediately. onReady fires.
  clear(key: string): boolean {
    if (this.disposed) return false;
    var existed = this.cds.delete(key);
    if (existed && this.onReady) {
      try { this.onReady(key); } catch { /* ignore */ }
    }
    return existed;
  }

  // Reset every active cooldown. onReady fires for each.
  clearAll(): void {
    if (this.disposed) return;
    var keys = Array.from(this.cds.keys());
    this.cds.clear();
    if (this.onReady) {
      var cb = this.onReady;
      for (var i = 0; i < keys.length; i++) {
        try { cb(keys[i] as string); } catch { /* ignore */ }
      }
    }
  }

  // Active cooldown count.
  activeCount(): number {
    return this.cds.size;
  }

  // List of keys currently on cooldown.
  activeKeys(): string[] {
    return Array.from(this.cds.keys());
  }

  // Convenience: try to use `key`. If ready, starts the cooldown
  // and returns true. If on cooldown, returns false.
  tryUse(key: string, durationMs: number): boolean {
    if (this.disposed) return false;
    if (!this.isReady(key)) return false;
    this.start(key, durationMs);
    return true;
  }

  dispose(): void {
    this.cds.clear();
    this.onReady = null;
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_COOLDOWN_MANAGER = 'cooldown_manager';
