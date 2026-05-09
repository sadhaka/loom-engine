// RelationshipGraph - per-pair character bonds (asymmetric).
//
// 1.3.1 enabling primitive (Wave 1.3 AI persona depth). PersonaTrait
// (1.3.0) is what an NPC IS in isolation. RelationshipGraph is
// who they CARE about, in both directions: Mira's friendship for
// Thane is one bond; Thane's friendship for Mira is a separate
// bond (which is the point - unrequited love, one-sided rivalries,
// stalker dynamics, mentor-student where one feels closer than
// the other).
//
//   var rels = RelationshipGraph.create();
//   rels.defineBondType({ id: 'trust',     decayHalfLifeMs: 60000 });
//   rels.defineBondType({ id: 'romantic',  decayHalfLifeMs: 0 });
//   rels.defineBondType({ id: 'rival',     decayHalfLifeMs: 30000 });
//
//   // Mira <-> Thane: friends.
//   rels.setMutual('mira', 'thane', 'trust', 0.8);
//
//   // Mira pines for Thane (one-sided).
//   rels.setBond('mira', 'thane', 'romantic', 0.7);
//   // Thane is oblivious; no reciprocal bond -> getBond returns null.
//
//   // After Thane betrays Mira:
//   rels.adjustBond('mira', 'thane', 'trust', -0.6);
//   rels.setBond('mira', 'thane', 'rival', 0.9);
//
//   // Query: who hates this NPC?
//   var enemies = rels.bondsTo('thane').filter((b) => b.bondType === 'rival');
//
// Pairs with PersonaTrait (1.3.0, individual character traits),
// EmotionState (1.3.2 next, mood gauges), DialogTree (0.61, often
// gated by relationship strength), NarrativeMemory (1.3.5 capstone,
// remembers what shifted bonds).
//
// Code style: var-only in browser source.

export interface BondTypeSpec {
  // Stable bond type id (e.g. 'trust', 'romantic', 'rival').
  id: string;
  // Baseline value the bond decays toward. Default 0.
  baseline?: number;
  // ms half-life for exponential decay toward baseline. 0 = no
  // decay. Default 0.
  decayHalfLifeMs?: number;
  // Optional payload.
  data?: Record<string, unknown>;
}

export interface Bond {
  fromId: string;
  toId: string;
  bondType: string;
  // Clamped value (default [-1, 1]).
  value: number;
  // Un-clamped value.
  rawValue: number;
  // ms since last set / adjust.
  ageMs: number;
}

export interface BondFilter {
  // Filter by bond type id.
  bondType?: string;
  // Inclusive bounds on clamped value.
  minLevel?: number;
  maxLevel?: number;
  // Filter on direction.
  fromId?: string;
  toId?: string;
}

export interface RelationshipGraphOptions {
  // Optional global value clamp. Default `[-1, 1]`.
  valueClamp?: (raw: number) => number;
  // Fired on any bond mutation (set / adjust / decay tick).
  onChange?: (bond: Bond) => void;
}

interface InternalBond {
  fromId: string;
  toId: string;
  bondType: string;
  rawValue: number;
  ageMs: number;
}

