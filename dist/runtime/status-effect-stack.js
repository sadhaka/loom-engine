// StatusEffectStack - buff / debuff ledger with stacking rules,
// diminishing returns, and post-expiry immunity windows.
//
// 1.1.1 enabling primitive (Wave 1.1 combat depth). BuffLifecycle
// (0.74) handles "this character has buff X with timer Y" - a flat
// list. StatusEffectStack adds the rules ARPGs / RPGs need on top:
// "bleed stacks up to 5 times, each stack adds 2dmg/sec",
// "multiple slow sources don't stack - highest wins", "stun has DR
// (each stun lasts 75% of prior)", "stun grants 1s immunity to
// further stuns after expiry".
//
// Layered model:
//   - defineEffect(spec)  - register the effect type + its
//                           stacking rule + DR / immunity / max
//                           stacks.
//   - apply(target, id, { magnitude, durationMs, source, data })
//                         - apply to a target; result depends on
//                           the registered stacking rule.
//   - tick(dtMs)          - advance ageMs / remainingMs / immunity
//                           windows, fire expire callbacks.
//   - has / get / listForTarget / listByEffect / forEach
//
// Stacking rules:
//   - 'replace' : new fully replaces old. stackCount stays 1.
//   - 'refresh' : duration refreshed; magnitude / source preserved
//                 from prior (use 'replace' if you want the new
//                 magnitude).
//   - 'stack'   : each apply increments stackCount up to maxStacks.
//                 totalMagnitude reflects perStack * stackCount.
//                 durationDR (default 1) shrinks new duration per
//                 existing stack: newDur = baseDur * pow(durationDR,
//                 currentStackCount).
//   - 'highest' : keep the entry with higher magnitude. Lower
//                 magnitude apply rejected.
//   - 'longest' : keep the entry with longer remainingMs at apply
//                 time. Lower remaining apply rejected.
//
// Immunity: when an effect expires, immunityAfterExpireMs starts.
// During that window, apply() returns false ('immune').
//
// Pairs with BuffLifecycle (0.74) for the simple flat case;
// AggroTable (0.78) for damage/threat conversion; DamageFormula
// (0.66) for crit / mitigation.
//
// Code style: var-only in browser source.
function clamp01(v) {
    if (!isFinite(v))
        return 1;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
export class StatusEffectStack {
    specs = new Map();
    entries = [];
    onApply;
    onExpire;
    disposed = false;
    constructor(opts) {
        this.onApply = opts.onApply ?? null;
        this.onExpire = opts.onExpire ?? null;
    }
    static create(opts = {}) {
        return new StatusEffectStack(opts);
    }
    // Register an effect spec. Returns true if accepted.
    defineEffect(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        var clone = {
            id: spec.id,
            stacking: spec.stacking ?? 'replace',
            maxStacks: spec.maxStacks !== undefined && isFinite(spec.maxStacks)
                && spec.maxStacks > 0
                ? Math.floor(spec.maxStacks) : 1,
            defaultDurationMs: spec.defaultDurationMs !== undefined
                && isFinite(spec.defaultDurationMs)
                ? Math.max(0, Math.floor(spec.defaultDurationMs)) : 5000,
            defaultMagnitude: spec.defaultMagnitude !== undefined
                && isFinite(spec.defaultMagnitude)
                ? spec.defaultMagnitude : 1,
            durationDR: spec.durationDR !== undefined ? clamp01(spec.durationDR) : 1,
            immunityAfterExpireMs: spec.immunityAfterExpireMs !== undefined
                && isFinite(spec.immunityAfterExpireMs)
                && spec.immunityAfterExpireMs >= 0
                ? Math.floor(spec.immunityAfterExpireMs) : 0,
        };
        if (spec.data !== undefined)
            clone.data = spec.data;
        this.specs.set(spec.id, clone);
        return true;
    }
    hasEffectSpec(effectId) {
        return this.specs.has(effectId);
    }
    // Apply an effect to a target. Returns ApplyResult describing
    // what happened.
    apply(targetId, effectId, opts = {}) {
        if (this.disposed)
            return 'rejected_unknown';
        if (typeof targetId !== 'string' || targetId.length === 0)
            return 'rejected_unknown';
        var spec = this.specs.get(effectId);
        if (!spec)
            return 'rejected_unknown';
        var existing = this.find(targetId, effectId);
        if (existing && existing.immunityRemainingMs > 0 && existing.stackCount === 0) {
            return 'rejected_immune';
        }
        var magnitude = opts.magnitude !== undefined && isFinite(opts.magnitude)
            ? opts.magnitude : spec.defaultMagnitude;
        var baseDuration = opts.durationMs !== undefined && isFinite(opts.durationMs)
            && opts.durationMs >= 0
            ? Math.floor(opts.durationMs) : spec.defaultDurationMs;
        var source = typeof opts.source === 'string' ? opts.source : null;
        var rule = spec.stacking;
        if (!existing || existing.stackCount === 0) {
            // Fresh entry.
            var entry = {
                targetId: targetId,
                effectId: effectId,
                source: source,
                magnitude: magnitude,
                stackCount: 1,
                remainingMs: baseDuration,
                ageMs: 0,
                immunityRemainingMs: 0,
            };
            if (opts.data !== undefined)
                entry.data = opts.data;
            // If there was a stale immunity record at index, replace.
            var idx = this.findIndex(targetId, effectId);
            if (idx >= 0)
                this.entries[idx] = entry;
            else
                this.entries.push(entry);
            this.fireApply(entry, 'applied');
            return 'applied';
        }
        // Existing active entry: dispatch on rule.
        if (rule === 'replace') {
            existing.source = source;
            existing.magnitude = magnitude;
            existing.stackCount = 1;
            existing.remainingMs = baseDuration;
            existing.ageMs = 0;
            if (opts.data !== undefined)
                existing.data = opts.data;
            this.fireApply(existing, 'replaced');
            return 'replaced';
        }
        if (rule === 'refresh') {
            existing.remainingMs = baseDuration;
            existing.ageMs = 0;
            this.fireApply(existing, 'refreshed');
            return 'refreshed';
        }
        if (rule === 'stack') {
            var maxStacks = spec.maxStacks;
            if (existing.stackCount < maxStacks) {
                existing.stackCount += 1;
            }
            // DR: new duration = baseDuration * pow(durationDR,
            // currentStackCount - 1). After we incremented stackCount,
            // currentStackCount - 1 = number of prior stacks.
            var dr = spec.durationDR;
            var scaled = baseDuration * Math.pow(dr, existing.stackCount - 1);
            // Refresh to the longer of existing remaining and new scaled.
            existing.remainingMs = Math.max(existing.remainingMs, Math.floor(scaled));
            existing.magnitude = magnitude;
            if (source !== null)
                existing.source = source;
            if (opts.data !== undefined)
                existing.data = opts.data;
            this.fireApply(existing, 'stacked');
            return 'stacked';
        }
        if (rule === 'highest') {
            if (magnitude > existing.magnitude) {
                existing.magnitude = magnitude;
                existing.remainingMs = baseDuration;
                existing.source = source;
                existing.ageMs = 0;
                if (opts.data !== undefined)
                    existing.data = opts.data;
                this.fireApply(existing, 'replaced');
                return 'replaced';
            }
            return 'rejected_lower';
        }
        if (rule === 'longest') {
            if (baseDuration > existing.remainingMs) {
                existing.magnitude = magnitude;
                existing.remainingMs = baseDuration;
                existing.source = source;
                existing.ageMs = 0;
                if (opts.data !== undefined)
                    existing.data = opts.data;
                this.fireApply(existing, 'replaced');
                return 'replaced';
            }
            return 'rejected_lower';
        }
        return 'rejected_unknown';
    }
    // Remove an active effect from a target. Returns true if found.
    // Triggers immunity if the spec has immunityAfterExpireMs > 0.
    removeEffect(targetId, effectId) {
        if (this.disposed)
            return false;
        var idx = this.findIndex(targetId, effectId);
        if (idx < 0)
            return false;
        var entry = this.entries[idx];
        if (entry.stackCount === 0)
            return false;
        var spec = this.specs.get(effectId);
        var immunity = spec && spec.immunityAfterExpireMs ? spec.immunityAfterExpireMs : 0;
        if (immunity > 0) {
            entry.stackCount = 0;
            entry.magnitude = 0;
            entry.remainingMs = 0;
            entry.immunityRemainingMs = immunity;
        }
        else {
            this.entries.splice(idx, 1);
        }
        this.fireExpire(entry, 'removed');
        return true;
    }
    has(targetId, effectId) {
        var entry = this.find(targetId, effectId);
        return !!entry && entry.stackCount > 0;
    }
    isImmune(targetId, effectId) {
        var entry = this.find(targetId, effectId);
        return !!entry && entry.stackCount === 0 && entry.immunityRemainingMs > 0;
    }
    get(targetId, effectId) {
        var entry = this.find(targetId, effectId);
        return entry ? this.snapshot(entry, this.specs.get(effectId)) : null;
    }
    getStacks(targetId, effectId) {
        var entry = this.find(targetId, effectId);
        return entry ? entry.stackCount : 0;
    }
    listForTarget(targetId) {
        var out = [];
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.targetId === targetId && entry.stackCount > 0) {
                out.push(this.snapshot(entry, this.specs.get(entry.effectId)));
            }
        }
        return out;
    }
    listByEffect(effectId) {
        var out = [];
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.effectId === effectId && entry.stackCount > 0) {
                out.push(this.snapshot(entry, this.specs.get(effectId)));
            }
        }
        return out;
    }
    forEach(cb) {
        if (this.disposed)
            return;
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.stackCount === 0)
                continue;
            try {
                cb(this.snapshot(entry, this.specs.get(entry.effectId)));
            }
            catch { /* ignore */ }
        }
    }
    count() {
        var n = 0;
        for (var i = 0; i < this.entries.length; i++) {
            if (this.entries[i].stackCount > 0)
                n++;
        }
        return n;
    }
    // Clear all effects from a target. Fires onExpire for each with
    // reason 'cleared'.
    clearTarget(targetId) {
        if (this.disposed)
            return 0;
        var removed = [];
        var keep = [];
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.targetId === targetId)
                removed.push(entry);
            else
                keep.push(entry);
        }
        this.entries = keep;
        if (this.onExpire) {
            for (var j = 0; j < removed.length; j++) {
                var e = removed[j];
                if (e.stackCount > 0)
                    this.fireExpire(e, 'cleared');
            }
        }
        return removed.length;
    }
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var keep = [];
        var expired = [];
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.stackCount > 0) {
                entry.ageMs += dt;
                entry.remainingMs -= dt;
                if (entry.remainingMs <= 0) {
                    var spec = this.specs.get(entry.effectId);
                    var immunity = spec && spec.immunityAfterExpireMs
                        ? spec.immunityAfterExpireMs : 0;
                    expired.push({ ...entry });
                    if (immunity > 0) {
                        entry.stackCount = 0;
                        entry.magnitude = 0;
                        entry.remainingMs = 0;
                        entry.immunityRemainingMs = immunity;
                        keep.push(entry);
                    }
                    // Else: drop entry entirely.
                    continue;
                }
                keep.push(entry);
            }
            else if (entry.immunityRemainingMs > 0) {
                entry.immunityRemainingMs -= dt;
                if (entry.immunityRemainingMs > 0) {
                    keep.push(entry);
                }
                // Else: immunity ended; drop entry.
            }
        }
        this.entries = keep;
        if (this.onExpire) {
            for (var j = 0; j < expired.length; j++) {
                this.fireExpire(expired[j], 'expired');
            }
        }
    }
    dispose() {
        this.specs.clear();
        this.entries.length = 0;
        this.onApply = null;
        this.onExpire = null;
        this.disposed = true;
    }
    // ---------- private ----------
    find(targetId, effectId) {
        var idx = this.findIndex(targetId, effectId);
        return idx >= 0 ? this.entries[idx] : null;
    }
    findIndex(targetId, effectId) {
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.targetId === targetId && entry.effectId === effectId)
                return i;
        }
        return -1;
    }
    fireApply(entry, result) {
        if (!this.onApply)
            return;
        try {
            this.onApply(this.snapshot(entry, this.specs.get(entry.effectId)), result);
        }
        catch { /* ignore */ }
    }
    fireExpire(entry, reason) {
        if (!this.onExpire)
            return;
        try {
            this.onExpire(this.snapshot(entry, this.specs.get(entry.effectId)), reason);
        }
        catch { /* ignore */ }
    }
    snapshot(entry, spec) {
        var stacking = (spec && spec.stacking) ? spec.stacking : 'replace';
        var totalMagnitude = stacking === 'stack'
            ? entry.magnitude * entry.stackCount
            : entry.magnitude;
        var copy = {
            targetId: entry.targetId,
            effectId: entry.effectId,
            source: entry.source,
            magnitude: entry.magnitude,
            totalMagnitude: totalMagnitude,
            stackCount: entry.stackCount,
            remainingMs: entry.remainingMs,
            ageMs: entry.ageMs,
            immunityRemainingMs: entry.immunityRemainingMs,
        };
        if (entry.data !== undefined)
            copy.data = entry.data;
        return copy;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_STATUS_EFFECT_STACK = 'status_effect_stack';
//# sourceMappingURL=status-effect-stack.js.map