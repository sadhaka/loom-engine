// FactionReputation - per-faction reputation track with tiered status.
//
// 0.86.0 enabling primitive. RPGs want "Kingdom of Eldoria likes you
// (Friendly), Thieves Guild hates you (Hostile)." Reputation is a
// number per faction; tiers are named bands the number falls into.
// Killing kingdom guards drops you toward Hostile; helping thieves
// pulls you toward Friendly with them but Hostile with the kingdom.
// Tier flips fire an onTierChanged callback (perfect for "Reputation
// with X has changed" toasts).
//
//   var rep = FactionReputation.create({
//     onTierChanged: (factionId, next, prev) => toast.post(
//       'Reputation with ' + factionId + ' is now ' + next),
//   });
//   rep.registerFaction({ id: 'eldoria', name: 'Kingdom of Eldoria' });
//   rep.addReputation('eldoria', 75);
//   rep.getTier('eldoria'); // 'friendly' (default tiers)
//
// Pairs with QuestLog (0.63) for faction-quest gating and Achievements
// (0.75) for "honored / hostile" milestones.
//
// Code style: var-only in browser source.

export interface FactionTier {
  name: string;
  // Minimum reputation value to be in this tier (inclusive).
  min: number;
}

export interface FactionSpec {
  id: string;
  name: string;
  // Sorted by `min` ascending. Default tiers used if absent.
  tiers?: FactionTier[];
  initialReputation?: number;
  // Defaults to -1000 / 1000.
  minReputation?: number;
  maxReputation?: number;
  data?: Record<string, unknown>;
}

export interface FactionStatus {
  id: string;
  name: string;
  reputation: number;
  tier: string | null;
}

export interface FactionReputationOptions {
  onChanged?: (factionId: string, next: number, prev: number) => void;
  onTierChanged?: (factionId: string, nextTier: string | null, prevTier: string | null) => void;
}

const DEFAULT_TIERS: FactionTier[] = [
  { name: 'hostile', min: -1000 },
  { name: 'unfriendly', min: -250 },
  { name: 'neutral', min: -50 },
  { name: 'friendly', min: 50 },
  { name: 'honored', min: 250 },
];

const DEFAULT_MIN = -1000;
const DEFAULT_MAX = 1000;

interface InternalEntry {
  spec: FactionSpec;
  tiers: FactionTier[];
  reputation: number;
  minRep: number;
  maxRep: number;
  currentTier: string | null;
}

export class FactionReputation {
  private factions: Map<string, InternalEntry> = new Map();
  private onChanged: ((id: string, n: number, p: number) => void) | null;
  private onTierChanged: ((id: string, n: string | null, p: string | null) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: FactionReputationOptions) {
    this.onChanged = opts.onChanged ?? null;
    this.onTierChanged = opts.onTierChanged ?? null;
  }

  static create(opts: FactionReputationOptions = {}): FactionReputation {
    return new FactionReputation(opts);
  }

  registerFaction(spec: FactionSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (typeof spec.name !== 'string') return false;
    if (this.factions.has(spec.id)) return false;
    var minRep = spec.minReputation !== undefined && isFinite(spec.minReputation)
      ? spec.minReputation : DEFAULT_MIN;
    var maxRep = spec.maxReputation !== undefined && isFinite(spec.maxReputation)
      ? spec.maxReputation : DEFAULT_MAX;
    if (maxRep < minRep) maxRep = minRep;
    var initRep = spec.initialReputation !== undefined && isFinite(spec.initialReputation)
      ? spec.initialReputation : 0;
    if (initRep < minRep) initRep = minRep;
    if (initRep > maxRep) initRep = maxRep;
    var tiers = spec.tiers && spec.tiers.length > 0 ? sortTiers(spec.tiers) : DEFAULT_TIERS.slice();
    var entry: InternalEntry = {
      spec: cloneSpec(spec),
      tiers: tiers,
      reputation: initRep,
      minRep: minRep,
      maxRep: maxRep,
      currentTier: tierFor(tiers, initRep),
    };
    this.factions.set(spec.id, entry);
    return true;
  }