function defaultClamp(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

function bondKey(from: string, to: string, type: string): string {
  return from + '->' + to + '|' + type;
}

export class RelationshipGraph {
  private specs: Map<string, BondTypeSpec> = new Map();
  private bonds: Map<string, InternalBond> = new Map();
  private valueClamp: (raw: number) => number;
  private onChange: ((b: Bond) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: RelationshipGraphOptions) {
    this.valueClamp = typeof opts.valueClamp === 'function'
      ? opts.valueClamp : defaultClamp;
    this.onChange = opts.onChange ?? null;
  }

  static create(opts: RelationshipGraphOptions = {}): RelationshipGraph {
    return new RelationshipGraph(opts);
  }

  // ---------- bond type management ----------

  defineBondType(spec: BondTypeSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    var clone: BondTypeSpec = {
      id: spec.id,
      baseline: spec.baseline !== undefined && isFinite(spec.baseline)
        ? spec.baseline : 0,
      decayHalfLifeMs: spec.decayHalfLifeMs !== undefined
          && isFinite(spec.decayHalfLifeMs) && spec.decayHalfLifeMs >= 0
        ? spec.decayHalfLifeMs : 0,
    };
    if (spec.data !== undefined) clone.data = spec.data;
    this.specs.set(spec.id, clone);
    return true;
  }

  hasBondType(id: string): boolean {
    return this.specs.has(id);
  }

  bondTypes(): string[] {
    var out: string[] = [];
    var keys = this.specs.keys();
    var k = keys.next();
    while (!k.done) {
      out.push(k.value);
      k = keys.next();
    }
    return out;
  }

  removeBondType(id: string): boolean {
    if (this.disposed) return false;
    if (!this.specs.has(id)) return false;
    var toRemove: string[] = [];
    var keys = this.bonds.keys();
    var k = keys.next();
    var suffix = '|' + id;
    while (!k.done) {
      if (k.value.length >= suffix.length
          && k.value.substring(k.value.length - suffix.length) === suffix) {
        toRemove.push(k.value);
      }
      k = keys.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.bonds.delete(toRemove[i] as string);
    }
    return this.specs.delete(id);
  }

  // ---------- bond CRUD ----------

  setBond(fromId: string, toId: string, bondType: string,
          value: number): boolean {
    if (this.disposed) return false;
    if (typeof fromId !== 'string' || fromId.length === 0) return false;
    if (typeof toId !== 'string' || toId.length === 0) return false;
    if (typeof bondType !== 'string' || bondType.length === 0) return false;
    if (fromId === toId) return false;
    if (!isFinite(value)) return false;
    if (!this.specs.has(bondType)) this.defineBondType({ id: bondType });
    var k = bondKey(fromId, toId, bondType);
    var bond: InternalBond = {
      fromId: fromId,
      toId: toId,
      bondType: bondType,
      rawValue: value,
      ageMs: 0,
    };
    this.bonds.set(k, bond);
    this.fireChange(bond);
    return true;
  }

  // Mutual bond: set both A->B and B->A to the same value.
  setMutual(aId: string, bId: string, bondType: string, value: number): boolean {
    var ok1 = this.setBond(aId, bId, bondType, value);
    var ok2 = this.setBond(bId, aId, bondType, value);
    return ok1 && ok2;
  }

  adjustBond(fromId: string, toId: string, bondType: string,
             delta: number): number | null {
    if (this.disposed) return null;
    if (typeof fromId !== 'string' || fromId.length === 0) return null;
    if (typeof toId !== 'string' || toId.length === 0) return null;
    if (typeof bondType !== 'string' || bondType.length === 0) return null;
    if (fromId === toId) return null;
    if (!isFinite(delta)) return null;
    if (!this.specs.has(bondType)) this.defineBondType({ id: bondType });
    var k = bondKey(fromId, toId, bondType);
    var bond = this.bonds.get(k);
    if (!bond) {
      bond = { fromId: fromId, toId: toId, bondType: bondType, rawValue: 0, ageMs: 0 };
      this.bonds.set(k, bond);
    }
    bond.rawValue += delta;
    bond.ageMs = 0;
    this.fireChange(bond);
    return this.valueClamp(bond.rawValue);
  }

  removeBond(fromId: string, toId: string, bondType: string): boolean {
    if (this.disposed) return false;
    return this.bonds.delete(bondKey(fromId, toId, bondType));
  }

  hasBond(fromId: string, toId: string, bondType: string): boolean {
    return this.bonds.has(bondKey(fromId, toId, bondType));
  }

  getBond(fromId: string, toId: string, bondType: string): Bond | null {
    var b = this.bonds.get(bondKey(fromId, toId, bondType));
    return b ? this.snapshot(b) : null;
  }

  // ---------- bulk reads ----------

  // All outgoing bonds from this character.
  bondsFor(characterId: string, filter: BondFilter = {}): Bond[] {
    return this.collect((b) => b.fromId === characterId, filter);
  }

  // All incoming bonds toward this character.
  bondsTo(characterId: string, filter: BondFilter = {}): Bond[] {
    return this.collect((b) => b.toId === characterId, filter);
  }

  // All bonds in either direction between A and B.
  bondsBetween(aId: string, bId: string, filter: BondFilter = {}): Bond[] {
    return this.collect((b) =>
      (b.fromId === aId && b.toId === bId) ||
      (b.fromId === bId && b.toId === aId), filter);
  }

  // All bonds in the graph (filtered).
  list(filter: BondFilter = {}): Bond[] {
    return this.collect(() => true, filter);
  }

  bondCount(): number { return this.bonds.size; }
  bondTypeCount(): number { return this.specs.size; }

  // ---------- find ----------

  findStrongest(bondType: string, filter: BondFilter = {}): Bond | null {
    return this.findExtreme(bondType, filter, true);
  }

  findWeakest(bondType: string, filter: BondFilter = {}): Bond | null {
    return this.findExtreme(bondType, filter, false);
  }

  // ---------- decay ----------

  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var iter = this.bonds.values();
    var v = iter.next();
    while (!v.done) {
      var b = v.value;
      b.ageMs += dt;
      var spec = this.specs.get(b.bondType);
      if (spec && (spec.decayHalfLifeMs as number) > 0) {
        var halfLife = spec.decayHalfLifeMs as number;
        var factor = Math.pow(0.5, dt / halfLife);
        var baseline = spec.baseline as number;
        var newRaw = baseline + (b.rawValue - baseline) * factor;
        if (Math.abs(newRaw - b.rawValue) > 1e-9) {
          b.rawValue = newRaw;
          this.fireChange(b);
        }
      }
      v = iter.next();
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.bonds.clear();
    this.specs.clear();
  }

  dispose(): void {
    this.bonds.clear();
    this.specs.clear();
    this.onChange = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private collect(pred: (b: InternalBond) => boolean, filter: BondFilter): Bond[] {
    var minLevel = filter.minLevel !== undefined && isFinite(filter.minLevel)
      ? filter.minLevel : -Infinity;
    var maxLevel = filter.maxLevel !== undefined && isFinite(filter.maxLevel)
      ? filter.maxLevel : Infinity;
    var typeId = typeof filter.bondType === 'string' ? filter.bondType : null;
    var fromId = typeof filter.fromId === 'string' ? filter.fromId : null;
    var toId = typeof filter.toId === 'string' ? filter.toId : null;
    var out: Bond[] = [];
    var iter = this.bonds.values();
    var v = iter.next();
    while (!v.done) {
      var b = v.value;
      if (!pred(b)) { v = iter.next(); continue; }
      if (typeId !== null && b.bondType !== typeId) { v = iter.next(); continue; }
      if (fromId !== null && b.fromId !== fromId) { v = iter.next(); continue; }
      if (toId !== null && b.toId !== toId) { v = iter.next(); continue; }
      var clamped = this.valueClamp(b.rawValue);
      if (clamped < minLevel || clamped > maxLevel) { v = iter.next(); continue; }
      out.push(this.snapshot(b));
      v = iter.next();
    }
    return out;
  }

  private findExtreme(bondType: string, filter: BondFilter,
                      highest: boolean): Bond | null {
    var minLevel = filter.minLevel !== undefined && isFinite(filter.minLevel)
      ? filter.minLevel : -Infinity;
    var maxLevel = filter.maxLevel !== undefined && isFinite(filter.maxLevel)
      ? filter.maxLevel : Infinity;
    var fromId = typeof filter.fromId === 'string' ? filter.fromId : null;
    var toId = typeof filter.toId === 'string' ? filter.toId : null;
    var bestBond: InternalBond | null = null;
    var bestVal = highest ? -Infinity : Infinity;
    var iter = this.bonds.values();
    var v = iter.next();
    while (!v.done) {
      var b = v.value;
      if (b.bondType !== bondType) { v = iter.next(); continue; }
      if (fromId !== null && b.fromId !== fromId) { v = iter.next(); continue; }
      if (toId !== null && b.toId !== toId) { v = iter.next(); continue; }
      var clamped = this.valueClamp(b.rawValue);
      if (clamped < minLevel || clamped > maxLevel) { v = iter.next(); continue; }
      if (highest ? clamped > bestVal : clamped < bestVal) {
        bestVal = clamped;
        bestBond = b;
      }
      v = iter.next();
    }
    return bestBond ? this.snapshot(bestBond) : null;
  }

  private fireChange(b: InternalBond): void {
    if (!this.onChange) return;
    try { this.onChange(this.snapshot(b)); } catch { /* ignore */ }
  }

  private snapshot(b: InternalBond): Bond {
    return {
      fromId: b.fromId,
      toId: b.toId,
      bondType: b.bondType,
      value: this.valueClamp(b.rawValue),
      rawValue: b.rawValue,
      ageMs: b.ageMs,
    };
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_RELATIONSHIP_GRAPH = 'relationship_graph';
