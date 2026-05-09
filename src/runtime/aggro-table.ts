// AggroTable - multi-target threat ledger for boss AI.
//
// 0.76.0 enabling primitive. Bosses with multiple attackers need
// to know "who is hurting me most right now?" and "who hit me last?"
// to drive target-selection AI. AggroTable is that ledger: keyed by
// target id, storing accumulated threat plus a monotonic last-hit
// counter. Threat decays over time so a player who stops attacking
// fades off the threat list, and entries below a minThreat floor
// get auto-evicted to keep the table compact.
//
//   var aggro = AggroTable.create({
//     decayPerSecond: 0.05, // 5% / second
//     minThreat: 0.5,
//     maxTargets: 32,
//   });
//
//   // On a hit:
//   aggro.addThreat('player:42', damageDealt);
//
//   // Each frame:
//   aggro.tick(dtMs);
//
//   // AI decision:
//   var target = aggro.topTarget();
//   if (target) boss.attack(target);
//
// Pairs with DamageFormula (0.66) - typical wiring is to add threat
// equal to a hit's `result.final` damage (or some scaled function of
// it for healers / tanks).
//
// Code style: var-only in browser source.

export interface AggroTableOptions {
  // Decay rate per second as a fraction (0.05 = 5% / second).
  // Default 0 (no decay; threat persists forever).
  decayPerSecond?: number;
  // Floor below which an entry is auto-removed during decay.
  // Default 0.01.
  minThreat?: number;
  // Max number of targets tracked. When over, addThreat evicts the
  // lowest-threat entry. Default 64.
  maxTargets?: number;
}

export interface AggroEntry {
  target: string;
  threat: number;
  // Monotonic counter (NOT Date.now). 0 = never hit; higher =
  // more recent. Replay-deterministic.
  lastHitAt: number;
}

const DEFAULT_DECAY = 0;
const DEFAULT_MIN_THREAT = 0.01;
const DEFAULT_MAX_TARGETS = 64;

interface InternalEntry {
  threat: number;
  lastHitAt: number;
}

export class AggroTable {
  private entries: Map<string, InternalEntry> = new Map();
  private decay: number;
  private minThreat: number;
  private maxTargets: number;
  private hitSeq: number = 0;
  private disposed: boolean = false;

  private constructor(opts: AggroTableOptions) {
    this.decay = opts.decayPerSecond !== undefined && isFinite(opts.decayPerSecond) && opts.decayPerSecond >= 0
      ? opts.decayPerSecond : DEFAULT_DECAY;
    this.minThreat = opts.minThreat !== undefined && isFinite(opts.minThreat) && opts.minThreat >= 0
      ? opts.minThreat : DEFAULT_MIN_THREAT;
    this.maxTargets = opts.maxTargets !== undefined && isFinite(opts.maxTargets) && opts.maxTargets > 0
      ? Math.floor(opts.maxTargets) : DEFAULT_MAX_TARGETS;
  }

  static create(opts: AggroTableOptions = {}): AggroTable {
    return new AggroTable(opts);
  }

  // Add `amount` to `target`'s threat. Updates lastHit counter.
  // Negative amounts are allowed (threat reduction). Empty target
  // id / non-finite amount rejected.
  addThreat(target: string, amount: number): void {
    if (this.disposed) return;
    if (typeof target !== 'string' || target.length === 0) return;
    var a = +amount;
    if (!isFinite(a) || a === 0) return;
    var entry = this.entries.get(target);
    if (!entry) {
      this.evictIfFull();
      entry = { threat: 0, lastHitAt: 0 };
      this.entries.set(target, entry);
    }
    entry.threat += a;
    if (entry.threat < 0) entry.threat = 0;
    this.hitSeq += 1;
    entry.lastHitAt = this.hitSeq;
    if (entry.threat <= 0) {
      this.entries.delete(target);
    }
  }

  // Set absolute threat. Empty target id / non-finite value
  // rejected. Setting to 0 removes the entry.
  setThreat(target: string, amount: number): void {
    if (this.disposed) return;
    if (typeof target !== 'string' || target.length === 0) return;
    var a = +amount;
    if (!isFinite(a)) return;
    if (a <= 0) {
      this.entries.delete(target);
      return;
    }
    var entry = this.entries.get(target);
    if (!entry) {
      this.evictIfFull();
      entry = { threat: a, lastHitAt: 0 };
      this.entries.set(target, entry);
    } else {
      entry.threat = a;
    }
  }

  remove(target: string): boolean {
    if (this.disposed) return false;
    return this.entries.delete(target);
  }

  clear(): void {
    if (this.disposed) return;
    this.entries.clear();
  }

  getThreat(target: string): number {
    var e = this.entries.get(target);
    return e ? e.threat : 0;
  }

  has(target: string): boolean {
    return this.entries.has(target);
  }

  // Highest-threat target (or null if empty). Ties broken by more
  // recent lastHitAt.
  topTarget(): string | null {
    if (this.disposed) return null;
    var best: string | null = null;
    var bestT = -Infinity;
    var bestHit = -1;
    this.entries.forEach((e, id) => {
      if (e.threat > bestT || (e.threat === bestT && e.lastHitAt > bestHit)) {
        best = id;
        bestT = e.threat;
        bestHit = e.lastHitAt;
      }
    });
    return best;
  }

  // Most recently hit target (or null if empty).
  lastHitTarget(): string | null {
    if (this.disposed) return null;
    var best: string | null = null;
    var bestHit = -1;
    this.entries.forEach((e, id) => {
      if (e.lastHitAt > bestHit) {
        best = id;
        bestHit = e.lastHitAt;
      }
    });
    return best;
  }

  // List entries sorted by threat (descending). Defensive copy.
  list(): AggroEntry[] {
    var out: AggroEntry[] = [];
    this.entries.forEach((e, id) => {
      out.push({ target: id, threat: e.threat, lastHitAt: e.lastHitAt });
    });
    out.sort((a, b) => {
      if (b.threat !== a.threat) return b.threat - a.threat;
      return b.lastHitAt - a.lastHitAt;
    });
    return out;
  }

  // Decay every entry by (decayPerSecond * dt / 1000). Entries
  // dropping below minThreat are removed.
  tick(dtMs: number): void {
    if (this.disposed) return;
    if (this.decay <= 0) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var factor = 1 - this.decay * (dt / 1000);
    if (factor < 0) factor = 0;
    var toRemove: string[] = [];
    this.entries.forEach((e, id) => {
      e.threat = e.threat * factor;
      if (e.threat < this.minThreat) toRemove.push(id);
    });
    for (var i = 0; i < toRemove.length; i++) this.entries.delete(toRemove[i] as string);
  }

  setDecayPerSecond(rate: number): void {
    if (this.disposed) return;
    if (!isFinite(rate) || rate < 0) return;
    this.decay = rate;
  }

  size(): number {
    return this.entries.size;
  }

  dispose(): void {
    this.entries.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private evictIfFull(): void {
    if (this.entries.size < this.maxTargets) return;
    // Find lowest-threat entry, ties broken by oldest lastHitAt.
    var worst: string | null = null;
    var worstT = Infinity;
    var worstHit = Infinity;
    this.entries.forEach((e, id) => {
      if (e.threat < worstT || (e.threat === worstT && e.lastHitAt < worstHit)) {
        worst = id;
        worstT = e.threat;
        worstHit = e.lastHitAt;
      }
    });
    if (worst !== null) this.entries.delete(worst);
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_AGGRO_TABLE = 'aggro_table';
