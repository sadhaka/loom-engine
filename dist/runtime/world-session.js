// world-session.ts - the WorldSession suspend/resume lifecycle (v3.0 Phase 4).
//
// The capstone of the Living Persistent World: it ties the four deterministic
// primitives - the HMAC event-chain (event-chain.ts), the world-state snapshot
// (world-state-snapshot.ts), and the Epoch world-tick (world-epoch.ts) - into ONE
// fail-closed suspend/resume flow. A world is packed into a verifiable bundle on
// suspend; on resume the engine verifies the snapshot, verifies + replays the
// event-chain tail, then fast-forwards offline epochs - and the resumed world hash
// is byte-identical across TypeScript, Python, Rust, and WASM.
//
// THE DESIGN (reconciled with the Pantheon's Phase-4 blueprint):
//
//   * EVENT-SOURCED from the latest snapshot. The snapshot caps replay cost; the
//     chain tail (events written after the snapshot but before suspend/crash) is
//     replayed to recover the true head. The chain - not the snapshot - is the
//     tamper-evident source of truth.
//
//   * THE REDUCER REPLAYS RECORDED MUTATIONS, IT DOES NOT RE-RUN THE AST. An
//     EpochResolved event carries the exact mutations_applied it produced. Replay
//     applies THOSE (prop -> set to the recorded `next`; tags -> the SAME
//     normalizeTags/filter the AST used). Re-running tickEpoch would diverge if the
//     ruleset was re-balanced after the event was written - the chain records what
//     HAPPENED, not what the current rules would do.
//
//   * FAIL-CLOSED, STRICT ORDER. (1) snapshot hash; (2) load; (3) tail chain HMAC;
//     (4) reduce; (5) bound catch-up (reject time-travel); (6) tick. Any integrity
//     failure throws before the world is trusted.
//
// IP BOUNDARY. PUBLIC (this module): the WorldBundle schema, the suspend/resume
// orchestration, the reducer, the verification loop. TWT-PRIVATE: the persistence
// store, the Director that generates proposals, and the concrete maxCatchup/maxActions
// economy limits (all passed in as parameters/data).
//
// Code style: var-only in browser source.
import { EventChain } from './event-chain.js';
import { worldStateHash, verifyWorldSnapshot, normalizeTags } from './world-state-snapshot.js';
import { catchUpEpochs } from './world-epoch.js';
// ---- the reducer: replay a recorded EpochResolved event --------------------
function ensureEnt(state, id) {
    var ent = state.entities[id];
    if (!ent) {
        ent = { properties: {}, tags: [] };
        state.entities[id] = ent;
    }
    return ent;
}
// Apply ONE recorded mutation. Mirrors the AST's applyMutation EXACTLY: a prop op
// stores the recorded `next` (the AST already computed prev+/-value); a tag op uses
// the SAME normalizeTags(concat) / filter the AST used, so the resulting tags array
// (whose ORDER the hash depends on) is reproduced byte-for-byte.
function applySerializedMutation(state, m) {
    var ent = ensureEnt(state, m.target);
    if (m.op === 'add_tag') {
        if (typeof m.tag === 'string')
            ent.tags = normalizeTags(ent.tags.concat([m.tag]));
    }
    else if (m.op === 'remove_tag') {
        var tag = m.tag;
        ent.tags = ent.tags.filter(function (t) { return t !== tag; });
    }
    else if (typeof m.property === 'string' && typeof m.next === 'number') {
        // set_prop / add_prop / sub_prop - the recorded `next` IS the post-value.
        ent.properties[m.property] = m.next;
    }
}
// Faithful structural clone (state is integer/string/plain-object/array only).
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}
// Replay one EpochResolved event onto a state (the reducer). Pure: returns a new
// state. Sets epoch = the event's epoch_number.
export function replayEpochEvent(state, event) {
    var work = cloneState(state);
    var entries = (event && event.actions_processed) ? event.actions_processed : [];
    for (var i = 0; i < entries.length; i++) {
        var muts = entries[i].mutations_applied;
        if (Array.isArray(muts)) {
            for (var j = 0; j < muts.length; j++)
                applySerializedMutation(work, muts[j]);
        }
    }
    work.epoch = event.epoch_number;
    return work;
}
// Pack a world into a verifiable bundle. The tail is every chain record after the
// snapshot index; tailGenesis is the head signature at that index (so the tail
// links cleanly under verifyRecords on resume).
export function suspend(input) {
    var records = input.chain.list();
    var tail = [];
    for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec && rec.seq > input.snapshotEventIndex)
            tail.push(rec);
    }
    var firstTail = tail[0];
    var tailGenesis = firstTail ? firstTail.prevSig : input.chain.head();
    return {
        worldId: input.worldId,
        snapshot: {
            eventIndex: input.snapshotEventIndex,
            stateHash: worldStateHash(input.key, input.snapshotState),
            state: input.snapshotState,
        },
        chainTail: tail,
        tailGenesis: tailGenesis,
    };
}
// Reconstruct + verify + fast-forward a world from a bundle. Fail-closed at every
// integrity gate. Deterministic: given the same (bundle, currentEpoch,
// proposalsByEpoch), the result is byte-identical on every surface.
export function resume(input) {
    var b = input.bundle;
    // (1) snapshot integrity - constant-time hash compare.
    if (!verifyWorldSnapshot(input.key, b.snapshot.state, b.snapshot.stateHash)) {
        throw new Error('world-session: corrupted snapshot (state hash mismatch)');
    }
    // (2) load the verified snapshot into the working state.
    var work = cloneState(b.snapshot.state);
    // (3) tail chain integrity - verify HMAC signatures + linkage against the anchor.
    var tail = b.chainTail || [];
    if (tail.length > 0) {
        var res = EventChain.verifyRecords(input.key, tail, b.tailGenesis);
        if (!res.ok) {
            throw new Error('world-session: chain tamper detected in tail');
        }
    }
    // (4) reducer - replay the recorded events (NOT the AST) to recover the head.
    for (var i = 0; i < tail.length; i++) {
        var rec = tail[i];
        if (rec)
            work = replayEpochEvent(work, rec.payload);
    }
    // (5) catch-up bounding - reject time travel (a clock behind the world state).
    if (!Number.isSafeInteger(input.currentEpoch)) {
        throw new Error('world-session: currentEpoch must be a JS-safe integer');
    }
    if (input.currentEpoch < work.epoch) {
        throw new Error('world-session: time travel detected (currentEpoch < state.epoch)');
    }
    // (6) deterministic offline catch-up (bounded by maxCatchup; excess voided).
    var caught = catchUpEpochs({
        worldId: b.worldId,
        state: work,
        currentEpoch: input.currentEpoch,
        maxCatchup: input.maxCatchup,
        ruleset: input.ruleset,
        proposalsByEpoch: input.proposalsByEpoch,
        actorTags: input.actorTags,
        maxActions: input.maxActions,
    });
    return {
        worldId: b.worldId,
        state: caught.state,
        newEvents: caught.events,
        epochsResolved: caught.epochsResolved,
        epochsVoided: caught.epochsVoided,
    };
}
// Resource key for the world's resource registry.
export var RESOURCE_WORLD_SESSION = 'world_session';
//# sourceMappingURL=world-session.js.map