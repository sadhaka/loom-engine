// BlackSwan - the chaos engine: a windowed entropy monitor plus a
// governed event-proposal pipeline. When the world's disruption rate
// crosses a threshold, the Loom may want to inject a "black swan" -
// a systemic disruption. BlackSwan is the SAFE gate for that: it
// NEVER mutates the world. It owns a proposal table; the Mainframe
// (the trusted caller) reads approved / active events and applies them.
//
// The Trinity dossier's section 6 (Gemini Volume I). The Gemini sketch
// was `processEntropy(metrics) { if (Atomics.load(metrics, SLOT) >
// THRESHOLD) this.proposeDisruption("SYSTEMIC_FAILURE") }` pushing a
// `{ type, timestamp: Date.now() }` object onto a command buffer. The
// Codex audit: "strong idea, but LLM cannot directly execute world
// authority." The sketch had a vague unnormalized entropy metric, a
// free-string event type, a wall clock, an Atomics read, and no
// lifecycle - nothing validated, expired, revoked, or audited.
//
// This is the corrected build, in two cooperating halves:
//
// ENTROPY MONITOR. A fixed-size ring of per-tick "disruption weight"
// buckets. addEntropy(n) accumulates into the current tick's bucket;
// tick() rolls the ring. entropy() is the NORMALIZED rate -
// windowedSum / entropyWindow - and entropyExceedsThreshold() compares
// it to a precise threshold. It is pure telemetry: it produces a
// signal, it never proposes anything itself.
//
// GOVERNED EVENT PIPELINE. A fixed-capacity event table whose slots
// move through a state machine:
//   propose()                  (reusable slot) -> PROPOSED
//   approve()  PROPOSED                        -> APPROVED
//   reject()   PROPOSED                        -> REJECTED   (terminal)
//   activate() APPROVED        -> ACTIVE, or   -> CANARY (dry-run)
//   promote()  CANARY                          -> ACTIVE
//   revoke()   APPROVED|CANARY|ACTIVE          -> REVOKED    (terminal)
//   tick()     CANARY|ACTIVE past expiry       -> EXPIRED    (terminal)
// propose() is the sole, uniformly-UNTRUSTED entry point - whether the
// proposer is an LLM Director or the caller reacting to the entropy
// signal, a proposal is inert PROPOSED data until the Mainframe both
// approve()s and activate()s it. Every transition is written to a
// fixed-capacity audit ring.
//
// The 7 Codex gates for Black Swan Chaos Engine, enforced:
//   1. "normalize entropy metrics and define threshold math precisely"
//      - entropy() = windowedSum / entropyWindow, a rate over a fixed
//      ΔT; entropyExceedsThreshold() is exactly entropy() >
//      chaosThreshold. No Atomics - the ring is single-thread owned.
//   2. "treat LLM output as untrusted proposal data" - propose() is
//      the only entry; nothing it produces is effective until
//      approve() + activate(). propose() never throws on bad input
//      (matching AIActionInterpreter) - it counts the rejection and
//      returns EVENT_HANDLE_INVALID.
//   3. "schema validation, enum mapping, bounds checks" - propose()
//      validates every field: proposer < maxProposers, kind is a
//      bounded enum < maxKinds (the Gemini free string is gone),
//      scopeRadius / ttl are bounded integers.
//   4. "server-generate event IDs" - propose() picks the slot and
//      stamps the generation; the proposer never chooses an id. The
//      returned EventHandle packs (generation, slot).
//   5. "provenance, TTL, scope radius, revocation, audit log" - every
//      event records its proposer, ttl, and scopeRadius; revoke()
//      kills a live event; every transition lands in the audit ring.
//   6. "idempotent commands with activation ticks and epochs" - the
//      EventHandle's generation IS the epoch: a command carrying a
//      stale handle (the slot was reused) resolves to nothing and is a
//      no-op. Each transition fires only from its legal prior state,
//      so a repeated command is idempotent. activate() stamps the
//      activation tick.
//   7. "dry-run/canary rollout before activation" - activate(handle,
//      true) lands the event in CANARY (live but flagged dry-run);
//      promote() rolls a CANARY event to full ACTIVE.
//
// Non-negotiable engine gates: no RNG; no wall clock - the Gemini
// Date.now() is replaced by an injected currentTick, so a run replays
// bit-for-bit; single-thread, no Atomics (the Gemini Atomics.load is
// gone); every handle / slot / index bounds-checked; fixed-capacity
// tables. Storage is allocated once in the constructor.
// Event lifecycle states. Exported so a caller can interpret
// getState(). NONE is "slot holds no event" (never used, or cleared).
export const EVENT_STATE_NONE = 0;
export const EVENT_STATE_PROPOSED = 1;
export const EVENT_STATE_APPROVED = 2;
export const EVENT_STATE_CANARY = 3; // live but a flagged dry-run
export const EVENT_STATE_ACTIVE = 4; // live at full effect
export const EVENT_STATE_EXPIRED = 5; // terminal - ttl elapsed
export const EVENT_STATE_REJECTED = 6; // terminal - the Mainframe declined it
export const EVENT_STATE_REVOKED = 7; // terminal - the Mainframe killed a live event
// propose() returns this when a proposal is rejected (schema-invalid
// input, or a full table). It is never a valid handle - a real handle
// always has a slot in [0, maxEvents) and maxEvents <= 1 << 16.
export const EVENT_HANDLE_INVALID = -1;
// readAuditRecord writes fixed-width records of this many u32:
// [slot, generation, kind, transition, tick] where transition packs
// (fromState << 8) | toState.
export const AUDIT_RECORD_STRIDE = 5;
// EventHandle layout, mirroring EntityId / MaterialHandle: low 24 bits
// slot, high 8 bits generation.
const EVENT_INDEX_MASK = 0x00ffffff;
const EVENT_GENERATION_SHIFT = 24;
const EVENT_GENERATION_MASK = 0xff;
// Sanity caps on the config-derived sizes. Not hard engine limits -
// guards so a bad argument throws a clear error instead of attempting
// an absurd typed-array allocation.
const MAX_ENTROPY_WINDOW = 1 << 16;
const MAX_EVENTS = 1 << 16;
const MAX_KINDS = 1 << 16;
const MAX_PROPOSERS = 1 << 24;
const MAX_AUDIT_LOG = 1 << 16;
const U32_MAX = 0xffffffff;
export function makeEventHandle(slot, generation) {
    return ((generation & EVENT_GENERATION_MASK) << EVENT_GENERATION_SHIFT)
        | (slot & EVENT_INDEX_MASK);
}
export function eventSlot(handle) {
    return handle & EVENT_INDEX_MASK;
}
export function eventGeneration(handle) {
    return (handle >>> EVENT_GENERATION_SHIFT) & EVENT_GENERATION_MASK;
}
export class BlackSwan {
    entropyWindow;
    chaosThreshold;
    maxEvents;
    maxKinds;
    maxProposers;
    auditLogSize;
    // --- entropy monitor ---
    // Per-tick disruption-weight buckets, a ring of length entropyWindow.
    entropyBuckets;
    // The bucket addEntropy() currently accumulates into.
    entropyCursor = 0;
    // Running sum of entropyBuckets - kept incrementally so entropy() is
    // O(1). A JS number (<= maxEvents-window * U32_MAX, well under 2^53).
    entropySum = 0;
    // --- event table (gate 1 active-slot metadata is evState) ---
    evState; // EVENT_STATE_*
    evKind; // bounded enum (gate 3)
    evProposer; // provenance (gate 5)
    evScopeRadius; // scope radius (gate 5)
    evTtl; // ticks-to-live (gate 5)
    evActivationTick; // tick it went live (gate 6)
    evExpiryTick; // activationTick + ttl
    evGeneration; // bumped on reuse - the epoch (gate 6)
    // --- audit ring (gate 5) ---
    // auditCount records ever written, monotonic; auditCount %
    // auditLogSize is the next write position.
    auditRing;
    auditCount = 0;
    // Live (PROPOSED / APPROVED / CANARY / ACTIVE) event count.
    liveCount = 0;
    // Proposals rejected (schema-invalid or table-full), monotonic.
    rejectedCount = 0;
    // The most recent tick() value - stamps audit records and the
    // activation / expiry ticks.
    currentTick = 0;
    constructor(config) {
        const { entropyWindow, chaosThreshold, maxEvents, maxKinds, maxProposers, auditLogSize } = config;
        if (!Number.isInteger(entropyWindow) || entropyWindow < 1 || entropyWindow > MAX_ENTROPY_WINDOW) {
            throw new RangeError('BlackSwan: entropyWindow must be an integer in [1, ' + MAX_ENTROPY_WINDOW + '], got ' + entropyWindow);
        }
        if (!Number.isFinite(chaosThreshold) || chaosThreshold < 0) {
            throw new RangeError('BlackSwan: chaosThreshold must be a finite number >= 0, got ' + chaosThreshold);
        }
        if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS) {
            throw new RangeError('BlackSwan: maxEvents must be an integer in [1, ' + MAX_EVENTS + '], got ' + maxEvents);
        }
        if (!Number.isInteger(maxKinds) || maxKinds < 1 || maxKinds > MAX_KINDS) {
            throw new RangeError('BlackSwan: maxKinds must be an integer in [1, ' + MAX_KINDS + '], got ' + maxKinds);
        }
        if (!Number.isInteger(maxProposers) || maxProposers < 1 || maxProposers > MAX_PROPOSERS) {
            throw new RangeError('BlackSwan: maxProposers must be an integer in [1, ' + MAX_PROPOSERS + '], got ' + maxProposers);
        }
        if (!Number.isInteger(auditLogSize) || auditLogSize < 1 || auditLogSize > MAX_AUDIT_LOG) {
            throw new RangeError('BlackSwan: auditLogSize must be an integer in [1, ' + MAX_AUDIT_LOG + '], got ' + auditLogSize);
        }
        this.entropyWindow = entropyWindow;
        this.chaosThreshold = chaosThreshold;
        this.maxEvents = maxEvents;
        this.maxKinds = maxKinds;
        this.maxProposers = maxProposers;
        this.auditLogSize = auditLogSize;
        this.entropyBuckets = new Uint32Array(entropyWindow);
        this.evState = new Uint8Array(maxEvents);
        this.evKind = new Uint16Array(maxEvents);
        this.evProposer = new Uint32Array(maxEvents);
        this.evScopeRadius = new Uint32Array(maxEvents);
        this.evTtl = new Uint32Array(maxEvents);
        this.evActivationTick = new Uint32Array(maxEvents);
        this.evExpiryTick = new Uint32Array(maxEvents);
        this.evGeneration = new Uint8Array(maxEvents);
        this.auditRing = new Uint32Array(auditLogSize * AUDIT_RECORD_STRIDE);
    }
    // --- entropy monitor ---
    // Add `amount` units of disruption weight (deaths, trade failures,
    // whatever the caller counts) to the current tick's bucket. The
    // bucket saturates at U32_MAX rather than wrapping.
    addEntropy(amount) {
        if (!Number.isInteger(amount) || amount < 0 || amount > U32_MAX) {
            throw new RangeError('BlackSwan.addEntropy: amount must be an integer in [0, ' + U32_MAX + '], got ' + amount);
        }
        const cur = this.entropyBuckets[this.entropyCursor] ?? 0;
        let next = cur + amount;
        if (next > U32_MAX)
            next = U32_MAX;
        this.entropyBuckets[this.entropyCursor] = next;
        this.entropySum += next - cur;
    }
    // The normalized entropy rate: the windowed disruption sum divided
    // by the window length. During the first entropyWindow ticks the
    // window is only partially warm, so the rate reads low.
    entropy() {
        return this.entropySum / this.entropyWindow;
    }
    // True when the entropy rate is strictly above chaosThreshold - the
    // signal that the world may want a black swan. Pure telemetry: this
    // proposes nothing on its own.
    entropyExceedsThreshold() {
        return this.entropy() > this.chaosThreshold;
    }
    // The raw windowed disruption sum (entropy() before normalization).
    getEntropySum() {
        return this.entropySum;
    }
    // --- the per-tick step ---
    // Advance one simulation tick: roll the entropy window forward by
    // one bucket and expire any CANARY / ACTIVE event whose ttl has
    // elapsed. `currentTick` must be a non-negative u32 integer; call
    // once per simulation tick with a monotonically increasing value.
    // Returns the number of events expired this tick.
    tick(currentTick) {
        if (!Number.isInteger(currentTick) || currentTick < 0 || currentTick > U32_MAX) {
            throw new RangeError('BlackSwan.tick: currentTick must be an integer in [0, ' + U32_MAX + '], got ' + currentTick);
        }
        this.currentTick = currentTick;
        // Roll the entropy ring: the next bucket is the one that has aged
        // out of the window - drop it from the sum and zero it.
        this.entropyCursor = (this.entropyCursor + 1) % this.entropyWindow;
        this.entropySum -= this.entropyBuckets[this.entropyCursor] ?? 0;
        this.entropyBuckets[this.entropyCursor] = 0;
        // Expire live events past their ttl.
        let expired = 0;
        for (let slot = 0; slot < this.maxEvents; slot++) {
            const state = this.evState[slot] ?? EVENT_STATE_NONE;
            if (state !== EVENT_STATE_CANARY && state !== EVENT_STATE_ACTIVE)
                continue;
            if (currentTick >= (this.evExpiryTick[slot] ?? 0)) {
                this.applyTransition(slot, EVENT_STATE_EXPIRED);
                this.liveCount--;
                expired++;
            }
        }
        return expired;
    }
    // The most recent tick() value (0 before the first tick()).
    getCurrentTick() {
        return this.currentTick;
    }
    // --- event lifecycle (gate 2: propose is the untrusted entry) ---
    // Submit a disruption proposal. ALL inputs are treated as untrusted:
    // any schema failure - proposer / kind / scopeRadius / ttl out of
    // range - or a full table is a counted rejection that returns
    // EVENT_HANDLE_INVALID; propose() never throws (gate 2). On success
    // the event enters PROPOSED with a server-generated, generation-
    // stamped handle (gate 4) and is inert until the Mainframe approves
    // and activates it.
    propose(proposer, kind, scopeRadius, ttl) {
        if (!Number.isInteger(proposer) || proposer < 0 || proposer >= this.maxProposers
            || !Number.isInteger(kind) || kind < 0 || kind >= this.maxKinds
            || !Number.isInteger(scopeRadius) || scopeRadius < 0 || scopeRadius > U32_MAX
            || !Number.isInteger(ttl) || ttl < 1 || ttl > U32_MAX) {
            this.rejectedCount++;
            return EVENT_HANDLE_INVALID;
        }
        // Server-generated id: the first reusable slot (never used, or in a
        // terminal state). Scanned in slot order - deterministic.
        let slot = -1;
        for (let s = 0; s < this.maxEvents; s++) {
            const state = this.evState[s] ?? EVENT_STATE_NONE;
            if (state === EVENT_STATE_NONE || state === EVENT_STATE_EXPIRED
                || state === EVENT_STATE_REJECTED || state === EVENT_STATE_REVOKED) {
                slot = s;
                break;
            }
        }
        if (slot < 0) {
            // Table full - bounded-queue backpressure, not an exception.
            this.rejectedCount++;
            return EVENT_HANDLE_INVALID;
        }
        const prevState = this.evState[slot] ?? EVENT_STATE_NONE;
        // Reusing a terminal slot bumps the generation, so any handle to
        // the old event stops validating (the epoch advances - gate 6).
        if (prevState !== EVENT_STATE_NONE) {
            this.evGeneration[slot] = ((this.evGeneration[slot] ?? 0) + 1) & EVENT_GENERATION_MASK;
        }
        this.evKind[slot] = kind;
        this.evProposer[slot] = proposer;
        this.evScopeRadius[slot] = scopeRadius;
        this.evTtl[slot] = ttl;
        this.evActivationTick[slot] = 0;
        this.evExpiryTick[slot] = 0;
        this.applyTransition(slot, EVENT_STATE_PROPOSED);
        this.liveCount++;
        return makeEventHandle(slot, this.evGeneration[slot] ?? 0);
    }
    // Mainframe command: PROPOSED -> APPROVED. Returns false (a no-op)
    // for a stale handle or an event not in PROPOSED - so a repeated
    // approve is idempotent (gate 6).
    approve(handle) {
        const slot = this.resolveSlot(handle);
        if (slot < 0 || (this.evState[slot] ?? EVENT_STATE_NONE) !== EVENT_STATE_PROPOSED)
            return false;
        this.applyTransition(slot, EVENT_STATE_APPROVED);
        return true;
    }
    // Mainframe command: PROPOSED -> REJECTED (terminal). Returns false
    // for a stale handle or an event not in PROPOSED.
    reject(handle) {
        const slot = this.resolveSlot(handle);
        if (slot < 0 || (this.evState[slot] ?? EVENT_STATE_NONE) !== EVENT_STATE_PROPOSED)
            return false;
        this.applyTransition(slot, EVENT_STATE_REJECTED);
        this.liveCount--;
        return true;
    }
    // Mainframe command: APPROVED -> ACTIVE, or -> CANARY when asCanary
    // is true (a live dry-run, gate 7). Stamps the activation tick with
    // the current tick and computes the expiry tick (saturating at
    // U32_MAX). Returns false for a stale handle or an event not in
    // APPROVED.
    activate(handle, asCanary) {
        const slot = this.resolveSlot(handle);
        if (slot < 0 || (this.evState[slot] ?? EVENT_STATE_NONE) !== EVENT_STATE_APPROVED)
            return false;
        this.evActivationTick[slot] = this.currentTick;
        let expiry = this.currentTick + (this.evTtl[slot] ?? 0);
        if (expiry > U32_MAX)
            expiry = U32_MAX;
        this.evExpiryTick[slot] = expiry;
        this.applyTransition(slot, asCanary ? EVENT_STATE_CANARY : EVENT_STATE_ACTIVE);
        return true;
    }
    // Mainframe command: CANARY -> ACTIVE - roll a dry-run event to full
    // effect (gate 7). Returns false for a stale handle or an event not
    // in CANARY.
    promote(handle) {
        const slot = this.resolveSlot(handle);
        if (slot < 0 || (this.evState[slot] ?? EVENT_STATE_NONE) !== EVENT_STATE_CANARY)
            return false;
        this.applyTransition(slot, EVENT_STATE_ACTIVE);
        return true;
    }
    // Mainframe command: APPROVED | CANARY | ACTIVE -> REVOKED
    // (terminal) - kill a live event (gate 5 revocation). Returns false
    // for a stale handle or an event that is not live.
    revoke(handle) {
        const slot = this.resolveSlot(handle);
        if (slot < 0)
            return false;
        const state = this.evState[slot] ?? EVENT_STATE_NONE;
        if (state !== EVENT_STATE_APPROVED && state !== EVENT_STATE_CANARY && state !== EVENT_STATE_ACTIVE) {
            return false;
        }
        this.applyTransition(slot, EVENT_STATE_REVOKED);
        this.liveCount--;
        return true;
    }
    // --- event queries ---
    // The event's lifecycle state, or EVENT_STATE_NONE for a stale /
    // invalid handle.
    getState(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? EVENT_STATE_NONE : (this.evState[slot] ?? EVENT_STATE_NONE);
    }
    // True if the event is PROPOSED, APPROVED, CANARY, or ACTIVE.
    isLive(handle) {
        const state = this.getState(handle);
        return state === EVENT_STATE_PROPOSED || state === EVENT_STATE_APPROVED
            || state === EVENT_STATE_CANARY || state === EVENT_STATE_ACTIVE;
    }
    // True only for a fully ACTIVE event (not a CANARY dry-run).
    isActive(handle) {
        return this.getState(handle) === EVENT_STATE_ACTIVE;
    }
    // True for a CANARY (live dry-run) event.
    isCanary(handle) {
        return this.getState(handle) === EVENT_STATE_CANARY;
    }
    // Per-field reads. Each returns -1 for a stale / invalid handle.
    getKind(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.evKind[slot] ?? -1);
    }
    getProposer(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.evProposer[slot] ?? -1);
    }
    getScopeRadius(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.evScopeRadius[slot] ?? -1);
    }
    getTtl(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.evTtl[slot] ?? -1);
    }
    // The tick the event was activated, or 0 if it has not been
    // activated, or -1 for a stale / invalid handle.
    getActivationTick(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.evActivationTick[slot] ?? -1);
    }
    // The tick the event expires (activationTick + ttl), or 0 if not
    // activated, or -1 for a stale / invalid handle.
    getExpiryTick(handle) {
        const slot = this.resolveSlot(handle);
        return slot < 0 ? -1 : (this.evExpiryTick[slot] ?? -1);
    }
    // Live (PROPOSED / APPROVED / CANARY / ACTIVE) event count.
    getLiveEventCount() {
        return this.liveCount;
    }
    // Proposals rejected for schema failure or a full table, monotonic.
    getRejectedProposalCount() {
        return this.rejectedCount;
    }
    // Write the handles of every event currently in `state` into
    // `outHandles`, returning the count. `state` must be a real
    // lifecycle state (PROPOSED..REVOKED). If `outHandles` cannot hold
    // them all the result is truncated. The Mainframe uses this to find
    // its review queue, e.g. exportEventsByState(EVENT_STATE_PROPOSED, ...).
    exportEventsByState(state, outHandles) {
        if (!Number.isInteger(state) || state < EVENT_STATE_PROPOSED || state > EVENT_STATE_REVOKED) {
            throw new RangeError('BlackSwan.exportEventsByState: state ' + state + ' is not a lifecycle state ['
                + EVENT_STATE_PROPOSED + ', ' + EVENT_STATE_REVOKED + ']');
        }
        const cap = outHandles.length;
        let count = 0;
        for (let slot = 0; slot < this.maxEvents && count < cap; slot++) {
            if ((this.evState[slot] ?? EVENT_STATE_NONE) !== state)
                continue;
            outHandles[count] = makeEventHandle(slot, this.evGeneration[slot] ?? 0);
            count++;
        }
        return count;
    }
    // --- audit log (gate 5) ---
    // Total transitions ever recorded, monotonic (may exceed auditLogSize
    // once the ring has wrapped and started overwriting).
    getAuditCount() {
        return this.auditCount;
    }
    // Transitions currently retained in the ring: min(auditCount,
    // auditLogSize).
    getAuditSize() {
        return this.auditCount < this.auditLogSize ? this.auditCount : this.auditLogSize;
    }
    // Copy retained audit record `index` (0 = oldest retained) into
    // `out` as [slot, generation, kind, transition, tick], where
    // transition packs (fromState << 8) | toState. `out` must hold at
    // least AUDIT_RECORD_STRIDE entries.
    readAuditRecord(index, out) {
        const size = this.getAuditSize();
        if (!Number.isInteger(index) || index < 0 || index >= size) {
            throw new RangeError('BlackSwan.readAuditRecord: index ' + index + ' out of [0, ' + size + ')');
        }
        if (out.length < AUDIT_RECORD_STRIDE) {
            throw new RangeError('BlackSwan.readAuditRecord: out must hold at least ' + AUDIT_RECORD_STRIDE + ' entries, got ' + out.length);
        }
        // Once the ring has wrapped, the oldest retained record sits at the
        // next-write position (auditCount % auditLogSize); before that it
        // is at 0.
        const oldest = this.auditCount <= this.auditLogSize ? 0 : (this.auditCount % this.auditLogSize);
        const ringPos = (oldest + index) % this.auditLogSize;
        const base = ringPos * AUDIT_RECORD_STRIDE;
        out[0] = this.auditRing[base] ?? 0;
        out[1] = this.auditRing[base + 1] ?? 0;
        out[2] = this.auditRing[base + 2] ?? 0;
        out[3] = this.auditRing[base + 3] ?? 0;
        out[4] = this.auditRing[base + 4] ?? 0;
    }
    // Reset to the constructed-but-empty state. All handles are void
    // after clear().
    clear() {
        this.entropyBuckets.fill(0);
        this.entropyCursor = 0;
        this.entropySum = 0;
        this.evState.fill(EVENT_STATE_NONE);
        this.evKind.fill(0);
        this.evProposer.fill(0);
        this.evScopeRadius.fill(0);
        this.evTtl.fill(0);
        this.evActivationTick.fill(0);
        this.evExpiryTick.fill(0);
        this.evGeneration.fill(0);
        this.auditRing.fill(0);
        this.auditCount = 0;
        this.liveCount = 0;
        this.rejectedCount = 0;
        this.currentTick = 0;
    }
    // --- private ---
    // Resolve a handle to its slot, or -1 if the handle is invalid: a
    // non-integer, an out-of-range slot, a NONE slot, or a generation
    // mismatch (the slot was reused - a stale epoch, gate 6).
    resolveSlot(handle) {
        if (!Number.isInteger(handle))
            return -1;
        const slot = eventSlot(handle);
        if (slot >= this.maxEvents)
            return -1;
        if ((this.evState[slot] ?? EVENT_STATE_NONE) === EVENT_STATE_NONE)
            return -1;
        if ((this.evGeneration[slot] ?? 0) !== eventGeneration(handle))
            return -1;
        return slot;
    }
    // Set a slot's state and write the transition to the audit ring.
    applyTransition(slot, toState) {
        const fromState = this.evState[slot] ?? EVENT_STATE_NONE;
        this.evState[slot] = toState;
        const base = (this.auditCount % this.auditLogSize) * AUDIT_RECORD_STRIDE;
        this.auditRing[base] = slot;
        this.auditRing[base + 1] = this.evGeneration[slot] ?? 0;
        this.auditRing[base + 2] = this.evKind[slot] ?? 0;
        this.auditRing[base + 3] = (fromState << 8) | toState;
        this.auditRing[base + 4] = this.currentTick;
        this.auditCount++;
    }
}
//# sourceMappingURL=black-swan.js.map