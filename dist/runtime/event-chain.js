// EventChain - tamper-evident, HMAC-chained event log.
//
// 2.2.0 enabling primitive. The integrity-bearing sibling of EventLog
// (0.83.0): every appended record is signed with HMAC-SHA-256, and each
// signature folds in the PREVIOUS record's signature, so the whole log is a
// hash chain. verify() recomputes every signature AND checks the chain
// linkage, catching four tamper classes a plain log cannot:
//
//   - field tampering   - a payload / type / seq edited at rest (sig_mismatch)
//   - record deletion   - a middle record removed (broken_chain_link)
//   - record reordering - records shuffled (broken_chain_link)
//   - tail truncation   - records dropped off the END, detected when an
//                         earlier seal() commitment is supplied (seal_mismatch)
//
// Use it for audit trails, anti-cheat event tapes, economy / ledger logs, or
// any "prove this sequence was not altered" requirement. Ported from the
// server-authoritative event tape running in production in TheWorldTable's
// LoomMaster backend (the same chain that guards its combat + currency ledger).
//
//   var chain = EventChain.create({ key: runtimeSecret });
//   chain.append('combat.hit', { target: 'goblin', dmg: 7 });
//   chain.append('xp.award',  { amount: 500 });
//   var result = chain.verify();          // { ok: true, total: 2, ... }
//   var seal = chain.seal();              // persist to detect later truncation
//   ... later ...
//   chain.verify(seal);                   // also fails if the tail was cut
//
// 2.2.x hardening (pre-`latest`):
//   - Canonical message is LENGTH-PREFIXED + domain-separated, so the encoding
//     is injective: no `type` or payload string can forge a field boundary
//     (the first cut used raw '|' joins, which were ambiguous when a value
//     contained the delimiter).
//   - seal() / verifySeal() add an optional signed (count, head) commitment so
//     tail truncation is detectable (a bare hash chain cannot see records
//     removed from the end without an external length commitment).
//   - signature comparison is constant-time (timingSafeEqualHex).
//   - 2.2.3 closes the remaining canonicalization injectivity gaps: -0 (which
//     stringifies to "0" yet is a distinct JS value), JSON-erased object/array
//     metadata (symbol keys, non-enumerables, accessors, extra array props),
//     and seal-head lone surrogates are all rejected fail-closed; stored
//     payloads are deep-cloned at every trust boundary so no external reference
//     can mutate signed chain state after the fact.
//   - 2.2.4 rejects an own '__proto__' data key (which a JSON-parsed payload can
//     carry but a normal-prototype clone cannot faithfully round-trip) and
//     deep-clones via defineProperty so no clone path can hit the prototype
//     setter.
//   - 2.2.5 bounds canonicalization + clone recursion depth (MAX_CANONICAL_DEPTH)
//     so a hostile deeply-nested payload from an untrusted snapshot is rejected
//     early instead of exhausting the stack.
//
// SCOPE: integrity, not secrecy. Payloads are stored in the clear; the
// signature proves they were not altered. The HMAC key is a runtime
// parameter, never persisted or logged by the engine. Output is
// self-consistent within the engine (sign + verify here) - it is NOT promised
// byte-compatible with other languages' JSON / HMAC framing.
//
// Pairs with EventLog (0.83.0), ReplayRecorder (0.60), hmacSha256 (2.2.0).
//
// Code style: var-only in browser source (matches event-log.ts).
import { hmacSha256Hex, timingSafeEqualHex } from './hmac-sha256.js';
// Domain tags keep record signatures and seal signatures in separate
// namespaces (a record HMAC can never be reinterpreted as a seal HMAC). The
// trailing /1 is a format version for future migrations.
const RECORD_DOMAIN = 'loom.chain.rec/1';
const SEAL_DOMAIN = 'loom.chain.seal/1';
// Codex audit P1 (persistence forge): a separate namespace for the world-bundle
// binding HMAC, which signs the bundle's identity (worldId + snapshot stateHash
// + eventIndex + tailGenesis + sealed count + sealed head) so none of those
// fields can be rewritten without the key. A bundle-bind HMAC can never be
// reinterpreted as a record or seal HMAC.
const BUNDLE_DOMAIN = 'loom.bundle.bind/1';
// 2.2.5 audit LOW: hard cap on canonicalization / clone recursion depth. Event
// payloads are shallow; this is far above any legitimate nesting and exists only
// so a hostile deeply-nested payload (e.g. an untrusted verifyRecords /
// fromVerifiedSnapshot input) is rejected early and cheaply instead of consuming
// stack + CPU all the way to a RangeError.
const MAX_CANONICAL_DEPTH = 256;
// Length-prefixed field: '<len>:<value>' where len is the JS string length.
// Self-delimiting, so concatenating fields is injective - a value cannot forge
// a field boundary no matter what characters it contains.
export function field(s) {
    return s.length + ':' + s;
}
// 2.2.2 audit HIGH 1: reject unpaired surrogates in any signed string.
// TextEncoder maps lone surrogates lossily to U+FFFD, so two distinct strings
// could otherwise collide after HMAC encoding. Valid event data never contains
// lone surrogates; rejecting them keeps the canonical encoding injective.
export function assertCleanString(s) {
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            var next = s.charCodeAt(i + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new Error('EventChain: lone high surrogate in a signed string');
            }
            i++; // valid surrogate pair - skip the low half
        }
        else if (c >= 0xdc00 && c <= 0xdfff) {
            throw new Error('EventChain: lone low surrogate in a signed string');
        }
    }
    // Hardening audit 2026-06-07: reject a non-NFC signed string. "e"+U+0301 and
    // U+00E9 are the same grapheme but distinct UTF-16, so accepting both would let
    // logically-equal content sign two ways and fork the chain across producers
    // that normalize differently. REJECT (never silently normalize - that would
    // mutate a player's raw text). Checked AFTER the surrogate scan so .normalize
    // only ever sees well-formed UTF-16. Mirrors the Rust assert_nfc + Python guard.
    if (s !== s.normalize('NFC')) {
        throw new Error('EventChain: non-NFC string in a signed payload (normalize to NFC first)');
    }
}
// 2.2.3 audit MED 1: an array's signed surface is EXACTLY its dense numeric
// elements. Any other own property (a symbol, a non-index string key like
// `arr.extra = 9`, a non-enumerable, or an accessor) is invisible to a plain
// element walk, so two distinct arrays could canonicalize identically. Reject
// the whole array fail-closed if any non-element own key exists. Validated
// BEFORE values are read so an attacker's index getter is never invoked.
function assertArraySurface(arr) {
    for (var k of Reflect.ownKeys(arr)) {
        if (typeof k === 'symbol')
            throw new Error('EventChain: symbol key not allowed in payload');
        if (k === 'length')
            continue; // the canonical, non-enumerable length data prop
        var n = Number(k);
        if (!(Number.isInteger(n) && n >= 0 && n < arr.length && String(n) === k)) {
            throw new Error('EventChain: non-index array property not allowed in payload');
        }
        var d = Object.getOwnPropertyDescriptor(arr, k);
        if (!d || !d.enumerable || typeof d.get === 'function' || typeof d.set === 'function') {
            throw new Error('EventChain: non-data array element not allowed in payload');
        }
    }
}
// 2.2.3 audit MED 1: a plain object's signed surface is EXACTLY its enumerable
// own string-keyed DATA properties. Symbol keys, non-enumerable own props, and
// accessor (get/set) props are dropped by a JSON walk, so they would let two
// distinct objects collide. Reject fail-closed. Validated BEFORE values are read
// so an attacker's getter is never invoked.
function assertObjectSurface(obj) {
    for (var k of Reflect.ownKeys(obj)) {
        if (typeof k === 'symbol')
            throw new Error('EventChain: symbol key not allowed in payload');
        // A JSON-parsed '__proto__' is an own data key but cannot be faithfully
        // round-tripped through a normal-prototype clone (the assignment hits the
        // prototype setter), so reject it fail-closed rather than risk drift.
        if (k === '__proto__')
            throw new Error('EventChain: "__proto__" key not allowed in payload');
        var d = Object.getOwnPropertyDescriptor(obj, k);
        if (!d || !d.enumerable || typeof d.get === 'function' || typeof d.set === 'function') {
            throw new Error('EventChain: non-enumerable or accessor property not allowed in payload');
        }
    }
}
// 2.2.3 audit MED 2: a structural deep copy of a JSON-shaped value, used at the
// trust boundary so a stored payload and any returned/loaded payload are
// independent objects - an external reference can never mutate chain state after
// the fact (or vice versa). Mirrors canonicalJson's accepted surface; primitives
// (incl. functions, which valid payloads never contain) pass through by value.
function deepCloneJson(v, depth = 0) {
    if (depth > MAX_CANONICAL_DEPTH) {
        throw new Error('EventChain: payload nesting exceeds max depth ' + MAX_CANONICAL_DEPTH);
    }
    if (v === null || typeof v !== 'object')
        return v;
    if (Array.isArray(v)) {
        var arr = [];
        for (var i = 0; i < v.length; i++)
            arr.push(deepCloneJson(v[i], depth + 1));
        return arr;
    }
    var out = {};
    var src = v;
    var keys = Object.keys(src);
    for (var j = 0; j < keys.length; j++) {
        var kk = keys[j];
        // defineProperty (not out[kk] = ...) so an own '__proto__' key on an
        // untrusted raw snapshot creates a real own property instead of hitting the
        // prototype setter (no transient prototype pollution of the clone).
        Object.defineProperty(out, kk, {
            value: deepCloneJson(src[kk], depth + 1), enumerable: true, writable: true, configurable: true,
        });
    }
    return out;
}
// Deterministic, STRICT JSON: object keys sorted recursively so the signed
// message is stable regardless of insertion order. 2.2.2 audit HIGH 2: rather
// than collapse non-JSON values to null (which let null / NaN / undefined /
// Date / Map / Set / array-holes all collide), this FAILS CLOSED - any value
// that cannot be faithfully + injectively serialized throws, and the caller
// rejects the append or marks the record unverifiable.
export function canonicalJson(value, depth = 0) {
    if (depth > MAX_CANONICAL_DEPTH) {
        throw new Error('EventChain: payload nesting exceeds max depth ' + MAX_CANONICAL_DEPTH);
    }
    if (value === null)
        return 'null';
    var t = typeof value;
    if (t === 'string') {
        assertCleanString(value);
        return JSON.stringify(value);
    }
    if (t === 'number') {
        if (!isFinite(value)) {
            throw new Error('EventChain: non-finite number (NaN/Infinity) not allowed in payload');
        }
        // 2.2.3 audit HIGH: String(-0) === '0' but Object.is(-0, 0) === false, so a
        // signed 0 could be mutated to -0 (a distinct JS value) and still verify.
        // Reject -0 fail-closed - valid event data never carries negative zero.
        if (Object.is(value, -0)) {
            throw new Error('EventChain: negative zero not allowed in payload');
        }
        // 2.3.0 (Codex P0/P1): JS-SAFE-integer-only canonical surface. Two reasons:
        // (1) a non-integer's String() form (V8 dtoa) is not reproducible by the Rust
        // core; (2) an integer beyond 2^53 is not exact in JS - JSON.parse silently
        // rounds 9007199254740993 -> ...992 - so accepting it here would diverge from
        // a Rust/C signer that kept the exact i64. isSafeInteger rejects BOTH, keeping
        // the accepted numeric surface byte-identical across Rust / TS / Python.
        if (!Number.isSafeInteger(value)) {
            throw new Error('EventChain: number must be a JS-safe integer (|n| <= 2^53-1)');
        }
        return String(value);
    }
    if (t === 'boolean')
        return value ? 'true' : 'false';
    if (t === 'undefined')
        throw new Error('EventChain: undefined not allowed in payload');
    if (t === 'bigint' || t === 'function' || t === 'symbol') {
        throw new Error('EventChain: ' + t + ' not allowed in payload');
    }
    if (Array.isArray(value)) {
        assertArraySurface(value);
        var items = [];
        for (var i = 0; i < value.length; i++) {
            if (!(i in value))
                throw new Error('EventChain: sparse array (hole) not allowed in payload');
            items.push(canonicalJson(value[i], depth + 1));
        }
        return '[' + items.join(',') + ']';
    }
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        // Date / Map / Set / class instances etc. are not faithfully serializable.
        throw new Error('EventChain: only plain objects allowed in payload');
    }
    // null-proto objects (Object.create(null)) are accepted here and sign
    // identically to a plain object with the same JSON value: EventChain proves
    // JSON-VALUE integrity, not JS object-surface identity (2.2.5 audit LOW,
    // intentional - reject proto === null above if value identity is ever needed).
    assertObjectSurface(value);
    var obj = value;
    var keys = Object.keys(obj).sort();
    var pairs = [];
    for (var key of keys) {
        assertCleanString(key);
        pairs.push(JSON.stringify(key) + ':' + canonicalJson(obj[key], depth + 1));
    }
    return '{' + pairs.join(',') + '}';
}
// The exact (injective) string fed to HMAC for one record. type + prevSig are
// validated for clean Unicode; payload is strictly canonicalized (throws on bad
// input). prevSig is always folded in, so deletion / reordering changes every
// downstream signature.
function canonicalMessage(seq, type, payload, prevSig) {
    assertCleanString(type);
    assertCleanString(prevSig);
    return field(RECORD_DOMAIN) + field(String(seq)) + field(type)
        + field(canonicalJson(payload)) + field(prevSig);
}
// The string fed to HMAC for a seal commitment. 2.2.3 audit MED 3: the head is
// validated for clean Unicode like every other signed string, so a tampered
// seal head with a lone surrogate cannot be lossily re-encoded into a colliding
// commitment (TextEncoder maps lone surrogates to U+FFFD).
// Round-6 audit LOW: the count is validated as a non-negative JS-safe integer,
// matching Python (_num_str rejects fractional/unsafe numbers) and Rust (u64 by
// type). A key holder could previously sign a TS seal over {count: 1.5} that
// Python rejected and Rust could not even represent - a cross-surface fork in
// what counts as a valid seal.
function sealMessage(count, head) {
    assertCleanString(head);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('EventChain: seal count must be a non-negative JS-safe integer');
    }
    return field(SEAL_DOMAIN) + field(String(count)) + field(head);
}
// Codex audit P1: the world-bundle binding message. Length-prefixed fields
// (injective) so worldId, stateHash, eventIndex, tailGenesis, count and head
// are bound into one HMAC with no delimiter ambiguity. Identical byte string
// on TS, Python and Rust.
function bundleBindMessage(worldId, stateHash, eventIndex, tailGenesis, count, head) {
    assertCleanString(worldId);
    assertCleanString(stateHash);
    assertCleanString(tailGenesis);
    assertCleanString(head);
    return field(BUNDLE_DOMAIN) + field(worldId) + field(stateHash)
        + field(String(eventIndex)) + field(tailGenesis)
        + field(String(count)) + field(head);
}
// 2.2.3 audit MED 4: payload is DEEP-CLONED so the returned record shares no
// mutable state with the stored one - a holder mutating a listed/snapshotted
// payload can never reach back into chain state (and break verify()).
function cloneRecord(r) {
    return { seq: r.seq, type: r.type, payload: deepCloneJson(r.payload), prevSig: r.prevSig, sig: r.sig };
}
export class EventChain {
    records = [];
    key;
    genesis;
    headSig;
    nextSeq = 1;
    disposed = false;
    constructor(opts) {
        this.key = opts.key;
        this.genesis = typeof opts.genesis === 'string' ? opts.genesis : '';
        this.headSig = this.genesis;
    }
    static create(opts) {
        if (!opts || (typeof opts.key !== 'string' && !(opts.key instanceof Uint8Array))) {
            throw new Error('EventChain.create: opts.key (HMAC secret) is required');
        }
        if (typeof opts.key === 'string' && opts.key.length === 0) {
            throw new Error('EventChain.create: opts.key must not be empty');
        }
        return new EventChain(opts);
    }
    // Sign one record's canonical message with the chain key.
    sign(seq, type, payload, prevSig) {
        return hmacSha256Hex(this.key, canonicalMessage(seq, type, payload, prevSig));
    }
    // Append + sign a record. Returns a clone of the stored record, or null on
    // rejection (disposed / bad type / non-canonicalizable payload). 2.2.2: an
    // invalid payload (NaN/undefined/Date/lone-surrogate/etc.) is rejected and
    // does NOT advance the sequence - sign() is computed before any mutation.
    append(type, payload) {
        if (this.disposed)
            return null;
        if (typeof type !== 'string' || type.length === 0)
            return null;
        var seq = this.nextSeq;
        var prevSig = this.headSig;
        var sig;
        try {
            sig = this.sign(seq, type, payload, prevSig);
        }
        catch (e) {
            return null; // fail closed - do not store, do not advance nextSeq
        }
        // 2.2.3 audit MED 4: store a deep copy so a caller mutating its input object
        // after append cannot reach back into (and desync) signed chain state. sign()
        // above already ran over the original, so the clone's canonical form matches.
        var rec = { seq: seq, type: type, payload: deepCloneJson(payload), prevSig: prevSig, sig: sig };
        this.records.push(rec);
        this.nextSeq = seq + 1;
        this.headSig = sig;
        return cloneRecord(rec);
    }
    // Recompute every signature AND verify chain linkage. Pass a prior seal() to
    // also detect tail truncation. Pure over the records.
    verify(expectedSeal) {
        return EventChain.verifyRecords(this.key, this.records, this.genesis, expectedSeal);
    }
    // Verify an EXTERNAL snapshot without an instance (e.g. records loaded from
    // disk or the network). Same key + genesis the chain was built with. Supply
    // expectedSeal to detect tail truncation.
    static verifyRecords(key, records, genesis = '', expectedSeal) {
        var mismatches = [];
        var prevActual = genesis;
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            var expected;
            try {
                expected = hmacSha256Hex(key, canonicalMessage(rec.seq, rec.type, rec.payload, rec.prevSig));
            }
            catch (e) {
                // 2.2.2: a record whose stored content is not canonicalizable (e.g. a
                // tampered-in lone surrogate or non-JSON value) can never carry a valid
                // signature - treat as a mismatch (fail closed), do not throw.
                mismatches.push({ seq: rec.seq, type: rec.type, reason: 'sig_mismatch' });
                prevActual = rec.sig;
                continue;
            }
            if (!timingSafeEqualHex(expected, rec.sig)) {
                mismatches.push({ seq: rec.seq, type: rec.type, reason: 'sig_mismatch' });
            }
            // Link continuity: a deleted / reordered record makes the stored prevSig
            // disagree with the real predecessor's signature. (Structural compare of
            // values both already visible to the holder - no secret, no timing risk.)
            if (rec.prevSig !== prevActual) {
                mismatches.push({ seq: rec.seq, type: rec.type, reason: 'broken_chain_link' });
            }
            prevActual = rec.sig;
        }
        // Tail-truncation / head commitment: if a prior seal is supplied, the
        // record count and head must still match it (and the seal itself be valid).
        if (expectedSeal !== undefined) {
            var headNow = records.length > 0
                ? records[records.length - 1].sig
                : genesis;
            var sealValid = EventChain.verifySeal(key, expectedSeal);
            if (!sealValid || expectedSeal.count !== records.length || expectedSeal.head !== headNow) {
                mismatches.push({ seq: expectedSeal.count, type: '(seal)', reason: 'seal_mismatch' });
            }
        }
        return { ok: mismatches.length === 0, total: records.length, mismatches: mismatches };
    }
    // Sign the current (count, head) so a holder can later prove no records were
    // dropped off the end. Persist this out of band.
    seal() {
        var count = this.records.length;
        var head = this.headSig;
        return { count: count, head: head, sig: hmacSha256Hex(this.key, sealMessage(count, head)) };
    }
    // Verify a seal's own signature (constant-time). Does not check it against
    // any record set - verifyRecords(..., seal) does that.
    static verifySeal(key, seal) {
        // Round-6 audit LOW: count must be a non-negative JS-safe integer (the
        // sealMessage guard also throws-to-false below, but the explicit gate
        // keeps the rejection visible + identical to the Python/Rust shape).
        if (!seal || typeof seal.count !== 'number' || typeof seal.head !== 'string'
            || typeof seal.sig !== 'string'
            || !Number.isSafeInteger(seal.count) || seal.count < 0) {
            return false;
        }
        var expected;
        try {
            expected = hmacSha256Hex(key, sealMessage(seal.count, seal.head));
        }
        catch (e) {
            // 2.2.3: a malformed head (e.g. a tampered-in lone surrogate) can never be
            // part of a valid seal - fail closed rather than throw.
            return false;
        }
        return timingSafeEqualHex(expected, seal.sig);
    }
    // Codex audit P1 (persistence forge): sign a world bundle's identity. Binds
    // worldId + snapshot stateHash + eventIndex + tailGenesis to the sealed
    // (count, head). suspend() stores this; resume() re-derives and compares, so
    // a forger cannot rewrite eventIndex/tailGenesis to drop leading tail records
    // (or splice a snapshot from another world) without invalidating it. count
    // and head are this chain's current values - the SAME ones seal() signs.
    bindBundle(worldId, stateHash, eventIndex, tailGenesis) {
        var count = this.records.length;
        var head = this.headSig;
        return hmacSha256Hex(this.key, bundleBindMessage(worldId, stateHash, eventIndex, tailGenesis, count, head));
    }
    // Verify a world-bundle binding (constant-time). All identity fields are
    // passed by the caller (resume()); a mismatch on ANY of them fails closed.
    static verifyBundleBinding(key, worldId, stateHash, eventIndex, tailGenesis, count, head, binding) {
        if (typeof binding !== 'string' || typeof worldId !== 'string'
            || typeof stateHash !== 'string' || typeof tailGenesis !== 'string'
            || typeof head !== 'string'
            || !Number.isSafeInteger(eventIndex) || !Number.isSafeInteger(count)) {
            return false;
        }
        var expected;
        try {
            expected = hmacSha256Hex(key, bundleBindMessage(worldId, stateHash, eventIndex, tailGenesis, count, head));
        }
        catch (e) {
            return false;
        }
        return timingSafeEqualHex(expected, binding);
    }
    bySeq(seq) {
        if (!isFinite(seq) || seq <= 0)
            return null;
        for (var i = 0; i < this.records.length; i++) {
            var r = this.records[i];
            if (r.seq === seq)
                return cloneRecord(r);
        }
        return null;
    }
    byType(type) {
        var out = [];
        for (var i = 0; i < this.records.length; i++) {
            var r = this.records[i];
            if (r.type === type)
                out.push(cloneRecord(r));
        }
        return out;
    }
    list() {
        var out = [];
        for (var i = 0; i < this.records.length; i++) {
            out.push(cloneRecord(this.records[i]));
        }
        return out;
    }
    // Current head signature - the value the NEXT append will fold in. Equals
    // the genesis anchor when the chain is empty.
    head() { return this.headSig; }
    size() { return this.records.length; }
    highWaterMark() { return this.nextSeq - 1; }
    // Snapshot for save / load / network sync. Records carry their own sigs so a
    // loaded snapshot is independently verifiable via EventChain.verifyRecords.
    toSnapshot() {
        return this.list();
    }
    // Restore from a snapshot. Does NOT re-sign (sigs travel with the records);
    // call verify() afterward to confirm integrity. Rejects malformed rows.
    fromSnapshot(records) {
        if (this.disposed)
            return;
        if (!Array.isArray(records))
            return;
        // 2.2.5 audit MED: TRANSACTIONAL load. Build into locals and only swap into
        // the instance after the FULL clone succeeds. deepCloneJson can now throw
        // (depth overflow), so cloning straight into this.records after clearing it
        // would leave the instance desynced (records=[] with a stale headSig) on a
        // hostile too-deep row. On any failure we return with the prior state intact.
        var nextRecords = [];
        var maxSeq = 0;
        var lastSig = this.genesis;
        try {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (!r || typeof r !== 'object')
                    continue;
                if (typeof r.seq !== 'number' || !isFinite(r.seq) || r.seq <= 0)
                    continue;
                if (typeof r.type !== 'string' || r.type.length === 0)
                    continue;
                if (typeof r.sig !== 'string' || typeof r.prevSig !== 'string')
                    continue;
                // 2.2.3 audit MED 4: deep-clone on load so mutating the source rows after
                // fromSnapshot / fromVerifiedSnapshot cannot reach into loaded chain state.
                nextRecords.push({ seq: r.seq, type: r.type, payload: deepCloneJson(r.payload), prevSig: r.prevSig, sig: r.sig });
                if (r.seq > maxSeq)
                    maxSeq = r.seq;
                lastSig = r.sig;
            }
        }
        catch (e) {
            return; // fail closed - leave this.records / nextSeq / headSig untouched
        }
        this.records = nextRecords;
        this.nextSeq = maxSeq + 1;
        this.headSig = lastSig;
    }
    // 2.2.2 audit MED: verify-before-mutate. Verifies the snapshot (and optional
    // seal) FIRST and only loads it when integrity holds, so an adversarial
    // snapshot can't desync this instance. Returns the verify result; the
    // instance is left untouched when ok is false. Prefer this over fromSnapshot
    // for any snapshot from an untrusted source (disk / network).
    fromVerifiedSnapshot(records, expectedSeal) {
        if (this.disposed) {
            return { ok: false, total: 0, mismatches: [{ seq: 0, type: '(disposed)', reason: 'sig_mismatch' }] };
        }
        var rows = Array.isArray(records) ? records : [];
        var res = EventChain.verifyRecords(this.key, rows, this.genesis, expectedSeal);
        if (res.ok)
            this.fromSnapshot(rows);
        return res;
    }
    dispose() {
        this.records = [];
        this.headSig = '';
        // Drop the key reference so it is not retained after disposal.
        this.key = '';
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_EVENT_CHAIN = 'event_chain';
//# sourceMappingURL=event-chain.js.map