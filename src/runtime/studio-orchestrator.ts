// LoomStudioOrchestrator - the AI Director governance kernel: a
// per-tick telemetry snapshot with a monotonic epoch, a batched
// SLM query queue (no Promise per query), per-query allowed-output
// bitmask validation, telemetry-epoch staleness rejection, fact
// proposals routed through a (sourceId, expiresAtTick, telemetry-
// Epoch) provenance envelope, a fact-tier guard that REJECTS any
// SLM-proposed VERIFIED-tier fact (only an explicit admin path
// can write VERIFIED), and a reserved fact-index 0 the dynamic
// pipeline never touches.
//
// The Trinity dossier's section 31 (Gemini Volume II). The Gemini
// sketch was `evaluateWorldState(telemetry, epoch) { excitement =
// Atomics.load(telemetry, PULSE_SIGNAL); if (excitement < BOREDOM)
// directorCommand("TRIGGER_EVENT_CHAOS", epoch) }`. The Codex
// audit: "valid director pattern but unsafe truth injector." The
// sketch had no batched director inference (one query per tick is
// fine, but the deferred SLM is async; per-query Promises break
// the budget), no telemetry-epoch staleness rejection (a slow SLM
// could land its response after the world had already moved on),
// no SLM-output bitmask validation (a hallucinated action ID
// would propagate), wrote dynamic facts to the FIXED fact index 0
// (corrupting the truth slot reserved for verified facts), no
// provenance / expiry / source metadata, and the "directorCommand"
// would inject God-tier truth directly without a tier check.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual SLM HTTP call, the LLM
// prompt construction, and the world-state mutation are the deferred
// integration layer; this is the pure-logic TELEMETRY-SNAPSHOT /
// QUERY-BATCH / RESPONSE-VALIDATOR / FACT-GOVERNANCE kernel that
// drives them.
//
// TELEMETRY (gate 2). recordTelemetrySignal(signalId, value) writes
// into the back snapshot; advanceTelemetryEpoch() increments the
// monotonic epoch counter and swaps front/back. The deferred SLM
// reads the front snapshot at a captured epoch; submitDirectorBatch
// stamps the captured epoch into every query.
//
// BATCH PIPELINE (gate 1). enqueueQuery(queryType, telemetryEpoch,
// payloadOffset, payloadLength) pushes onto the query ring;
// drainQueryBatch yields a typed-array record the deferred
// dispatcher posts to the SLM as a single batched HTTP call (one
// Promise per batch, not per query).
//
// RESPONSE VALIDATION (gate 3). registerQueryAllowedMask(queryType,
// allowedActionMask) registers the bitmask of acceptable action
// bits per query type. completeQuery(queryHandle, telemetryEpoch,
// proposedActionMask) rejects responses whose action bits are
// outside the allowed mask, OR whose telemetryEpoch is stale.
//
// FACT GOVERNANCE (gates 4, 5, 6). proposeFact(...) is the SLM's
// only path to inject narrative state. Every proposal carries:
//   factTier        - one of FACT_TIER_LOW / MEDIUM / HIGH /
//                     VERIFIED. SLM proposals MAY NOT be VERIFIED;
//                     proposeFact rejects with REASON_TIER_FORBIDDEN.
//                     Only adminProposeFact (admin-only path) can
//                     submit VERIFIED.
//   sourceId        - the SLM session / model id (provenance)
//   expiresAtTick   - when the fact ages out (TTL)
//   factIndex       - target slot. Index 0 is RESERVED (the fixed
//                     "verified truth" slot) and proposeFact REJECTS
//                     any factIndex === 0; only adminProposeFact may
//                     write factIndex 0.
// Approved facts go into a per-slot ring with provenance.
//
// The 6 Codex gates for LoomStudioOrchestrator, enforced:
//   1. "batch director inference" - enqueueQuery + drainQueryBatch
//      pattern; the deferred dispatcher does ONE Promise per batch.
//   2. "telemetry epochs + stale response rejection" - per-query
//      telemetry epoch stamped at submit; completeQuery rejects
//      responses whose epoch < currentTelemetryEpoch -
//      maxTelemetryEpochSkew.
//   3. "validate SLM output bitmasks" -
//      registerQueryAllowedMask + completeQuery validation.
//   4. "do not write dynamic facts to fixed fact index 0" -
//      proposeFact REJECTS factIndex === 0; only adminProposeFact
//      may write index 0.
//   5. "provenance, expiry, source metadata" - every fact carries
//      sourceId + expiresAtTick + telemetryEpoch + factTier; tick()
//      sweeps expired facts.
//   6. "do not inject God-tier verified truth directly" -
//      proposeFact rejects factTier === FACT_TIER_VERIFIED;
//      adminProposeFact is the only path that can write VERIFIED.
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is
// injected; single-thread, no Atomics; every signalId / queryType
// / factIndex / tier bounds-checked; fixed-capacity storage. The
// SLM HTTP call, prompt construction, and world mutation are
// deferred.

