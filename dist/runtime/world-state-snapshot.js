// WorldStateSnapshot - deterministic, cross-language world-state hashing.
//
// 3.0 Phase 1 primitive (Living Persistent World). The integrity anchor for
// persistence + replay: a WorldState is reduced to a single state_hash that is
// BYTE-IDENTICAL across TypeScript, Python, and Rust, so a snapshot taken at a
// known event index can be (a) persisted compactly, (b) verified against the
// HMAC event chain on resume, and (c) compared across languages to prove no
// surface diverged. Replay then reconstructs the world by loading the latest
// VERIFIED snapshot and re-applying only the events after it - far cheaper than
// replaying from genesis, and provably equivalent because the state_hash must
// match.
//
// REUSE, do not re-implement. This builds entirely on the audited,
// golden-vector-pinned primitives from event-chain.ts + hmac-sha256.ts:
//   - canonicalJson(): the strict, injective, integer-only canonical encoder
//     (UTF-16 object-key sort, -0 / NaN / Infinity / unsafe-int / non-plain-object
//     / __proto__ / lone-surrogate rejection, depth cap). Its byte-parity across
//     TS / Python / Rust is pinned by test_vectors/event_chain_v1.json.
//   - field(): the length-prefixed ('<len>:<value>', len in UTF-16 code units)
//     self-delimiting framing - injective, so no value can forge a field boundary.
//   - hmacSha256Hex(): hand-rolled FIPS 180-4 HMAC-SHA-256.
// Building on these means loom_snapshot inherits their cross-language byte-parity
// for free and adds NO new divergence surface.
//
//   var snap = snapshotWorldState({
//     key: runtimeSecret,
//     eventIndex: 1024,                         // version metadata, NOT hashed
//     state: { epoch: 3, worldSeed: 42, entities: { ... } },
//   });
//   // -> { eventIndex: 1024, stateHash: '7f3c...' }
//
//   verifyWorldSnapshot(key, state, snap.stateHash);   // -> true (constant-time)
//
// DESIGN NOTES (reconciled with the Pantheon, 2026-06-05):
//   - The state_hash is a PURE content hash of the canonical state. The
//     eventIndex is version metadata stored alongside (event-sourcing norm), NOT
//     folded into the hash, so the same world hashes identically wherever it sits.
//   - ONE sort rule everywhere: UTF-16 code units. Object keys are sorted by
//     canonicalJson (UTF-16); tags are sorted by normalizeTags (UTF-16, the same
//     comparator). Mixing a second rule (e.g. UTF-8 for tags) would re-open the
//     exact key-vs-element divergence the cross-language audit warns about.
//   - Ids are string keys, sorted by canonicalJson's UTF-16 order. If numeric
//     VALUE ordering is ever required (2 before 10), upgrade to an entry-array
//     encoded with the numeric-aware compare_ids rule - it does not change hash
//     correctness, only canonical-form readability.
//   - The WorldState passed in MUST contain only persistent, canonical state -
//     no transient / cache / runtime-derived fields, unless every language
//     surface derives them identically. canonicalJson is fail-closed: any
//     non-canonical value throws before a hash is produced.
//   - PARITY REQUIREMENT for the Python surface: it MUST canonicalize via the
//     engine encoder (Rust core through PyO3, or a UTF-16-sorting port) - NOT
//     json.dumps(sort_keys=True), which sorts by Unicode code point and diverges
//     from JS UTF-16 on astral characters.
//
// Domain separation: the snapshot HMAC is tagged SNAPSHOT_DOMAIN, a namespace
// distinct from the event-chain record ('loom.chain.rec/1') and seal
// ('loom.chain.seal/1') domains, so a snapshot hash can never be reinterpreted
// as a chain-record signature, or vice versa.
//
// Code style: var-only in browser source (matches event-chain.ts).
import { canonicalJson, field } from './event-chain.js';
import { hmacSha256Hex, timingSafeEqualHex } from './hmac-sha256.js';
// Namespace tag for snapshot HMACs. The trailing /1 is a format version for
// future migrations. Distinct from the chain record / seal domains.
export const SNAPSHOT_DOMAIN = 'loom.snapshot/1';
// Deterministically de-duplicate + sort a tag list by UTF-16 code unit (the
// String default sort - the SAME ordering canonicalJson uses for object keys).
// Use before building a WorldEntity so tag insertion order never affects the
// hash. Rust must sort tags with the encode_utf16 comparator (not native
// str Ord, which is UTF-8 bytes); Python with a UTF-16 key (not native code
// point) - the parity tests pin this.
export function normalizeTags(tags) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < tags.length; i++) {
        var t = tags[i];
        if (typeof t !== 'string') {
            throw new Error('WorldStateSnapshot: tag must be a string');
        }
        if (!seen[t]) {
            seen[t] = true;
            out.push(t);
        }
    }
    out.sort();
    return out;
}
// The exact (injective) string fed to HMAC for a snapshot. Length-prefixed +
// domain-separated via the engine's field(), identical discipline to
// event-chain's canonicalMessage, so it is injective: no state encoding can
// forge a field boundary. The eventIndex is intentionally NOT included - the
// hash is a pure function of the state.
function snapshotMessage(state) {
    return field(SNAPSHOT_DOMAIN) + field(canonicalJson(state));
}
// The canonical (deterministic, injective) JSON encoding of a world state.
// Exposed for callers that want to store / diff the canonical form itself.
export function canonicalWorldState(state) {
    return canonicalJson(state);
}
// Compute the pure content hash of a world state. Cross-language byte-identical
// (reuses canonicalJson + field + HMAC). Throws fail-closed on any non-canonical
// state.
export function worldStateHash(key, state) {
    return hmacSha256Hex(key, snapshotMessage(state));
}
// Take a snapshot: the (eventIndex, stateHash) commitment. Validates the index
// fail-closed.
export function snapshotWorldState(input) {
    if (!Number.isSafeInteger(input.eventIndex) || input.eventIndex < 0) {
        throw new Error('WorldStateSnapshot: eventIndex must be a non-negative JS-safe integer');
    }
    return { eventIndex: input.eventIndex, stateHash: worldStateHash(input.key, input.state) };
}
// Verify a world matches an expected snapshot hash. Constant-time hex compare
// (no early-exit timing leak), so it is safe as an integrity gate on an
// untrusted resumed snapshot: a mismatch means do NOT trust the state.
export function verifyWorldSnapshot(key, state, expectedHash) {
    return timingSafeEqualHex(worldStateHash(key, state), expectedHash);
}
//# sourceMappingURL=world-state-snapshot.js.map