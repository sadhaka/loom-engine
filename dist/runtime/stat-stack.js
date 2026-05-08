// StatStack - base + modifier stack producing derived stats.
//
// 0.59.0 enabling primitive. Stats (max-hp, attack-power, run-
// speed, crit-chance) come from layered sources: a base value
// from the character class, plus equipment bonuses, plus buffs,
// plus debuffs, plus aura effects. Each source can apply a flat
// addition, a percentage-of-base, or a final multiplier. The
// game keeps everything sane by applying them in a fixed order.
//
// StatStack is that machinery: register a base value per stat,
// add named modifiers tagged by source, query the derived value.
// Removing a modifier (buff expires, equipment unequipped) is
// O(1) by source key.
//
// Modifier order:
//   1. baseValue
//   2. + sum of all 'flat' additions
//   3. * (1 + sum of all 'percentBase')
//   4. * product of all 'multiplier' (final scalar)
//
// This 4-step order is the canonical RPG model; consumers who
// need different ordering can layer their own logic on top.
//
// Code style: var-only in browser source.
export class StatStack {
    stats = new Map();
    onChanged;
    disposed = false;
    constructor(opts) {
        this.onChanged = opts.onChanged ?? null;
    }
    static create(opts = {}) {
        return new StatStack(opts);
    }
    // Register or update a stat's base value. The base is the
    // foundation every modifier stacks on top of.
    setBase(statName, value) {
        if (this.disposed)
            return;
        if (typeof statName !== 'string' || statName.length === 0)
            return;
        var v = +value;
        if (!isFinite(v))
            v = 0;
        var entry = this.stats.get(statName);
        if (!entry) {
            // derived starts at 0 so the first computed value fires
            // onChanged with prev=0 -> next=v.
            entry = { base: v, derived: 0, modifiers: [], dirty: true };
            this.stats.set(statName, entry);
        }
        else {
            entry.base = v;
            entry.dirty = true;
        }
        this.maybeFire(statName, entry);
    }
    // Read the base value for a stat.
    getBase(statName) {
        var entry = this.stats.get(statName);
        return entry ? entry.base : 0;
    }
    // Add (or replace) a modifier. Replacement is keyed by
    // (source, stat, kind) so re-applying the same equipment slot's
    // modifier doesn't double up. Returns true if added/replaced;
    // false if disposed or invalid input.
    addModifier(mod) {
        if (this.disposed)
            return false;
        if (!mod || typeof mod.source !== 'string' || mod.source.length === 0)
            return false;
        if (typeof mod.stat !== 'string' || mod.stat.length === 0)
            return false;
        if (typeof mod.kind !== 'string')
            return false;
        if (typeof mod.value !== 'number' || !isFinite(mod.value))
            return false;
        var entry = this.stats.get(mod.stat);
        if (!entry) {
            // Same convention as setBase: derived=0 so first compute
            // fires onChanged.
            entry = { base: 0, derived: 0, modifiers: [], dirty: true };
            this.stats.set(mod.stat, entry);
        }
        // Drop existing modifier with same (source, kind) on this stat.
        for (var i = entry.modifiers.length - 1; i >= 0; i--) {
            var m = entry.modifiers[i];
            if (m.source === mod.source && m.kind === mod.kind) {
                entry.modifiers.splice(i, 1);
            }
        }
        entry.modifiers.push({
            source: mod.source,
            stat: mod.stat,
            kind: mod.kind,
            value: mod.value,
        });
        entry.dirty = true;
        this.maybeFire(mod.stat, entry);
        return true;
    }
    // Remove every modifier whose `source` matches across all stats.
    // Returns number of modifiers removed. Useful for "buff expires"
    // or "item unequipped" cleanup.
    removeBySource(source) {
        if (this.disposed)
            return 0;
        if (typeof source !== 'string' || source.length === 0)
            return 0;
        var removed = 0;
        var changedStats = [];
        this.stats.forEach((entry, statName) => {
            var initialLen = entry.modifiers.length;
            entry.modifiers = entry.modifiers.filter((m) => m.source !== source);
            var dropped = initialLen - entry.modifiers.length;
            if (dropped > 0) {
                removed += dropped;
                entry.dirty = true;
                changedStats.push(statName);
            }
        });
        for (var i = 0; i < changedStats.length; i++) {
            var name = changedStats[i];
            var entry = this.stats.get(name);
            if (entry)
                this.maybeFire(name, entry);
        }
        return removed;
    }
    // Remove all modifiers across all stats matching (source, stat,
    // kind?). If `kind` is omitted, removes all kinds for that
    // (source, stat) pair.
    removeModifier(source, stat, kind) {
        if (this.disposed)
            return false;
        var entry = this.stats.get(stat);
        if (!entry)
            return false;
        var initialLen = entry.modifiers.length;
        entry.modifiers = entry.modifiers.filter((m) => {
            if (m.source !== source)
                return true;
            if (kind !== undefined && m.kind !== kind)
                return true;
            return false;
        });
        if (entry.modifiers.length === initialLen)
            return false;
        entry.dirty = true;
        this.maybeFire(stat, entry);
        return true;
    }
    // Compute (or read cached) derived value for a stat. Lazy: only
    // recomputes when something changed.
    get(statName) {
        var entry = this.stats.get(statName);
        if (!entry)
            return 0;
        if (entry.dirty) {
            entry.derived = this.computeDerived(entry);
            entry.dirty = false;
        }
        return entry.derived;
    }
    // Read every modifier on a stat. Returns a fresh array.
    getModifiers(statName) {
        var entry = this.stats.get(statName);
        if (!entry)
            return [];
        return entry.modifiers.map((m) => ({
            source: m.source, stat: m.stat, kind: m.kind, value: m.value,
        }));
    }
    // Read every defined stat name.
    statNames() {
        var out = [];
        this.stats.forEach((_e, name) => out.push(name));
        return out;
    }
    // Wipe all stats + modifiers.
    clear() {
        if (this.disposed)
            return;
        this.stats.clear();
    }
    dispose() {
        this.stats.clear();
        this.onChanged = null;
        this.disposed = true;
    }
    // ---------- private ----------
    computeDerived(entry) {
        var flat = 0;
        var percentSum = 0;
        var mulProduct = 1;
        for (var i = 0; i < entry.modifiers.length; i++) {
            var m = entry.modifiers[i];
            if (m.kind === 'flat')
                flat += m.value;
            else if (m.kind === 'percentBase')
                percentSum += m.value;
            else if (m.kind === 'multiplier')
                mulProduct *= m.value;
        }
        return (entry.base + flat) * (1 + percentSum) * mulProduct;
    }
    maybeFire(statName, entry) {
        if (!this.onChanged)
            return;
        if (entry.dirty) {
            var next = this.computeDerived(entry);
            var prev = entry.derived;
            entry.derived = next;
            entry.dirty = false;
            if (next !== prev) {
                try {
                    this.onChanged(statName, next, prev);
                }
                catch {
                    // Best-effort.
                }
            }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_STAT_STACK = 'stat_stack';
//# sourceMappingURL=stat-stack.js.map