// Reasons.
export const STUDIO_REASON_NONE = 0;
export const STUDIO_REASON_BAD_SIGNAL = 1;
export const STUDIO_REASON_BAD_QUERY_TYPE = 2;
export const STUDIO_REASON_BAD_HANDLE = 3;
export const STUDIO_REASON_BAD_STATE = 4;
export const STUDIO_REASON_STALE_EPOCH = 5;
export const STUDIO_REASON_BAD_ACTION_MASK = 6;
export const STUDIO_REASON_BAD_FACT_INDEX = 7;
export const STUDIO_REASON_TIER_FORBIDDEN = 8;
export const STUDIO_REASON_BAD_TIER = 9;
export const STUDIO_REASON_QUEUE_FULL = 10;
export const STUDIO_REASON_BAD_TTL = 11;
export const STUDIO_REASON_BAD_SOURCE = 12;

// Fact tiers (gate 6).
export const FACT_TIER_LOW = 0;
export const FACT_TIER_MEDIUM = 1;
export const FACT_TIER_HIGH = 2;
export const FACT_TIER_VERIFIED = 3;

// Query lifecycle states.
export const QUERY_STATE_NONE = 0;
export const QUERY_STATE_PENDING = 1;
export const QUERY_STATE_INFLIGHT = 2;
export const QUERY_STATE_COMPLETED = 3;
export const QUERY_STATE_REJECTED = 4;

// Fact slot states.
export const FACT_STATE_NONE = 0;
export const FACT_STATE_PROPOSED = 1;
export const FACT_STATE_APPROVED = 2;        // for the deferred mainframe approval flow
export const FACT_STATE_EXPIRED = 3;

// Reserved fact index (gate 4).
export const RESERVED_FACT_INDEX = 0;

// Sentinels.
export const QUERY_HANDLE_INVALID = -1;
export const FACT_HANDLE_INVALID = -1;

// Sanity caps.
const MAX_SIGNALS = 256;
const MAX_QUERY_TYPES = 64;
const MAX_QUERIES = 1 << 12;
const MAX_FACTS = 1 << 14;
const MAX_TTL = 1 << 20;
const MAX_TELEMETRY_EPOCH_SKEW = 1 << 16;
const U32_MAX = 0xffffffff;

// Query record stride for drainQueryBatch:
// [queryType, telemetryEpoch, payloadOffset, payloadLength,
//  submittedAtTick, queryHandle].
export const QUERY_RECORD_STRIDE = 6;

// Fact record stride for readFact:
// [factIndex, factTier, state, sourceId, telemetryEpoch,
//  expiresAtTick, payloadHash, generation].
export const FACT_RECORD_STRIDE = 8;

export interface StudioOrchestratorConfig {
  numSignals: number;
  numQueryTypes: number;
  maxQueries: number;
  maxFacts: number;
  // Maximum telemetry-epoch skew before completeQuery REJECTs.
  maxTelemetryEpochSkew: number;
}

export class LoomStudioOrchestrator {
  readonly numSignals: number;
  readonly numQueryTypes: number;
  readonly maxQueries: number;
  readonly maxFacts: number;
  readonly maxTelemetryEpochSkew: number;

  // Telemetry double-buffered snapshot (gate 2).
  private readonly frontSignal: Uint32Array;
  private readonly backSignal: Uint32Array;
  private telemetryEpoch: number = 0;

  // Per-query-type allowed-action-mask registry (gate 3).
  private readonly queryAllowedMask: Uint32Array;
  private readonly queryRegistered: Uint8Array;

