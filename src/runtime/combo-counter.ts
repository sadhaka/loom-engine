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

export interface ComboThreshold {
  count: number;
  callback: (count: number) => void;
  data?: Record<string, unknown>;
}

export interface ComboCounterOptions {
  // Reset timeout in ms; default 2500. If no hit lands within this
  // window, the counter resets to 0 and onReset fires.
  timeoutMs?: number;
  // Sorted-by-count thresholds. Each fires callback exactly once
  // per chain when count first crosses it.
  thresholds?: ComboThreshold[];
  // Fired on every hit() call (after the count bumps).
  onChain?: (count: number) => void;
  // Fired when the counter resets (manually or via timeout).
  // peakCount is the highest count reached this chain.
  onReset?: (peakCount: number) => void;
}

interface InternalThreshold {
  count: number;
  callback: (count: number) => void;
  fired: boolean;
}

const DEFAULT_TIMEOUT_MS = 2500;

export class ComboCounter {
  private count: number = 0;
  private peak: number = 0;
  private remainingMs: number = 0;
  private timeoutMs: number;
  private thresholds: InternalThreshold[];
  private onChain: ((c: number) => void) | null;
  private onReset: ((p: number) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: ComboCounterOptions) {
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

  static create(opts: ComboCounterOptions = {}): ComboCounter {
    return new ComboCounter(opts);
  }

  // Register a hit. Bumps the counter, refreshes the timer, fires
  // any threshold callbacks crossed, fires onChain. Returns the new
  // combo count.
  hit(): number {
    if (this.disposed) return 0;
    this.count += 1;
    if (this.count > this.peak) this.peak = this.count;
    this.remainingMs = this.timeoutMs;
    if (this.onChain) {
      try { this.onChain(this.count); } catch { /* ignore */ }
    }
    for (var i = 0; i < this.thresholds.length; i++) {
      var t = this.thresholds[i] as InternalThreshold;
      if (!t.fired && this.count >= t.count) {
        t.fired = true;
        try { t.callback(this.count); } catch { /* ignore */ }
      }
    }
    return this.count;
  }

  // Manual reset. Fires onReset with peak count.
  reset(): void {
    if (this.disposed) return;
    this.fireResetIfActive();
  }

  // Advance the reset timer by dtMs. Triggers automatic reset (and
  // onReset) when the timer expires.
  tick(dtMs: number): void {
    if (this.disposed) return;
    if (this.count <= 0) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    this.remainingMs -= dt;
    if (this.remainingMs <= 0) {
      this.fireResetIfActive();
    }
  }

  getCount(): number { return this.count; }

  // Highest count reached this chain. Cleared on reset.
  getPeak(): number { return this.peak; }

  getRemainingMs(): number {
    if (this.count <= 0) return 0;
    return Math.max(0, this.remainingMs);
  }

  isActive(): boolean { return this.count > 0; }

  setTimeoutMs(ms: number): void {
    if (this.disposed) return;
    if (!isFinite(ms) || ms <= 0) return;
    this.timeoutMs = ms;
  }

  // Register a new threshold at runtime. Returns false if a
  // threshold at that count already exists.
  addThreshold(t: ComboThreshold): boolean {
    if (this.disposed) return false;
    if (!t || typeof t.count !== 'number' || !isFinite(t.count) || t.count <= 0) {
      return false;
    }
    if (typeof t.callback !== 'function') return false;
    var c = Math.floor(t.count);
    for (var i = 0; i < this.thresholds.length; i++) {
      if ((this.thresholds[i] as InternalThreshold).count === c) return false;
    }
    this.thresholds.push({
      count: c,
      callback: t.callback,
      fired: this.count >= c,
    });
    this.thresholds.sort((a, b) => a.count - b.count);
    return true;
  }

  removeThreshold(count: number): boolean {
    if (this.disposed) return false;
    var c = Math.floor(count);
    for (var i = 0; i < this.thresholds.length; i++) {
      if ((this.thresholds[i] as InternalThreshold).count === c) {
        this.thresholds.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.count = 0;
    this.peak = 0;
    this.remainingMs = 0;
    this.thresholds = [];
    this.onChain = null;
    this.onReset = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private fireResetIfActive(): void {
    if (this.count <= 0) return;
    var peak = this.peak;
    this.count = 0;
    this.peak = 0;
    this.remainingMs = 0;
    // Re-arm thresholds so the next chain can trigger them again.
    for (var i = 0; i < this.thresholds.length; i++) {
      (this.thresholds[i] as InternalThreshold).fired = false;
    }
    if (this.onReset) {
      try { this.onReset(peak); } catch { /* ignore */ }
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_COMBO_COUNTER = 'combo_counter';
