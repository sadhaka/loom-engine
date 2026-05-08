// InventoryGrid - slot-based inventory with stack support.
//
// 0.58.0 enabling primitive. Items, consumables, equipment,
// quest tokens - all share the slot-grid pattern. InventoryGrid
// is a fixed-capacity array of slots, each slot holding either
// nothing or `{ itemId, count }`. Stackable items merge when
// added; non-stackable items consume one slot per unit.
//
// The inventory does not own item *definitions* - those live in
// a consumer-side catalog. The inventory only deals with item ids
// and stack semantics derived from per-id `maxStack` config.
//
// Code style: var-only in browser source.
export class InventoryGrid {
    slots;
    capacityNum;
    itemInfoFn;
    onChanged;
    disposed = false;
    constructor(opts) {
        if (!isFinite(opts.capacity) || opts.capacity <= 0) {
            throw new Error('InventoryGrid: capacity must be a positive number');
        }
        this.capacityNum = Math.floor(opts.capacity);
        this.slots = new Array(this.capacityNum).fill(null);
        this.itemInfoFn = opts.itemInfo ?? null;
        this.onChanged = opts.onChanged ?? null;
    }
    static create(opts) {
        return new InventoryGrid(opts);
    }
    capacity() {
        return this.capacityNum;
    }
    // Number of occupied slots.
    occupiedCount() {
        var n = 0;
        for (var i = 0; i < this.slots.length; i++) {
            if (this.slots[i] !== null)
                n++;
        }
        return n;
    }
    // Number of empty slots.
    freeSlots() {
        return this.capacityNum - this.occupiedCount();
    }
    // Read a slot. Returns a copy (mutating the result does NOT
    // affect inventory state). Out-of-bounds returns null.
    getSlot(index) {
        if (this.disposed)
            return null;
        if (index < 0 || index >= this.capacityNum)
            return null;
        var s = this.slots[index];
        if (!s)
            return null;
        return { itemId: s.itemId, count: s.count };
    }
    // True if the inventory holds at least one of `itemId`.
    has(itemId) {
        return this.totalOf(itemId) > 0;
    }
    // Total count of `itemId` summed across every slot.
    totalOf(itemId) {
        var total = 0;
        for (var i = 0; i < this.slots.length; i++) {
            var s = this.slots[i];
            if (s && s.itemId === itemId)
                total += s.count;
        }
        return total;
    }
    // Add `count` of `itemId`. Stacks into existing slots first,
    // then fills empty slots. Returns { added, overflow }.
    add(itemId, count = 1) {
        if (this.disposed)
            return { added: 0, overflow: count };
        if (typeof itemId !== 'string' || itemId.length === 0) {
            return { added: 0, overflow: count };
        }
        var c = Math.floor(count);
        if (c <= 0)
            return { added: 0, overflow: 0 };
        var maxStack = this.maxStackOf(itemId);
        var remaining = c;
        var added = 0;
        // Pass 1: top up existing stacks.
        if (maxStack > 1) {
            for (var i = 0; i < this.slots.length && remaining > 0; i++) {
                var s = this.slots[i];
                if (!s || s.itemId !== itemId)
                    continue;
                var room = maxStack - s.count;
                if (room <= 0)
                    continue;
                var fill = Math.min(room, remaining);
                s.count += fill;
                added += fill;
                remaining -= fill;
                this.fireChanged(i);
            }
        }
        // Pass 2: drop into empty slots up to maxStack each.
        for (var j = 0; j < this.slots.length && remaining > 0; j++) {
            if (this.slots[j] !== null)
                continue;
            var fill2 = Math.min(maxStack, remaining);
            this.slots[j] = { itemId: itemId, count: fill2 };
            added += fill2;
            remaining -= fill2;
            this.fireChanged(j);
        }
        return { added: added, overflow: remaining };
    }
    // Remove `count` of `itemId`. Returns the number of units
    // actually removed (may be < count if inventory had less).
    remove(itemId, count = 1) {
        if (this.disposed)
            return 0;
        if (typeof itemId !== 'string' || itemId.length === 0)
            return 0;
        var c = Math.floor(count);
        if (c <= 0)
            return 0;
        var removed = 0;
        var remaining = c;
        // Front-to-back so older slots drain first (use the oldest
        // potion before the newest). Matches typical RPG semantics.
        for (var i = 0; i < this.slots.length && remaining > 0; i++) {
            var s = this.slots[i];
            if (!s || s.itemId !== itemId)
                continue;
            var take = Math.min(s.count, remaining);
            s.count -= take;
            removed += take;
            remaining -= take;
            if (s.count === 0) {
                this.slots[i] = null;
            }
            this.fireChanged(i);
        }
        return removed;
    }
    // Remove from a specific slot index. Returns the removed slot
    // contents (or null if the slot was empty / out-of-bounds).
    // Useful for click-to-pick-up UI.
    takeSlot(index) {
        if (this.disposed)
            return null;
        if (index < 0 || index >= this.capacityNum)
            return null;
        var s = this.slots[index];
        if (!s)
            return null;
        this.slots[index] = null;
        this.fireChanged(index);
        return { itemId: s.itemId, count: s.count };
    }
    // Move slot `from` into slot `to`. If `to` is empty, the slot
    // moves wholesale. If `to` holds the same item id and there's
    // room, stacks merge. If `to` is a different item, the slots
    // swap. Returns true if the operation happened, false if no-op
    // (e.g. from === to or from is empty).
    move(from, to) {
        if (this.disposed)
            return false;
        if (from === to)
            return false;
        if (from < 0 || from >= this.capacityNum)
            return false;
        if (to < 0 || to >= this.capacityNum)
            return false;
        var src = this.slots[from];
        if (!src)
            return false;
        var dst = this.slots[to];
        if (!dst) {
            this.slots[to] = src;
            this.slots[from] = null;
            this.fireChanged(from);
            this.fireChanged(to);
            return true;
        }
        if (dst.itemId === src.itemId) {
            // Stack merge.
            var maxStack = this.maxStackOf(src.itemId);
            var room = maxStack - dst.count;
            if (room <= 0)
                return false; // dst already full of same item
            var merge = Math.min(room, src.count);
            dst.count += merge;
            src.count -= merge;
            if (src.count === 0)
                this.slots[from] = null;
            this.fireChanged(from);
            this.fireChanged(to);
            return true;
        }
        // Swap (different items).
        this.slots[from] = dst;
        this.slots[to] = src;
        this.fireChanged(from);
        this.fireChanged(to);
        return true;
    }
    // Empty every slot.
    clear() {
        if (this.disposed)
            return;
        for (var i = 0; i < this.slots.length; i++) {
            if (this.slots[i] !== null) {
                this.slots[i] = null;
                this.fireChanged(i);
            }
        }
    }
    // Snapshot for save / load. Returns a fresh array of slot
    // objects (or nulls) safe for JSON.
    toSnapshot() {
        var out = new Array(this.capacityNum);
        for (var i = 0; i < this.capacityNum; i++) {
            var s = this.slots[i];
            out[i] = s ? { itemId: s.itemId, count: s.count } : null;
        }
        return out;
    }
    // Restore from a snapshot. Length mismatches cause null fill /
    // truncation as appropriate (consumer should validate first if
    // strict shape matters).
    fromSnapshot(snap) {
        if (this.disposed)
            return;
        var n = Math.min(snap.length, this.capacityNum);
        for (var i = 0; i < n; i++) {
            var s = snap[i];
            if (!s || typeof s !== 'object' || typeof s.itemId !== 'string' || typeof s.count !== 'number') {
                this.slots[i] = null;
            }
            else {
                this.slots[i] = { itemId: s.itemId, count: Math.floor(s.count) };
            }
            this.fireChanged(i);
        }
        // Clear any tail slots beyond snap length.
        for (var j = n; j < this.capacityNum; j++) {
            if (this.slots[j] !== null) {
                this.slots[j] = null;
                this.fireChanged(j);
            }
        }
    }
    dispose() {
        this.slots.length = 0;
        this.itemInfoFn = null;
        this.onChanged = null;
        this.disposed = true;
    }
    // ---------- private ----------
    maxStackOf(itemId) {
        if (!this.itemInfoFn)
            return 1;
        var info;
        try {
            info = this.itemInfoFn(itemId);
        }
        catch {
            return 1;
        }
        var ms = info && info.maxStack !== undefined ? info.maxStack : 1;
        return ms > 0 ? Math.floor(ms) : 1;
    }
    fireChanged(idx) {
        if (!this.onChanged)
            return;
        try {
            this.onChanged(idx);
        }
        catch {
            // Best-effort.
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_INVENTORY_GRID = 'inventory_grid';
//# sourceMappingURL=inventory-grid.js.map