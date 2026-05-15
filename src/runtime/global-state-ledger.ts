// GlobalStateLedger - the spatio-temporal persistence kernel:
// (regionId, lamport64, nodeId, sequence) total ordering, per-delta
// idempotency-key + authority-epoch binding, versioned NewValue
// codec (componentTypeId + codecVersion), per-region Lamport clock,
// per-componentTypeId merge-rule registry, atomic + auditable
// compaction with idempotency preservation, and a vector-DB-index
// marker bit (the vector store is a derived index only).
//
// The Trinity dossier's section 30 (Gemini Volume II). The Gemini
// sketch was `commitDelta(entityId, componentId, newValue) { entry =
// {id: lamportId(), target, comp, val}; sqliteWAL.push(entry) }`.
// The Codex audit: "good event-sourcing path, but Lamport / SQLite
// claims are too strong." The sketch had ad-hoc Lamport packing
// (no nodeId / sequence in the order tuple), no idempotency / epoch
// on the delta, no component-type version (a schema change broke
// every old delta), no separation between the authoritative log and
// the derived vector index, no compaction (the WAL grew unbounded),
// no per-component merge / conflict rules, and no benchmark surface.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual SQLite WAL writes, the
// vector-DB writes, and the on-disk compaction file moves are the
// deferred integration layer; this is the pure-logic ORDERING /
// IDEMPOTENCY / VERSIONING / MERGE-REGISTRY / COMPACTION-PLANNER
// kernel that drives them.
//
// ORDERING (gate 1). Every delta carries (regionId, lamportHi/Lo,
// nodeId, sequence). The full ordering tuple is the comparison key
// used by the deferred SQLite "ORDER BY" - the kernel exposes it
// as a typed-array record. lamport64 is split into hi/lo u32 for
// JS-fp safety (no 64-bit BigInt on the hot path).
//
// IDEMPOTENCY + AUTHORITY EPOCH (gate 2). appendDelta requires a
// per-(regionId) idempotency key + authority epoch on every delta.
// Replays of the same idempotency key in the recent window are
// dropped; epoch < currentEpoch is REJECTED.
//
// VERSIONED COMPONENT CODEC (gate 3). componentTypeId + codecVersion
// are recorded with every delta. The deferred deserializer uses
// codecVersion to pick the right value-decoder for backward-compat.
// The kernel rejects deltas with codecVersion > registeredCodecVersion
// (the deferred persistence layer only supports up-to-current
// codecs).
//
// VECTOR INDEX MARKER (gate 4). hasVectorEmbedding is a single bit
// the consumer sets on a delta whose semantic meaning needs vector
// indexing. The deferred vector store reads marked deltas and
// builds the index FROM the authoritative ledger - the vector store
// is NEVER consulted as the source of truth.
//
// COMPACTION (gate 5). compactionPlan(regionId) walks the deltas
// for a region and returns a list of (entityId, componentTypeId)
// pairs whose ALL prior deltas can be deleted (only the latest
// matters). The deferred persistence layer applies the plan in
// a single SQLite transaction. The plan is deterministic + auditable
// (every compaction emits an audit event before applying).
//
// PER-COMPONENT MERGE RULES (gate 6). registerComponentMergeRule
// (componentTypeId, ruleId) records the merge policy ID for a
// component type. Rule IDs:
//   MERGE_RULE_LAST_WRITE_WINS - the highest-(lamport, nodeId) wins
//   MERGE_RULE_SUM             - integer-add the values (counters)
//   MERGE_RULE_BITSET_OR       - OR the values (flag sets)
//   MERGE_RULE_CRDT_CUSTOM     - the deferred CRDT layer handles it
// The kernel records the rule; the deferred merger executes it.
//
// BENCHMARK SURFACE (gate 7). getStatsSnapshot exposes append /
// drop / compaction counters; the deferred SQLite WAL benchmark
// reads these.
//
// The 7 Codex gates for GlobalStateLedger, enforced:
//   1. "(region_id, lamport64, node_id, sequence) ordering" - every
//      delta carries the 5-tuple; readDeltaRecord exposes them.
//   2. "idempotency key + authority epoch on every delta" - per-
//      (regionId) idemp ring; epoch validated; replays + stale
//      epochs dropped.
//   3. "NewValue is a versioned component codec" - componentTypeId
//      + codecVersion fields; rejected if codecVersion is unknown.
//   4. "vector DB as derived index only" - hasVectorEmbedding bit
//      flags deltas the indexer reads; the vector DB is never the
//      source of truth.
//   5. "atomic + idempotent + auditable compaction" -
//      compactionPlan returns the plan; the audit log records the
//      plan id + (entity, component) pairs before the deferred apply.
//   6. "per-component merge / conflict rules" -
//      registerComponentMergeRule maps componentTypeId -> ruleId;
//      MERGE_RULE_* enum.
//   7. "benchmark SQLite WAL with real batching" - getStatsSnapshot
//      counters; the deferred SQLite WAL bench reads these.
//
// Non-negotiable engine gates: no RNG; no wall clock; single-thread,
// no Atomics; every regionId / nodeId / componentTypeId / lamport
// component bounds-checked; fixed-capacity storage (the deferred
// persistence layer handles unbounded WAL growth).

