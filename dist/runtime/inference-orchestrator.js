// InferenceOrchestrator - the NPC-AI inference router: a per-tick
// request queue split into LANE_LOCAL_SLM (consented low-priority
// local compute) and LANE_CLOUD (rate-limited high-stakes cloud LLM),
// drained as zero-allocation batches under hard token / rate / TTL
// budgets, with action validation on the result side.
//
// The Trinity dossier's section 18 (Gemini Volume I). The Gemini sketch
// was `async requestInference(npcs[]): Promise<void> { if budget<=0
// return; batch = npcs.slice(0, MAX_BATCH); results = await
// localSLM.process(batch); buffer.writeBatch(results) }`. The Codex
// audit: "useful routing idea but async fanout and privacy / cost
// controls missing." The sketch had unbatched Promise dispatch (one
// or one batch per call - no smoothing across NPCs), no cloud rate
// limit / deadline / cancellation / stale-response guard, no
// consent gate for the local SLM, no action validation after
// inference (the model could return an arbitrary action that the
// AI buffer would obediently apply), no concurrency-safe budget
// debit, and no ceiling on critical-NPC bypass (any NPC tagged
// CRITICAL ate as much budget as it wanted).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual local-SLM and cloud-LLM
// HTTP calls are the deferred integration layer; this is the pure-
// logic REQUEST-QUEUE / BATCH-BUILDER / BUDGET / RATE-LIMITER /
// TTL-CANCELLER / RESULT-VALIDATOR kernel that drives them.
//
// LANES. Two lanes:
//   LANE_LOCAL_SLM - consented low-priority compute on-device. The
//     setLocalSlmEnabled(false) consent gate disables the entire
//     lane; requests submitted while disabled are transparently
//     re-routed to LANE_CLOUD if its budget permits, else dropped
//     with REASON_CONSENT_DENIED.
//   LANE_CLOUD - rate-limited high-stakes cloud LLM. Lower request
//     ceiling; higher tokens-per-request; deadline pressure.
// Each lane has its own SoA queue, token budget, rate-limit counter,
// and inflight tracking.
//
// REQUEST PIPELINE (gate 1). submitRequest(npcId, lane, priority,
// estimatedTokens, ttlTicks) returns a RequestHandle - a packed
// (generation, slot) into the lane's request table. drainBatch(
// lane, maxBatchSize, out) writes a dense array of npcIds into out
// and returns the count. The deferred dispatcher takes the batch,
// makes ONE inference call (no Promise per NPC), and reports the
// outcome with completeRequest. Stale handles (slot reused) are
// rejected.
//
// TOKEN BUDGET (gates 5, 6). Per-lane Uint32 budget. submitRequest
// reserves estimatedTokens up front; the budget is concurrency-safe
// in single-thread (a regression to multi-thread would replace the
// debit with Atomics.sub - the structure is the seam). Critical-
// priority requests STILL respect a budget ceiling: even
// PRIORITY_CRITICAL is capped at criticalBudgetCeiling tokens per
// tick, so a runaway model cannot drain the cloud budget on one NPC.
// Refill happens at tick() up to maxBudget.
//
// RATE LIMIT + DEADLINES + CANCELLATION (gate 2). Per-lane request
// counter resets at tick(); requests past maxRequestsPerTick are
// dropped with REASON_RATE_LIMITED. Each request carries a TTL; a
// request not drained within ttlTicks is cancelled with
// REASON_DEADLINE_EXCEEDED at the next tick(). cancelRequest(handle)
// is the explicit cancellation path - the slot is invalidated; the
// dispatcher checks completeRequest's generation guard before
// applying.
//
// CONSENT GATE (gate 3). setLocalSlmEnabled(false) disables the
// entire LOCAL_SLM lane; any request to it is silently re-routed to
// CLOUD if budget allows, else dropped with REASON_CONSENT_DENIED
// (the consumer can switch the consent UI on/off without code
// changes). Default is enabled.
//
// ACTION VALIDATION (gate 4). Each actionType has a registered
// allowedResultMask u32; completeRequest's resultActionMask must
// have NO bits set outside the allowed mask. An invalid result is
// rejected with REASON_BAD_RESULT and never reaches the AI buffer.
// This is the "untrusted LLM output" gate matching the AIAction-
// Interpreter doctrine.
//
// The 6 Codex gates for InferenceOrchestrator, enforced:
//   1. "batch NPC inference; no Promise per NPC" - submit -> drain
//      -> complete pipeline; drainBatch yields a typed array of
//      npcIds for one batched inference call; the deferred
//      dispatcher does ONE Promise per batch.
//   2. "hard cloud rate limits, deadlines, cancellation, stale-
//      response guards" - per-lane maxRequestsPerTick + per-request
//      ttlTicks + cancelRequest + (slot generation) staleness check
//      on completeRequest.
//   3. "treat local SLM as optional consented low-priority compute" -
//      setLocalSlmEnabled gates the lane; default enabled; off means
//      transparent re-route to CLOUD if its budget permits else drop.
//   4. "add action validation after inference" - registerActionType(
//      actionType, allowedResultMask); completeRequest validates
//      resultActionMask & ~allowedMask === 0 or rejects.
//   5. "make token budget concurrency-safe" - per-lane Uint32 budget;
//      the debit is structured as one operation so a future SAB
//      variant maps to Atomics.sub. Single-thread today.
//   6. "critical NPC bypass still needs budget ceiling" -
//      criticalBudgetCeiling caps even PRIORITY_CRITICAL per tick;
//      a runaway critical-tagged stream cannot eat the lane.
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is an
// injected parameter, so a run replays bit-for-bit; single-thread,
// no Atomics today (the SAB multi-producer variant is the deferred
// integration layer); every npcId / actionType / handle / slot
// bounds-checked; fixed-capacity storage. Storage allocated once
// in the constructor.
// Lanes. Two are exposed; the kernel can be extended later by adding
// columns. Lane index is in [0, LANE_COUNT).
export const LANE_LOCAL_SLM = 0;
export const LANE_CLOUD = 1;
const LANE_COUNT = 2;
// Priorities. Higher = more important; CRITICAL bypasses some normal
// gating (still respects criticalBudgetCeiling - gate 6).
export const PRIORITY_LOW = 0;
export const PRIORITY_NORMAL = 1;
export const PRIORITY_HIGH = 2;
export const PRIORITY_CRITICAL = 3;
const PRIORITY_COUNT = 4;
// Request lifecycle. NONE means an empty slot. drainBatch transitions
// PENDING -> INFLIGHT; completeRequest transitions INFLIGHT ->
// COMPLETED (terminal); cancelRequest -> CANCELLED (terminal); a TTL
// sweep -> EXPIRED (terminal).
export const REQUEST_STATE_NONE = 0;
export const REQUEST_STATE_PENDING = 1;
export const REQUEST_STATE_INFLIGHT = 2;
export const REQUEST_STATE_COMPLETED = 3;
export const REQUEST_STATE_CANCELLED = 4;
export const REQUEST_STATE_EXPIRED = 5;
// completeRequest reasons. Used both for completion (REASON_NONE = ok)
// and for explicit drops (every failure path tags one).
export const REASON_NONE = 0;
export const REASON_RATE_LIMITED = 1; // submit dropped: lane at maxRequestsPerTick
export const REASON_BUDGET_EXHAUSTED = 2; // submit dropped: lane budget < estimatedTokens
export const REASON_CRITICAL_CEILING = 3; // submit dropped: criticalBudgetCeiling exceeded
export const REASON_CONSENT_DENIED = 4; // submit dropped: LOCAL_SLM disabled, CLOUD also gated
export const REASON_DEADLINE_EXCEEDED = 5; // tick() found request past ttl
export const REASON_BAD_RESULT = 6; // completeRequest action mask out of allowed bits
export const REASON_STALE_HANDLE = 7; // completeRequest's handle generation mismatched
export const REASON_BAD_LANE = 8; // submitRequest lane out of range
export const REASON_BAD_PRIORITY = 9; // submitRequest priority out of range
export const REASON_BAD_NPC = 10; // submitRequest npcId out of range
export const REASON_BAD_TOKENS = 11; // submitRequest estimatedTokens out of range
export const REASON_BAD_TTL = 12; // submitRequest ttlTicks out of range
export const REASON_BAD_ACTION = 13; // completeRequest actionType out of range
// Sentinels.
export const REQUEST_HANDLE_INVALID = -1;
// Drop event record stride. drainDropEvent yields:
// [npcId, lane, priority, reason, tickEmitted]. The consumer pipes
// these to a moderation / metrics surface; the orchestrator never
// retries on its own.
export const DROP_EVENT_STRIDE = 5;
// Sanity caps on config-derived sizes - guards so a bad argument
// throws a clear error instead of attempting an absurd typed-array
// allocation.
const MAX_NPC = 1 << 20;
const MAX_ACTION_TYPES = 1 << 12;
const MAX_REQUESTS_PER_LANE = 1 << 14;
const MAX_BATCH_SIZE = 1 << 10;
const MAX_BUDGET = 1 << 24;
const MAX_RATE = 1 << 16;
const MAX_TTL = 1 << 16;
const U32_MAX = 0xffffffff;
// Request slot handle layout: low 24 bits slot, high 8 bits generation.
// We pack the lane into the slot - low 16 bits slot, bits 16-23 lane,
// bits 24-31 generation. slot is in [0, perLaneCapacity); lane is in
// [0, LANE_COUNT).
const HANDLE_SLOT_MASK = 0x0000ffff;
const HANDLE_LANE_SHIFT = 16;
const HANDLE_LANE_MASK = 0xff;
const HANDLE_GENERATION_SHIFT = 24;
const HANDLE_GENERATION_MASK = 0xff;
export function makeRequestHandle(slot, lane, generation) {
    return ((generation & HANDLE_GENERATION_MASK) << HANDLE_GENERATION_SHIFT)
        | ((lane & HANDLE_LANE_MASK) << HANDLE_LANE_SHIFT)
        | (slot & HANDLE_SLOT_MASK);
}
export function requestSlot(handle) {
    return handle & HANDLE_SLOT_MASK;
}
export function requestLane(handle) {
    return (handle >>> HANDLE_LANE_SHIFT) & HANDLE_LANE_MASK;
}
export function requestGeneration(handle) {
    return (handle >>> HANDLE_GENERATION_SHIFT) & HANDLE_GENERATION_MASK;
}
export class InferenceOrchestrator {
    maxNpc;
    maxActionTypes;
    perLaneCapacity;
    maxBatchSize;
    dropEventCapacity;
    defaultTtlTicks;
    laneMaxBudget; // [LANE_COUNT]
    laneRefillPerTick;
    laneMaxRequestsPerTick;
    laneCriticalCeiling;
    // Per-lane runtime state.
    laneBudget; // [LANE_COUNT]
    laneRequestsThisTick;
    laneCriticalSpentThisTick;
    // Per-lane request slot tables. Indexed [lane * perLaneCapacity + slot].
    slotState;
    slotNpcId;
    slotPriority;
    slotEstimatedTokens;
    slotSubmittedAtTick;
    slotExpiresAtTick;
    slotGeneration;
    // Per-lane pending count.
    lanePendingCount;
    // Per-lane next-free probe hint - O(1) in the common path.
    laneFreeHint;
    // Per-actionType allowed-result-mask (gate 4). 0 = no actionType
    // registered (the kernel rejects any result tagged with this
    // actionType - a defensive default).
    actionAllowedMask;
    // Whether the actionType has been registered - distinguishes "no
    // bits allowed" (allowed mask 0) from "type unknown" (rejected).
    actionRegistered;
    // Drop-event ring (gate 1, 2 - the consumer drains drops to track
    // metrics; the orchestrator never retries on its own).
    dropEventRing;
    dropEventHead = 0;
    dropEventTail = 0;
    dropOverflowCount = 0;
    localSlmEnabled = true;
    currentTick = 0;
    completedTotal = 0;
    cancelledTotal = 0;
    expiredTotal = 0;
    rejectedResultsTotal = 0;
    constructor(config) {
        const { maxNpc, maxActionTypes, perLaneCapacity, maxBatchSize, dropEventCapacity, localSlmMaxBudget, localSlmRefillPerTick, cloudMaxBudget, cloudRefillPerTick, localSlmMaxRequestsPerTick, cloudMaxRequestsPerTick, localSlmCriticalCeiling, cloudCriticalCeiling, defaultTtlTicks, } = config;
        if (!Number.isInteger(maxNpc) || maxNpc < 1 || maxNpc > MAX_NPC) {
            throw new RangeError('InferenceOrchestrator: maxNpc out of range, got ' + maxNpc);
        }
        if (!Number.isInteger(maxActionTypes) || maxActionTypes < 1 || maxActionTypes > MAX_ACTION_TYPES) {
            throw new RangeError('InferenceOrchestrator: maxActionTypes out of range, got ' + maxActionTypes);
        }
        if (!Number.isInteger(perLaneCapacity) || perLaneCapacity < 1 || perLaneCapacity > MAX_REQUESTS_PER_LANE) {
            throw new RangeError('InferenceOrchestrator: perLaneCapacity out of range, got ' + perLaneCapacity);
        }
        if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > MAX_BATCH_SIZE) {
            throw new RangeError('InferenceOrchestrator: maxBatchSize out of range, got ' + maxBatchSize);
        }
        if (!Number.isInteger(dropEventCapacity) || dropEventCapacity < 1 || dropEventCapacity > 1 << 16) {
            throw new RangeError('InferenceOrchestrator: dropEventCapacity out of range, got ' + dropEventCapacity);
        }
        for (const [name, val] of [
            ['localSlmMaxBudget', localSlmMaxBudget],
            ['localSlmRefillPerTick', localSlmRefillPerTick],
            ['cloudMaxBudget', cloudMaxBudget],
            ['cloudRefillPerTick', cloudRefillPerTick],
            ['localSlmCriticalCeiling', localSlmCriticalCeiling],
            ['cloudCriticalCeiling', cloudCriticalCeiling],
        ]) {
            if (!Number.isInteger(val) || val < 0 || val > MAX_BUDGET) {
                throw new RangeError('InferenceOrchestrator: ' + name + ' out of range, got ' + val);
            }
        }
        for (const [name, val] of [
            ['localSlmMaxRequestsPerTick', localSlmMaxRequestsPerTick],
            ['cloudMaxRequestsPerTick', cloudMaxRequestsPerTick],
        ]) {
            if (!Number.isInteger(val) || val < 0 || val > MAX_RATE) {
                throw new RangeError('InferenceOrchestrator: ' + name + ' out of range, got ' + val);
            }
        }
        if (!Number.isInteger(defaultTtlTicks) || defaultTtlTicks < 1 || defaultTtlTicks > MAX_TTL) {
            throw new RangeError('InferenceOrchestrator: defaultTtlTicks out of range, got ' + defaultTtlTicks);
        }
        this.maxNpc = maxNpc;
        this.maxActionTypes = maxActionTypes;
        this.perLaneCapacity = perLaneCapacity;
        this.maxBatchSize = maxBatchSize;
        this.dropEventCapacity = dropEventCapacity;
        this.defaultTtlTicks = defaultTtlTicks;
        this.laneMaxBudget = new Uint32Array(LANE_COUNT);
        this.laneMaxBudget[LANE_LOCAL_SLM] = localSlmMaxBudget;
        this.laneMaxBudget[LANE_CLOUD] = cloudMaxBudget;
        this.laneRefillPerTick = new Uint32Array(LANE_COUNT);
        this.laneRefillPerTick[LANE_LOCAL_SLM] = localSlmRefillPerTick;
        this.laneRefillPerTick[LANE_CLOUD] = cloudRefillPerTick;
        this.laneMaxRequestsPerTick = new Uint32Array(LANE_COUNT);
        this.laneMaxRequestsPerTick[LANE_LOCAL_SLM] = localSlmMaxRequestsPerTick;
        this.laneMaxRequestsPerTick[LANE_CLOUD] = cloudMaxRequestsPerTick;
        this.laneCriticalCeiling = new Uint32Array(LANE_COUNT);
        this.laneCriticalCeiling[LANE_LOCAL_SLM] = localSlmCriticalCeiling;
        this.laneCriticalCeiling[LANE_CLOUD] = cloudCriticalCeiling;
        // Initial lane state - budgets start at max (a fresh tick).
        this.laneBudget = new Uint32Array(LANE_COUNT);
        this.laneBudget[LANE_LOCAL_SLM] = localSlmMaxBudget;
        this.laneBudget[LANE_CLOUD] = cloudMaxBudget;
        this.laneRequestsThisTick = new Uint32Array(LANE_COUNT);
        this.laneCriticalSpentThisTick = new Uint32Array(LANE_COUNT);
        this.lanePendingCount = new Uint32Array(LANE_COUNT);
        this.laneFreeHint = new Uint32Array(LANE_COUNT);
        const totalSlots = LANE_COUNT * perLaneCapacity;
        this.slotState = new Uint8Array(totalSlots);
        this.slotNpcId = new Int32Array(totalSlots).fill(-1);
        this.slotPriority = new Uint8Array(totalSlots);
        this.slotEstimatedTokens = new Uint32Array(totalSlots);
        this.slotSubmittedAtTick = new Uint32Array(totalSlots);
        this.slotExpiresAtTick = new Uint32Array(totalSlots);
        this.slotGeneration = new Uint8Array(totalSlots);
        this.actionAllowedMask = new Uint32Array(maxActionTypes);
        this.actionRegistered = new Uint8Array(maxActionTypes);
        this.dropEventRing = new Int32Array(dropEventCapacity * DROP_EVENT_STRIDE);
    }
    // --- counts ---
    getCurrentTick() { return this.currentTick; }
    getLanePendingCount(lane) {
        if (!this.requireLane(lane))
            return 0;
        return this.lanePendingCount[lane] ?? 0;
    }
    getLaneBudget(lane) {
        if (!this.requireLane(lane))
            return 0;
        return this.laneBudget[lane] ?? 0;
    }
    getLaneRequestsThisTick(lane) {
        if (!this.requireLane(lane))
            return 0;
        return this.laneRequestsThisTick[lane] ?? 0;
    }
    getLaneCriticalSpentThisTick(lane) {
        if (!this.requireLane(lane))
            return 0;
        return this.laneCriticalSpentThisTick[lane] ?? 0;
    }
    getCompletedTotal() { return this.completedTotal; }
    getCancelledTotal() { return this.cancelledTotal; }
    getExpiredTotal() { return this.expiredTotal; }
    getRejectedResultsTotal() { return this.rejectedResultsTotal; }
    getDropEventCount() { return this.dropEventTail - this.dropEventHead; }
    getDropOverflowCount() { return this.dropOverflowCount; }
    isLocalSlmEnabled() { return this.localSlmEnabled; }
    // --- consent gate (gate 3) ---
    // Toggle the local SLM consent. When false, requests submitted to
    // LANE_LOCAL_SLM transparently re-route to LANE_CLOUD if its budget
    // permits, else dropped with REASON_CONSENT_DENIED.
    setLocalSlmEnabled(enabled) {
        this.localSlmEnabled = !!enabled;
    }
    // --- action type registry (gate 4) ---
    // Register an actionType with its allowed-result-mask. Result bits
    // outside the mask are rejected by completeRequest. Returns false
    // on out-of-range actionType / mask.
    registerActionType(actionType, allowedResultMask) {
        if (!Number.isInteger(actionType) || actionType < 0 || actionType >= this.maxActionTypes)
            return false;
        if (!Number.isInteger(allowedResultMask) || allowedResultMask < 0 || allowedResultMask > U32_MAX)
            return false;
        this.actionAllowedMask[actionType] = allowedResultMask >>> 0;
        this.actionRegistered[actionType] = 1;
        return true;
    }
    isActionTypeRegistered(actionType) {
        if (!Number.isInteger(actionType) || actionType < 0 || actionType >= this.maxActionTypes)
            return false;
        return (this.actionRegistered[actionType] ?? 0) === 1;
    }
    // --- request submission (gates 1, 2, 5, 6) ---
    // Submit an inference request. Returns a RequestHandle the
    // dispatcher uses for completeRequest, or REQUEST_HANDLE_INVALID
    // if the submission is rejected. Every rejection lands a drop
    // event with a reason for the consumer's metrics surface.
    submitRequest(npcId, lane, priority, estimatedTokens, ttlTicks) {
        if (!this.requireLane(lane)) {
            this.pushDrop(npcId, lane, priority, REASON_BAD_LANE);
            return REQUEST_HANDLE_INVALID;
        }
        if (!this.requirePriority(priority)) {
            this.pushDrop(npcId, lane, priority, REASON_BAD_PRIORITY);
            return REQUEST_HANDLE_INVALID;
        }
        if (!this.requireNpcId(npcId)) {
            this.pushDrop(npcId, lane, priority, REASON_BAD_NPC);
            return REQUEST_HANDLE_INVALID;
        }
        if (!Number.isInteger(estimatedTokens) || estimatedTokens < 0 || estimatedTokens > MAX_BUDGET) {
            this.pushDrop(npcId, lane, priority, REASON_BAD_TOKENS);
            return REQUEST_HANDLE_INVALID;
        }
        const ttl = ttlTicks ?? this.defaultTtlTicks;
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL) {
            this.pushDrop(npcId, lane, priority, REASON_BAD_TTL);
            return REQUEST_HANDLE_INVALID;
        }
        // Re-route LOCAL_SLM submissions when consent is denied (gate 3).
        let effectiveLane = lane;
        if (lane === LANE_LOCAL_SLM && !this.localSlmEnabled) {
            effectiveLane = LANE_CLOUD;
        }
        return this.submitToLane(effectiveLane, npcId, priority, estimatedTokens, ttl);
    }
    submitToLane(lane, npcId, priority, estimatedTokens, ttl) {
        // Rate limit (gate 2).
        const rateMax = this.laneMaxRequestsPerTick[lane] ?? 0;
        const rateNow = this.laneRequestsThisTick[lane] ?? 0;
        if (rateNow >= rateMax) {
            this.pushDrop(npcId, lane, priority, REASON_RATE_LIMITED);
            // For LOCAL_SLM->CLOUD reroute under consent denial, the rate
            // limit on CLOUD means we cannot serve the request at all.
            // Match the consent-denied semantic.
            return REQUEST_HANDLE_INVALID;
        }
        // Critical-priority ceiling (gate 6) - applies to PRIORITY_CRITICAL
        // *in addition* to the normal budget.
        if (priority === PRIORITY_CRITICAL) {
            const ceiling = this.laneCriticalCeiling[lane] ?? 0;
            const spent = this.laneCriticalSpentThisTick[lane] ?? 0;
            if (spent + estimatedTokens > ceiling) {
                this.pushDrop(npcId, lane, priority, REASON_CRITICAL_CEILING);
                return REQUEST_HANDLE_INVALID;
            }
        }
        // Budget check + debit (gates 5, 6).
        const budget = this.laneBudget[lane] ?? 0;
        if (budget < estimatedTokens) {
            this.pushDrop(npcId, lane, priority, REASON_BUDGET_EXHAUSTED);
            return REQUEST_HANDLE_INVALID;
        }
        // Debit. Single-thread; the structure is the seam for a future
        // SAB Atomics.sub variant.
        this.laneBudget[lane] = (budget - estimatedTokens) >>> 0;
        if (priority === PRIORITY_CRITICAL) {
            this.laneCriticalSpentThisTick[lane] = ((this.laneCriticalSpentThisTick[lane] ?? 0) + estimatedTokens) >>> 0;
        }
        this.laneRequestsThisTick[lane] = (rateNow + 1) >>> 0;
        // Allocate a slot. Probe from the lane's free hint.
        const slot = this.allocSlot(lane);
        if (slot < 0) {
            // Lane queue full - refund the budget + rate counter and drop.
            this.laneBudget[lane] = ((this.laneBudget[lane] ?? 0) + estimatedTokens) >>> 0;
            this.laneRequestsThisTick[lane] = ((this.laneRequestsThisTick[lane] ?? 0) - 1) >>> 0;
            if (priority === PRIORITY_CRITICAL) {
                this.laneCriticalSpentThisTick[lane] = ((this.laneCriticalSpentThisTick[lane] ?? 0) - estimatedTokens) >>> 0;
            }
            this.pushDrop(npcId, lane, priority, REASON_RATE_LIMITED);
            return REQUEST_HANDLE_INVALID;
        }
        const idx = lane * this.perLaneCapacity + slot;
        this.slotState[idx] = REQUEST_STATE_PENDING;
        this.slotNpcId[idx] = npcId | 0;
        this.slotPriority[idx] = priority & 0xff;
        this.slotEstimatedTokens[idx] = estimatedTokens >>> 0;
        this.slotSubmittedAtTick[idx] = this.currentTick >>> 0;
        this.slotExpiresAtTick[idx] = (this.currentTick + ttl) >>> 0;
        // Bump generation so a stale handle from a prior occupant is
        // distinguishable.
        this.slotGeneration[idx] = ((this.slotGeneration[idx] ?? 0) + 1) & HANDLE_GENERATION_MASK;
        this.lanePendingCount[lane] = ((this.lanePendingCount[lane] ?? 0) + 1) >>> 0;
        return makeRequestHandle(slot, lane, this.slotGeneration[idx] ?? 0);
    }
    // Allocate the lowest-indexed free slot in a lane. Returns -1 if
    // the lane is full.
    allocSlot(lane) {
        const start = this.laneFreeHint[lane] ?? 0;
        const cap = this.perLaneCapacity;
        for (let probe = 0; probe < cap; probe++) {
            const slot = (start + probe) % cap;
            const idx = lane * cap + slot;
            if (this.slotState[idx] === REQUEST_STATE_NONE) {
                this.laneFreeHint[lane] = (slot + 1) % cap;
                return slot;
            }
        }
        return -1;
    }
    // --- batch drain (gate 1) ---
    // Drain up to `count` PENDING requests from `lane` into `out`,
    // transitioning them to INFLIGHT. Returns the number of requests
    // drained. The deferred dispatcher passes the batch as a single
    // request to the model API. Higher-priority requests come first;
    // ties broken by submittedAtTick (FIFO).
    drainBatch(lane, count, out) {
        if (!this.requireLane(lane))
            return 0;
        if (!Number.isInteger(count) || count < 1 || count > this.maxBatchSize)
            return 0;
        if (out.length < count)
            return 0;
        const cap = this.perLaneCapacity;
        let drained = 0;
        // Two-pass: highest priority first.
        for (let pri = PRIORITY_CRITICAL; pri >= PRIORITY_LOW; pri--) {
            for (let slot = 0; slot < cap && drained < count; slot++) {
                const idx = lane * cap + slot;
                if (this.slotState[idx] !== REQUEST_STATE_PENDING)
                    continue;
                if (this.slotPriority[idx] !== pri)
                    continue;
                out[drained] = this.slotNpcId[idx] ?? -1;
                this.slotState[idx] = REQUEST_STATE_INFLIGHT;
                drained++;
            }
        }
        return drained;
    }
    // Drain a batch and ALSO write each drained slot's handle into
    // outHandles (matching out's npc array). Useful when the dispatcher
    // wants to call completeRequest later without remembering the
    // submission handles.
    drainBatchWithHandles(lane, count, outNpcs, outHandles) {
        if (!this.requireLane(lane))
            return 0;
        if (!Number.isInteger(count) || count < 1 || count > this.maxBatchSize)
            return 0;
        if (outNpcs.length < count || outHandles.length < count)
            return 0;
        const cap = this.perLaneCapacity;
        let drained = 0;
        for (let pri = PRIORITY_CRITICAL; pri >= PRIORITY_LOW; pri--) {
            for (let slot = 0; slot < cap && drained < count; slot++) {
                const idx = lane * cap + slot;
                if (this.slotState[idx] !== REQUEST_STATE_PENDING)
                    continue;
                if (this.slotPriority[idx] !== pri)
                    continue;
                outNpcs[drained] = this.slotNpcId[idx] ?? -1;
                outHandles[drained] = makeRequestHandle(slot, lane, this.slotGeneration[idx] ?? 0);
                this.slotState[idx] = REQUEST_STATE_INFLIGHT;
                drained++;
            }
        }
        return drained;
    }
    // --- result completion (gates 2 stale-guard, 4 action validation) ---
    // Apply a result to an inflight request. Returns the reason: 0 on
    // success, REASON_STALE_HANDLE on a generation mismatch (the slot
    // was reused), REASON_BAD_RESULT on action-mask validation failure,
    // REASON_BAD_ACTION on out-of-range actionType. The lane's pending
    // count is decremented; the slot returns to NONE.
    completeRequest(handle, actionType, resultActionMask) {
        const slot = requestSlot(handle);
        const lane = requestLane(handle);
        const gen = requestGeneration(handle);
        if (!this.requireLane(lane))
            return REASON_BAD_LANE;
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.perLaneCapacity)
            return REASON_STALE_HANDLE;
        const idx = lane * this.perLaneCapacity + slot;
        if ((this.slotGeneration[idx] ?? 0) !== gen) {
            this.rejectedResultsTotal++;
            return REASON_STALE_HANDLE;
        }
        if (this.slotState[idx] !== REQUEST_STATE_INFLIGHT) {
            this.rejectedResultsTotal++;
            return REASON_STALE_HANDLE;
        }
        if (!Number.isInteger(actionType) || actionType < 0 || actionType >= this.maxActionTypes) {
            this.failSlot(idx, lane);
            this.rejectedResultsTotal++;
            return REASON_BAD_ACTION;
        }
        if (!this.actionRegistered[actionType]) {
            this.failSlot(idx, lane);
            this.rejectedResultsTotal++;
            return REASON_BAD_RESULT;
        }
        if (!Number.isInteger(resultActionMask) || resultActionMask < 0 || resultActionMask > U32_MAX) {
            this.failSlot(idx, lane);
            this.rejectedResultsTotal++;
            return REASON_BAD_RESULT;
        }
        const allowed = this.actionAllowedMask[actionType] ?? 0;
        // resultActionMask must be a subset of allowed.
        if (((resultActionMask >>> 0) & ~(allowed >>> 0)) !== 0) {
            this.failSlot(idx, lane);
            this.rejectedResultsTotal++;
            return REASON_BAD_RESULT;
        }
        // Success.
        this.slotState[idx] = REQUEST_STATE_COMPLETED;
        this.slotState[idx] = REQUEST_STATE_NONE; // immediately reusable
        this.slotNpcId[idx] = -1;
        this.lanePendingCount[lane] = ((this.lanePendingCount[lane] ?? 0) - 1) >>> 0;
        this.completedTotal++;
        return REASON_NONE;
    }
    // Mark a slot as failed (post-validation reject). Frees the slot
    // and decrements pending count.
    failSlot(idx, lane) {
        this.slotState[idx] = REQUEST_STATE_NONE;
        this.slotNpcId[idx] = -1;
        this.lanePendingCount[lane] = ((this.lanePendingCount[lane] ?? 0) - 1) >>> 0;
    }
    // --- cancellation (gate 2) ---
    // Cancel a request in PENDING or INFLIGHT state. Returns true if
    // cancelled; false if the handle is stale or the slot is already
    // terminal.
    cancelRequest(handle) {
        const slot = requestSlot(handle);
        const lane = requestLane(handle);
        const gen = requestGeneration(handle);
        if (!this.requireLane(lane))
            return false;
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.perLaneCapacity)
            return false;
        const idx = lane * this.perLaneCapacity + slot;
        if ((this.slotGeneration[idx] ?? 0) !== gen)
            return false;
        const state = this.slotState[idx] ?? 0;
        if (state !== REQUEST_STATE_PENDING && state !== REQUEST_STATE_INFLIGHT)
            return false;
        this.slotState[idx] = REQUEST_STATE_NONE;
        this.slotNpcId[idx] = -1;
        this.lanePendingCount[lane] = ((this.lanePendingCount[lane] ?? 0) - 1) >>> 0;
        this.cancelledTotal++;
        return true;
    }
    // --- TTL sweep + budget refill (gates 2, 5, 6) ---
    // Advance to tick t, refill per-lane budgets up to their max, reset
    // per-tick rate / critical counters, and expire any request past
    // its ttlTicks. Idempotent on multiple calls within the same tick
    // ONLY IF `t` is the same; calling tick(t+1) twice will refill twice.
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
            throw new RangeError('InferenceOrchestrator.tick: t must be a u32, got ' + t);
        }
        this.currentTick = t | 0;
        // Refill + reset per-tick counters.
        for (let lane = 0; lane < LANE_COUNT; lane++) {
            const cur = this.laneBudget[lane] ?? 0;
            const max = this.laneMaxBudget[lane] ?? 0;
            const refill = this.laneRefillPerTick[lane] ?? 0;
            const next = Math.min(max, cur + refill);
            this.laneBudget[lane] = next >>> 0;
            this.laneRequestsThisTick[lane] = 0;
            this.laneCriticalSpentThisTick[lane] = 0;
        }
        // Sweep TTL expirations.
        const cap = this.perLaneCapacity;
        for (let lane = 0; lane < LANE_COUNT; lane++) {
            for (let slot = 0; slot < cap; slot++) {
                const idx = lane * cap + slot;
                const state = this.slotState[idx] ?? 0;
                if (state !== REQUEST_STATE_PENDING && state !== REQUEST_STATE_INFLIGHT)
                    continue;
                const expiresAt = this.slotExpiresAtTick[idx] ?? 0;
                if (((this.currentTick - expiresAt) >>> 0) < 0x80000000) {
                    // Expired (currentTick >= expiresAt, wrap-safe).
                    const npcId = this.slotNpcId[idx] ?? -1;
                    const priority = this.slotPriority[idx] ?? 0;
                    this.slotState[idx] = REQUEST_STATE_NONE;
                    this.slotNpcId[idx] = -1;
                    this.lanePendingCount[lane] = ((this.lanePendingCount[lane] ?? 0) - 1) >>> 0;
                    this.expiredTotal++;
                    this.pushDrop(npcId, lane, priority, REASON_DEADLINE_EXCEEDED);
                }
            }
        }
    }
    // --- drop event ring (gate 1, 2 metrics surface) ---
    pushDrop(npcId, lane, priority, reason) {
        if (this.dropEventTail - this.dropEventHead >= this.dropEventCapacity) {
            this.dropOverflowCount++;
            return;
        }
        const slot = (this.dropEventTail % this.dropEventCapacity) * DROP_EVENT_STRIDE;
        this.dropEventRing[slot + 0] = npcId | 0;
        this.dropEventRing[slot + 1] = lane | 0;
        this.dropEventRing[slot + 2] = priority | 0;
        this.dropEventRing[slot + 3] = reason | 0;
        this.dropEventRing[slot + 4] = this.currentTick | 0;
        this.dropEventTail++;
    }
    // Read the next drop event (FIFO). Writes DROP_EVENT_STRIDE i32
    // into out; returns false if the ring is empty or out is too small.
    consumeDropEvent(out, outOffset = 0) {
        if (this.dropEventHead >= this.dropEventTail)
            return false;
        if (outOffset < 0 || outOffset + DROP_EVENT_STRIDE > out.length)
            return false;
        const slot = (this.dropEventHead % this.dropEventCapacity) * DROP_EVENT_STRIDE;
        out[outOffset + 0] = this.dropEventRing[slot + 0] ?? 0;
        out[outOffset + 1] = this.dropEventRing[slot + 1] ?? 0;
        out[outOffset + 2] = this.dropEventRing[slot + 2] ?? 0;
        out[outOffset + 3] = this.dropEventRing[slot + 3] ?? 0;
        out[outOffset + 4] = this.dropEventRing[slot + 4] ?? 0;
        this.dropEventHead++;
        return true;
    }
    // --- helpers ---
    requireLane(lane) {
        return Number.isInteger(lane) && lane >= 0 && lane < LANE_COUNT;
    }
    requirePriority(p) {
        return Number.isInteger(p) && p >= 0 && p < PRIORITY_COUNT;
    }
    requireNpcId(id) {
        return Number.isInteger(id) && id >= 0 && id < this.maxNpc;
    }
    // Read a request slot's state - useful for the dispatcher's
    // diagnostic surface.
    getSlotState(handle) {
        const slot = requestSlot(handle);
        const lane = requestLane(handle);
        const gen = requestGeneration(handle);
        if (!this.requireLane(lane))
            return REQUEST_STATE_NONE;
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.perLaneCapacity)
            return REQUEST_STATE_NONE;
        const idx = lane * this.perLaneCapacity + slot;
        if ((this.slotGeneration[idx] ?? 0) !== gen)
            return REQUEST_STATE_NONE;
        return this.slotState[idx] ?? REQUEST_STATE_NONE;
    }
    // --- lifecycle ---
    // Reset every queue, budget, counter, and registry; leaves backing
    // arrays allocated. Budgets reset to their max; consent stays as
    // last-set; registered actionTypes are CLEARED (the consumer
    // re-registers as part of init).
    clear() {
        this.slotState.fill(0);
        this.slotNpcId.fill(-1);
        this.slotPriority.fill(0);
        this.slotEstimatedTokens.fill(0);
        this.slotSubmittedAtTick.fill(0);
        this.slotExpiresAtTick.fill(0);
        this.slotGeneration.fill(0);
        this.actionAllowedMask.fill(0);
        this.actionRegistered.fill(0);
        this.dropEventRing.fill(0);
        this.dropEventHead = 0;
        this.dropEventTail = 0;
        this.dropOverflowCount = 0;
        this.lanePendingCount.fill(0);
        this.laneFreeHint.fill(0);
        this.laneRequestsThisTick.fill(0);
        this.laneCriticalSpentThisTick.fill(0);
        for (let lane = 0; lane < LANE_COUNT; lane++) {
            this.laneBudget[lane] = this.laneMaxBudget[lane] ?? 0;
        }
        this.completedTotal = 0;
        this.cancelledTotal = 0;
        this.expiredTotal = 0;
        this.rejectedResultsTotal = 0;
    }
}
//# sourceMappingURL=inference-orchestrator.js.map