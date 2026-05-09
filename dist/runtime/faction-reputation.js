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
const DEFAULT_TIERS = [
    { name: 'hostile', min: -1000 },
    { name: 'unfriendly', min: -250 },
    { name: 'neutral', min: -50 },
    { name: 'friendly', min: 50 },
    { name: 'honored', min: 250 },
];
const DEFAULT_MIN = -1000;
const DEFAULT_MAX = 1000;
export class FactionReputation {
    factions = new Map();
    onChanged;
    onTierChanged;
    disposed = false;
    constructor(opts) {
        this.onChanged = opts.onChanged ?? null;
        this.onTierChanged = opts.onTierChanged ?? null;
    }
    static create(opts = {}) {
        return new FactionReputation(opts);
    }
    registerFaction(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (typeof spec.name !== 'string')
            return false;
        if (this.factions.has(spec.id))
            return false;
        var minRep = spec.minReputation !== undefined && isFinite(spec.minReputation)
            ? spec.minReputation : DEFAULT_MIN;
        var maxRep = spec.maxReputation !== undefined && isFinite(spec.maxReputation)
            ? spec.maxReputation : DEFAULT_MAX;
        if (maxRep < minRep)
            maxRep = minRep;
        var initRep = spec.initialReputation !== undefined && isFinite(spec.initialReputation)
            ? spec.initialReputation : 0;
        if (initRep < minRep)
            initRep = minRep;
        if (initRep > maxRep)
            initRep = maxRep;
        var tiers = spec.tiers && spec.tiers.length > 0 ? sortTiers(spec.tiers) : DEFAULT_TIERS.slice();
        var entry = {
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
    unregisterFaction(id) {
        if (this.disposed)
            return false;
        return this.factions.delete(id);
    }
    has(id) { return this.factions.has(id); }
    getReputation(id) {
        var e = this.factions.get(id);
        return e ? e.reputation : 0;
    }
    getTier(id) {
        var e = this.factions.get(id);
        return e ? e.currentTier : null;
    }
    // Add a reputation delta (positive or negative). Clamps to
    // [min, max]. Fires onChanged + onTierChanged on tier flip.
    addReputation(id, delta) {
        if (this.disposed)
            return false;
        if (!isFinite(delta) || delta === 0)
            return false;
        return this.applyReputation(id, this.getReputation(id) + delta);
    }
    setReputation(id, value) {
        if (this.disposed)
            return false;
        if (!isFinite(value))
            return false;
        return this.applyReputation(id, value);
    }
    list() {
        var out = [];
        this.factions.forEach((e) => {
            out.push({
                id: e.spec.id, name: e.spec.name,
                reputation: e.reputation, tier: e.currentTier,
            });
        });
        return out;
    }
    size() { return this.factions.size; }
    toSnapshot() {
        var out = {};
        this.factions.forEach((e, id) => { out[id] = e.reputation; });
        return out;
    }
    fromSnapshot(snap) {
        if (this.disposed)
            return;
        if (!snap || typeof snap !== 'object')
            return;
        var keys = Object.keys(snap);
        for (var i = 0; i < keys.length; i++) {
            var id = keys[i];
            var v = snap[id];
            if (typeof v !== 'number' || !isFinite(v))
                continue;
            var entry = this.factions.get(id);
            if (!entry)
                continue;
            var clamped = v;
            if (clamped < entry.minRep)
                clamped = entry.minRep;
            if (clamped > entry.maxRep)
                clamped = entry.maxRep;
            entry.reputation = clamped;
            entry.currentTier = tierFor(entry.tiers, clamped);
        }
    }
    dispose() {
        this.factions.clear();
        this.onChanged = null;
        this.onTierChanged = null;
        this.disposed = true;
    }
    // ---------- private ----------
    applyReputation(id, value) {
        var entry = this.factions.get(id);
        if (!entry)
            return false;
        var clamped = value;
        if (clamped < entry.minRep)
            clamped = entry.minRep;
        if (clamped > entry.maxRep)
            clamped = entry.maxRep;
        var prev = entry.reputation;
        if (prev === clamped)
            return false;
        entry.reputation = clamped;
        var prevTier = entry.currentTier;
        var nextTier = tierFor(entry.tiers, clamped);
        if (this.onChanged) {
            try {
                this.onChanged(id, clamped, prev);
            }
            catch { /* ignore */ }
        }
        if (nextTier !== prevTier) {
            entry.currentTier = nextTier;
            if (this.onTierChanged) {
                try {
                    this.onTierChanged(id, nextTier, prevTier);
                }
                catch { /* ignore */ }
            }
        }
        return true;
    }
}
function tierFor(tiers, rep) {
    if (tiers.length === 0)
        return null;
    var current = null;
    for (var i = 0; i < tiers.length; i++) {
        var t = tiers[i];
        if (rep >= t.min)
            current = t.name;
    }
    return current;
}
function sortTiers(tiers) {
    var copy = tiers.map((t) => ({ name: t.name, min: t.min }));
    copy.sort(function (a, b) { return a.min - b.min; });
    return copy;
}
function cloneSpec(s) {
    var copy = { id: s.id, name: s.name };
    if (s.tiers)
        copy.tiers = s.tiers.slice();
    if (s.initialReputation !== undefined)
        copy.initialReputation = s.initialReputation;
    if (s.minReputation !== undefined)
        copy.minReputation = s.minReputation;
    if (s.maxReputation !== undefined)
        copy.maxReputation = s.maxReputation;
    if (s.data)
        copy.data = s.data;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_FACTION_REPUTATION = 'faction_reputation';
//# sourceMappingURL=faction-reputation.js.map