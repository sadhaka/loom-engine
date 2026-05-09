// PersonaTrait - NPC personality trait ledger with weighted
// expression + decay.
//
// 1.3.0 enabling primitive (Wave 1.3 AI persona depth opens). The
// most "uniquely Loom" wave: making NPCs feel like PEOPLE, not
// state machines. PersonaTrait is the foundation - a weighted
// trait vector per character (curiosity, courage, greed,
// suspicion, ...) that biases their dialog, AI choices, and
// reactions. Traits can decay over time, be reinforced by
// experiences, and be queried for "is this NPC the type to ___?".
//
//   var traits = PersonaTrait.create();
//   traits.set('mira', 'courage', 0.7);
//   traits.set('mira', 'curiosity', 0.9);
//   traits.set('mira', 'greed', 0.1);
//
//   // After Mira witnesses a death:
//   traits.adjust('mira', 'courage', -0.2);
//
//   // Query: which NPC is most likely to volunteer for the
//   // dangerous quest?
//   var bravest = traits.findHighest('courage', { minLevel: 0.5 });
//
//   // Tick decay (slowly normalize traits toward baseline 0):
//   each frame: traits.tick(dtMs);
//
// Pairs with EmotionState (1.3.2 next, mood gauges - shorter
// timescale than traits), RelationshipGraph (1.3.1 next,
// per-pair bonds), DialogTree (0.61, often gated by trait
// thresholds), BehaviorTree (1.1.2, uses traits in conditions).
//
// Traits are unbounded internally but `getValue` clamps to
// [-1, 1] for stable querying. Consumer can normalize differently
// via custom valueClamp.
//
// Code style: var-only in browser source.
const SQRT2 = Math.sqrt(2); // unused but kept for potential future use
function defaultClamp(v) {
    if (!isFinite(v))
        return 0;
    if (v < -1)
        return -1;
    if (v > 1)
        return 1;
    return v;
}
function key(characterId, traitId) {
    return characterId + '|' + traitId;
}
export class PersonaTrait {
    specs = new Map();
    entries = new Map();
    valueClamp;
    onChange;
    disposed = false;
    constructor(opts) {
        this.valueClamp = typeof opts.valueClamp === 'function'
            ? opts.valueClamp : defaultClamp;
        this.onChange = opts.onChange ?? null;
    }
    static create(opts = {}) {
        return new PersonaTrait(opts);
    }
    // ---------- trait spec management ----------
    defineTrait(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        var clone = {
            id: spec.id,
            baseline: spec.baseline !== undefined && isFinite(spec.baseline)
                ? spec.baseline : 0,
            decayHalfLifeMs: spec.decayHalfLifeMs !== undefined
                && isFinite(spec.decayHalfLifeMs) && spec.decayHalfLifeMs >= 0
                ? spec.decayHalfLifeMs : 0,
        };
        if (spec.data !== undefined)
            clone.data = spec.data;
        this.specs.set(spec.id, clone);
        return true;
    }
    hasTraitSpec(id) {
        return this.specs.has(id);
    }
    getTraitSpec(id) {
        var s = this.specs.get(id);
        return s ? { ...s } : null;
    }
    removeTraitSpec(id) {
        if (this.disposed)
            return false;
        if (!this.specs.has(id))
            return false;
        // Drop all entries for this trait.
        var toRemove = [];
        var keys = this.entries.keys();
        var k = keys.next();
        var suffix = '|' + id;
        while (!k.done) {
            var ks = k.value;
            if (ks.length >= suffix.length
                && ks.substring(ks.length - suffix.length) === suffix) {
                toRemove.push(ks);
            }
            k = keys.next();
        }
        for (var i = 0; i < toRemove.length; i++) {
            this.entries.delete(toRemove[i]);
        }
        return this.specs.delete(id);
    }
    traitIds() {
        var out = [];
        var keys = this.specs.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    // ---------- value get / set / adjust ----------
    // Set a character's trait value directly. Auto-defines the
    // trait spec with baseline 0 / no decay if not already defined,
    // so quick prototyping doesn't need a separate defineTrait call.
    set(characterId, traitId, value) {
        if (this.disposed)
            return false;
        if (typeof characterId !== 'string' || characterId.length === 0)
            return false;
        if (typeof traitId !== 'string' || traitId.length === 0)
            return false;
        if (!isFinite(value))
            return false;
        if (!this.specs.has(traitId))
            this.defineTrait({ id: traitId });
        var k = key(characterId, traitId);
        var entry = {
            characterId: characterId,
            traitId: traitId,
            rawValue: value,
            ageMs: 0,
        };
        this.entries.set(k, entry);
        this.fireChange(entry);
        return true;
    }
    // Add `delta` to the current value. If no entry exists, treats
    // current as 0. Returns the new clamped value (or null on
    // invalid input).
    adjust(characterId, traitId, delta) {
        if (this.disposed)
            return null;
        if (typeof characterId !== 'string' || characterId.length === 0)
            return null;
        if (typeof traitId !== 'string' || traitId.length === 0)
            return null;
        if (!isFinite(delta))
            return null;
        if (!this.specs.has(traitId))
            this.defineTrait({ id: traitId });
        var k = key(characterId, traitId);
        var entry = this.entries.get(k);
        if (!entry) {
            entry = { characterId: characterId, traitId: traitId, rawValue: 0, ageMs: 0 };
            this.entries.set(k, entry);
        }
        entry.rawValue += delta;
        entry.ageMs = 0;
        this.fireChange(entry);
        return this.valueClamp(entry.rawValue);
    }
    // Returns the clamped value, or 0 if no entry / invalid input.
    getValue(characterId, traitId) {
        var entry = this.entries.get(key(characterId, traitId));
        if (!entry)
            return 0;
        return this.valueClamp(entry.rawValue);
    }
    // Returns the raw (un-clamped) value, or null if no entry.
    getRawValue(characterId, traitId) {
        var entry = this.entries.get(key(characterId, traitId));
        return entry ? entry.rawValue : null;
    }
    has(characterId, traitId) {
        return this.entries.has(key(characterId, traitId));
    }
    remove(characterId, traitId) {
        if (this.disposed)
            return false;
        return this.entries.delete(key(characterId, traitId));
    }
    // All trait values for one character.
    forCharacter(characterId) {
        var out = [];
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.characterId === characterId)
                out.push(this.snapshot(e));
            v = iter.next();
        }
        return out;
    }
    // All character entries for one trait.
    forTrait(traitId) {
        var out = [];
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.traitId === traitId)
                out.push(this.snapshot(e));
            v = iter.next();
        }
        return out;
    }
    // Find the character whose trait value is highest within
    // [minLevel, maxLevel]. Returns null if no match.
    findHighest(traitId, opts = {}) {
        return this.find(traitId, opts, true);
    }
    findLowest(traitId, opts = {}) {
        return this.find(traitId, opts, false);
    }
    // Number of (character, trait) entries.
    entryCount() { return this.entries.size; }
    traitSpecCount() { return this.specs.size; }
    list() {
        var out = [];
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.snapshot(v.value));
            v = iter.next();
        }
        return out;
    }
    // Apply decay toward baseline using the trait spec's
    // decayHalfLifeMs. Each tick advances ageMs and pulls the raw
    // value some fraction of the way to baseline.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            e.ageMs += dt;
            var spec = this.specs.get(e.traitId);
            if (spec && spec.decayHalfLifeMs > 0) {
                // Exponential decay toward baseline.
                // value(t+dt) = baseline + (value(t) - baseline) * 0.5^(dt/halfLife)
                var halfLife = spec.decayHalfLifeMs;
                var factor = Math.pow(0.5, dt / halfLife);
                var baseline = spec.baseline;
                var newRaw = baseline + (e.rawValue - baseline) * factor;
                if (Math.abs(newRaw - e.rawValue) > 1e-9) {
                    e.rawValue = newRaw;
                    this.fireChange(e);
                }
            }
            v = iter.next();
        }
    }
    clear() {
        if (this.disposed)
            return;
        this.specs.clear();
        this.entries.clear();
    }
    dispose() {
        this.specs.clear();
        this.entries.clear();
        this.onChange = null;
        this.disposed = true;
    }
    // ---------- private ----------
    find(traitId, opts, highest) {
        var minLevel = opts.minLevel !== undefined && isFinite(opts.minLevel)
            ? opts.minLevel : -Infinity;
        var maxLevel = opts.maxLevel !== undefined && isFinite(opts.maxLevel)
            ? opts.maxLevel : Infinity;
        var allowed = null;
        if (Array.isArray(opts.characterIds) && opts.characterIds.length > 0) {
            allowed = new Set(opts.characterIds);
        }
        var bestEntry = null;
        var bestVal = highest ? -Infinity : Infinity;
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.traitId !== traitId) {
                v = iter.next();
                continue;
            }
            if (allowed !== null && !allowed.has(e.characterId)) {
                v = iter.next();
                continue;
            }
            var clamped = this.valueClamp(e.rawValue);
            if (clamped < minLevel || clamped > maxLevel) {
                v = iter.next();
                continue;
            }
            if (highest ? clamped > bestVal : clamped < bestVal) {
                bestVal = clamped;
                bestEntry = e;
            }
            v = iter.next();
        }
        return bestEntry ? this.snapshot(bestEntry) : null;
    }
    fireChange(e) {
        if (!this.onChange)
            return;
        try {
            this.onChange(this.snapshot(e));
        }
        catch { /* ignore */ }
    }
    snapshot(e) {
        return {
            characterId: e.characterId,
            traitId: e.traitId,
            value: this.valueClamp(e.rawValue),
            rawValue: e.rawValue,
            ageMs: e.ageMs,
        };
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_PERSONA_TRAIT = 'persona_trait';
//# sourceMappingURL=persona-trait.js.map