// NarrativeMemory - cross-session NPC recall ledger.
//
// 1.3.5 CAPSTONE primitive (Wave 1.3 AI persona depth milestone).
// THE uniquely-Loom primitive: what NPCs REMEMBER about the
// player across sessions. PersonaTrait (1.3.0) is who they are.
// EmotionState (1.3.2) is how they feel right now.
// RelationshipGraph (1.3.1) is who they care about.
// NarrativeMemory is what they REMEMBER and recall when prompted.
//
// Each fact: a (character, subject) pair with kind, content,
// salience (vividness), tags, recorded time. Recall ranks by
// salience * recency * tag-match. Facts decay over time per their
// kind's half-life. Cross-session: serialize to JSON, restore on
// next play.
//
//   var nm = NarrativeMemory.create();
//   nm.defineKind({ id: 'trauma',     decayHalfLifeMs: 0 });        // forever
//   nm.defineKind({ id: 'event',      decayHalfLifeMs: 86400000 }); // ~1 day
//   nm.defineKind({ id: 'rumor',      decayHalfLifeMs: 3600000 });  // ~1h
//   nm.defineKind({ id: 'observation', decayHalfLifeMs: 600000 });  // ~10m
//
//   nm.remember({
//     id: 'mira_saw_player_steal',
//     characterId: 'mira',
//     subjectId: 'player_1',
//     kind: 'observation',
//     content: 'I saw them take the gold from the chest.',
//     recordedAt: now,
//     salience: 0.9,
//     tags: ['theft', 'witnessed'],
//   });
//
//   // Days later, when Mira encounters the player:
//   var memories = nm.recall('mira', 'player_1', { tags: ['theft'] });
//   // Returns ranked list. Top memory might still be the theft if
//   // salience hasn't decayed below threshold.
//
//   // Save / load across sessions:
//   var json = nm.exportSession();
//   localStorage.setItem('memory', json);
//   // ...next session...
//   nm.importSession(localStorage.getItem('memory'));
//
// Pairs with PersonaTrait (1.3.0), RelationshipGraph (1.3.1),
// EmotionState (1.3.2), DialogTree (0.61, dialog can branch on
// recalled memories), DialogChoiceHistory (0.89, what was said
// before).
//
// Code style: var-only in browser source.

export interface MemoryKindSpec {
  id: string;
  // ms half-life for salience decay. 0 = no decay (permanent).
  // Default: 24h (86400000).
  decayHalfLifeMs?: number;
  // Salience floor below which facts are auto-purged on tick.
  // 0 = never purge. Default 0.05.
  autoPurgeBelow?: number;
  data?: Record<string, unknown>;
}

export interface MemoryFact<T = Record<string, unknown>> {
  // Stable fact id.
  id: string;
  // Who remembers it.
  characterId: string;
  // Who / what the fact is about.
  subjectId: string;
  // Memory category id (matches MemoryKindSpec.id).
  kind: string;
  // Human-readable content. Engine doesn't interpret.
  content: string;
  // Time the fact was laid down. Engine treats as opaque ms scalar
  // for recency math; consumer chooses meaning (wall clock /
  // game time / tick count).
  recordedAt: number;
  // 0..1 vividness. Decays per kind's half-life.
  salience: number;
  tags?: string[];
  data?: T;
}

export interface RecallContext {
  // Tags to match (any-overlap with fact tags).
  tags?: string[];
  // Kind filter.
  kind?: string;
  // Minimum salience (after current decay).
  minSalience?: number;
  // Max results. Default 10.
  limit?: number;
  // Reference time for recency. Default = newest fact's recordedAt.
  now?: number;
  // Half-life for recency decay (separate from salience decay).
  // Default 86400000 (1 day) = facts older than ~24h get half
  // recency weight.
  recencyHalfLifeMs?: number;
  // Weights for combined ranking. Default 0.6 / 0.4.
  salienceWeight?: number;
  recencyWeight?: number;
}

export interface RecallResult<T = Record<string, unknown>> extends MemoryFact<T> {
  // 0..1 recency score (1 = just happened).
  recencyScore: number;
  // 0..1 combined rank score (salience * w + recency * w).
  rankScore: number;
}

export interface NarrativeMemoryOptions<T = Record<string, unknown>> {
  // Default kind spec applied when remember() references an
  // unknown kind. Default { decayHalfLifeMs: 86400000, autoPurgeBelow: 0.05 }.
  defaultKind?: { decayHalfLifeMs?: number; autoPurgeBelow?: number };
  // Reference time getter for tick-based decay. Inject for
  // deterministic replays. Default Date-style monotonic accumulator
  // (advances by tick(dtMs)).
  // Engine doesn't pin to wall clock - uses internal elapsedMs.
  // Pass `now` if you want decay anchored to your sim clock.
  now?: () => number;
  // Fired when a fact is added / replaced.
  onRemember?: (fact: MemoryFact<T>) => void;
  // Fired when a fact is forgotten (manual or auto-purge).
  onForget?: (fact: MemoryFact<T>, reason: 'manual' | 'purge' | 'cleared') => void;
}

