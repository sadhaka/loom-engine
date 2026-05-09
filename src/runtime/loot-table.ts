// LootTable - weighted random drop tables.
//
// 0.62.0 enabling primitive. Boss kills, chest opens, mob despawns,
// daily rewards - they all share the "pick a few items from a
// weighted pool" pattern. LootTable is that primitive: register
// entries with a weight, optionally a guaranteed drop count + a
// per-roll random pick count, and a seedable RNG so loot is
// replay-deterministic.
//
//   var table = LootTable.create({
//     entries: [
//       { itemId: 'gold-coin',   weight: 60, count: 50 },
//       { itemId: 'health-potion', weight: 30 },
//       { itemId: 'rare-gem',    weight: 9 },
//       { itemId: 'epic-sword',  weight: 1 },
//     ],
//     rollCount: 3,           // pick 3 items per roll()
//     guaranteed: ['gold-coin'], // always include this id once
//     seed: 1234,
//   });
//   var drops = table.roll();
//
// Code style: var-only in browser source.

export interface LootEntry {
  itemId: string;
  // Relative weight; higher = more likely. Must be > 0 for the
  // entry to ever roll.
  weight: number;
  // Optional fixed count when this entry rolls. Default 1.
  count?: number;
  // Optional [min, max] inclusive count range. If set, overrides
  // `count` and the count is rolled uniformly within the range.
  countRange?: [number, number];
}

export interface LootDrop {
  itemId: string;
  count: number;
}

export interface LootTableOptions {
  entries: LootEntry[];
  // Number of weighted picks per roll(). Default 1. Each pick is
  // independent; the same itemId can be drawn multiple times in
  // a single roll().
  rollCount?: number;
  // Item ids that ALWAYS appear once per roll (with count=1 unless
  // their entry has count/countRange). These don't consume a
  // rollCount slot - they're added on top.
  guaranteed?: string[];
  // RNG seed. Same seed -> same rolls.
  seed?: number;
}

const DEFAULT_SEED = 0x12345678 >>> 0;

// Mulberry32 PRNG: tiny, fast, decent quality, deterministic.
function mulberry32(seed: number): () => number {
  var s = seed >>> 0;
  return function (): number {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export class LootTable {
  private entries: LootEntry[];
  private weightedPool: LootEntry[];  // entries with weight > 0
  private cumulativeWeights: number[];
  private totalWeight: number;
  private rollCount: number;
  private guaranteed: string[];
  private rng: () => number;
  private seed: number;
  private disposed: boolean = false;

  private constructor(opts: LootTableOptions) {
    if (!Array.isArray(opts.entries)) {
      throw new Error('LootTable: entries array required');
    }
    this.entries = opts.entries;
    this.weightedPool = [];
    this.cumulativeWeights = [];
    this.totalWeight = 0;
    var cum = 0;
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i] as LootEntry;
      if (typeof e.itemId !== 'string' || e.itemId.length === 0) continue;
      if (typeof e.weight !== 'number' || e.weight <= 0) continue;
      cum += e.weight;
      this.weightedPool.push(e);
      this.cumulativeWeights.push(cum);
    }
    this.totalWeight = cum;
    this.rollCount = opts.rollCount !== undefined && opts.rollCount >= 0
      ? Math.floor(opts.rollCount) : 1;
    this.guaranteed = opts.guaranteed ? opts.guaranteed.slice() : [];
    this.seed = opts.seed !== undefined ? (opts.seed >>> 0) : DEFAULT_SEED;
    this.rng = mulberry32(this.seed);
  }

  static create(opts: LootTableOptions): LootTable {
    return new LootTable(opts);
  }

  // Number of valid weighted entries (weight > 0).
  poolSize(): number { return this.weightedPool.length; }

  // Sum of all positive weights.
  totalWeightSum(): number { return this.totalWeight; }

  // Reset the RNG to the original seed (or a new one if provided).
  reseed(seed?: number): void {
    if (this.disposed) return;
    if (seed !== undefined) this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
  }

  // Roll the table once. Returns an array of LootDrop objects:
  //   - guaranteed entries first (one per id, count from entry def
  //     if registered; default 1).
  //   - then `rollCount` weighted picks.
  // Same itemId across guaranteed + weighted may appear multiple
  // times; consumers can stack-merge if desired.
  roll(): LootDrop[] {
    if (this.disposed) return [];
    var drops: LootDrop[] = [];
    // Guaranteed first.
    for (var g = 0; g < this.guaranteed.length; g++) {
      var gid = this.guaranteed[g] as string;
      var entry = this.findEntry(gid);
      if (entry) {
        drops.push({ itemId: gid, count: this.resolveCount(entry) });
      } else {
        // Unregistered guaranteed id -> count 1.
        drops.push({ itemId: gid, count: 1 });
      }
    }
    // Weighted picks.
    if (this.totalWeight > 0) {
      for (var r = 0; r < this.rollCount; r++) {
        var picked = this.weightedPick();
        if (picked) {
          drops.push({ itemId: picked.itemId, count: this.resolveCount(picked) });
        }
      }
    }
    return drops;
  }

  // Roll N times, returning the union (each call advances the RNG).
  rollMultiple(times: number): LootDrop[] {
    if (this.disposed) return [];
    var n = Math.floor(times);
    if (n <= 0) return [];
    var out: LootDrop[] = [];
    for (var i = 0; i < n; i++) {
      var sub = this.roll();
      for (var j = 0; j < sub.length; j++) out.push(sub[j] as LootDrop);
    }
    return out;
  }

  // Probability that a single weighted pick produces `itemId`.
  // Returns 0 if the id isn't in the weighted pool. Useful for
  // tooltips ("0.5% drop chance").
  probabilityOf(itemId: string): number {
    if (this.totalWeight <= 0) return 0;
    for (var i = 0; i < this.weightedPool.length; i++) {
      var e = this.weightedPool[i] as LootEntry;
      if (e.itemId === itemId) return e.weight / this.totalWeight;
    }
    return 0;
  }

  dispose(): void {
    this.weightedPool.length = 0;
    this.cumulativeWeights.length = 0;
    this.totalWeight = 0;
    this.disposed = true;
  }

  // ---------- private ----------

  private findEntry(itemId: string): LootEntry | null {
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i] as LootEntry;
      if (e.itemId === itemId) return e;
    }
    return null;
  }

  private resolveCount(entry: LootEntry): number {
    if (entry.countRange) {
      var lo = Math.floor(entry.countRange[0]);
      var hi = Math.floor(entry.countRange[1]);
      if (lo > hi) {
        var tmp = lo;
        lo = hi;
        hi = tmp;
      }
      var span = hi - lo + 1;
      var v = Math.floor(this.rng() * span);
      return lo + v;
    }
    return entry.count !== undefined ? Math.floor(entry.count) : 1;
  }

  private weightedPick(): LootEntry | null {
    if (this.weightedPool.length === 0 || this.totalWeight <= 0) return null;
    var roll = this.rng() * this.totalWeight;
    // Linear scan; weighted pools are typically < 50 entries so
    // binary search not worth the overhead.
    for (var i = 0; i < this.cumulativeWeights.length; i++) {
      var cum = this.cumulativeWeights[i] as number;
      if (roll < cum) return this.weightedPool[i] as LootEntry;
    }
    // Rounding fallback: return the last entry.
    return this.weightedPool[this.weightedPool.length - 1] as LootEntry;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_LOOT_TABLE = 'loot_table';
