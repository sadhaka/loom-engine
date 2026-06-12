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
//   * FAIL-CLOSED, STRICT ORDER. (1) snapshot hash; (2) load; (3) chain seal +
//     tail chain HMAC; (4) reduce; (5) bound catch-up (reject time-travel);
//     (6) tick. Any integrity failure throws before the world is trusted.
//
//   * THE STRUCTURAL SEAL (the format-v2 component of the current v3 bundle).
//     A bare hash chain cannot see
//     records dropped off its END, so a pre-seal bundle whose chainTail lost its
//     trailing records verified clean and the lost events were silently replaced
//     by re-simulated catch-up. The bundle CARRIES the chain's ChainSeal:
//     suspend() signs the (count, head) commitment via EventChain.seal(), and
//     resume() rejects any bundle whose seal is missing, forged, or disagrees
//     with the tail (head or count). No compatibility escape hatch.
//
//   * THE BUNDLE BINDING (bundle format v3 - BREAKING; Codex audit P1). The seal
//     signs only (count, head), which left a forge: the snapshot hash binds the
//     STATE but not its claimed chain POSITION, so a forger could rewrite
//     snapshot.eventIndex + tailGenesis together to drop the LEADING prefix of
//     the tail (every structural check still passed; the dropped record's
//     mutations were silently lost), or splice a snapshot from another world.
//     suspend() now also signs a BINDING over worldId + snapshot.stateHash +
//     eventIndex + tailGenesis + (count, head) via EventChain.bindBundle();
//     resume() re-derives it and rejects fail-closed on any mismatch, closing
//     both forges. resume() also takes an optional expectedWorldId so a caller
//     can refuse a cross-world bundle outright. The prior KNOWN RESIDUAL is
//     resolved.
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
// links cleanly under verifyRecords on resume); the seal is the chain's signed
// (count, head) commitment so resume() can detect an end-truncated tail.
// FAIL-CLOSED: snapshotEventIndex is validated against the chain's last seq -
// an index past the end would yield a bundle claiming a snapshot at a
// nonexistent event (and a tail/seal accounting that can never verify).
export function suspend(input) {
    var idx = input.snapshotEventIndex;
    if (typeof idx !== 'number' || !Number.isSafeInteger(idx) || idx < 0) {
        throw new Error('world-session: snapshotEventIndex must be a JS-safe integer >= 0');
    }
    var records = input.chain.list();
    var lastRec = records.length > 0 ? records[records.length - 1] : null;
    var lastSeq = lastRec ? lastRec.seq : 0;
    if (idx > lastSeq) {
        throw new Error('world-session: snapshotEventIndex ' + idx
            + ' is past the end of the chain (last seq ' + lastSeq
            + ') - the snapshot would claim a nonexistent event');
    }
    var tail = [];
    for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec && rec.seq > idx)
            tail.push(rec);
    }
    // Seal/index alignment: the resume-side invariant is seal.count ==
    // snapshot.eventIndex + chainTail.length, which holds only when exactly idx
    // records sit at-or-before the snapshot index (dense 1-based seqs - what
    // append() produces). A chain with gapped/odd seq numbering cannot be packed
    // into a bundle that verifies, so refuse to produce one.
    if (records.length - tail.length !== idx) {
        throw new Error('world-session: snapshotEventIndex ' + idx
            + ' does not align with the chain seq numbering ('
            + (records.length - tail.length) + ' records at or before it)');
    }
    var firstTail = tail[0];
    var tailGenesis = firstTail ? firstTail.prevSig : input.chain.head();
    var stateHash = worldStateHash(input.key, input.snapshotState);
    return {
        worldId: input.worldId,
        snapshot: {
            eventIndex: idx,
            stateHash: stateHash,
            state: input.snapshotState,
        },
        chainTail: tail,
        tailGenesis: tailGenesis,
        seal: input.chain.seal(),
        // v3: bind the identity fields the seal does not cover (Codex audit P1).
        binding: input.chain.bindBundle(input.worldId, stateHash, idx, tailGenesis),
    };
}
// Reconstruct + verify + fast-forward a world from a bundle. Fail-closed at every
// integrity gate. Deterministic: given the same (bundle, currentEpoch,
// proposalsByEpoch), the result is byte-identical on every surface.
export function resume(input) {
    var b = input.bundle;
    // (0) shape + identity gates (Codex audit P1/P2), fail-closed and BEFORE any
    // crypto so a malformed bundle is rejected cheaply and identically on every
    // surface.
    // (0a) expectedWorldId: a caller that named its world refuses any other.
    if (input.expectedWorldId !== undefined && b.worldId !== input.expectedWorldId) {
        throw new Error('world-session: bundle worldId does not match expectedWorldId'
            + ' (cross-world or cross-path bundle rejected)');
    }
    // (0b) chainTail MUST be an array (Rust/Python treated a non-array as empty;
    // TS rejected via NaN - make the rejection explicit and identical).
    if (b.chainTail !== undefined && !Array.isArray(b.chainTail)) {
        throw new Error('world-session: chainTail must be an array');
    }
    // (0c) WorldState shape: entities MUST be an object. The audit found Rust
    // no-opped a malformed state (entities not an object) while TS/Python threw -
    // fail-closed is the canonical contract, so validate it explicitly here.
    if (!b.snapshot || !b.snapshot.state || typeof b.snapshot.state !== 'object'
        || b.snapshot.state.entities === null
        || typeof b.snapshot.state.entities !== 'object'
        || Array.isArray(b.snapshot.state.entities)) {
        throw new Error('world-session: snapshot.state.entities must be an object'
            + ' (malformed WorldState rejected fail-closed)');
    }
    // (1) snapshot integrity - constant-time hash compare.
    if (!verifyWorldSnapshot(input.key, b.snapshot.state, b.snapshot.stateHash)) {
        throw new Error('world-session: corrupted snapshot (state hash mismatch)');
    }
    // (2) load the verified snapshot into the working state.
    var work = cloneState(b.snapshot.state);
    // (3) chain seal + tail chain integrity - FAIL-CLOSED, no escape hatch.
    //
    // (3a) the structural seal. A bare hash chain cannot see records dropped off
    // its END, so before trusting the tail at all, the bundle must carry a valid
    // ChainSeal and the tail must MATCH it: the sealed head is the last tail
    // record's sig (or tailGenesis when the snapshot is current), and the sealed
    // count equals snapshot.eventIndex + chainTail.length. Pre-seal bundles are
    // rejected outright - re-suspend with the current engine.
    var tail = b.chainTail || [];
    var seal = b.seal;
    if (!seal || typeof seal !== 'object') {
        throw new Error('world-session: bundle carries no chain seal'
            + ' (pre-seal bundle format rejected; re-suspend with the current engine)');
    }
    if (!EventChain.verifySeal(input.key, seal)) {
        throw new Error('world-session: chain seal signature invalid (forged seal or wrong key)');
    }
    if (!Number.isSafeInteger(b.snapshot.eventIndex) || b.snapshot.eventIndex < 0) {
        throw new Error('world-session: snapshot.eventIndex must be a JS-safe integer >= 0');
    }
    // (3a-bind) THE FORGE GATE (Codex audit P1): the seal signs only (count,
    // head), which a forger satisfies by dropping the leading tail prefix and
    // rewriting eventIndex + tailGenesis (no key needed). The binding signs all of
    // worldId + stateHash + eventIndex + tailGenesis + count + head, so any such
    // rewrite - or a cross-world snapshot/tail splice - fails here. Verified
    // BEFORE the head/count structural checks the forger is able to pass.
    if (!EventChain.verifyBundleBinding(input.key, b.worldId, b.snapshot.stateHash, b.snapshot.eventIndex, b.tailGenesis, seal.count, seal.head, b.binding)) {
        throw new Error('world-session: bundle binding invalid'
            + ' (worldId / eventIndex / tailGenesis rewritten, or cross-world splice - forge detected)');
    }
    var lastTail = tail.length > 0 ? tail[tail.length - 1] : null;
    var tailHead = lastTail ? lastTail.sig : b.tailGenesis;
    if (seal.head !== tailHead) {
        throw new Error('world-session: chain tail head does not match the seal'
            + ' (trailing records dropped or replaced - end-truncation detected)');
    }
    if (seal.count !== b.snapshot.eventIndex + tail.length) {
        throw new Error('world-session: chain tail length does not match the seal'
            + ' (sealed count ' + seal.count + ' != eventIndex ' + b.snapshot.eventIndex
            + ' + tail ' + tail.length + ')');
    }
    // (3b) per-record HMAC signatures + linkage against the anchor.
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