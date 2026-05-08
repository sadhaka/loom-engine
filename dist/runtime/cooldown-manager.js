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
export class CooldownManager {
    cds = new Map();
    onReady;
    disposed = false;
    constructor(opts) {
        this.onReady = opts.onReady ?? null;
    }
    static create(opts = {}) {
        return new CooldownManager(opts);
    }
    // Begin a cooldown. If `key` is already on cooldown, replaces it
    // wholesale (same key = single timer; you cannot stack). Use a
    // composite key for stacking semantics.
    start(key, durationMs) {
        if (this.disposed)
            return;
        if (typeof key !== 'string' || key.length === 0)
            return;
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
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var doneKeys = [];
        var iter = this.cds.entries();
        var step = iter.next();
        while (!step.done) {
            var entry = step.value;
            var key = entry[0];
            var cd = entry[1];
            cd.remainingMs -= dt;
            if (cd.remainingMs <= 0)
                doneKeys.push(key);
            step = iter.next();
        }
        for (var i = 0; i < doneKeys.length; i++) {
            var dk = doneKeys[i];
            this.cds.delete(dk);
            if (this.onReady) {
                try {
                    this.onReady(dk);
                }
                catch {
                    // Best-effort.
                }
            }
        }
    }
    // True if `key` has no active cooldown.
    isReady(key) {
        if (this.disposed)
            return true;
        return !this.cds.has(key);
    }
    // True iff `key` has an active cooldown.
    isOnCooldown(key) {
        return !this.isReady(key);
    }
    // ms remaining on `key`'s cooldown; 0 if ready.
    remaining(key) {
        var cd = this.cds.get(key);
        return cd ? Math.max(0, cd.remainingMs) : 0;
    }
    // Total duration of `key`'s cooldown when it was started; 0 if
    // not on cooldown. Useful for HUD progress rings.
    totalFor(key) {
        var cd = this.cds.get(key);
        return cd ? cd.totalMs : 0;
    }
    // Fraction in [0, 1] of the cooldown that's elapsed; 1 = ready.
    fractionElapsed(key) {
        var cd = this.cds.get(key);
        if (!cd || cd.totalMs <= 0)
            return 1;
        var elapsed = cd.totalMs - cd.remainingMs;
        if (elapsed < 0)
            return 0;
        if (elapsed > cd.totalMs)
            return 1;
        return elapsed / cd.totalMs;
    }
    // Force a key to become ready immediately. onReady fires.
    clear(key) {
        if (this.disposed)
            return false;
        var existed = this.cds.delete(key);
        if (existed && this.onReady) {
            try {
                this.onReady(key);
            }
            catch { /* ignore */ }
        }
        return existed;
    }
    // Reset every active cooldown. onReady fires for each.
    clearAll() {
        if (this.disposed)
            return;
        var keys = Array.from(this.cds.keys());
        this.cds.clear();
        if (this.onReady) {
            var cb = this.onReady;
            for (var i = 0; i < keys.length; i++) {
                try {
                    cb(keys[i]);
                }
                catch { /* ignore */ }
            }
        }
    }
    // Active cooldown count.
    activeCount() {
        return this.cds.size;
    }
    // List of keys currently on cooldown.
    activeKeys() {
        return Array.from(this.cds.keys());
    }
    // Convenience: try to use `key`. If ready, starts the cooldown
    // and returns true. If on cooldown, returns false.
    tryUse(key, durationMs) {
        if (this.disposed)
            return false;
        if (!this.isReady(key))
            return false;
        this.start(key, durationMs);
        return true;
    }
    dispose() {
        this.cds.clear();
        this.onReady = null;
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_COOLDOWN_MANAGER = 'cooldown_manager';
//# sourceMappingURL=cooldown-manager.js.map