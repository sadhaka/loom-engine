// LootTier - gear-quality tiered drop pools (Wave 1.2 milestone).
//
// 1.2.5 CAPSTONE primitive (Wave 1.2 world / economy depth
// milestone). LootTable (0.57) is a flat weighted pool: roll once,
// get an item. LootTier is the diablo / borderlands / Path of
// Exile pattern: items belong to tiers (common / uncommon / rare /
// epic / legendary), and drops are TWO weighted rolls - first
// pick the tier (rare per-context probability), then pick an item
// within that tier. Plus tier scaling so high-level zones drop
// rares more often than low-level ones.
//
//   var loot = LootTier.create<{ name: string }>();
//   loot.defineTier({ id: 'common',    weight: 75 });
//   loot.defineTier({ id: 'uncommon',  weight: 20 });
//   loot.defineTier({ id: 'rare',      weight: 4 });
//   loot.defineTier({ id: 'legendary', weight: 1 });
//
//   loot.addItem({ id: 'twig', tier: 'common',
//                  payload: { name: 'Twig' } });
//   loot.addItem({ id: 'goldring', tier: 'rare',
//                  payload: { name: 'Gold Ring' } });
//   loot.addItem({ id: 'mirror_shard', tier: 'legendary',
//                  payload: { name: 'Mirror Shard' } });
//
//   // Tier scale: at zone level 30, rare and legendary become 3x
//   // more likely.
//   loot.setTierScaleFn((tierId, ctx) => {
//     if (tierId === 'rare' && (ctx.level as number) > 25) return 3;
//     if (tierId === 'legendary' && (ctx.level as number) > 25) return 3;
//     return 1;
//   });
//
//   var drop = loot.rollItem({ level: 30 });
//   // drop = { tier: 'rare', id: 'goldring', payload: {...} }
//
//   // Boss drop set: guaranteed 1 rare + 0-3 commons.
//   var bossLoot = loot.rollItems(1, { level: 30, tier: 'rare' });
//
// Pairs with LootTable (0.57, flat pools), MerchantStock (1.2.4),
// SpawnDirector (1.2.2), Entropy (0.17, RNG seam).
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
export class LootTier {
    tiers = new Map();
    items = new Map();
    // tier id -> array of item ids in that tier.
    itemsByTierIndex = new Map();
    rng;
    tierScaleFn = null;
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
        return new LootTier(opts);
    }
    // ---------- tier management ----------
    defineTier(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        var weight = spec.weight !== undefined && isFinite(spec.weight)
            && spec.weight > 0 ? spec.weight : 1;
        this.tiers.set(spec.id, { id: spec.id, weight: weight });
        if (!this.itemsByTierIndex.has(spec.id)) {
            this.itemsByTierIndex.set(spec.id, []);
        }
        return true;
    }
    removeTier(id) {
        if (this.disposed)
            return false;
        if (!this.tiers.has(id))
            return false;
        // Remove all items in this tier.
        var ids = this.itemsByTierIndex.get(id) ?? [];
        for (var i = 0; i < ids.length; i++) {
            this.items.delete(ids[i]);
        }
        this.itemsByTierIndex.delete(id);
        this.tiers.delete(id);
        return true;
    }
    hasTier(id) {
        return this.tiers.has(id);
    }
    tierIds() {
        var out = [];
        var keys = this.tiers.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    tierCount() { return this.tiers.size; }
    // ---------- item management ----------
    addItem(item) {
        if (this.disposed)
            return false;
        if (!item || typeof item.id !== 'string' || item.id.length === 0)
            return false;
        if (typeof item.tier !== 'string' || !this.tiers.has(item.tier))
            return false;
        if (item.payload === undefined || item.payload === null)
            return false;
        var weight = item.weight !== undefined && isFinite(item.weight)
            && item.weight > 0 ? item.weight : 1;
        var existing = this.items.get(item.id);
        if (existing && existing.tier !== item.tier) {
            // Item moving between tiers; remove from old tier index.
            var oldArr = this.itemsByTierIndex.get(existing.tier);
            if (oldArr) {
                var ix = oldArr.indexOf(item.id);
                if (ix >= 0)
                    oldArr.splice(ix, 1);
            }
        }
        var internal = {
            id: item.id,
            tier: item.tier,
            weight: weight,
            tags: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.slice() : null,
            payload: item.payload,
        };
        this.items.set(item.id, internal);
        var arr = this.itemsByTierIndex.get(item.tier);
        if (arr && arr.indexOf(item.id) < 0)
            arr.push(item.id);
        return true;
    }
    removeItem(id) {
        if (this.disposed)
            return false;
        var item = this.items.get(id);
        if (!item)
            return false;
        var arr = this.itemsByTierIndex.get(item.tier);
        if (arr) {
            var ix = arr.indexOf(id);
            if (ix >= 0)
                arr.splice(ix, 1);
        }
        return this.items.delete(id);
    }
    hasItem(id) {
        return this.items.has(id);
    }
    size() { return this.items.size; }
    itemsByTier(tier) {
        var out = [];
        var ids = this.itemsByTierIndex.get(tier);
        if (!ids)
            return out;
        for (var i = 0; i < ids.length; i++) {
            var item = this.items.get(ids[i]);
            if (item)
                out.push(this.publicItem(item));
        }
        return out;
    }
    list() {
        var out = [];
        var iter = this.items.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.publicItem(v.value));
            v = iter.next();
        }
        return out;
    }
    // ---------- scale ----------
    setTierScaleFn(fn) {
        if (this.disposed)
            return;
        this.tierScaleFn = fn;
    }
    // Resolve effective tier weights given context.
    effectiveTierWeights(ctx = {}) {
        var out = [];
        var iter = this.tiers.values();
        var v = iter.next();
        while (!v.done) {
            var t = v.value;
            var scale = 1;
            if (this.tierScaleFn) {
                try {
                    var s = this.tierScaleFn(t.id, ctx);
                    if (isFinite(s) && s >= 0)
                        scale = s;
                }
                catch {
                    scale = 1;
                }
            }
            out.push({ id: t.id, weight: t.weight * scale });
            v = iter.next();
        }
        return out;
    }
    // ---------- rolling ----------
    // Roll a tier id. Returns null if no tiers defined / all weights 0.
    rollTier(ctx = {}) {
        if (this.disposed)
            return null;
        if (typeof ctx.tier === 'string' && this.tiers.has(ctx.tier)) {
            return ctx.tier;
        }
        var weights = this.effectiveTierWeights(ctx);
        var total = 0;
        for (var i = 0; i < weights.length; i++)
            total += weights[i].weight;
        if (total <= 0)
            return null;
        var r = this.safeRng();
        var target = r * total;
        var acc = 0;
        for (var j = 0; j < weights.length; j++) {
            acc += weights[j].weight;
            if (acc >= target)
                return weights[j].id;
        }
        return weights[weights.length - 1].id;
    }
    // Roll an item: first pick a tier, then pick an item in that tier
    // weighted by item.weight (with optional tag filter). Returns
    // null on no match.
    rollItem(ctx = {}) {
        if (this.disposed)
            return null;
        var tier = this.rollTier(ctx);
        if (!tier)
            return null;
        return this.rollItemInTier(tier, ctx);
    }
    // Roll N items (independent rolls; each can repeat). Returns
    // an array of length up to N (may be shorter if some rolls
    // produced no match).
    rollItems(count, ctx = {}) {
        if (this.disposed)
            return [];
        var n = Math.floor(count);
        if (!isFinite(n) || n <= 0)
            return [];
        var out = [];
        for (var i = 0; i < n; i++) {
            var d = this.rollItem(ctx);
            if (d)
                out.push(d);
        }
        return out;
    }
    // Roll N unique items (without replacement; same item won't drop
    // twice in this call). May return fewer if pool exhausts.
    rollItemsUnique(count, ctx = {}) {
        if (this.disposed)
            return [];
        var n = Math.floor(count);
        if (!isFinite(n) || n <= 0)
            return [];
        var seen = new Set();
        var out = [];
        var maxAttempts = n * 8;
        var attempts = 0;
        while (out.length < n && attempts < maxAttempts) {
            attempts++;
            var d = this.rollItem(ctx);
            if (!d)
                break;
            if (seen.has(d.id))
                continue;
            seen.add(d.id);
            out.push(d);
        }
        return out;
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
        this.tiers.clear();
        this.items.clear();
        this.itemsByTierIndex.clear();
    }
    dispose() {
        this.tiers.clear();
        this.items.clear();
        this.itemsByTierIndex.clear();
        this.tierScaleFn = null;
        this.disposed = true;
    }
    // ---------- private ----------
    rollItemInTier(tier, ctx) {
        var ids = this.itemsByTierIndex.get(tier);
        if (!ids || ids.length === 0)
            return null;
        var requireMatch = ctx.requireTagMatch === true;
        var ctxTags = Array.isArray(ctx.tags) && ctx.tags.length > 0 ? ctx.tags : null;
        var matched = [];
        var totalWeight = 0;
        for (var i = 0; i < ids.length; i++) {
            var item = this.items.get(ids[i]);
            if (!item)
                continue;
            if (item.tags === null) {
                if (ctxTags !== null && requireMatch)
                    continue;
            }
            else {
                // Item has tags; if ctxTags set, require any-match.
                if (ctxTags !== null) {
                    var anyMatch = false;
                    for (var j = 0; j < item.tags.length; j++) {
                        if (ctxTags.indexOf(item.tags[j]) >= 0) {
                            anyMatch = true;
                            break;
                        }
                    }
                    if (!anyMatch)
                        continue;
                }
            }
            matched.push(item);
            totalWeight += item.weight;
        }
        if (matched.length === 0 || totalWeight <= 0)
            return null;
        var r = this.safeRng();
        var target = r * totalWeight;
        var acc = 0;
        for (var k = 0; k < matched.length; k++) {
            acc += matched[k].weight;
            if (acc >= target) {
                var pick = matched[k];
                return this.toDropResult(pick);
            }
        }
        var lastPick = matched[matched.length - 1];
        return this.toDropResult(lastPick);
    }
    safeRng() {
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
        return r;
    }
    toDropResult(item) {
        var out = {
            tier: item.tier,
            id: item.id,
            payload: item.payload,
        };
        if (item.tags !== null)
            out.tags = item.tags.slice();
        return out;
    }
    publicItem(item) {
        var copy = {
            id: item.id,
            tier: item.tier,
            weight: item.weight,
            payload: item.payload,
        };
        if (item.tags !== null)
            copy.tags = item.tags.slice();
        return copy;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_LOOT_TIER = 'loot_tier';
//# sourceMappingURL=loot-tier.js.map