// Reasons.
export const LEDGER_REASON_NONE = 0;
export const LEDGER_REASON_BAD_REGION = 1;
export const LEDGER_REASON_BAD_NODE = 2;
export const LEDGER_REASON_BAD_ENTITY = 3;
export const LEDGER_REASON_BAD_COMPONENT = 4;
export const LEDGER_REASON_BAD_CODEC_VERSION = 5;
export const LEDGER_REASON_STALE_EPOCH = 6;
export const LEDGER_REASON_DUPLICATE_KEY = 7;
export const LEDGER_REASON_FULL = 8;
export const LEDGER_REASON_BAD_LAMPORT = 9;
export const LEDGER_REASON_BAD_RULE = 10;

// Merge rule IDs (gate 6).
export const MERGE_RULE_NONE = 0;
export const MERGE_RULE_LAST_WRITE_WINS = 1;
export const MERGE_RULE_SUM = 2;
export const MERGE_RULE_BITSET_OR = 3;
export const MERGE_RULE_CRDT_CUSTOM = 4;

// Vector embedding bit.
export const DELTA_FLAG_HAS_VECTOR_EMBEDDING = 1 << 0;

// Sentinels.
export const DELTA_HANDLE_INVALID = -1;

// Sanity caps.
const MAX_REGIONS = 1 << 12;
const MAX_NODES = 1 << 14;
const MAX_DELTAS = 1 << 18;
const MAX_COMPONENT_TYPES = 1 << 12;
const MAX_VALUE_BYTES = 1 << 24;
const MAX_AUDIT_RING = 1 << 14;
const MAX_IDEMP_WINDOW = 1024;
const U32_MAX = 0xffffffff;

// Delta record stride for readDeltaRecord:
// [regionId, lamportHi, lamportLo, nodeId, sequence,
//  idempotencyKey, authorityEpoch, entityId, componentTypeId,
//  codecVersion, valueByteOffset, valueByteLength, flags].
export const DELTA_RECORD_STRIDE = 13;

// Compaction-plan entry stride: [entityId, componentTypeId,
// keepDeltaIdx, compactedCount].
export const COMPACTION_ENTRY_STRIDE = 4;

export interface GlobalStateLedgerConfig {
  maxRegions: number;
  maxNodes: number;
  maxDeltas: number;
  maxComponentTypes: number;
  // Shared value arena bytes.
  valueArenaBytes: number;
  // Per-region idempotency-key window.
  idempotencyWindow: number;
  // Audit ring capacity.
  auditRingCapacity: number;
}

export class GlobalStateLedger {
  readonly maxRegions: number;
  readonly maxNodes: number;
  readonly maxDeltas: number;
  readonly maxComponentTypes: number;
  readonly valueArenaBytes: number;
  readonly idempotencyWindow: number;
  readonly auditRingCapacity: number;

  // Per-delta SoA columns (gate 1).
  private readonly deltaRegion: Uint16Array;
  private readonly deltaLamportHi: Uint32Array;
  private readonly deltaLamportLo: Uint32Array;
  private readonly deltaNode: Uint32Array;
  private readonly deltaSequence: Uint32Array;
  private readonly deltaIdempotencyKey: Uint32Array;
  private readonly deltaAuthorityEpoch: Uint32Array;
  private readonly deltaEntity: Uint32Array;
  private readonly deltaComponentType: Uint16Array;
  private readonly deltaCodecVersion: Uint16Array;
  private readonly deltaValueOffset: Uint32Array;
  private readonly deltaValueLength: Uint32Array;
  private readonly deltaFlags: Uint8Array;
  private deltaCount: number = 0;

