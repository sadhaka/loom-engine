// BuffLifecycle - duration-tracked StatStack modifiers with auto-expire.
//
// 0.73.0 enabling primitive. Buffs and debuffs - "rage for 8 seconds",
// "burn for 5 seconds dealing damage every 0.5s", "speed boost from
// potion (permanent until consumed)" - share a common shape: a named
// effect that contributes some StatStack modifiers, optionally fires a
// periodic tick, and either runs out after a duration or sticks until
// manually removed.
//
// BuffLifecycle owns that lifecycle. Apply a buff, the system pushes
// its modifiers into the StatStack (0.59) under a stable
// `${sourcePrefix}${buff.id}` source key. Each tick advances elapsed
// time. When the duration runs out, modifiers come off the StatStack
// and onExpired fires. Manual remove() is the same path with onRemoved
// instead.
//
//   var buffs = BuffLifecycle.create({
//     statStack: stats,
//     onExpired: (buff) => log('buff ended: ' + buff.id),
//     onTick: (buff, idx) => {
//       if (buff.id === 'burn') hp -= 5;
//     },
//   });
//   buffs.apply({
//     id: 'rage',
//     durationMs: 8000,
//     modifiers: [
//       { source: '', stat: 'attackPower', kind: 'flat', value: 20 },
//     ],
//   });
//   each frame: buffs.tick(dtMs);
//
// Notes:
//   - Buff.id is the stable replacement key. Re-applying a buff with
//     the same id refreshes the duration and updates modifiers - it
//     does NOT stack a second instance. To stack, use unique ids.
//   - Modifiers' `source` field is overwritten by the lifecycle to
//     ${sourcePrefix}${buff.id} so removeBySource cleans them up
//     atomically. Caller can leave source blank in the buff spec.
//   - tickIntervalMs >0 fires onTick (1-based index) every interval
//     ms. Multiple ticks land per dt when dt > tickIntervalMs.
//
// Pairs with StatStack (0.59) and CooldownManager (0.52).
//
// Code style: var-only in browser source.
const DEFAULT_SOURCE_PREFIX = 'buff:';
export class BuffLifecycle {
    active = new Map();
    statStack;
    sourcePrefix;
    onApplied;
    onExpired;
    onRemoved;
    onTick;
    disposed = false;
    constructor(opts) {
        this.statStack = opts.statStack ?? null;
        this.sourcePrefix = opts.sourcePrefix !== undefined ? opts.sourcePrefix : DEFAULT_SOURCE_PREFIX;
        this.onApplied = opts.onApplied ?? null;
        this.onExpired = opts.onExpired ?? null;
        this.onRemoved = opts.onRemoved ?? null;
        this.onTick = opts.onTick ?? null;
    }
    static create(opts = {}) {
        return new BuffLifecycle(opts);
    }
    // Apply a buff. If a buff with the same id is already active, the
    // existing one is refreshed: its duration resets, its modifiers
    // are replaced (off then on), and onApplied fires with isRefresh=true.
    // Returns false if disposed or buff is invalid.
    apply(buff) {
        if (this.disposed)
            return false;
        if (!buff || typeof buff.id !== 'string' || buff.id.length === 0)
            return false;
        var existing = this.active.get(buff.id);
        var isRefresh = existing !== undefined;
        var modSource = this.sourcePrefix + buff.id;
        // Remove any prior modifiers under this id (refresh path).
        if (existing && this.statStack) {
            this.statStack.removeBySource(modSource);
        }
        var entry = {
            buff: buff,
            elapsedMs: 0,
            ticksFired: 0,
            permanent: !(buff.durationMs > 0),
            modSource: modSource,
        };
        if (this.statStack && buff.modifiers) {
            for (var i = 0; i < buff.modifiers.length; i++) {
                var m = buff.modifiers[i];
                this.statStack.addModifier({
                    source: modSource,
                    stat: m.stat,
                    kind: m.kind,
                    value: m.value,
                });
            }
        }
        this.active.set(buff.id, entry);
        if (this.onApplied) {
            try {
                this.onApplied(buff, isRefresh);
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Reset the duration timer for an active buff (without re-applying
    // modifiers). Returns false if no buff with that id is active.
    refresh(id) {
        if (this.disposed)
            return false;
        var entry = this.active.get(id);
        if (!entry)
            return false;
        entry.elapsedMs = 0;
        entry.ticksFired = 0;
        if (this.onApplied) {
            try {
                this.onApplied(entry.buff, true);
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Remove a buff manually. Strips its modifiers from the StatStack
    // and fires onRemoved (NOT onExpired). Returns false if not active.
    remove(id) {
        if (this.disposed)
            return false;
        var entry = this.active.get(id);
        if (!entry)
            return false;
        this.cleanup(entry);
        this.active.delete(id);
        if (this.onRemoved) {
            try {
                this.onRemoved(entry.buff);
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Remove every active buff. Returns the number removed.
    removeAll() {
        if (this.disposed)
            return 0;
        var ids = [];
        this.active.forEach((_e, k) => ids.push(k));
        for (var i = 0; i < ids.length; i++)
            this.remove(ids[i]);
        return ids.length;
    }
    has(id) {
        return this.active.has(id);
    }
    // Remaining ms; <0 for permanent buffs; 0 if not active.
    remainingMs(id) {
        var entry = this.active.get(id);
        if (!entry)
            return 0;
        if (entry.permanent)
            return -1;
        var rem = entry.buff.durationMs - entry.elapsedMs;
        return rem > 0 ? rem : 0;
    }
    // List of active buffs (defensive copy of the surface info).
    list() {
        var out = [];
        this.active.forEach((entry) => {
            out.push({
                buff: entry.buff,
                remainingMs: entry.permanent ? -1 : Math.max(0, entry.buff.durationMs - entry.elapsedMs),
                elapsedMs: entry.elapsedMs,
                ticksFired: entry.ticksFired,
            });
        });
        return out;
    }
    // Advance every active buff by dtMs. Fires onTick at every
    // tickIntervalMs boundary; fires onExpired when duration runs out
    // and removes modifiers. Permanent buffs (durationMs <= 0) advance
    // but never expire (their elapsedMs grows monotonically).
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var expiredIds = [];
        this.active.forEach((entry, id) => {
            var prev = entry.elapsedMs;
            entry.elapsedMs = prev + dt;
            // Tick events.
            var interval = entry.buff.tickIntervalMs;
            if (this.onTick && interval !== undefined && interval > 0) {
                // Number of full tick boundaries crossed during this dt.
                var dueCount = Math.floor(entry.elapsedMs / interval) - Math.floor(prev / interval);
                // For non-permanent buffs, cap ticks to NOT cross past the
                // expiry boundary (caller asked for tick-on-expire? we treat
                // expiry independently).
                if (!entry.permanent && entry.elapsedMs > entry.buff.durationMs) {
                    var cappedElapsed = entry.buff.durationMs;
                    dueCount = Math.floor(cappedElapsed / interval) - Math.floor(prev / interval);
                    if (dueCount < 0)
                        dueCount = 0;
                }
                for (var k = 0; k < dueCount; k++) {
                    entry.ticksFired += 1;
                    try {
                        this.onTick(entry.buff, entry.ticksFired);
                    }
                    catch { /* ignore */ }
                }
            }
            if (!entry.permanent && entry.elapsedMs >= entry.buff.durationMs) {
                expiredIds.push(id);
            }
        });
        for (var i = 0; i < expiredIds.length; i++) {
            var id2 = expiredIds[i];
            var entry2 = this.active.get(id2);
            if (!entry2)
                continue;
            this.cleanup(entry2);
            this.active.delete(id2);
            if (this.onExpired) {
                try {
                    this.onExpired(entry2.buff);
                }
                catch { /* ignore */ }
            }
        }
    }
    dispose() {
        if (this.disposed)
            return;
        // Strip all StatStack modifiers we added.
        if (this.statStack) {
            this.active.forEach((entry) => {
                this.statStack.removeBySource(entry.modSource);
            });
        }
        this.active.clear();
        this.statStack = null;
        this.onApplied = null;
        this.onExpired = null;
        this.onRemoved = null;
        this.onTick = null;
        this.disposed = true;
    }
    // ---------- private ----------
    cleanup(entry) {
        if (this.statStack) {
            this.statStack.removeBySource(entry.modSource);
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_BUFF_LIFECYCLE = 'buff_lifecycle';
//# sourceMappingURL=buff-lifecycle.js.map