  // Query queue (gate 1).
  private readonly querySlotState: Uint8Array;
  private readonly querySlotType: Uint16Array;
  private readonly querySlotTelemetryEpoch: Uint32Array;
  private readonly querySlotPayloadOffset: Uint32Array;
  private readonly querySlotPayloadLength: Uint32Array;
  private readonly querySlotSubmittedAt: Uint32Array;
  private readonly querySlotGeneration: Uint8Array;
  private nextQuerySlot: number = 0;

  // Fact slots (gates 4, 5, 6).
  private readonly factState: Uint8Array;
  private readonly factTier: Uint8Array;
  private readonly factSourceId: Uint32Array;
  private readonly factTelemetryEpoch: Uint32Array;
  private readonly factExpiresAtTick: Uint32Array;
  private readonly factPayloadHash: Uint32Array;
  private readonly factGeneration: Uint8Array;

  private currentTick: number = 0;
  private queriesEnqueuedTotal: number = 0;
  private queriesCompletedTotal: number = 0;
  private queriesRejectedTotal: number = 0;
  private factsProposedTotal: number = 0;
  private factsRejectedTotal: number = 0;
  private factsExpiredTotal: number = 0;

  constructor(config: StudioOrchestratorConfig) {
    const { numSignals, numQueryTypes, maxQueries, maxFacts, maxTelemetryEpochSkew } = config;
    if (!Number.isInteger(numSignals) || numSignals < 1 || numSignals > MAX_SIGNALS) {
      throw new RangeError('Studio: numSignals out of range, got ' + numSignals);
    }
    if (!Number.isInteger(numQueryTypes) || numQueryTypes < 1 || numQueryTypes > MAX_QUERY_TYPES) {
      throw new RangeError('Studio: numQueryTypes out of range, got ' + numQueryTypes);
    }
    if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > MAX_QUERIES) {
      throw new RangeError('Studio: maxQueries out of range, got ' + maxQueries);
    }
    if (!Number.isInteger(maxFacts) || maxFacts < 2 || maxFacts > MAX_FACTS) {
      throw new RangeError('Studio: maxFacts out of range, got ' + maxFacts);
    }
    if (!Number.isInteger(maxTelemetryEpochSkew) || maxTelemetryEpochSkew < 1
      || maxTelemetryEpochSkew > MAX_TELEMETRY_EPOCH_SKEW) {
      throw new RangeError('Studio: maxTelemetryEpochSkew out of range, got ' + maxTelemetryEpochSkew);
    }
    this.numSignals = numSignals;
    this.numQueryTypes = numQueryTypes;
    this.maxQueries = maxQueries;
    this.maxFacts = maxFacts;
    this.maxTelemetryEpochSkew = maxTelemetryEpochSkew;

    this.frontSignal = new Uint32Array(numSignals);
    this.backSignal = new Uint32Array(numSignals);

    this.queryAllowedMask = new Uint32Array(numQueryTypes);
    this.queryRegistered = new Uint8Array(numQueryTypes);

    this.querySlotState = new Uint8Array(maxQueries);
    this.querySlotType = new Uint16Array(maxQueries);
    this.querySlotTelemetryEpoch = new Uint32Array(maxQueries);
    this.querySlotPayloadOffset = new Uint32Array(maxQueries);
    this.querySlotPayloadLength = new Uint32Array(maxQueries);
    this.querySlotSubmittedAt = new Uint32Array(maxQueries);
    this.querySlotGeneration = new Uint8Array(maxQueries);