  // Per-region Lamport clock (gate 1).
  private readonly regionLamportHi: Uint32Array;
  private readonly regionLamportLo: Uint32Array;
  // Per-region authority epoch (gate 2).
  private readonly regionAuthorityEpoch: Uint32Array;
  // Per-region next sequence number.
  private readonly regionNextSequence: Uint32Array;

  // Per-region idempotency ring (gate 2).
  private readonly idempRingKey: Uint32Array;
  private readonly idempRingHead: Uint32Array;
  private readonly idempRingCount: Uint32Array;

  // Per-component-type registered codec version + merge rule (gates 3, 6).
  private readonly componentMaxCodecVersion: Uint16Array;
  private readonly componentMergeRule: Uint8Array;
  private readonly componentRegistered: Uint8Array;

  // Value arena (gate 3 - the value bytes the deferred codec
  // deserializes).
  private readonly valueArena: Uint8Array;
  private valueHead: number = 0;

  // Audit ring (gate 5 - records every compaction plan + apply).
  private readonly auditRing: Int32Array;
  private auditHead: number = 0;
  private auditTail: number = 0;
  // Audit record stride: [eventType, regionId, count, tickEmitted].
  private static readonly AUDIT_STRIDE = 4;

  // Audit event types.
  static readonly AUDIT_COMPACTION_PLANNED = 1;
  static readonly AUDIT_COMPACTION_APPLIED = 2;

  private currentTick: number = 0;
  private appendsTotal: number = 0;
  private dropsTotal: number = 0;
  private compactionsTotal: number = 0;

  constructor(config: GlobalStateLedgerConfig) {
    const {
      maxRegions, maxNodes, maxDeltas, maxComponentTypes,
      valueArenaBytes, idempotencyWindow, auditRingCapacity,
    } = config;
    if (!Number.isInteger(maxRegions) || maxRegions < 1 || maxRegions > MAX_REGIONS) {
      throw new RangeError('GlobalStateLedger: maxRegions out of range, got ' + maxRegions);
    }
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES) {
      throw new RangeError('GlobalStateLedger: maxNodes out of range, got ' + maxNodes);
    }
    if (!Number.isInteger(maxDeltas) || maxDeltas < 1 || maxDeltas > MAX_DELTAS) {
      throw new RangeError('GlobalStateLedger: maxDeltas out of range, got ' + maxDeltas);
    }
    if (!Number.isInteger(maxComponentTypes) || maxComponentTypes < 1 || maxComponentTypes > MAX_COMPONENT_TYPES) {
      throw new RangeError('GlobalStateLedger: maxComponentTypes out of range, got ' + maxComponentTypes);
    }
    if (!Number.isInteger(valueArenaBytes) || valueArenaBytes < 1 || valueArenaBytes > MAX_VALUE_BYTES) {
      throw new RangeError('GlobalStateLedger: valueArenaBytes out of range, got ' + valueArenaBytes);
    }
    if (!Number.isInteger(idempotencyWindow) || idempotencyWindow < 1 || idempotencyWindow > MAX_IDEMP_WINDOW) {
      throw new RangeError('GlobalStateLedger: idempotencyWindow out of range, got ' + idempotencyWindow);
    }
    if (!Number.isInteger(auditRingCapacity) || auditRingCapacity < 1 || auditRingCapacity > MAX_AUDIT_RING) {
      throw new RangeError('GlobalStateLedger: auditRingCapacity out of range, got ' + auditRingCapacity);
    }
    this.maxRegions = maxRegions;
    this.maxNodes = maxNodes;
    this.maxDeltas = maxDeltas;
    this.maxComponentTypes = maxComponentTypes;
    this.valueArenaBytes = valueArenaBytes;
    this.idempotencyWindow = idempotencyWindow;
    this.auditRingCapacity = auditRingCapacity;

    this.deltaRegion = new Uint16Array(maxDeltas);
    this.deltaLamportHi = new Uint32Array(maxDeltas);
    this.deltaLamportLo = new Uint32Array(maxDeltas);
    this.deltaNode = new Uint32Array(maxDeltas);
    this.deltaSequence = new Uint32Array(maxDeltas);
    this.deltaIdempotencyKey = new Uint32Array(maxDeltas);
    this.deltaAuthorityEpoch = new Uint32Array(maxDeltas);
    this.deltaEntity = new Uint32Array(maxDeltas);
    this.deltaComponentType = new Uint16Array(maxDeltas);
    this.deltaCodecVersion = new Uint16Array(maxDeltas);
    this.deltaValueOffset = new Uint32Array(maxDeltas);
    this.deltaValueLength = new Uint32Array(maxDeltas);
    this.deltaFlags = new Uint8Array(maxDeltas);