interface InternalKindSpec {
  id: string;
  decayHalfLifeMs: number;
  autoPurgeBelow: number;
}

interface InternalFact<T> extends MemoryFact<T> {
  // Internal: ms accumulated against this fact's half-life.
  internalAgeMs: number;
}

const DEFAULT_KIND_HALFLIFE = 86400000; // 1 day
const DEFAULT_AUTO_PURGE = 0.05;
const DEFAULT_RECENCY_HALFLIFE = 86400000;

export class NarrativeMemory<T = Record<string, unknown>> {
  private kinds: Map<string, InternalKindSpec> = new Map();
  private facts: Map<string, InternalFact<T>> = new Map();
  private defaultDecayMs: number;
  private defaultPurgeBelow: number;
  private internalElapsedMs: number = 0;
  private onRemember: ((f: MemoryFact<T>) => void) | null;
  private onForget: ((f: MemoryFact<T>, r: 'manual' | 'purge' | 'cleared') => void) | null;
  private disposed: boolean = false;

  private constructor(opts: NarrativeMemoryOptions<T>) {
    this.defaultDecayMs = opts.defaultKind?.decayHalfLifeMs !== undefined
        && isFinite(opts.defaultKind.decayHalfLifeMs)
        && opts.defaultKind.decayHalfLifeMs >= 0
      ? opts.defaultKind.decayHalfLifeMs : DEFAULT_KIND_HALFLIFE;
    this.defaultPurgeBelow = opts.defaultKind?.autoPurgeBelow !== undefined
        && isFinite(opts.defaultKind.autoPurgeBelow)
      ? opts.defaultKind.autoPurgeBelow : DEFAULT_AUTO_PURGE;
    this.onRemember = opts.onRemember ?? null;
    this.onForget = opts.onForget ?? null;
  }

  static create<T = Record<string, unknown>>(
    opts: NarrativeMemoryOptions<T> = {}): NarrativeMemory<T> {
    return new NarrativeMemory<T>(opts);
  }

  // ---------- kind management ----------

  defineKind(spec: MemoryKindSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    var internal: InternalKindSpec = {
      id: spec.id,
      decayHalfLifeMs: spec.decayHalfLifeMs !== undefined
          && isFinite(spec.decayHalfLifeMs) && spec.decayHalfLifeMs >= 0
        ? spec.decayHalfLifeMs : this.defaultDecayMs,
      autoPurgeBelow: spec.autoPurgeBelow !== undefined
          && isFinite(spec.autoPurgeBelow)
        ? spec.autoPurgeBelow : this.defaultPurgeBelow,
    };
    this.kinds.set(spec.id, internal);
    return true;
  }

  hasKind(id: string): boolean {
    return this.kinds.has(id);
  }

  kindIds(): string[] {
    var out: string[] = [];
    var keys = this.kinds.keys();
    var k = keys.next();
    while (!k.done) {
      out.push(k.value);
      k = keys.next();
    }
    return out;
  }

  // ---------- fact CRUD ----------

  remember(fact: MemoryFact<T>): boolean {
    if (this.disposed) return false;
    if (!fact || typeof fact.id !== 'string' || fact.id.length === 0) return false;
    if (typeof fact.characterId !== 'string' || fact.characterId.length === 0) return false;
    if (typeof fact.subjectId !== 'string' || fact.subjectId.length === 0) return false;
    if (typeof fact.kind !== 'string' || fact.kind.length === 0) return false;
    if (typeof fact.content !== 'string') return false;
    if (!isFinite(fact.recordedAt)) return false;
    if (!isFinite(fact.salience)) return false;
    if (!this.kinds.has(fact.kind)) {
      this.defineKind({ id: fact.kind });
    }
    var internal: InternalFact<T> = {
      id: fact.id,
      characterId: fact.characterId,
      subjectId: fact.subjectId,
      kind: fact.kind,
      content: fact.content,
      recordedAt: fact.recordedAt,
      salience: this.clamp01(fact.salience),
      internalAgeMs: 0,
    };
    if (Array.isArray(fact.tags) && fact.tags.length > 0) {
      internal.tags = fact.tags.slice();
    }
    if (fact.data !== undefined) internal.data = fact.data;
    this.facts.set(fact.id, internal);
    if (this.onRemember) {
      try { this.onRemember(this.publicFact(internal)); } catch { /* ignore */ }
    }
    return true;
  }

