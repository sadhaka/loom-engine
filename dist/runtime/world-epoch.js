// world-epoch.ts - the deterministic between-session Epoch world-tick.
//
// 3.0 Phase 3 (Living Persistent World). While a player is offline, the world
// must keep moving - factions act, regions shift - WITHOUT the player's session
// PRNG and WITHOUT any non-determinism, so the browser client and the
// authoritative server arrive at the BYTE-IDENTICAL world-state hash for the
// same epoch. This module is that engine: a bounded, fail-closed tick loop whose
// every random draw comes from an Epoch PRNG derived purely from PUBLIC inputs.
//
// THE THREE GUARANTEES (all cross-language byte-parity, pinned by
// test_vectors/v3_3_epoch_tick.json):
//
//   1. PRNG ISOLATION. The Epoch PRNG is seeded from SHA-256(UTF8(world_id) ||
//      LE64(epoch_number)) - a fresh, public derivation that NEVER touches the
//      session/combat PRNG. Bytes 0-7 of the digest (LE) are the PCG state, bytes
//      8-15 (LE, forced odd) are the increment. Any surface reproduces it from
//      (world_id, epoch) alone; the keyed world-state hash - not the seed - is the
//      anti-cheat anchor.
//
//   2. DETERMINISTIC ORDER + FAIL-CLOSED RESOLUTION. Offline actors are the
//      entities tagged with an actor tag; they resolve in compareIds order (the
//      numeric-aware id sort already pinned across surfaces). Each actor's proposed
//      action is resolved through the Phase 2 ruleset AST. A proposal that names an
//      unknown action, or whose AST fails validation, or that errors mid-eval is
//      REJECTED and consumes ZERO prng + ZERO state change (prng snapshot/restore +
//      the AST's clone-not-mutate contract). Reason codes are assigned by THIS code
//      at fixed decision points - never parsed from exception text - so they are
//      identical on every surface.
//
//   3. BOUNDED COST. tickEpoch caps SUCCESSFUL resolutions at max_actions (the
//      Veil-Ceiling guard - an offline loop cannot mint unbounded wealth);
//      catchUpEpochs caps the number of epochs replayed at max_catchup (excess
//      offline time is "lost to the void"). Both limits are PARAMETERS, never
//      hardcoded - the generic engine is content/economy-agnostic.
//
// IP BOUNDARY. PUBLIC (this module): the SHA-256 seed protocol, the tick/catch-up
// orchestration, the EpochResolved canonical event framing, the compareIds actor
// sort. TWT-PRIVATE (never here): the Director prompts that GENERATE the
// WorldActionProposals, the concrete limit values (max_actions, max_catchup, the
// actor tag names), and the proprietary faction/region action ASTs - all supplied
// by the caller as parameters/data.
//
// Code style: var-only in browser source (matches pcg32.ts / ruleset-ast.ts).
import { Pcg32 } from './pcg32.js';
import { sha256Bytes } from './hmac-sha256.js';
import { compareIds } from './ruleset.js';
import { evaluateAction, applyTriggeredMutations, validateCheck, validateTriggeredMutations } from './ruleset-ast.js';
import { assertCleanString } from './event-chain.js';
var MASK64 = (1n << 64n) - 1n;
// The default tag marking an entity that acts while the owner is offline. Generic
// (no game-specific term); a caller passes its own set (e.g. ['faction',
// 'acts_offline']) via TickEpochInput.actorTags.
export var DEFAULT_ACTOR_TAG = 'acts_offline';
// The fixed reason vocabulary. Assigned by THIS code (never from exception text),
// so every surface emits the same string for the same input.
//   unknown_action - proposal.actionId not in the ruleset
//   invalid_action - the action AST fails fail-closed validation
//   eval_error     - the action threw during evaluation (e.g. missing target ref,
//                    integer overflow); prng + state are rolled back
var REASON_UNKNOWN_ACTION = 'unknown_action';
var REASON_INVALID_ACTION = 'invalid_action';
var REASON_EVAL_ERROR = 'eval_error';
//   malformed_proposal - the proposal object lacks a non-empty string actionId
var REASON_MALFORMED_PROPOSAL = 'malformed_proposal';
// ---- Epoch PRNG derivation -------------------------------------------------
// Serialize an i64 as exactly 8 little-endian bytes (two's complement for
// negatives). Endianness is FIXED here, independent of machine endianness, so
// WASM (LE) and a big-endian host agree. Matches Python int.to_bytes(8,'little',
// signed=True) and Rust i64::to_le_bytes.
function le64Signed(n) {
    var u = n & MASK64; // two's-complement wrap into the unsigned 64-bit range
    var b = new Uint8Array(8);
    for (var i = 0; i < 8; i++) {
        b[i] = Number(u & 0xffn);
        u = u >> 8n;
    }
    return b;
}
// Read 8 little-endian bytes at off as an unsigned 64-bit BigInt.
function readLeU64(bytes, off) {
    var v = 0n;
    for (var i = 7; i >= 0; i--) {
        v = (v << 8n) | BigInt(bytes[off + i]);
    }
    return v;
}
// Derive the Epoch PRNG for (world_id, epoch_number). PUBLIC + deterministic: any
// surface computes the same PRNG from these two inputs. See the module header for
// the exact byte protocol.
export function deriveEpochPrng(worldId, epochNumber) {
    assertCleanString(worldId);
    if (!Number.isSafeInteger(epochNumber)) {
        throw new Error('world-epoch: epoch_number must be a JS-safe integer');
    }
    var idBytes = new TextEncoder().encode(worldId);
    var epochBytes = le64Signed(BigInt(epochNumber));
    var msg = new Uint8Array(idBytes.length + 8);
    msg.set(idBytes, 0);
    msg.set(epochBytes, idBytes.length);
    var digest = sha256Bytes(msg);
    var state = readLeU64(digest, 0);
    var inc = readLeU64(digest, 8) | 1n;
    return Pcg32.fromRaw(state, inc);
}
// ---- Helpers ---------------------------------------------------------------
// Record an AppliedMutation as a canonical object - only the PRESENT fields, in no
// particular order (canonicalJson sorts keys). Mirrors the AST's deterministic
// field-presence, so every surface serializes the same key set.
function serializeMutations(applied) {
    var out = [];
    for (var i = 0; i < applied.length; i++) {
        var m = applied[i];
        var o = { op: m.op, target: m.target };
        if (m.property !== undefined)
            o.property = m.property;
        if (m.tag !== undefined)
            o.tag = m.tag;
        if (m.previous !== undefined)
            o.previous = m.previous;
        if (m.next !== undefined)
            o.next = m.next;
        out.push(o);
    }
    return out;
}
// Shallow top-level clone of a world state with epoch replaced. Entities/regions
// references are shared but never mutated here, so the returned state is safe to
// hash and independent of the caller's `epoch` field.
function withEpoch(state, epochNumber) {
    var out = {};
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        out[k] = state[k];
    }
    out['epoch'] = epochNumber;
    return out;
}
function entityHasActorTag(tags, actorTags) {
    if (!Array.isArray(tags))
        return false;
    for (var i = 0; i < tags.length; i++) {
        for (var j = 0; j < actorTags.length; j++) {
            if (tags[i] === actorTags[j])
                return true;
        }
    }
    return false;
}
// Resolve one offline epoch. Pure: does not mutate input.state. Returns the new
// state (epoch advanced) + the canonical EpochResolved event for the chain.
export function tickEpoch(input) {
    assertCleanString(input.worldId);
    if (!Number.isSafeInteger(input.epochNumber)) {
        throw new Error('world-epoch: epoch_number must be a JS-safe integer');
    }
    var actorTags = (input.actorTags && input.actorTags.length > 0) ? input.actorTags : [DEFAULT_ACTOR_TAG];
    // maxActions: absent -> no cap; present -> MUST be a non-negative JS-safe integer
    // (a fractional / negative cap must not be silently accepted - Codex P1).
    if (input.maxActions !== undefined
        && (!Number.isSafeInteger(input.maxActions) || input.maxActions < 0)) {
        throw new Error('world-epoch: maxActions must be a non-negative JS-safe integer');
    }
    var maxActions = input.maxActions === undefined ? Number.MAX_SAFE_INTEGER : input.maxActions;
    var prng = deriveEpochPrng(input.worldId, input.epochNumber);
    // Identify offline actors, then sort by the numeric-aware id comparator so the
    // resolution order (and thus the PRNG draw order) is byte-identical everywhere.
    var entities = input.state.entities || {};
    var ids = Object.keys(entities);
    var actors = [];
    for (var i = 0; i < ids.length; i++) {
        var ent = entities[ids[i]];
        if (ent && entityHasActorTag(ent.tags, actorTags))
            actors.push(ids[i]);
    }
    actors.sort(compareIds);
    var work = input.state;
    var entries = [];
    var resolved = 0;
    var rejected = 0;
    for (var a = 0; a < actors.length; a++) {
        if (resolved >= maxActions)
            break; // Veil-Ceiling guard - stop after the cap
        var actorId = actors[a];
        var proposal = input.proposals[actorId];
        if (!proposal)
            continue; // no proposal -> the actor idles (not counted, not listed)
        // Malformed proposal (missing / non-string / empty actionId): a FIXED-schema
        // rejection with action_id '' + zero prng - NOT an undefined action_id (which
        // drops from canonical JSON) and NOT a crash (Codex P1). Distinct from "no
        // proposal" above (which idles silently).
        var actionId = proposal.actionId;
        if (typeof actionId !== 'string' || actionId.length === 0) {
            entries.push({ action_id: '', actor_id: actorId, reason: REASON_MALFORMED_PROPOSAL });
            rejected = rejected + 1;
            continue;
        }
        var action = input.ruleset[actionId];
        // (1) unknown action - no prng, no state change.
        if (!action) {
            entries.push({ action_id: actionId, actor_id: actorId, reason: REASON_UNKNOWN_ACTION });
            rejected = rejected + 1;
            continue;
        }
        // (1b) unknown action KIND - only 'check' / 'mutations' execute. A typo'd kind
        // must NOT be silently run as a mutation action (Codex P1, fail-closed).
        if (action.kind !== 'check' && action.kind !== 'mutations') {
            entries.push({ action_id: actionId, actor_id: actorId, reason: REASON_INVALID_ACTION });
            rejected = rejected + 1;
            continue;
        }
        // (2) fail-closed validation BEFORE any prng draw. Reason assigned here, not
        // parsed from the throw, so it is surface-stable.
        try {
            if (action.kind === 'check')
                validateCheck(action.check);
            else
                validateTriggeredMutations(action.mutations);
        }
        catch (eValidate) {
            entries.push({ action_id: actionId, actor_id: actorId, reason: REASON_INVALID_ACTION });
            rejected = rejected + 1;
            continue;
        }
        // (3) resolve. Snapshot the prng first; on ANY throw, roll it back to zero
        // draws (the AST clones state, so a failed resolve never mutated `work`).
        var snap = prng.snapshot();
        try {
            var ctx = { state: work, actorId: actorId, targetId: proposal.targetId, rng: prng, naturalRoll: null };
            var degree = 'none';
            var applied;
            if (action.kind === 'check') {
                var res = evaluateAction(work, action.check, ctx);
                work = res.state;
                degree = res.degree;
                applied = res.mutations;
            }
            else {
                var res2 = applyTriggeredMutations(work, action.mutations, ctx);
                work = res2.state;
                applied = res2.mutations;
            }
            entries.push({ action_id: actionId, actor_id: actorId, degree: degree, mutations_applied: serializeMutations(applied) });
            resolved = resolved + 1;
        }
        catch (eEval) {
            prng.restore(snap); // zero prng consumed for a rejected proposal
            entries.push({ action_id: actionId, actor_id: actorId, reason: REASON_EVAL_ERROR });
            rejected = rejected + 1;
        }
    }
    var outState = withEpoch(work, input.epochNumber);
    var event = {
        event_type: 'EpochResolved',
        epoch_number: input.epochNumber,
        actions_processed: entries,
        pcg_steps_consumed: prng.getDraws(),
    };
    return { state: outState, event: event, resolved: resolved, rejected: rejected };
}
// Deterministically replay offline epochs from state.epoch up to currentEpoch,
// capped at maxCatchup. The first `capped` epochs after the client epoch are
// resolved (epochs beyond the cap are voided), so the result depends only on
// (state, capped, proposals) - never on the wall clock directly.
export function catchUpEpochs(input) {
    if (!Number.isSafeInteger(input.currentEpoch)) {
        throw new Error('world-epoch: currentEpoch must be a JS-safe integer');
    }
    if (!Number.isSafeInteger(input.maxCatchup) || input.maxCatchup < 0) {
        throw new Error('world-epoch: maxCatchup must be a non-negative JS-safe integer');
    }
    var clientEpoch = input.state.epoch;
    var target = input.currentEpoch - clientEpoch;
    if (target <= 0) {
        return { state: input.state, events: [], epochsResolved: 0, epochsVoided: 0 };
    }
    var capped = target > input.maxCatchup ? input.maxCatchup : target;
    var work = input.state;
    var events = [];
    for (var i = 1; i <= capped; i++) {
        var epochN = clientEpoch + i;
        var proposals = (input.proposalsByEpoch && input.proposalsByEpoch[String(epochN)]) || {};
        var r = tickEpoch({
            worldId: input.worldId,
            state: work,
            epochNumber: epochN,
            proposals: proposals,
            ruleset: input.ruleset,
            actorTags: input.actorTags,
            maxActions: input.maxActions,
        });
        work = r.state;
        events.push(r.event);
    }
    return { state: work, events: events, epochsResolved: capped, epochsVoided: target - capped };
}
// Resource key for the world's resource registry.
export var RESOURCE_WORLD_EPOCH = 'world_epoch';
//# sourceMappingURL=world-epoch.js.map