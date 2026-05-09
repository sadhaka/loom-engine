// ComboCounter - chain hit counter with reset timer.
//
// 0.96.0 enabling primitive. ARPGs / brawlers reward consecutive
// hits with combo callouts ("10 HIT!", "50 HIT!"), crit
// multipliers, and SFX. ComboCounter is the per-character ledger:
// hit() bumps the count, tick(dt) advances the reset timer,
// reaching a threshold fires a callback. Resets if no hit lands
// within timeoutMs.
//
//   var combo = ComboCounter.create({
//     timeoutMs: 2500,
//     thresholds: [
//       { count: 10, callback: () => toast.post('10 HIT!') },
//       { count: 50, callback: () => audio.play('combo_50') },
//     ],
//     onReset: (peak) => stats.recordCombo(peak),
//   });
//   on hit: combo.hit();
//   each frame: combo.tick(dtMs);
//
// Pairs with DamageFormula (0.66), DamageNumberPipeline (0.72),
// AudioCueQueue (0.94), ToastQueue (0.65).
//
// Code style: var-only in browser source.
const DEFAULT_TIMEOUT_MS = 2500;
export class ComboCounter {
    count = 0;
    peak = 0;
    remainingMs = 0;
    timeoutMs;
    thresholds;
    onChain;
    onReset;
    disposed = false;
    constructor(opts) {
        this.timeoutMs = opts.timeoutMs !== undefined && isFinite(opts.timeoutMs)
            && opts.timeoutMs > 0
            ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
        this.thresholds = (opts.thresholds || [])
            .filter((t) => t && typeof t.count === 'number'
            && isFinite(t.count) && t.count > 0
            && typeof t.callback === 'function')
            .map((t) => ({
            count: Math.floor(t.count),
            callback: t.callback,
            fired: false,
        }));
        this.thresholds.sort((a, b) => a.count - b.count);
        this.onChain = opts.onChain ?? null;
        this.onReset = opts.onReset ?? null;
    }
    static create(opts = {}) {
        return new ComboCounter(opts);
    }
    // Register a hit. Bumps the counter, refreshes the timer, fires
    // any threshold callbacks crossed, fires onChain. Returns the new
    // combo count.
    hit() {
        if (this.disposed)
            return 0;
        this.count += 1;
        if (this.count > this.peak)
            this.peak = this.count;
        this.remainingMs = this.timeoutMs;
        if (this.onChain) {
            try {
                this.onChain(this.count);
            }
            catch { /* ignore */ }
        }
        for (var i = 0; i < this.thresholds.length; i++) {
            var t = this.thresholds[i];
            if (!t.fired && this.count >= t.count) {
                t.fired = true;
                try {
                    t.callback(this.count);
                }
                catch { /* ignore */ }
            }
        }
        return this.count;
    }
    // Manual reset. Fires onReset with peak count.
    reset() {
        if (this.disposed)
            return;
        this.fireResetIfActive();
    }
    // Advance the reset timer by dtMs. Triggers automatic reset (and
    // onReset) when the timer expires.
    tick(dtMs) {
        if (this.disposed)
            return;
        if (this.count <= 0)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        this.remainingMs -= dt;
        if (this.remainingMs <= 0) {
            this.fireResetIfActive();
        }
    }
    getCount() { return this.count; }
    // Highest count reached this chain. Cleared on reset.
    getPeak() { return this.peak; }
    getRemainingMs() {
        if (this.count <= 0)
            return 0;
        return Math.max(0, this.remainingMs);
    }
    isActive() { return this.count > 0; }
    setTimeoutMs(ms) {
        if (this.disposed)
            return;
        if (!isFinite(ms) || ms <= 0)
            return;
        this.timeoutMs = ms;
    }
    // Register a new threshold at runtime. Returns false if a
    // threshold at that count already exists.
    addThreshold(t) {
        if (this.disposed)
            return false;
        if (!t || typeof t.count !== 'number' || !isFinite(t.count) || t.count <= 0) {
            return false;
        }
        if (typeof t.callback !== 'function')
            return false;
        var c = Math.floor(t.count);
        for (var i = 0; i < this.thresholds.length; i++) {
            if (this.thresholds[i].count === c)
                return false;
        }
        this.thresholds.push({
            count: c,
            callback: t.callback,
            fired: this.count >= c,
        });
        this.thresholds.sort((a, b) => a.count - b.count);
        return true;
    }
    removeThreshold(count) {
        if (this.disposed)
            return false;
        var c = Math.floor(count);
        for (var i = 0; i < this.thresholds.length; i++) {
            if (this.thresholds[i].count === c) {
                this.thresholds.splice(i, 1);
                return true;
            }
        }
        return false;
    }
    dispose() {
        this.count = 0;
        this.peak = 0;
        this.remainingMs = 0;
        this.thresholds = [];
        this.onChain = null;
        this.onReset = null;
        this.disposed = true;
    }
    // ---------- private ----------
    fireResetIfActive() {
        if (this.count <= 0)
            return;
        var peak = this.peak;
        this.count = 0;
        this.peak = 0;
        this.remainingMs = 0;
        // Re-arm thresholds so the next chain can trigger them again.
        for (var i = 0; i < this.thresholds.length; i++) {
            this.thresholds[i].fired = false;
        }
        if (this.onReset) {
            try {
                this.onReset(peak);
            }
            catch { /* ignore */ }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_COMBO_COUNTER = 'combo_counter';
//# sourceMappingURL=combo-counter.js.map