    this.factState = new Uint8Array(maxFacts);
    this.factTier = new Uint8Array(maxFacts);
    this.factSourceId = new Uint32Array(maxFacts);
    this.factTelemetryEpoch = new Uint32Array(maxFacts);
    this.factExpiresAtTick = new Uint32Array(maxFacts);
    this.factPayloadHash = new Uint32Array(maxFacts);
    this.factGeneration = new Uint8Array(maxFacts);
  }

  // --- counts ---

  getCurrentTick(): number { return this.currentTick; }
  getTelemetryEpoch(): number { return this.telemetryEpoch; }
  getQueriesEnqueuedTotal(): number { return this.queriesEnqueuedTotal; }
  getQueriesCompletedTotal(): number { return this.queriesCompletedTotal; }
  getQueriesRejectedTotal(): number { return this.queriesRejectedTotal; }
  getFactsProposedTotal(): number { return this.factsProposedTotal; }
  getFactsRejectedTotal(): number { return this.factsRejectedTotal; }
  getFactsExpiredTotal(): number { return this.factsExpiredTotal; }

  // --- telemetry (gate 2) ---

  recordTelemetrySignal(signalId: number, value: number): boolean {
    if (!this.requireSignal(signalId)) return false;
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) return false;
    this.backSignal[signalId] = value >>> 0;
    return true;
  }

  // Promote back -> front and bump telemetry epoch. The deferred
  // SLM dispatcher captures the new epoch and stamps it into every
  // submitted query.
  advanceTelemetryEpoch(): number {
    for (let i = 0; i < this.numSignals; i++) {
      this.frontSignal[i] = this.backSignal[i] ?? 0;
    }
    this.telemetryEpoch = ((this.telemetryEpoch + 1) >>> 0);
    return this.telemetryEpoch;
  }

  readSignal(signalId: number): number {
    if (!this.requireSignal(signalId)) return 0;
    return this.frontSignal[signalId] ?? 0;
  }

  // --- query-type registry (gate 3) ---

  registerQueryAllowedMask(queryType: number, allowedActionMask: number): number {
    if (!this.requireQueryType(queryType)) return STUDIO_REASON_BAD_QUERY_TYPE;
    if (!Number.isInteger(allowedActionMask) || allowedActionMask < 0
      || allowedActionMask > U32_MAX) return STUDIO_REASON_BAD_ACTION_MASK;
    this.queryAllowedMask[queryType] = allowedActionMask >>> 0;
    this.queryRegistered[queryType] = 1;
    return STUDIO_REASON_NONE;
  }

  isQueryTypeRegistered(queryType: number): boolean {
    if (!this.requireQueryType(queryType)) return false;
    return (this.queryRegistered[queryType] ?? 0) === 1;
  }

  // --- query queue (gates 1, 2) ---

  // Submit a query. telemetryEpoch must be the current epoch
  // (or within skew) at the time of submission. Returns a query
  // handle (slot index packed with generation), or QUERY_HANDLE_INVALID
  // on rejection.
  enqueueQuery(
    queryType: number,
    telemetryEpoch: number,
    payloadOffset: number,
    payloadLength: number,
  ): number {
    if (!this.requireQueryType(queryType)) return QUERY_HANDLE_INVALID;
    if (!this.queryRegistered[queryType]) return QUERY_HANDLE_INVALID;
    if (!Number.isInteger(telemetryEpoch) || telemetryEpoch < 0 || telemetryEpoch > U32_MAX) {
      return QUERY_HANDLE_INVALID;
    }
    if (!Number.isInteger(payloadOffset) || payloadOffset < 0) return QUERY_HANDLE_INVALID;
    if (!Number.isInteger(payloadLength) || payloadLength < 0) return QUERY_HANDLE_INVALID;
    // Stale-on-submit check (gate 2).
    const skew = ((this.telemetryEpoch - telemetryEpoch) >>> 0);
    if (skew > this.maxTelemetryEpochSkew) return QUERY_HANDLE_INVALID;
    const slot = this.allocQuerySlot();
    if (slot < 0) return QUERY_HANDLE_INVALID;
    this.querySlotState[slot] = QUERY_STATE_PENDING;
    this.querySlotType[slot] = queryType & 0xffff;
    this.querySlotTelemetryEpoch[slot] = telemetryEpoch >>> 0;
    this.querySlotPayloadOffset[slot] = payloadOffset >>> 0;
    this.querySlotPayloadLength[slot] = payloadLength >>> 0;
    this.querySlotSubmittedAt[slot] = this.currentTick >>> 0;
    this.querySlotGeneration[slot] = (((this.querySlotGeneration[slot] ?? 0) + 1) & 0xff);
    this.queriesEnqueuedTotal++;
    return makeHandle(slot, this.querySlotGeneration[slot] ?? 0);
  }

  // Drain up to `count` PENDING queries into `out` (gate 1). The
  // deferred dispatcher posts the batch as a single SLM HTTP call.
  // Returns the number of queries drained.
  drainQueryBatch(count: number, out: Int32Array): number {
    if (!Number.isInteger(count) || count < 1) return 0;
    if (out.length < count * QUERY_RECORD_STRIDE) return 0;
    let drained = 0;
    for (let s = 0; s < this.maxQueries && drained < count; s++) {
      if (this.querySlotState[s] !== QUERY_STATE_PENDING) continue;
      const off = drained * QUERY_RECORD_STRIDE;
      out[off + 0] = this.querySlotType[s] ?? 0;
      out[off + 1] = this.querySlotTelemetryEpoch[s] ?? 0;
      out[off + 2] = this.querySlotPayloadOffset[s] ?? 0;
      out[off + 3] = this.querySlotPayloadLength[s] ?? 0;
      out[off + 4] = this.querySlotSubmittedAt[s] ?? 0;
      out[off + 5] = makeHandle(s, this.querySlotGeneration[s] ?? 0);
      this.querySlotState[s] = QUERY_STATE_INFLIGHT;
      drained++;
    }
    return drained;
  }

  // Apply an SLM response. Validates telemetry-epoch staleness +
  // proposed-action-mask against the registered allowed mask.
  // Returns STUDIO_REASON_NONE on success.
  completeQuery(handle: number, telemetryEpoch: number, proposedActionMask: number): number {
    const slot = handleSlot(handle);
    const gen = handleGen(handle);
    if (!this.requireQuerySlot(slot)) return STUDIO_REASON_BAD_HANDLE;
    if ((this.querySlotGeneration[slot] ?? 0) !== gen) return STUDIO_REASON_BAD_HANDLE;
    if (this.querySlotState[slot] !== QUERY_STATE_INFLIGHT) return STUDIO_REASON_BAD_STATE;
    // Stale telemetry epoch (gate 2).
    if (!Number.isInteger(telemetryEpoch) || telemetryEpoch < 0) {
      this.querySlotState[slot] = QUERY_STATE_REJECTED;
      this.queriesRejectedTotal++;
      return STUDIO_REASON_STALE_EPOCH;
    }
    const submittedEpoch = this.querySlotTelemetryEpoch[slot] ?? 0;
    if ((telemetryEpoch >>> 0) !== submittedEpoch) {
      this.querySlotState[slot] = QUERY_STATE_REJECTED;
      this.queriesRejectedTotal++;
      return STUDIO_REASON_STALE_EPOCH;
    }
    const skew = ((this.telemetryEpoch - submittedEpoch) >>> 0);
    if (skew > this.maxTelemetryEpochSkew) {
      this.querySlotState[slot] = QUERY_STATE_REJECTED;
      this.queriesRejectedTotal++;
      return STUDIO_REASON_STALE_EPOCH;
    }
    // Action-mask validation (gate 3).
    const queryType = this.querySlotType[slot] ?? 0;
    const allowed = this.queryAllowedMask[queryType] ?? 0;
    if (!Number.isInteger(proposedActionMask) || proposedActionMask < 0
      || proposedActionMask > U32_MAX) {
      this.querySlotState[slot] = QUERY_STATE_REJECTED;
      this.queriesRejectedTotal++;
      return STUDIO_REASON_BAD_ACTION_MASK;
    }
    if (((proposedActionMask >>> 0) & ~(allowed >>> 0)) !== 0) {
      this.querySlotState[slot] = QUERY_STATE_REJECTED;
      this.queriesRejectedTotal++;
      return STUDIO_REASON_BAD_ACTION_MASK;
    }
    this.querySlotState[slot] = QUERY_STATE_NONE;     // immediately reusable
    this.queriesCompletedTotal++;
    return STUDIO_REASON_NONE;
  }

  // --- fact governance (gates 4, 5, 6) ---

  // The SLM-driven fact proposal path. Index 0 is RESERVED; tier
  // VERIFIED is FORBIDDEN. Returns STUDIO_REASON_NONE on accept.
  proposeFact(
    factIndex: number,
    factTier: number,
    sourceId: number,
    telemetryEpoch: number,
    expiresAtTick: number,
    payloadHash: number,
  ): number {
    if (factIndex === RESERVED_FACT_INDEX) {
      this.factsRejectedTotal++;
      return STUDIO_REASON_BAD_FACT_INDEX;
    }
    if (!this.requireFactIndex(factIndex)) {
      this.factsRejectedTotal++;
      return STUDIO_REASON_BAD_FACT_INDEX;
    }
    if (factTier !== FACT_TIER_LOW && factTier !== FACT_TIER_MEDIUM && factTier !== FACT_TIER_HIGH) {
      // Includes FACT_TIER_VERIFIED + any out-of-range tier.
      this.factsRejectedTotal++;
      if (factTier === FACT_TIER_VERIFIED) return STUDIO_REASON_TIER_FORBIDDEN;
      return STUDIO_REASON_BAD_TIER;
    }
    return this.writeFact(factIndex, factTier, sourceId, telemetryEpoch, expiresAtTick, payloadHash);
  }

  // The admin path - the only way to write VERIFIED facts OR to
  // touch the reserved index 0. Used by an out-of-band trusted
  // admin tool, never by the SLM director.
  adminProposeFact(
    factIndex: number,
    factTier: number,
    sourceId: number,
    telemetryEpoch: number,
    expiresAtTick: number,
    payloadHash: number,
  ): number {
    if (!Number.isInteger(factIndex) || factIndex < 0 || factIndex >= this.maxFacts) {
      return STUDIO_REASON_BAD_FACT_INDEX;
    }
    if (factTier < FACT_TIER_LOW || factTier > FACT_TIER_VERIFIED) return STUDIO_REASON_BAD_TIER;
    return this.writeFact(factIndex, factTier, sourceId, telemetryEpoch, expiresAtTick, payloadHash);
  }

  private writeFact(
    factIndex: number,
    factTier: number,
    sourceId: number,
    telemetryEpoch: number,
    expiresAtTick: number,
    payloadHash: number,
  ): number {
    if (!Number.isInteger(sourceId) || sourceId < 0 || sourceId > U32_MAX) {
      this.factsRejectedTotal++;
      return STUDIO_REASON_BAD_SOURCE;
    }
    if (!Number.isInteger(telemetryEpoch) || telemetryEpoch < 0 || telemetryEpoch > U32_MAX) {
      this.factsRejectedTotal++;
      return STUDIO_REASON_STALE_EPOCH;
    }
    if (!Number.isInteger(expiresAtTick) || expiresAtTick <= this.currentTick
      || ((expiresAtTick - this.currentTick) >>> 0) > MAX_TTL) {
      this.factsRejectedTotal++;
      return STUDIO_REASON_BAD_TTL;
    }
    if (!Number.isInteger(payloadHash) || payloadHash < 0 || payloadHash > U32_MAX) {
      this.factsRejectedTotal++;
      return STUDIO_REASON_BAD_TIER;
    }
    this.factState[factIndex] = FACT_STATE_PROPOSED;
    this.factTier[factIndex] = factTier & 0xff;
    this.factSourceId[factIndex] = sourceId >>> 0;
    this.factTelemetryEpoch[factIndex] = telemetryEpoch >>> 0;
    this.factExpiresAtTick[factIndex] = expiresAtTick >>> 0;
    this.factPayloadHash[factIndex] = payloadHash >>> 0;
    this.factGeneration[factIndex] = (((this.factGeneration[factIndex] ?? 0) + 1) & 0xff);
    this.factsProposedTotal++;
    return STUDIO_REASON_NONE;
  }

  // Read a fact slot (gate 5 - the deferred consumer reads
  // provenance + expiry).
  readFact(factIndex: number, out: Int32Array, outOffset: number = 0): boolean {
    if (!Number.isInteger(factIndex) || factIndex < 0 || factIndex >= this.maxFacts) return false;
    if (outOffset < 0 || outOffset + FACT_RECORD_STRIDE > out.length) return false;
    out[outOffset + 0] = factIndex;
    out[outOffset + 1] = this.factTier[factIndex] ?? 0;
    out[outOffset + 2] = this.factState[factIndex] ?? 0;
    out[outOffset + 3] = this.factSourceId[factIndex] ?? 0;
    out[outOffset + 4] = this.factTelemetryEpoch[factIndex] ?? 0;
    out[outOffset + 5] = this.factExpiresAtTick[factIndex] ?? 0;
    out[outOffset + 6] = this.factPayloadHash[factIndex] ?? 0;
    out[outOffset + 7] = this.factGeneration[factIndex] ?? 0;
    return true;
  }

  // --- tick (gate 5 - expiry sweep) ---

  tick(t: number): void {
    if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
      throw new RangeError('Studio.tick: t must be a u32, got ' + t);
    }
    this.currentTick = t | 0;
    // Expire facts past their TTL.
    for (let i = 0; i < this.maxFacts; i++) {
      const state = this.factState[i] ?? 0;
      if (state === FACT_STATE_NONE || state === FACT_STATE_EXPIRED) continue;
      const expiresAt = this.factExpiresAtTick[i] ?? 0;
      if (((this.currentTick - expiresAt) >>> 0) < 0x80000000) {
        // currentTick >= expiresAt
        this.factState[i] = FACT_STATE_EXPIRED;
        this.factGeneration[i] = (((this.factGeneration[i] ?? 0) + 1) & 0xff);
        this.factsExpiredTotal++;
      }
    }
  }

  // --- helpers ---

  private requireSignal(s: number): boolean {
    return Number.isInteger(s) && s >= 0 && s < this.numSignals;
  }

  private requireQueryType(q: number): boolean {
    return Number.isInteger(q) && q >= 0 && q < this.numQueryTypes;
  }

  private requireQuerySlot(s: number): boolean {
    return Number.isInteger(s) && s >= 0 && s < this.maxQueries;
  }

  private requireFactIndex(i: number): boolean {
    // gate 4 enforced: index 0 is reserved; this returns true for
    // [1, maxFacts). The caller (proposeFact) checks index 0 first.
    return Number.isInteger(i) && i >= 1 && i < this.maxFacts;
  }

  private allocQuerySlot(): number {
    const start = this.nextQuerySlot;
    for (let probe = 0; probe < this.maxQueries; probe++) {
      const slot = (start + probe) % this.maxQueries;
      const state = this.querySlotState[slot] ?? 0;
      if (state === QUERY_STATE_NONE
        || state === QUERY_STATE_COMPLETED
        || state === QUERY_STATE_REJECTED) {
        this.nextQuerySlot = (slot + 1) % this.maxQueries;
        return slot;
      }
    }
    return -1;
  }

  // --- lifecycle ---

  clear(): void {
    this.frontSignal.fill(0);
    this.backSignal.fill(0);
    this.telemetryEpoch = 0;
    this.queryAllowedMask.fill(0);
    this.queryRegistered.fill(0);
    this.querySlotState.fill(0);
    this.querySlotType.fill(0);
    this.querySlotTelemetryEpoch.fill(0);
    this.querySlotPayloadOffset.fill(0);
    this.querySlotPayloadLength.fill(0);
    this.querySlotSubmittedAt.fill(0);
    this.querySlotGeneration.fill(0);
    this.factState.fill(0);
    this.factTier.fill(0);
    this.factSourceId.fill(0);
    this.factTelemetryEpoch.fill(0);
    this.factExpiresAtTick.fill(0);
    this.factPayloadHash.fill(0);
    this.factGeneration.fill(0);
    this.queriesEnqueuedTotal = 0;
    this.queriesCompletedTotal = 0;
    this.queriesRejectedTotal = 0;
    this.factsProposedTotal = 0;
    this.factsRejectedTotal = 0;
    this.factsExpiredTotal = 0;
  }
}

// Query-handle layout: low 24 bits slot, high 8 bits generation.
const HANDLE_SLOT_MASK = 0x00ffffff;
const HANDLE_GEN_SHIFT = 24;
const HANDLE_GEN_MASK = 0xff;

export function makeHandle(slot: number, gen: number): number {
  return ((gen & HANDLE_GEN_MASK) << HANDLE_GEN_SHIFT) | (slot & HANDLE_SLOT_MASK);
}

export function handleSlot(h: number): number {
  return h & HANDLE_SLOT_MASK;
}

export function handleGen(h: number): number {
  return (h >>> HANDLE_GEN_SHIFT) & HANDLE_GEN_MASK;
}