  unregisterFaction(id: string): boolean {
    if (this.disposed) return false;
    return this.factions.delete(id);
  }

  has(id: string): boolean { return this.factions.has(id); }

  getReputation(id: string): number {
    var e = this.factions.get(id);
    return e ? e.reputation : 0;
  }

  getTier(id: string): string | null {
    var e = this.factions.get(id);
    return e ? e.currentTier : null;
  }

  // Add a reputation delta (positive or negative). Clamps to
  // [min, max]. Fires onChanged + onTierChanged on tier flip.
  addReputation(id: string, delta: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(delta) || delta === 0) return false;
    return this.applyReputation(id, this.getReputation(id) + delta);
  }

  setReputation(id: string, value: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(value)) return false;
    return this.applyReputation(id, value);
  }

  list(): FactionStatus[] {
    var out: FactionStatus[] = [];
    this.factions.forEach((e) => {
      out.push({
        id: e.spec.id, name: e.spec.name,
        reputation: e.reputation, tier: e.currentTier,
      });
    });
    return out;
  }

  size(): number { return this.factions.size; }

  toSnapshot(): Record<string, number> {
    var out: Record<string, number> = {};
    this.factions.forEach((e, id) => { out[id] = e.reputation; });
    return out;
  }

  fromSnapshot(snap: Record<string, number>): void {
    if (this.disposed) return;
    if (!snap || typeof snap !== 'object') return;
    var keys = Object.keys(snap);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i] as string;
      var v = snap[id];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      var entry = this.factions.get(id);
      if (!entry) continue;
      var clamped = v;
      if (clamped < entry.minRep) clamped = entry.minRep;
      if (clamped > entry.maxRep) clamped = entry.maxRep;
      entry.reputation = clamped;
      entry.currentTier = tierFor(entry.tiers, clamped);
    }
  }

  dispose(): void {
    this.factions.clear();
    this.onChanged = null;
    this.onTierChanged = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private applyReputation(id: string, value: number): boolean {
    var entry = this.factions.get(id);
    if (!entry) return false;
    var clamped = value;
    if (clamped < entry.minRep) clamped = entry.minRep;
    if (clamped > entry.maxRep) clamped = entry.maxRep;
    var prev = entry.reputation;
    if (prev === clamped) return false;
    entry.reputation = clamped;
    var prevTier = entry.currentTier;
    var nextTier = tierFor(entry.tiers, clamped);
    if (this.onChanged) {
      try { this.onChanged(id, clamped, prev); } catch { /* ignore */ }
    }
    if (nextTier !== prevTier) {
      entry.currentTier = nextTier;
      if (this.onTierChanged) {
        try { this.onTierChanged(id, nextTier, prevTier); } catch { /* ignore */ }
      }
    }
    return true;
  }
}

function tierFor(tiers: FactionTier[], rep: number): string | null {
  if (tiers.length === 0) return null;
  var current: string | null = null;
  for (var i = 0; i < tiers.length; i++) {
    var t = tiers[i] as FactionTier;
    if (rep >= t.min) current = t.name;
  }
  return current;
}

function sortTiers(tiers: FactionTier[]): FactionTier[] {
  var copy = tiers.map((t) => ({ name: t.name, min: t.min }));
  copy.sort(function (a, b) { return a.min - b.min; });
  return copy;
}

function cloneSpec(s: FactionSpec): FactionSpec {
  var copy: FactionSpec = { id: s.id, name: s.name };
  if (s.tiers) copy.tiers = s.tiers.slice();
  if (s.initialReputation !== undefined) copy.initialReputation = s.initialReputation;
  if (s.minReputation !== undefined) copy.minReputation = s.minReputation;
  if (s.maxReputation !== undefined) copy.maxReputation = s.maxReputation;
  if (s.data) copy.data = s.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_FACTION_REPUTATION = 'faction_reputation';
