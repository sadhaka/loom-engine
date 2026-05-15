// AIBehaviorBuffer - a zero-allocation SoA snapshot store for LLM
// context ingestion, with a seqlock publish protocol and a built-in
// observer change-feed.
//
// The Trinity dossier's section 1 (Gemini Volume I). The Gemini sketch
// was `class AIBehaviorBuffer { constructor(buffer: SharedArrayBuffer)
// ... writeSnapshot() { ...plain f32 writes...; Atomics.add(version) }
// }` - the Codex audit rejected it: "not safe for concurrent
// SharedArrayBuffer and not truly zero-allocation." The plain float
// writes were not ordered against the atomic version bump, so a reader
// could see a torn record; the version protocol had a first-sight-0
// bug; reads returned a live subarray() view.
//
// This is the corrected build. Concurrency is settled the way every
// shipped Trinity component settles it: single-writer / single-thread,
// with the cross-worker SAB + Atomics variant deferred (AIActionInter-
// preter says it outright - "An SAB + Atomics multi-thread variant is
// out of scope"; SpatialGrid ships a plain epoch counter; LoomDecay's
// stub Atomics call was removed). The "atomic publish protocol" the
// Codex gate asks for is a SEQLOCK driven by a plain version counter -
// the same shape as SpatialGrid's epoch, the part a future SAB variant
// upgrades to Atomics.
//
// LAYOUT. One backing buffer (the Gemini single-buffer SoA shape),
// two aliased views over it:
//   f32  - payload floats: record `slot` occupies f32[base, base+P)
//   u32  - the version counter: record `slot`'s lives at u32[base+P]
// where base = slot * stride, stride = payloadLength + 1, P =
// payloadLength. The payload region and the version slot never
// overlap. The constructor allocates an ArrayBuffer by default but
// accepts a caller-supplied buffer (which may be a SharedArrayBuffer);
// `.buffer` is exposed so a future integration can hand it to a worker.
//
// SEQLOCK. writeSnapshot bumps the version to ODD (write in progress),
// writes the payload, then bumps it to the next EVEN (published).
// readSnapshot loads the version (v1), copies the payload, loads it
// again (v2): the copy is consistent iff v1 === v2 and v1 is even.
// Version numbers: 0 = never written, ODD = a write is in progress,
// EVEN >= 2 = a published version. So a reader can DETECT a torn read
// instead of silently consuming one - in single-thread that never
// happens (the writer always completes before any reader runs), but
// the protocol makes a future shared violation observable.
//
// OBSERVERS. AIBehaviorBuffer owns a small registry of observers -
// generation-stamped ObserverHandles, each with its own per-entity
// lastSeen column. readChanged(observer, slot, out) is the change-feed
// primitive: it returns SNAPSHOT_UNCHANGED when the entity's version
// matches what the observer last saw, and otherwise copies the payload
// and advances lastSeen - but ONLY after the seqlock confirms a
// consistent copy. Multiple AI consumers (LLM context builder, behavi-
// our workers) each get an independent feed off the one snapshot heap.
//
// The 7 Codex gates for AIBehaviorBuffer, enforced:
//   1. "atomic publish protocol for versions/components/active flags"
//      - the seqlock. Each record's single version counter publishes
//      every payload slot ("components") and any caller-encoded active
//      flag together; there is no separately-racing flag.
//   2. "do not read shared Float32 while writers active" - enforced by
//      detection: an odd version, or a version that changes across the
//      copy, rejects the read (retry, then SNAPSHOT_TORN).
//   3. "move lastSeenVersions update after successful serialization" -
//      readChanged advances the observer's lastSeen ONLY after v1 ===
//      v2 confirms the copy; a torn / in-progress read leaves it.
//   4. "fix first-sight version 0" - 0 is reserved for never-written;
//      the first writeSnapshot publishes 2; published versions are
//      always even and >= 2, so lastSeen 0 always reads as changed.
//   5. "replace per-call header array allocation" - nothing allocates:
//      writes go straight into the f32 view, reads copy into a caller
//      out buffer, read calls return a plain number. No header array,
//      no object return, no subarray().
//   6. "treat returned snapshot as a single-use mutable view" -
//      stronger: reads never return a view. They copy into the
//      caller's out buffer, so no shared view can be aliased or
//      outlive its consistency window.
//   7. "validate observer handle generation and bounds" - ObserverHan-
//      dle packs (generation, slot) like an EntityId; createObserver
//      stamps the generation, releaseObserver bumps it, and every
//      observer-taking method validates slot bounds AND generation.
//
// Non-negotiable engine gates: no RNG, no wall clock (version counters
// increment deterministically - a single-thread run replays bit-for-
// bit); every slot / handle / index is bounds-checked; the buffer is
// fixed-capacity; the u32 version wrap is handled (a publish that
// would land on 0 skips to 2). Storage is allocated once in the
// constructor - write / read / readChanged allocate nothing.
// ObserverHandle layout, mirroring EntityId / MaterialHandle: low 24
// bits slot, high 8 bits generation.
const OBSERVER_INDEX_MASK = 0x00ffffff;
const OBSERVER_GENERATION_SHIFT = 24;
const OBSERVER_GENERATION_MASK = 0xff;
// Sanity caps on the constructor-derived sizes. Not hard engine limits
// - guards so a bad argument throws a clear error instead of
// attempting an absurd typed-array allocation.
const MAX_CAPACITY = 1 << 18; // entity slots
const MAX_PAYLOAD_LENGTH = 1 << 12; // float slots per record
const MAX_OBSERVERS = 64;
// Ceiling on capacity * stride (the backing buffer, in u32 slots) and
// on capacity * maxObservers (the observer lastSeen storage). 1<<26
// u32 is a 256MB buffer - matches the Gemini SAB_SIZE ballpark.
const MAX_TOTAL_SLOTS = 1 << 26;
// Seqlock read retries. In single-thread a read never tears, so the
// first attempt always succeeds; the retries are the protocol shape a
// future shared variant needs.
const DEFAULT_READ_ATTEMPTS = 4;
const MAX_READ_ATTEMPTS = 64;
// readSnapshot / readChanged return values. Any return >= 2 is the
// consistent published version (always even). The three sentinels are
// negative or 0 so they never collide with a real version.
export const SNAPSHOT_NEVER_WRITTEN = 0; // the entity slot was never written
export const SNAPSHOT_TORN = -1; // no consistent read within the retry budget
export const SNAPSHOT_UNCHANGED = -2; // readChanged only: consistent, but nothing new since lastSeen
export function makeObserverHandle(slot, generation) {
    return ((generation & OBSERVER_GENERATION_MASK) << OBSERVER_GENERATION_SHIFT)
        | (slot & OBSERVER_INDEX_MASK);
}
export function observerSlot(handle) {
    return handle & OBSERVER_INDEX_MASK;
}
export function observerGeneration(handle) {
    return (handle >>> OBSERVER_GENERATION_SHIFT) & OBSERVER_GENERATION_MASK;
}
export class AIBehaviorBuffer {
    // Entity-record slots: a record lives at slot in [0, capacity).
    capacity;
    // Float payload slots per record.
    payloadLength;
    // u32 / f32 slots per record - payloadLength + 1 (the version slot).
    stride;
    // Observer registry size.
    maxObservers;
    // The two aliased views over the one backing buffer. f32 holds the
    // payload (record base .. base + payloadLength); u32 holds the
    // version counter (record base + payloadLength). The regions never
    // overlap.
    u32;
    f32;
    // Observer registry - reader-local bookkeeping, NOT in the shared
    // buffer (a worker handed `.buffer` keeps its own observers).
    observerActive; // 1 = slot holds a live observer
    observerGen; // bumped on release (handle guard)
    observerLastSeen; // maxObservers * capacity
    observerCount = 0;
    constructor(capacity, payloadLength, maxObservers, buffer) {
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
            throw new RangeError('AIBehaviorBuffer: capacity must be an integer in [1, ' + MAX_CAPACITY + '], got ' + capacity);
        }
        if (!Number.isInteger(payloadLength) || payloadLength < 1 || payloadLength > MAX_PAYLOAD_LENGTH) {
            throw new RangeError('AIBehaviorBuffer: payloadLength must be an integer in [1, ' + MAX_PAYLOAD_LENGTH + '], got '
                + payloadLength);
        }
        if (!Number.isInteger(maxObservers) || maxObservers < 1 || maxObservers > MAX_OBSERVERS) {
            throw new RangeError('AIBehaviorBuffer: maxObservers must be an integer in [1, ' + MAX_OBSERVERS + '], got '
                + maxObservers);
        }
        const stride = payloadLength + 1;
        const totalSlots = capacity * stride;
        if (totalSlots > MAX_TOTAL_SLOTS) {
            throw new RangeError('AIBehaviorBuffer: capacity * stride = ' + totalSlots + ' exceeds the cap ' + MAX_TOTAL_SLOTS);
        }
        const byteLength = totalSlots * 4;
        let backing;
        if (buffer === undefined) {
            backing = new ArrayBuffer(byteLength);
        }
        else {
            if (buffer.byteLength < byteLength) {
                throw new RangeError('AIBehaviorBuffer: provided buffer byteLength ' + buffer.byteLength
                    + ' < required ' + byteLength);
            }
            backing = buffer;
        }
        this.capacity = capacity;
        this.payloadLength = payloadLength;
        this.stride = stride;
        this.maxObservers = maxObservers;
        this.u32 = new Uint32Array(backing, 0, totalSlots);
        this.f32 = new Float32Array(backing, 0, totalSlots);
        this.observerActive = new Uint8Array(maxObservers);
        this.observerGen = new Uint8Array(maxObservers);
        this.observerLastSeen = new Uint32Array(maxObservers * capacity);
    }
    // The backing buffer. Exposed for a future integration that hands it
    // to an AI worker; the worker makes its own u32 / f32 views and
    // reads with the same seqlock protocol.
    get buffer() {
        return this.u32.buffer;
    }
    // --- writer side (single owner) ---
    // Publish a snapshot for entity `slot`. Writes the first `count`
    // payload floats from `values` (count defaults to values.length);
    // payload slots beyond `count` keep their prior value. The seqlock:
    // version -> odd (write in progress), payload written, version ->
    // next even (published). Returns the published version (even, >= 2).
    // `values` is opaque entity state - AIBehaviorBuffer never
    // interprets it; the caller owns the schema.
    writeSnapshot(slot, values, count) {
        this.requireSlot(slot, 'writeSnapshot');
        const n = count === undefined ? values.length : count;
        if (!Number.isInteger(n) || n < 0) {
            throw new RangeError('AIBehaviorBuffer.writeSnapshot: count must be a non-negative integer, got ' + n);
        }
        if (n > this.payloadLength) {
            throw new RangeError('AIBehaviorBuffer.writeSnapshot: count ' + n + ' exceeds payloadLength ' + this.payloadLength);
        }
        if (n > values.length) {
            throw new RangeError('AIBehaviorBuffer.writeSnapshot: count ' + n + ' exceeds values.length ' + values.length);
        }
        const base = slot * this.stride;
        const versionIdx = base + this.payloadLength;
        // `v` is always even here: writeSnapshot always runs odd -> even
        // to completion (validation throws before the odd mark, nothing
        // throws after it), so the previous write left an even version.
        const v = this.u32[versionIdx] ?? 0;
        // Mark write-in-progress (odd).
        this.u32[versionIdx] = (v + 1) >>> 0;
        for (let i = 0; i < n; i++) {
            this.f32[base + i] = values[i] ?? 0;
        }
        // Publish (next even). A publish that would wrap u32 onto 0 skips
        // to 2, keeping 0 reserved for never-written (gate 4).
        let published = (v + 2) >>> 0;
        if (published === 0)
            published = 2;
        this.u32[versionIdx] = published;
        return published;
    }
    // The raw version counter for `slot`: 0 = never written, an odd
    // value = a write is in progress, an even value >= 2 = a published
    // version.
    getVersion(slot) {
        this.requireSlot(slot, 'getVersion');
        return this.u32[slot * this.stride + this.payloadLength] ?? 0;
    }
    // --- reader side (any number of readers) ---
    // Copy entity `slot`'s payload into `out` under the seqlock. Copies
    // min(out.length, payloadLength) floats. Returns the consistent
    // published version (even, >= 2), or SNAPSHOT_NEVER_WRITTEN (0) if
    // the slot was never written, or SNAPSHOT_TORN (-1) if no consistent
    // read landed within the retry budget. `out` is caller-owned - this
    // never returns a view (gate 6).
    readSnapshot(slot, out, attempts) {
        this.requireSlot(slot, 'readSnapshot');
        const tries = this.resolveAttempts(attempts, 'readSnapshot');
        const base = slot * this.stride;
        const versionIdx = base + this.payloadLength;
        const copyLen = Math.min(out.length, this.payloadLength);
        for (let attempt = 0; attempt < tries; attempt++) {
            const v1 = this.u32[versionIdx] ?? 0;
            if (v1 === 0)
                return SNAPSHOT_NEVER_WRITTEN;
            if ((v1 & 1) === 1)
                continue; // a write is in progress - retry
            for (let i = 0; i < copyLen; i++) {
                out[i] = this.f32[base + i] ?? 0;
            }
            const v2 = this.u32[versionIdx] ?? 0;
            if (v1 === v2)
                return v1; // consistent
            // The record was written during the copy - retry.
        }
        return SNAPSHOT_TORN;
    }
    // --- observer registry (gates 3, 7) ---
    // Register a new observer. Returns a generation-stamped handle; the
    // observer's lastSeen starts cleared, so its first readChanged of
    // any written entity reports a change. Throws if the registry is
    // full.
    createObserver() {
        for (let s = 0; s < this.maxObservers; s++) {
            if ((this.observerActive[s] ?? 0) === 0) {
                this.observerActive[s] = 1;
                this.observerCount++;
                const rowStart = s * this.capacity;
                this.observerLastSeen.fill(0, rowStart, rowStart + this.capacity);
                return makeObserverHandle(s, this.observerGen[s] ?? 0);
            }
        }
        throw new Error('AIBehaviorBuffer.createObserver: observer registry full (maxObservers=' + this.maxObservers + ')');
    }
    // Release an observer: free its slot and bump the generation so the
    // old handle stops validating. Returns false if the handle was
    // already stale / released.
    releaseObserver(handle) {
        if (!this.isObserver(handle))
            return false;
        const s = observerSlot(handle);
        this.observerActive[s] = 0;
        this.observerGen[s] = ((this.observerGen[s] ?? 0) + 1) & OBSERVER_GENERATION_MASK;
        this.observerCount--;
        return true;
    }
    // True if `handle` still refers to a live observer - the slot is
    // active and its generation matches the handle.
    isObserver(handle) {
        const s = observerSlot(handle);
        if (s >= this.maxObservers)
            return false;
        if ((this.observerActive[s] ?? 0) === 0)
            return false;
        return (this.observerGen[s] ?? 0) === observerGeneration(handle);
    }
    // Live observer count.
    getObserverCount() {
        return this.observerCount;
    }
    // Read entity `slot` through `observer`, copying the payload into
    // `out` only when the entity changed since the observer last saw a
    // consistent version of it. Returns:
    //   >= 2                   - the consistent version; `out` was
    //                            filled and lastSeen advanced.
    //   SNAPSHOT_UNCHANGED (-2) - consistent read, version matches the
    //                            observer's lastSeen; `out` untouched.
    //   SNAPSHOT_NEVER_WRITTEN  - the slot was never written.
    //   SNAPSHOT_TORN (-1)      - no consistent read within the budget.
    // lastSeen advances ONLY after the seqlock confirms the copy (gate
    // 3). Throws on an out-of-range slot or an invalid observer handle.
    readChanged(observer, slot, out, attempts) {
        const obsSlot = this.requireObserver(observer, 'readChanged');
        this.requireSlot(slot, 'readChanged');
        const tries = this.resolveAttempts(attempts, 'readChanged');
        const base = slot * this.stride;
        const versionIdx = base + this.payloadLength;
        const lastSeenIdx = obsSlot * this.capacity + slot;
        const copyLen = Math.min(out.length, this.payloadLength);
        for (let attempt = 0; attempt < tries; attempt++) {
            const v1 = this.u32[versionIdx] ?? 0;
            if (v1 === 0)
                return SNAPSHOT_NEVER_WRITTEN;
            if ((v1 & 1) === 1)
                continue; // a write is in progress - retry
            if (v1 === (this.observerLastSeen[lastSeenIdx] ?? 0))
                return SNAPSHOT_UNCHANGED;
            for (let i = 0; i < copyLen; i++) {
                out[i] = this.f32[base + i] ?? 0;
            }
            const v2 = this.u32[versionIdx] ?? 0;
            if (v1 === v2) {
                // Advance lastSeen ONLY now the copy is confirmed consistent.
                this.observerLastSeen[lastSeenIdx] = v1;
                return v1;
            }
            // The record was written during the copy - retry.
        }
        return SNAPSHOT_TORN;
    }
    // True if entity `slot` has a change `observer` has not yet seen - a
    // write is in progress, or the published version differs from the
    // observer's lastSeen. False for a never-written slot. Throws on an
    // out-of-range slot or an invalid observer handle.
    hasChanged(observer, slot) {
        const obsSlot = this.requireObserver(observer, 'hasChanged');
        this.requireSlot(slot, 'hasChanged');
        const v = this.u32[slot * this.stride + this.payloadLength] ?? 0;
        if (v === 0)
            return false;
        if ((v & 1) === 1)
            return true;
        return v !== (this.observerLastSeen[obsSlot * this.capacity + slot] ?? 0);
    }
    // The version `observer` last consistently read for entity `slot`
    // (0 if it has never read a consistent snapshot of it). Throws on an
    // out-of-range slot or an invalid observer handle.
    getLastSeen(observer, slot) {
        const obsSlot = this.requireObserver(observer, 'getLastSeen');
        this.requireSlot(slot, 'getLastSeen');
        return this.observerLastSeen[obsSlot * this.capacity + slot] ?? 0;
    }
    // Clear an observer's lastSeen so its next readChanged of any
    // written entity reports a change - for rebuilding an LLM context
    // from scratch. Throws on an invalid observer handle.
    resetObserver(observer) {
        const obsSlot = this.requireObserver(observer, 'resetObserver');
        const rowStart = obsSlot * this.capacity;
        this.observerLastSeen.fill(0, rowStart, rowStart + this.capacity);
    }
    // Reset to the constructed-but-empty state: every version back to 0
    // (never written), every payload float to 0, every observer
    // released. All handles - observer and snapshot - are void after
    // clear().
    clear() {
        // u32 and f32 alias the same bytes, so this zeros the payload too.
        this.u32.fill(0);
        this.observerActive.fill(0);
        this.observerGen.fill(0);
        this.observerLastSeen.fill(0);
        this.observerCount = 0;
    }
    // --- private ---
    requireSlot(slot, op) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity) {
            throw new RangeError('AIBehaviorBuffer.' + op + ': slot ' + slot + ' out of [0, ' + this.capacity + ')');
        }
    }
    resolveAttempts(attempts, op) {
        if (attempts === undefined)
            return DEFAULT_READ_ATTEMPTS;
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_READ_ATTEMPTS) {
            throw new RangeError('AIBehaviorBuffer.' + op + ': attempts must be an integer in [1, ' + MAX_READ_ATTEMPTS
                + '], got ' + attempts);
        }
        return attempts;
    }
    requireObserver(handle, op) {
        const s = observerSlot(handle);
        if (s >= this.maxObservers
            || (this.observerActive[s] ?? 0) === 0
            || (this.observerGen[s] ?? 0) !== observerGeneration(handle)) {
            throw new RangeError('AIBehaviorBuffer.' + op + ': observer handle is invalid or released');
        }
        return s;
    }
}
//# sourceMappingURL=ai-behavior-buffer.js.map