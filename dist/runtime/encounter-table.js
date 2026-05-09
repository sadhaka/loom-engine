// EncounterTable - weighted encounter pools per zone / phase /
// difficulty band.
//
// 1.2.3 enabling primitive (Wave 1.2 world depth). LootTable
// (0.57) handles "drop one of these items with these weights."
// EncounterTable is the same shape but for ENCOUNTERS: "which mob
// pack spawns in this zone at this time-of-day at this player
// difficulty level?". Filtering by zone, phase, level / tier band,
// and arbitrary tags - so a single declarative table can drive
// encounters across an entire game.
//
//   var et = EncounterTable.create();
//   et.add({
//     id: 'forest_wolf_pack',
//     zones: ['forest'],
//     phases: ['dusk', 'night'],
//     minLevel: 3, maxLevel: 12,
//     weight: 4,
//     payload: { mobs: [{ kind: 'wolf', count: 3 }] },
//   });
//   et.add({
//     id: 'forest_lone_wolf',
//     zones: ['forest'],
//     weight: 2,
//     payload: { mobs: [{ kind: 'wolf', count: 1 }] },
//   });
//
//   var pick = et.roll({ zone: 'forest', phase: 'dusk', level: 5 });
//   // -> picks 'forest_wolf_pack' or 'forest_lone_wolf' weighted.
//
// Pairs with LootTable (0.57, item drops), SpawnDirector (1.2.2,
// the spawn-rate engine), Entropy (0.17, deterministic RNG seam).
//
// Code style: var-only in browser source.
function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
}
export class EncounterTable {
    entries = new Map();
    rng;
    disposed = false;
    constructor(opts) {
        if (typeof opts.rng === 'function') {
            this.rng = opts.rng;
        }
        else {
            var seed = opts.seed !== undefined && isFinite(opts.seed) ? opts.seed : 1;
            this.rng = mulberry32(seed);
        }
    }
    static create(opts = {}) {
        return new EncounterTable(opts);
    }
    add(entry) {
        if (this.disposed)
            return false;
        if (!entry || typeof entry.id !== 'string' || entry.id.length === 0)
            return false;
        if (entry.payload === undefined || entry.payload === null)
            return false;
        var weight = entry.weight !== undefined && isFinite(entry.weight)
            && entry.weight > 0 ? entry.weight : 1;
        var internal = {
            id: entry.id,
            zones: Array.isArray(entry.zones) && entry.zones.length > 0
                ? entry.zones.slice() : null,
            phases: Array.isArray(entry.phases) && entry.phases.length > 0
                ? entry.phases.slice() : null,
            minLevel: entry.minLevel !== undefined && isFinite(entry.minLevel)
                ? entry.minLevel : null,
            maxLevel: entry.maxLevel !== undefined && isFinite(entry.maxLevel)
                ? entry.maxLevel : null,
            tags: Array.isArray(entry.tags) && entry.tags.length > 0
                ? entry.tags.slice() : null,
            weight: weight,
            payload: entry.payload,
        };
        this.entries.set(entry.id, internal);
        return true;
    }
    remove(id) {
        if (this.disposed)
            return false;
        return this.entries.delete(id);
    }
    has(id) {
        return this.entries.has(id);
    }
    size() { return this.entries.size; }
    // Filter entries by context without rolling.
    filter(ctx = {}) {
        var out = [];
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            if (this.matches(v.value, ctx))
                out.push(this.publicView(v.value));
            v = iter.next();
        }
        return out;
    }
    list() {
        var out = [];
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.publicView(v.value));
            v = iter.next();
        }
        return out;
    }
    // Pick an encounter weighted by entry.weight, filtered by context.
    // Returns null if no entry matches.
    roll(ctx = {}) {
        if (this.disposed)
            return null;
        var matched = [];
        var totalWeight = 0;
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            if (this.matches(v.value, ctx)) {
                matched.push(v.value);
                totalWeight += v.value.weight;
            }
            v = iter.next();
        }
        if (matched.length === 0 || totalWeight <= 0)
            return null;
        var r = 0;
        try {
            r = this.rng();
        }
        catch {
            r = 0;
        }
        if (!isFinite(r) || r < 0)
            r = 0;
        if (r >= 1)
            r = 0.9999;
        var target = r * totalWeight;
        var acc = 0;
        for (var i = 0; i < matched.length; i++) {
            acc += matched[i].weight;
            if (acc >= target)
                return this.publicView(matched[i]);
        }
        return this.publicView(matched[matched.length - 1]);
    }
    // Return the total weight of entries matching the context.
    totalWeightFor(ctx = {}) {
        var total = 0;
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            if (this.matches(v.value, ctx))
                total += v.value.weight;
            v = iter.next();
        }
        return total;
    }
    setRng(rng) {
        if (this.disposed)
            return;
        if (typeof rng !== 'function')
            return;
        this.rng = rng;
    }
    clear() {
        if (this.disposed)
            return;
        this.entries.clear();
    }
    dispose() {
        this.entries.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    matches(e, ctx) {
        if (e.zones !== null) {
            if (typeof ctx.zone !== 'string' || e.zones.indexOf(ctx.zone) < 0)
                return false;
        }
        if (e.phases !== null) {
            if (typeof ctx.phase !== 'string' || e.phases.indexOf(ctx.phase) < 0)
                return false;
        }
        if (e.minLevel !== null) {
            if (typeof ctx.level !== 'number' || ctx.level < e.minLevel)
                return false;
        }
        if (e.maxLevel !== null) {
            if (typeof ctx.level !== 'number' || ctx.level > e.maxLevel)
                return false;
        }
        if (e.tags !== null) {
            if (!Array.isArray(ctx.tags) || ctx.tags.length === 0)
                return false;
            var anyMatch = false;
            for (var i = 0; i < e.tags.length; i++) {
                if (ctx.tags.indexOf(e.tags[i]) >= 0) {
                    anyMatch = true;
                    break;
                }
            }
            if (!anyMatch)
                return false;
        }
        return true;
    }
    publicView(e) {
        var copy = { id: e.id, weight: e.weight, payload: e.payload };
        if (e.zones !== null)
            copy.zones = e.zones.slice();
        if (e.phases !== null)
            copy.phases = e.phases.slice();
        if (e.minLevel !== null)
            copy.minLevel = e.minLevel;
        if (e.maxLevel !== null)
            copy.maxLevel = e.maxLevel;
        if (e.tags !== null)
            copy.tags = e.tags.slice();
        return copy;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_ENCOUNTER_TABLE = 'encounter_table';
//# sourceMappingURL=encounter-table.js.map