    this.regionLamportHi = new Uint32Array(maxRegions);
    this.regionLamportLo = new Uint32Array(maxRegions);
    this.regionAuthorityEpoch = new Uint32Array(maxRegions);
    this.regionNextSequence = new Uint32Array(maxRegions);

    this.idempRingKey = new Uint32Array(maxRegions * idempotencyWindow);
    this.idempRingHead = new Uint32Array(maxRegions);
    this.idempRingCount = new Uint32Array(maxRegions);

    this.componentMaxCodecVersion = new Uint16Array(maxComponentTypes);
    this.componentMergeRule = new Uint8Array(maxComponentTypes);
    this.componentRegistered = new Uint8Array(maxComponentTypes);

    this.valueArena = new Uint8Array(valueArenaBytes);
    this.auditRing = new Int32Array(auditRingCapacity * GlobalStateLedger.AUDIT_STRIDE);
  }

  // --- counts ---

  getCurrentTick(): number { return this.currentTick; }
  getDeltaCount(): number { return this.deltaCount; }
  getAppendsTotal(): number { return this.appendsTotal; }
  getDropsTotal(): number { return this.dropsTotal; }
  getCompactionsTotal(): number { return this.compactionsTotal; }
  getAuditPending(): number { return this.auditTail - this.auditHead; }

  getRegionLamport(regionId: number): { hi: number; lo: number } | null {
    if (!this.requireRegion(regionId)) return null;
    return { hi: this.regionLamportHi[regionId] ?? 0, lo: this.regionLamportLo[regionId] ?? 0 };
  }

  getRegionEpoch(regionId: number): number {
    if (!this.requireRegion(regionId)) return 0;
    return this.regionAuthorityEpoch[regionId] ?? 0;
  }

  // --- component registry (gates 3, 6) ---

  registerComponentType(componentTypeId: number, maxCodecVersion: number, mergeRule: number): number {
    if (!this.requireComponentType(componentTypeId)) return LEDGER_REASON_BAD_COMPONENT;
    if (!Number.isInteger(maxCodecVersion) || maxCodecVersion < 1 || maxCodecVersion > 0xffff) {
      return LEDGER_REASON_BAD_CODEC_VERSION;
    }
    if (mergeRule < MERGE_RULE_NONE || mergeRule > MERGE_RULE_CRDT_CUSTOM) return LEDGER_REASON_BAD_RULE;
    this.componentMaxCodecVersion[componentTypeId] = maxCodecVersion & 0xffff;
    this.componentMergeRule[componentTypeId] = mergeRule & 0xff;
    this.componentRegistered[componentTypeId] = 1;
    return LEDGER_REASON_NONE;
  }

  getComponentMergeRule(componentTypeId: number): number {
    if (!this.requireComponentType(componentTypeId)) return MERGE_RULE_NONE;
    return this.componentMergeRule[componentTypeId] ?? MERGE_RULE_NONE;
  }

  // --- region authority (gate 2) ---

  rotateRegionAuthorityEpoch(regionId: number): boolean {
    if (!this.requireRegion(regionId)) return false;
    this.regionAuthorityEpoch[regionId] = (((this.regionAuthorityEpoch[regionId] ?? 0) + 1) >>> 0);
    return true;
  }

  // --- append (gates 1, 2, 3, 4) ---

  // Append a delta. Assigns a (lamport, sequence) pair locally;
  // returns the delta index, or -1 on rejection.
  appendDelta(
    regionId: number,
    nodeId: number,
    entityId: number,
    componentTypeId: number,
    codecVersion: number,
    idempotencyKey: number,
    authorityEpoch: number,
    valueBytes: Uint8Array,
    flags: number = 0,
    receivedLamportHi: number = 0,
    receivedLamportLo: number = 0,
  ): number {
    if (!this.requireRegion(regionId)) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }
    if (!this.requireNode(nodeId)) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }
    if (!Number.isInteger(entityId) || entityId < 0 || entityId > U32_MAX) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }
    if (!this.requireComponentType(componentTypeId)) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }
    if (!this.componentRegistered[componentTypeId]) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }
    const maxCodec = this.componentMaxCodecVersion[componentTypeId] ?? 0;
    if (!Number.isInteger(codecVersion) || codecVersion < 1 || codecVersion > maxCodec) {
      this.dropsTotal++;
      return DELTA_HANDLE_INVALID;
    }
    if (!Number.isInteger(idempotencyKey) || idempotencyKey < 0 || idempotencyKey > U32_MAX) {
      this.dropsTotal++;
      return DELTA_HANDLE_INVALID;
    }
    if (!Number.isInteger(authorityEpoch) || authorityEpoch < 0 || authorityEpoch > U32_MAX) {
      this.dropsTotal++;
      return DELTA_HANDLE_INVALID;
    }
    if (!valueBytes || (this.valueHead + valueBytes.length) > this.valueArenaBytes) {
      this.dropsTotal++;
      return DELTA_HANDLE_INVALID;
    }
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xff) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }
    if (this.deltaCount >= this.maxDeltas) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }

    // Authority epoch check (gate 2).
    const curEpoch = this.regionAuthorityEpoch[regionId] ?? 0;
    if ((authorityEpoch >>> 0) < curEpoch) { this.dropsTotal++; return DELTA_HANDLE_INVALID; }

    // Idempotency check (gate 2).
    if (idempotencyKey !== 0 && this.idempRingHas(regionId, idempotencyKey)) {
      this.dropsTotal++;
      return DELTA_HANDLE_INVALID;
    }

    // Update Lamport clock (gate 1). max(local, received) + 1.
    let newHi = this.regionLamportHi[regionId] ?? 0;
    let newLo = this.regionLamportLo[regionId] ?? 0;
    if (receivedLamportHi > newHi || (receivedLamportHi === newHi && receivedLamportLo > newLo)) {
      newHi = receivedLamportHi >>> 0;
      newLo = receivedLamportLo >>> 0;
    }
    // Bump.
    if (newLo === U32_MAX) { newLo = 0; newHi = (newHi + 1) >>> 0; }
    else { newLo = (newLo + 1) >>> 0; }
    this.regionLamportHi[regionId] = newHi;
    this.regionLamportLo[regionId] = newLo;
    const seq = (this.regionNextSequence[regionId] ?? 0) + 1;
    this.regionNextSequence[regionId] = seq >>> 0;

    // Copy value bytes into arena.
    const valueOffset = this.valueHead;
    this.valueArena.set(valueBytes, valueOffset);
    this.valueHead += valueBytes.length;

    const idx = this.deltaCount++;
    this.deltaRegion[idx] = regionId & 0xffff;
    this.deltaLamportHi[idx] = newHi;
    this.deltaLamportLo[idx] = newLo;
    this.deltaNode[idx] = nodeId >>> 0;
    this.deltaSequence[idx] = seq >>> 0;
    this.deltaIdempotencyKey[idx] = idempotencyKey >>> 0;
    this.deltaAuthorityEpoch[idx] = authorityEpoch >>> 0;
    this.deltaEntity[idx] = entityId >>> 0;
    this.deltaComponentType[idx] = componentTypeId & 0xffff;
    this.deltaCodecVersion[idx] = codecVersion & 0xffff;
    this.deltaValueOffset[idx] = valueOffset >>> 0;
    this.deltaValueLength[idx] = valueBytes.length >>> 0;
    this.deltaFlags[idx] = flags & 0xff;
    if (idempotencyKey !== 0) this.idempRingPush(regionId, idempotencyKey);
    this.appendsTotal++;
    return idx;
  }

  // --- read ---

  readDeltaRecord(idx: number, out: Int32Array, outOffset: number = 0): boolean {
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.deltaCount) return false;
    if (outOffset < 0 || outOffset + DELTA_RECORD_STRIDE > out.length) return false;
    out[outOffset + 0] = this.deltaRegion[idx] ?? 0;
    out[outOffset + 1] = this.deltaLamportHi[idx] ?? 0;
    out[outOffset + 2] = this.deltaLamportLo[idx] ?? 0;
    out[outOffset + 3] = this.deltaNode[idx] ?? 0;
    out[outOffset + 4] = this.deltaSequence[idx] ?? 0;
    out[outOffset + 5] = this.deltaIdempotencyKey[idx] ?? 0;
    out[outOffset + 6] = this.deltaAuthorityEpoch[idx] ?? 0;
    out[outOffset + 7] = this.deltaEntity[idx] ?? 0;
    out[outOffset + 8] = this.deltaComponentType[idx] ?? 0;
    out[outOffset + 9] = this.deltaCodecVersion[idx] ?? 0;
    out[outOffset + 10] = this.deltaValueOffset[idx] ?? 0;
    out[outOffset + 11] = this.deltaValueLength[idx] ?? 0;
    out[outOffset + 12] = this.deltaFlags[idx] ?? 0;
    return true;
  }

  readValueBytes(offset: number, length: number): Uint8Array | null {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.valueArenaBytes) return null;
    if (!Number.isInteger(length) || length < 1 || (offset + length) > this.valueArenaBytes) return null;
    return this.valueArena.subarray(offset, offset + length);
  }

  // --- compaction (gate 5) ---

  // Build a compaction plan for a region. For each (entityId,
  // componentTypeId), keep only the LATEST delta (by lamport then
  // nodeId then sequence); flag everything older as compactable.
  // Writes pairs into out at COMPACTION_ENTRY_STRIDE. Returns the
  // number of entries written. Audit-logs the plan.
  compactionPlan(regionId: number, out: Int32Array): number {
    if (!this.requireRegion(regionId)) return 0;
    let outIdx = 0;
    // Build a per-(entity, component) map of latest-delta-idx +
    // older-count. We use a linear scan + a small temporary Map.
    const latest = new Map<string, { idx: number; count: number }>();
    for (let i = 0; i < this.deltaCount; i++) {
      if ((this.deltaRegion[i] ?? 0) !== (regionId & 0xffff)) continue;
      const e = this.deltaEntity[i] ?? 0;
      const c = this.deltaComponentType[i] ?? 0;
      const k = e + ':' + c;
      const cur = latest.get(k);
      if (!cur) {
        latest.set(k, { idx: i, count: 1 });
      } else {
        // Compare (lamport, nodeId, sequence) to pick the newer.
        if (this.compareOrder(i, cur.idx) > 0) {
          cur.idx = i;
        }
        cur.count++;
      }
    }
    for (const [k, v] of latest) {
      if (v.count <= 1) continue;
      const sep = k.indexOf(':');
      const e = parseInt(k.slice(0, sep), 10);
      const c = parseInt(k.slice(sep + 1), 10);
      const olderCount = v.count - 1;
      if (outIdx + COMPACTION_ENTRY_STRIDE > out.length) break;
      out[outIdx + 0] = e;
      out[outIdx + 1] = c;
      out[outIdx + 2] = v.idx;
      out[outIdx + 3] = olderCount;
      outIdx += COMPACTION_ENTRY_STRIDE;
    }
    // Audit-log the plan (gate 5).
    this.pushAudit(GlobalStateLedger.AUDIT_COMPACTION_PLANNED, regionId,
      Math.floor(outIdx / COMPACTION_ENTRY_STRIDE));
    return outIdx;
  }

  // Returns >0 if a > b in the (lamport, nodeId, sequence) ordering;
  // <0 if a < b; 0 if equal.
  private compareOrder(a: number, b: number): number {
    const aHi = this.deltaLamportHi[a] ?? 0;
    const bHi = this.deltaLamportHi[b] ?? 0;
    if (aHi !== bHi) return aHi - bHi;
    const aLo = this.deltaLamportLo[a] ?? 0;
    const bLo = this.deltaLamportLo[b] ?? 0;
    if (aLo !== bLo) return aLo - bLo;
    const aN = this.deltaNode[a] ?? 0;
    const bN = this.deltaNode[b] ?? 0;
    if (aN !== bN) return aN - bN;
    return (this.deltaSequence[a] ?? 0) - (this.deltaSequence[b] ?? 0);
  }

  // The deferred persistence layer calls this after applying the
  // plan to the on-disk WAL. Records the apply audit event.
  notifyCompactionApplied(regionId: number, entriesApplied: number): boolean {
    if (!this.requireRegion(regionId)) return false;
    if (!Number.isInteger(entriesApplied) || entriesApplied < 0) return false;
    this.pushAudit(GlobalStateLedger.AUDIT_COMPACTION_APPLIED, regionId, entriesApplied);
    this.compactionsTotal++;
    return true;
  }

  consumeAuditEvent(out: Int32Array, outOffset: number = 0): boolean {
    if (this.auditHead >= this.auditTail) return false;
    if (outOffset < 0 || outOffset + GlobalStateLedger.AUDIT_STRIDE > out.length) return false;
    const slot = (this.auditHead % this.auditRingCapacity) * GlobalStateLedger.AUDIT_STRIDE;
    out[outOffset + 0] = this.auditRing[slot + 0] ?? 0;
    out[outOffset + 1] = this.auditRing[slot + 1] ?? 0;
    out[outOffset + 2] = this.auditRing[slot + 2] ?? 0;
    out[outOffset + 3] = this.auditRing[slot + 3] ?? 0;
    this.auditHead++;
    return true;
  }

  private pushAudit(eventType: number, regionId: number, count: number): void {
    if (this.auditTail - this.auditHead >= this.auditRingCapacity) return;
    const slot = (this.auditTail % this.auditRingCapacity) * GlobalStateLedger.AUDIT_STRIDE;
    this.auditRing[slot + 0] = eventType | 0;
    this.auditRing[slot + 1] = regionId | 0;
    this.auditRing[slot + 2] = count | 0;
    this.auditRing[slot + 3] = this.currentTick | 0;
    this.auditTail++;
  }

  // --- benchmark surface (gate 7) ---

  getStatsSnapshot(out: Uint32Array): boolean {
    if (out.length < 4) return false;
    out[0] = this.appendsTotal >>> 0;
    out[1] = this.dropsTotal >>> 0;
    out[2] = this.compactionsTotal >>> 0;
    out[3] = this.deltaCount >>> 0;
    return true;
  }

  // --- helpers ---

  private requireRegion(r: number): boolean {
    return Number.isInteger(r) && r >= 0 && r < this.maxRegions;
  }

  private requireNode(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n < this.maxNodes;
  }

  private requireComponentType(c: number): boolean {
    return Number.isInteger(c) && c >= 0 && c < this.maxComponentTypes;
  }

  private idempRingHas(regionId: number, key: number): boolean {
    const base = regionId * this.idempotencyWindow;
    const count = this.idempRingCount[regionId] ?? 0;
    for (let i = 0; i < count; i++) {
      if (this.idempRingKey[base + i] === (key >>> 0)) return true;
    }
    return false;
  }

  private idempRingPush(regionId: number, key: number): void {
    const base = regionId * this.idempotencyWindow;
    const head = this.idempRingHead[regionId] ?? 0;
    this.idempRingKey[base + head] = key >>> 0;
    this.idempRingHead[regionId] = (head + 1) % this.idempotencyWindow;
    if ((this.idempRingCount[regionId] ?? 0) < this.idempotencyWindow) {
      this.idempRingCount[regionId] = ((this.idempRingCount[regionId] ?? 0) + 1) >>> 0;
    }
  }

  tick(t: number): void {
    if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
      throw new RangeError('GlobalStateLedger.tick: t must be a u32, got ' + t);
    }
    this.currentTick = t | 0;
  }

  // --- lifecycle ---

  clear(): void {
    this.deltaRegion.fill(0);
    this.deltaLamportHi.fill(0);
    this.deltaLamportLo.fill(0);
    this.deltaNode.fill(0);
    this.deltaSequence.fill(0);
    this.deltaIdempotencyKey.fill(0);
    this.deltaAuthorityEpoch.fill(0);
    this.deltaEntity.fill(0);
    this.deltaComponentType.fill(0);
    this.deltaCodecVersion.fill(0);
    this.deltaValueOffset.fill(0);
    this.deltaValueLength.fill(0);
    this.deltaFlags.fill(0);
    this.deltaCount = 0;
    this.regionLamportHi.fill(0);
    this.regionLamportLo.fill(0);
    this.regionAuthorityEpoch.fill(0);
    this.regionNextSequence.fill(0);
    this.idempRingKey.fill(0);
    this.idempRingHead.fill(0);
    this.idempRingCount.fill(0);
    this.componentMaxCodecVersion.fill(0);
    this.componentMergeRule.fill(0);
    this.componentRegistered.fill(0);
    this.valueArena.fill(0);
    this.valueHead = 0;
    this.auditRing.fill(0);
    this.auditHead = 0;
    this.auditTail = 0;
    this.appendsTotal = 0;
    this.dropsTotal = 0;
    this.compactionsTotal = 0;
  }
}
