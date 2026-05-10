// LagCompensation - client-side rollback netcode primitive.
//
// 1.7.4 networking primitive (Wave 1.7 networking depth).
// "What did the world look like 6 frames ago, and what inputs have
// I sent since? Re-simulate from there." Stores a circular buffer
// of (tick, state) snapshots + (tick, input) records. When an
// authoritative state arrives for some past tick, rewind() returns
// the snapshot + inputs to re-apply; the consumer's tick function
// re-simulates forward.
//
//   var lag = LagCompensation.create({
//     historySize: 60,
//     stateSerialize: (s) => structuredClone(s),
//   });
//
//   // Each tick:
//   lag.recordInput(tick, input);
//   lag.recordState(tick, currentState);
//
//   // Server sends authoritative state for an older tick:
//   var rewound = lag.rewind(serverTick);
//   if (rewound) {
//     // rewound.state = local snapshot at serverTick
//     // rewound.inputs = inputs from (serverTick+1)..currentTick
//     // Apply server state, replay inputs to catch up.
//   }
//
// Circular buffer caps memory (oldest tick evicted on overflow).
// State serializer is consumer-provided (the engine doesn't know the
// shape of game state). Inputs are stored verbatim per-tick.
//
// Pure logic. Consumer wires the actual replay loop (this primitive
// just gives them the data needed). Pairs with PresenceTracker (1.7.0)
// for round-trip ping; with AuthorityHandoff (1.7.3) for who emits
// authoritative state.
//
// Code style: var-only in browser source.
export class LagCompensation {
    snapshots = [];
    inputs = [];
    historySize;
    serialize;
    constructor(opts) {
        this.historySize = (typeof opts.historySize === 'number' && opts.historySize > 0)
            ? Math.floor(opts.historySize) : 60;
        this.serialize = opts.stateSerialize || null;
    }
    static create(opts = {}) {
        return new LagCompensation(opts);
    }
    // Record a state snapshot at `tick`. Replaces any prior snapshot at
    // the same tick. Maintains tick-ascending order.
    recordState(tick, state) {
        if (typeof tick !== 'number' || !isFinite(tick))
            return;
        var stored = this.serialize ? this.serialize(state) : state;
        // Replace existing same-tick or insert sorted
        var i = this.findSnapshotIndex(tick);
        if (i >= 0 && this.snapshots[i].tick === tick) {
            this.snapshots[i].state = stored;
        }
        else {
            // Insert after i (last <= tick)
            this.snapshots.splice(i + 1, 0, { tick: tick, state: stored });
        }
        this.evictOldSnapshots(tick);
    }
    // Record an input at `tick`. Multiple inputs at the same tick are
    // ALLOWED and preserved in insertion order.
    recordInput(tick, input) {
        if (typeof tick !== 'number' || !isFinite(tick))
            return;
        // Append; if insertion order vs tick order conflicts, sort.
        var last = this.inputs[this.inputs.length - 1];
        if (!last || last.tick <= tick) {
            this.inputs.push({ tick: tick, input: input });
        }
        else {
            // Out-of-order arrival; insert sorted
            var idx = this.findInputInsertIndex(tick);
            this.inputs.splice(idx, 0, { tick: tick, input: input });
        }
        this.evictOldInputs(tick);
    }
    // Find the snapshot AT or just before `tick`, plus all inputs
    // AFTER that snapshot's tick (up to the most-recent input).
    // Returns null if no snapshot at-or-before tick exists.
    rewind(tick) {
        if (typeof tick !== 'number' || !isFinite(tick))
            return null;
        var i = this.findSnapshotIndex(tick);
        if (i < 0)
            return null; // no snapshot at-or-before
        var snap = this.snapshots[i];
        var inputsAfter = [];
        for (var j = 0; j < this.inputs.length; j++) {
            var inp = this.inputs[j];
            if (inp.tick > snap.tick)
                inputsAfter.push(inp);
        }
        return { snapshot: snap, inputs: inputsAfter };
    }
    // Authoritative resync. Drops all snapshots + inputs at or before
    // `tick`, replaces with the new authoritative snapshot, returns the
    // remaining inputs (those AFTER tick) so consumer can re-apply.
    resync(tick, authoritativeState) {
        if (typeof tick !== 'number' || !isFinite(tick))
            return [];
        // Drop snapshots at or before tick
        this.snapshots = this.snapshots.filter(function (s) { return s.tick > tick; });
        // Insert the authoritative snapshot at the head
        var stored = this.serialize ? this.serialize(authoritativeState) : authoritativeState;
        this.snapshots.unshift({ tick: tick, state: stored });
        this.snapshots.sort(function (a, b) { return a.tick - b.tick; });
        // Inputs AFTER tick survive; inputs at or before are dropped
        var remaining = this.inputs.filter(function (inp) { return inp.tick > tick; });
        this.inputs = remaining;
        return remaining.slice();
    }
    // Read-only inspection.
    snapshotCount() { return this.snapshots.length; }
    inputCount() { return this.inputs.length; }
    oldestSnapshotTick() {
        return this.snapshots.length > 0 ? this.snapshots[0].tick : null;
    }
    newestSnapshotTick() {
        return this.snapshots.length > 0
            ? this.snapshots[this.snapshots.length - 1].tick : null;
    }
    newestInputTick() {
        return this.inputs.length > 0
            ? this.inputs[this.inputs.length - 1].tick : null;
    }
    getHistorySize() { return this.historySize; }
    setHistorySize(n) {
        if (typeof n === 'number' && n > 0) {
            this.historySize = Math.floor(n);
            var newest = this.newestSnapshotTick();
            if (newest !== null)
                this.evictOldSnapshots(newest);
            var newestI = this.newestInputTick();
            if (newestI !== null)
                this.evictOldInputs(newestI);
        }
    }
    clear() {
        this.snapshots.length = 0;
        this.inputs.length = 0;
    }
    // ---------- private ----------
    // Find largest index i such that snapshots[i].tick <= tick.
    // Returns -1 if no such snapshot.
    findSnapshotIndex(tick) {
        var lo = 0, hi = this.snapshots.length - 1, ans = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >>> 1;
            if (this.snapshots[mid].tick <= tick) {
                ans = mid;
                lo = mid + 1;
            }
            else {
                hi = mid - 1;
            }
        }
        return ans;
    }
    findInputInsertIndex(tick) {
        var lo = 0, hi = this.inputs.length;
        while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (this.inputs[mid].tick <= tick)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    }
    evictOldSnapshots(currentTick) {
        var minTick = currentTick - this.historySize;
        while (this.snapshots.length > 0
            && this.snapshots[0].tick < minTick) {
            this.snapshots.shift();
        }
    }
    evictOldInputs(currentTick) {
        var minTick = currentTick - this.historySize;
        while (this.inputs.length > 0
            && this.inputs[0].tick < minTick) {
            this.inputs.shift();
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_LAG_COMPENSATION = 'lag_compensation';
//# sourceMappingURL=lag-compensation.js.map