  forget(factId: string): boolean {
    if (this.disposed) return false;
    var fact = this.facts.get(factId);
    if (!fact) return false;
    this.facts.delete(factId);
    if (this.onForget) {
      try { this.onForget(this.publicFact(fact), 'manual'); } catch { /* ignore */ }
    }
    return true;
  }

  // Forget every fact a given character has about a subject.
  forgetAbout(characterId: string, subjectId: string): number {
    if (this.disposed) return 0;
    var toRemove: InternalFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      var f = v.value;
      if (f.characterId === characterId && f.subjectId === subjectId) {
        toRemove.push(f);
      }
      v = iter.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.facts.delete((toRemove[i] as InternalFact<T>).id);
    }
    if (this.onForget) {
      var cb = this.onForget;
      for (var j = 0; j < toRemove.length; j++) {
        try { cb(this.publicFact(toRemove[j] as InternalFact<T>), 'manual'); } catch { /* ignore */ }
      }
    }
    return toRemove.length;
  }

  has(factId: string): boolean {
    return this.facts.has(factId);
  }

  get(factId: string): MemoryFact<T> | null {
    var f = this.facts.get(factId);
    return f ? this.publicFact(f) : null;
  }

  adjustSalience(factId: string, delta: number): number | null {
    if (this.disposed) return null;
    var f = this.facts.get(factId);
    if (!f) return null;
    if (!isFinite(delta)) return null;
    f.salience = this.clamp01(f.salience + delta);
    return f.salience;
  }

  // ---------- bulk reads ----------

  factsAbout(characterId: string, subjectId: string): MemoryFact<T>[] {
    var out: MemoryFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      var f = v.value;
      if (f.characterId === characterId && f.subjectId === subjectId) {
        out.push(this.publicFact(f));
      }
      v = iter.next();
    }
    return out;
  }

  factsBy(characterId: string): MemoryFact<T>[] {
    var out: MemoryFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      var f = v.value;
      if (f.characterId === characterId) out.push(this.publicFact(f));
      v = iter.next();
    }
    return out;
  }

  factsAboutSubject(subjectId: string): MemoryFact<T>[] {
    var out: MemoryFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      var f = v.value;
      if (f.subjectId === subjectId) out.push(this.publicFact(f));
      v = iter.next();
    }
    return out;
  }

  // ---------- recall ----------

  // Ranked recall: salience * recency * tag overlap, sorted by
  // descending rank.
  recall(characterId: string, subjectId: string,
         ctx: RecallContext = {}): RecallResult<T>[] {
    if (this.disposed) return [];
    var minSal = ctx.minSalience !== undefined && isFinite(ctx.minSalience)
      ? ctx.minSalience : 0;
    var limit = ctx.limit !== undefined && isFinite(ctx.limit) && ctx.limit > 0
      ? Math.floor(ctx.limit) : 10;
    var recencyHalf = ctx.recencyHalfLifeMs !== undefined
        && isFinite(ctx.recencyHalfLifeMs) && ctx.recencyHalfLifeMs > 0
      ? ctx.recencyHalfLifeMs : DEFAULT_RECENCY_HALFLIFE;
    var salWeight = ctx.salienceWeight !== undefined && isFinite(ctx.salienceWeight)
      ? ctx.salienceWeight : 0.6;
    var recWeight = ctx.recencyWeight !== undefined && isFinite(ctx.recencyWeight)
      ? ctx.recencyWeight : 0.4;
    var ctxTags = Array.isArray(ctx.tags) && ctx.tags.length > 0 ? ctx.tags : null;
    var kindFilter = typeof ctx.kind === 'string' ? ctx.kind : null;

    // Gather candidates.
    var candidates: InternalFact<T>[] = [];
    var maxRecorded = -Infinity;
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      var f = v.value;
      if (f.characterId === characterId && f.subjectId === subjectId) {
        if (kindFilter !== null && f.kind !== kindFilter) {
          v = iter.next(); continue;
        }
        if (f.salience < minSal) { v = iter.next(); continue; }
        if (ctxTags !== null) {
          if (!f.tags || f.tags.length === 0) { v = iter.next(); continue; }
          var anyMatch = false;
          for (var i = 0; i < (f.tags as string[]).length; i++) {
            if (ctxTags.indexOf((f.tags as string[])[i] as string) >= 0) {
              anyMatch = true;
              break;
            }
          }
          if (!anyMatch) { v = iter.next(); continue; }
        }
        candidates.push(f);
        if (f.recordedAt > maxRecorded) maxRecorded = f.recordedAt;
      }
      v = iter.next();
    }
    var nowRef = ctx.now !== undefined && isFinite(ctx.now) ? ctx.now : maxRecorded;
    var results: RecallResult<T>[] = [];
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j] as InternalFact<T>;
      var ageMs = nowRef - c.recordedAt;
      var recency = ageMs <= 0 ? 1 : Math.pow(0.5, ageMs / recencyHalf);
      var rank = c.salience * salWeight + recency * recWeight;
      var pub = this.publicFact(c) as RecallResult<T>;
      pub.recencyScore = recency;
      pub.rankScore = rank;
      results.push(pub);
    }
    results.sort(function (a, b) { return b.rankScore - a.rankScore; });
    return results.slice(0, limit);
  }

  topMemory(characterId: string, subjectId: string,
            ctx: RecallContext = {}): RecallResult<T> | null {
    var copy: RecallContext = { ...ctx, limit: 1 };
    var rs = this.recall(characterId, subjectId, copy);
    return rs.length > 0 ? (rs[0] as RecallResult<T>) : null;
  }

  size(): number { return this.facts.size; }

  list(): MemoryFact<T>[] {
    var out: MemoryFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.publicFact(v.value));
      v = iter.next();
    }
    return out;
  }

  // Decay all facts' salience per their kind's half-life. Auto-purge
  // any that drop below the kind's autoPurgeBelow threshold.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    this.internalElapsedMs += dt;
    var purged: InternalFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) {
      var f = v.value;
      var spec = this.kinds.get(f.kind);
      if (spec && spec.decayHalfLifeMs > 0) {
        var factor = Math.pow(0.5, dt / spec.decayHalfLifeMs);
        f.salience = this.clamp01(f.salience * factor);
        f.internalAgeMs += dt;
        if (spec.autoPurgeBelow > 0 && f.salience < spec.autoPurgeBelow) {
          purged.push(f);
        }
      }
      v = iter.next();
    }
    for (var i = 0; i < purged.length; i++) {
      this.facts.delete((purged[i] as InternalFact<T>).id);
    }
    if (this.onForget) {
      var cb = this.onForget;
      for (var j = 0; j < purged.length; j++) {
        try { cb(this.publicFact(purged[j] as InternalFact<T>), 'purge'); } catch { /* ignore */ }
      }
    }
  }

  // ---------- serialization ----------

  // Export facts (and kind specs) as JSON. Optional characterId
  // filter limits the export to one character's memories.
  exportSession(characterId?: string): string {
    var kinds: InternalKindSpec[] = [];
    var ki = this.kinds.values();
    var kv = ki.next();
    while (!kv.done) {
      kinds.push(kv.value);
      kv = ki.next();
    }
    var facts: MemoryFact<T>[] = [];
    var fi = this.facts.values();
    var fv = fi.next();
    while (!fv.done) {
      var f = fv.value;
      if (characterId === undefined || f.characterId === characterId) {
        facts.push(this.publicFact(f));
      }
      fv = fi.next();
    }
    return JSON.stringify({ kinds: kinds, facts: facts });
  }

  // Import facts + kinds from a previous exportSession. Existing
  // facts with the same id are overwritten. Returns false if the
  // payload is malformed.
  importSession(data: string): boolean {
    if (this.disposed) return false;
    if (typeof data !== 'string' || data.length === 0) return false;
    try {
      var parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object') return false;
      if (Array.isArray(parsed.kinds)) {
        for (var i = 0; i < parsed.kinds.length; i++) {
          var k = parsed.kinds[i];
          if (k && typeof k.id === 'string') {
            this.defineKind({
              id: k.id,
              decayHalfLifeMs: k.decayHalfLifeMs,
              autoPurgeBelow: k.autoPurgeBelow,
            });
          }
        }
      }
      if (Array.isArray(parsed.facts)) {
        for (var j = 0; j < parsed.facts.length; j++) {
          this.remember(parsed.facts[j] as MemoryFact<T>);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    if (this.disposed) return;
    var toRemove: InternalFact<T>[] = [];
    var iter = this.facts.values();
    var v = iter.next();
    while (!v.done) { toRemove.push(v.value); v = iter.next(); }
    this.facts.clear();
    this.kinds.clear();
    if (this.onForget) {
      var cb = this.onForget;
      for (var i = 0; i < toRemove.length; i++) {
        try { cb(this.publicFact(toRemove[i] as InternalFact<T>), 'cleared'); } catch { /* ignore */ }
      }
    }
  }

  dispose(): void {
    this.facts.clear();
    this.kinds.clear();
    this.onRemember = null;
    this.onForget = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private clamp01(v: number): number {
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  private publicFact(f: InternalFact<T>): MemoryFact<T> {
    var out: MemoryFact<T> = {
      id: f.id,
      characterId: f.characterId,
      subjectId: f.subjectId,
      kind: f.kind,
      content: f.content,
      recordedAt: f.recordedAt,
      salience: f.salience,
    };
    if (f.tags) out.tags = f.tags.slice();
    if (f.data !== undefined) out.data = f.data;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_NARRATIVE_MEMORY = 'narrative_memory';
