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
const DEFAULT_KIND_HALFLIFE = 86400000; // 1 day
const DEFAULT_AUTO_PURGE = 0.05;
const DEFAULT_RECENCY_HALFLIFE = 86400000;
export class NarrativeMemory {
    kinds = new Map();
    facts = new Map();
    defaultDecayMs;
    defaultPurgeBelow;
    internalElapsedMs = 0;
    onRemember;
    onForget;
    disposed = false;
    constructor(opts) {
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
    static create(opts = {}) {
        return new NarrativeMemory(opts);
    }
    // ---------- kind management ----------
    defineKind(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        var internal = {
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
    hasKind(id) {
        return this.kinds.has(id);
    }
    kindIds() {
        var out = [];
        var keys = this.kinds.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    // ---------- fact CRUD ----------
    remember(fact) {
        if (this.disposed)
            return false;
        if (!fact || typeof fact.id !== 'string' || fact.id.length === 0)
            return false;
        if (typeof fact.characterId !== 'string' || fact.characterId.length === 0)
            return false;
        if (typeof fact.subjectId !== 'string' || fact.subjectId.length === 0)
            return false;
        if (typeof fact.kind !== 'string' || fact.kind.length === 0)
            return false;
        if (typeof fact.content !== 'string')
            return false;
        if (!isFinite(fact.recordedAt))
            return false;
        if (!isFinite(fact.salience))
            return false;
        if (!this.kinds.has(fact.kind)) {
            this.defineKind({ id: fact.kind });
        }
        var internal = {
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
        if (fact.data !== undefined)
            internal.data = fact.data;
        this.facts.set(fact.id, internal);
        if (this.onRemember) {
            try {
                this.onRemember(this.publicFact(internal));
            }
            catch { /* ignore */ }
        }
        return true;
    }
    forget(factId) {
        if (this.disposed)
            return false;
        var fact = this.facts.get(factId);
        if (!fact)
            return false;
        this.facts.delete(factId);
        if (this.onForget) {
            try {
                this.onForget(this.publicFact(fact), 'manual');
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Forget every fact a given character has about a subject.
    forgetAbout(characterId, subjectId) {
        if (this.disposed)
            return 0;
        var toRemove = [];
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
            this.facts.delete(toRemove[i].id);
        }
        if (this.onForget) {
            var cb = this.onForget;
            for (var j = 0; j < toRemove.length; j++) {
                try {
                    cb(this.publicFact(toRemove[j]), 'manual');
                }
                catch { /* ignore */ }
            }
        }
        return toRemove.length;
    }
    has(factId) {
        return this.facts.has(factId);
    }
    get(factId) {
        var f = this.facts.get(factId);
        return f ? this.publicFact(f) : null;
    }
    adjustSalience(factId, delta) {
        if (this.disposed)
            return null;
        var f = this.facts.get(factId);
        if (!f)
            return null;
        if (!isFinite(delta))
            return null;
        f.salience = this.clamp01(f.salience + delta);
        return f.salience;
    }
    // ---------- bulk reads ----------
    factsAbout(characterId, subjectId) {
        var out = [];
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
    factsBy(characterId) {
        var out = [];
        var iter = this.facts.values();
        var v = iter.next();
        while (!v.done) {
            var f = v.value;
            if (f.characterId === characterId)
                out.push(this.publicFact(f));
            v = iter.next();
        }
        return out;
    }
    factsAboutSubject(subjectId) {
        var out = [];
        var iter = this.facts.values();
        var v = iter.next();
        while (!v.done) {
            var f = v.value;
            if (f.subjectId === subjectId)
                out.push(this.publicFact(f));
            v = iter.next();
        }
        return out;
    }
    // ---------- recall ----------
    // Ranked recall: salience * recency * tag overlap, sorted by
    // descending rank.
    recall(characterId, subjectId, ctx = {}) {
        if (this.disposed)
            return [];
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
        var candidates = [];
        var maxRecorded = -Infinity;
        var iter = this.facts.values();
        var v = iter.next();
        while (!v.done) {
            var f = v.value;
            if (f.characterId === characterId && f.subjectId === subjectId) {
                if (kindFilter !== null && f.kind !== kindFilter) {
                    v = iter.next();
                    continue;
                }
                if (f.salience < minSal) {
                    v = iter.next();
                    continue;
                }
                if (ctxTags !== null) {
                    if (!f.tags || f.tags.length === 0) {
                        v = iter.next();
                        continue;
                    }
                    var anyMatch = false;
                    for (var i = 0; i < f.tags.length; i++) {
                        if (ctxTags.indexOf(f.tags[i]) >= 0) {
                            anyMatch = true;
                            break;
                        }
                    }
                    if (!anyMatch) {
                        v = iter.next();
                        continue;
                    }
                }
                candidates.push(f);
                if (f.recordedAt > maxRecorded)
                    maxRecorded = f.recordedAt;
            }
            v = iter.next();
        }
        var nowRef = ctx.now !== undefined && isFinite(ctx.now) ? ctx.now : maxRecorded;
        var results = [];
        for (var j = 0; j < candidates.length; j++) {
            var c = candidates[j];
            var ageMs = nowRef - c.recordedAt;
            var recency = ageMs <= 0 ? 1 : Math.pow(0.5, ageMs / recencyHalf);
            var rank = c.salience * salWeight + recency * recWeight;
            var pub = this.publicFact(c);
            pub.recencyScore = recency;
            pub.rankScore = rank;
            results.push(pub);
        }
        results.sort(function (a, b) { return b.rankScore - a.rankScore; });
        return results.slice(0, limit);
    }
    topMemory(characterId, subjectId, ctx = {}) {
        var copy = { ...ctx, limit: 1 };
        var rs = this.recall(characterId, subjectId, copy);
        return rs.length > 0 ? rs[0] : null;
    }
    size() { return this.facts.size; }
    list() {
        var out = [];
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
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        this.internalElapsedMs += dt;
        var purged = [];
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
            this.facts.delete(purged[i].id);
        }
        if (this.onForget) {
            var cb = this.onForget;
            for (var j = 0; j < purged.length; j++) {
                try {
                    cb(this.publicFact(purged[j]), 'purge');
                }
                catch { /* ignore */ }
            }
        }
    }
    // ---------- serialization ----------
    // Export facts (and kind specs) as JSON. Optional characterId
    // filter limits the export to one character's memories.
    exportSession(characterId) {
        var kinds = [];
        var ki = this.kinds.values();
        var kv = ki.next();
        while (!kv.done) {
            kinds.push(kv.value);
            kv = ki.next();
        }
        var facts = [];
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
    importSession(data) {
        if (this.disposed)
            return false;
        if (typeof data !== 'string' || data.length === 0)
            return false;
        try {
            var parsed = JSON.parse(data);
            if (!parsed || typeof parsed !== 'object')
                return false;
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
                    this.remember(parsed.facts[j]);
                }
            }
            return true;
        }
        catch {
            return false;
        }
    }
    clear() {
        if (this.disposed)
            return;
        var toRemove = [];
        var iter = this.facts.values();
        var v = iter.next();
        while (!v.done) {
            toRemove.push(v.value);
            v = iter.next();
        }
        this.facts.clear();
        this.kinds.clear();
        if (this.onForget) {
            var cb = this.onForget;
            for (var i = 0; i < toRemove.length; i++) {
                try {
                    cb(this.publicFact(toRemove[i]), 'cleared');
                }
                catch { /* ignore */ }
            }
        }
    }
    dispose() {
        this.facts.clear();
        this.kinds.clear();
        this.onRemember = null;
        this.onForget = null;
        this.disposed = true;
    }
    // ---------- private ----------
    clamp01(v) {
        if (!isFinite(v))
            return 0;
        if (v < 0)
            return 0;
        if (v > 1)
            return 1;
        return v;
    }
    publicFact(f) {
        var out = {
            id: f.id,
            characterId: f.characterId,
            subjectId: f.subjectId,
            kind: f.kind,
            content: f.content,
            recordedAt: f.recordedAt,
            salience: f.salience,
        };
        if (f.tags)
            out.tags = f.tags.slice();
        if (f.data !== undefined)
            out.data = f.data;
        return out;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_NARRATIVE_MEMORY = 'narrative_memory';
//# sourceMappingURL=narrative-memory.js.map