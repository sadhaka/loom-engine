// SchedulePlan - NPC daily routine ledger.
//
// 1.3.4 enabling primitive (Wave 1.3 AI persona depth). The
// Stardew Valley / Skyrim / Persona pattern: each NPC has a
// schedule of "at 8am go to the bakery, at noon go to the
// temple, at 6pm go home." SchedulePlan is the time-indexed
// registry: blocks per character with start / end minute,
// location, activity, weekday filter, optional gate predicate,
// and priority for overlap resolution.
//
//   var sp = SchedulePlan.create();
//   sp.addBlock({
//     id: 'mira_morning_market',
//     characterId: 'mira',
//     startMinute: 9 * 60, endMinute: 11 * 60,
//     location: 'market', activity: 'shopping',
//     weekdays: [2, 4, 6],  // Tue/Thu/Sat
//     priority: 0,
//   });
//   sp.addBlock({
//     id: 'mira_festival_override',
//     characterId: 'mira',
//     startMinute: 0, endMinute: 1440,
//     location: 'plaza', activity: 'festival',
//     priority: 100,        // wins on festival day
//     condition: (ctx) => !!ctx.festivalActive,
//   });
//
//   var here = sp.current('mira', {
//     minute: 10 * 60,
//     weekday: 2,
//     festivalActive: false,
//   });
//   // -> ScheduleBlock 'mira_morning_market' (market / shopping)
//
// Pairs with PersonaTrait (1.3.0, who they are), EmotionState
// (1.3.2, current mood), RegionGraph (1.2.1, the location ids),
// EncounterTable (1.2.3, what spawns where).
//
// Code style: var-only in browser source.
export class SchedulePlan {
    blocks = new Map();
    insertCounter = 0;
    disposed = false;
    constructor(_opts) { }
    static create(opts = {}) {
        return new SchedulePlan(opts);
    }
    // ---------- block management ----------
    addBlock(block) {
        if (this.disposed)
            return false;
        if (!block || typeof block.id !== 'string' || block.id.length === 0)
            return false;
        if (typeof block.characterId !== 'string' || block.characterId.length === 0) {
            return false;
        }
        if (typeof block.location !== 'string' || block.location.length === 0)
            return false;
        if (!isFinite(block.startMinute) || block.startMinute < 0 || block.startMinute > 1440) {
            return false;
        }
        if (!isFinite(block.endMinute) || block.endMinute < 0 || block.endMinute > 1440) {
            return false;
        }
        var weekdaysSet = null;
        if (Array.isArray(block.weekdays) && block.weekdays.length > 0) {
            weekdaysSet = new Set();
            for (var i = 0; i < block.weekdays.length; i++) {
                var w = block.weekdays[i];
                if (isFinite(w) && w >= 0 && w <= 6)
                    weekdaysSet.add(Math.floor(w));
            }
        }
        var internal = {
            id: block.id,
            characterId: block.characterId,
            startMinute: Math.floor(block.startMinute),
            endMinute: Math.floor(block.endMinute),
            location: block.location,
            weekdaysSet: weekdaysSet,
            priorityVal: block.priority !== undefined && isFinite(block.priority)
                ? block.priority : 0,
            insertOrder: ++this.insertCounter,
        };
        if (block.activity !== undefined)
            internal.activity = block.activity;
        if (block.weekdays !== undefined)
            internal.weekdays = block.weekdays.slice();
        if (block.priority !== undefined)
            internal.priority = block.priority;
        if (block.condition !== undefined)
            internal.condition = block.condition;
        if (block.data !== undefined)
            internal.data = block.data;
        this.blocks.set(block.id, internal);
        return true;
    }
    removeBlock(id) {
        if (this.disposed)
            return false;
        return this.blocks.delete(id);
    }
    updateBlock(id, partial) {
        if (this.disposed)
            return false;
        var existing = this.blocks.get(id);
        if (!existing)
            return false;
        if (partial.startMinute !== undefined) {
            if (!isFinite(partial.startMinute) || partial.startMinute < 0
                || partial.startMinute > 1440)
                return false;
            existing.startMinute = Math.floor(partial.startMinute);
        }
        if (partial.endMinute !== undefined) {
            if (!isFinite(partial.endMinute) || partial.endMinute < 0
                || partial.endMinute > 1440)
                return false;
            existing.endMinute = Math.floor(partial.endMinute);
        }
        if (partial.location !== undefined)
            existing.location = partial.location;
        if (partial.activity !== undefined)
            existing.activity = partial.activity;
        if (partial.priority !== undefined && isFinite(partial.priority)) {
            existing.priority = partial.priority;
            existing.priorityVal = partial.priority;
        }
        if (partial.condition !== undefined)
            existing.condition = partial.condition;
        if (partial.data !== undefined)
            existing.data = partial.data;
        if (partial.weekdays !== undefined) {
            existing.weekdays = partial.weekdays.slice();
            existing.weekdaysSet = null;
            if (partial.weekdays.length > 0) {
                existing.weekdaysSet = new Set();
                for (var i = 0; i < partial.weekdays.length; i++) {
                    var w = partial.weekdays[i];
                    if (isFinite(w) && w >= 0 && w <= 6)
                        existing.weekdaysSet.add(Math.floor(w));
                }
            }
        }
        return true;
    }
    hasBlock(id) {
        return this.blocks.has(id);
    }
    getBlock(id) {
        var b = this.blocks.get(id);
        return b ? this.publicBlock(b) : null;
    }
    blockCount() { return this.blocks.size; }
    // ---------- query ----------
    // Return the highest-priority active block for a character at
    // the given query context. Returns null if no block applies.
    current(characterId, ctx) {
        if (this.disposed)
            return null;
        if (typeof characterId !== 'string')
            return null;
        if (!ctx || !isFinite(ctx.minute))
            return null;
        var minute = ctx.minute;
        var bestBlock = null;
        var iter = this.blocks.values();
        var v = iter.next();
        while (!v.done) {
            var b = v.value;
            if (b.characterId !== characterId) {
                v = iter.next();
                continue;
            }
            if (!this.blockMatches(b, ctx)) {
                v = iter.next();
                continue;
            }
            if (!bestBlock
                || b.priorityVal > bestBlock.priorityVal
                || (b.priorityVal === bestBlock.priorityVal
                    && b.insertOrder > bestBlock.insertOrder)) {
                bestBlock = b;
            }
            v = iter.next();
        }
        return bestBlock ? this.toActive(bestBlock, minute) : null;
    }
    // All matching active blocks for a character (for diagnostics
    // or when a consumer wants overlap resolution different from
    // priority).
    allActive(characterId, ctx) {
        var out = [];
        if (this.disposed || typeof characterId !== 'string' || !ctx
            || !isFinite(ctx.minute))
            return out;
        var iter = this.blocks.values();
        var v = iter.next();
        while (!v.done) {
            var b = v.value;
            if (b.characterId === characterId && this.blockMatches(b, ctx)) {
                out.push(this.toActive(b, ctx.minute));
            }
            v = iter.next();
        }
        return out;
    }
    // All regular blocks for a character (regardless of current time).
    blocksFor(characterId) {
        var out = [];
        var iter = this.blocks.values();
        var v = iter.next();
        while (!v.done) {
            if (v.value.characterId === characterId)
                out.push(this.publicBlock(v.value));
            v = iter.next();
        }
        return out;
    }
    // For all characters with at least one block, return the active
    // block at this query (may be null per character if no match).
    allCurrent(ctx) {
        var out = {};
        if (this.disposed || !ctx || !isFinite(ctx.minute))
            return out;
        var seen = new Set();
        var iter = this.blocks.values();
        var v = iter.next();
        while (!v.done) {
            seen.add(v.value.characterId);
            v = iter.next();
        }
        var arr = Array.from(seen);
        for (var i = 0; i < arr.length; i++) {
            out[arr[i]] = this.current(arr[i], ctx);
        }
        return out;
    }
    list() {
        var out = [];
        var iter = this.blocks.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.publicBlock(v.value));
            v = iter.next();
        }
        return out;
    }
    clear() {
        if (this.disposed)
            return;
        this.blocks.clear();
        this.insertCounter = 0;
    }
    dispose() {
        this.blocks.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    blockMatches(b, ctx) {
        var minute = ctx.minute;
        // Time window check (handles midnight wrap).
        var inWindow;
        if (b.startMinute <= b.endMinute) {
            inWindow = minute >= b.startMinute && minute < b.endMinute;
        }
        else {
            // Wraps midnight: e.g. 22:00 - 06:00.
            inWindow = minute >= b.startMinute || minute < b.endMinute;
        }
        if (!inWindow)
            return false;
        // Weekday filter.
        if (b.weekdaysSet !== null
            && typeof ctx.weekday === 'number'
            && !b.weekdaysSet.has(Math.floor(ctx.weekday))) {
            return false;
        }
        // Condition predicate.
        if (b.condition) {
            var allowed = false;
            try {
                allowed = !!b.condition(ctx);
            }
            catch {
                allowed = false;
            }
            if (!allowed)
                return false;
        }
        return true;
    }
    toActive(b, minute) {
        var duration;
        var elapsed;
        if (b.startMinute <= b.endMinute) {
            duration = b.endMinute - b.startMinute;
            elapsed = minute - b.startMinute;
        }
        else {
            // Wrap: total = (1440 - start) + end.
            duration = (1440 - b.startMinute) + b.endMinute;
            elapsed = minute >= b.startMinute
                ? minute - b.startMinute
                : (1440 - b.startMinute) + minute;
        }
        var progress = duration > 0
            ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
        var remaining = duration - elapsed;
        if (remaining < 0)
            remaining = 0;
        return {
            ...this.publicBlock(b),
            progress: progress,
            remainingMinutes: remaining,
        };
    }
    publicBlock(b) {
        var out = {
            id: b.id,
            characterId: b.characterId,
            startMinute: b.startMinute,
            endMinute: b.endMinute,
            location: b.location,
        };
        if (b.activity !== undefined)
            out.activity = b.activity;
        if (b.weekdays !== undefined)
            out.weekdays = b.weekdays.slice();
        if (b.priority !== undefined)
            out.priority = b.priority;
        if (b.condition !== undefined)
            out.condition = b.condition;
        if (b.data !== undefined)
            out.data = b.data;
        return out;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_SCHEDULE_PLAN = 'schedule_plan';
//# sourceMappingURL=schedule-plan.js.map