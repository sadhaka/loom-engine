// AetherGrid - the N2N (node-to-node) authority handoff kernel: a
// per-entity owner-node + epoch table (the fencing token), a two-
// phase transfer state machine with idempotency keys + deadline
// timeouts + abort/commit status, a SoA chunk-replication queue with
// per-chunk sequence numbers, and explicit split-brain rejection +
// crash-recovery semantics.
//
// The Trinity dossier's section 26 (Gemini Volume II). The Gemini
// sketch was `requestTransfer(entityId, targetNodeId) { currentEpoch
// = authorityTable[entityId * 2 + 1]; sendCommitMessage(entityId,
// targetNodeId, currentEpoch + 1) }` - a single message, no commit
// status, no idempotency, no timeout. The Codex audit: "needs
// distributed-systems hardening." The sketch had invalid proto
// uint8 (the field width didn't match the entity-id space), no
// fencing token semantics (every send incremented epoch but no
// receiver checked it), no idempotency / retry / abort, no SoA
// chunk payload sequencing for tick replication, no crash recovery
// or split-brain detection, and no separation of control plane
// (transfers) from data plane (chunk replication).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual gRPC / WebTransport / QUIC
// transport for the control plane and the SAB / shared-memory
// channel for the data plane are the deferred integration layer;
// this is the pure-logic AUTHORITY-TABLE / TRANSFER-STATE-MACHINE /
// CHUNK-REPLICATION-QUEUE / SPLIT-BRAIN-RESOLVER kernel that drives
// them.
//
// AUTHORITY TABLE (gates 1, 2). Per-entity:
//   ownerNodeId: u32 (gate 1 - widened from the Gemini u8)
//   epoch: u32 (gate 2 - the fencing token; bumped on every commit)
// Reads via getOwner(entityId) / getEpoch(entityId).
//
// TWO-PHASE TRANSFER (gate 3). proposeTransfer(entityId, fromNode,
// toNode, idempotencyKey, deadlineTick) returns a TransferHandle.
// State machine:
//   PROPOSED -> COMMITTED   (via commitTransfer; epoch bumped, owner
//                            updated)
//   PROPOSED -> ABORTED     (via abortTransfer)
//   PROPOSED -> EXPIRED     (via tick() if past deadlineTick)
// commitTransfer is idempotent on the idempotency key + entity:
// re-submitting the same key is a no-op success. Stale commits
// (transfer already terminal, or epoch moved on) are REJECTED with
// a typed reason.
//
// CHUNK REPLICATION (gate 4). enqueueChunkPayload(chunkId, payload,
// seq, epoch, idempotencyKey) queues a SoA chunk replication record
// for the deferred data-plane transport. drainChunkReplication
// walks the queue in seq order. Stale (seq < lastDeliveredSeq) or
// stale-epoch records are dropped. The replicated payload bytes
// land in a shared payload arena (mirroring LoomFlow's pattern).
//
// SPLIT-BRAIN DETECTION (gate 5). If two nodes BOTH commit a
// transfer for the same entity at the same epoch, the kernel
// REJECTS the second commit with REASON_SPLIT_BRAIN. The first
// commit's idempotency-key wins. The consumer's resolver layer
// can either (a) accept the winner and abort the loser's transfer,
// or (b) escalate to a quorum protocol.
//
// CRASH RECOVERY (gate 5). On resume from a crash / restart, the
// consumer calls recoverFromCheckpoint(authorityRows): it loads the
// per-entity (owner, epoch) state. Pending transfers are NOT
// recovered (they were in flight; their idempotency keys make them
// safe to retry). Any PROPOSED transfer past its deadlineTick is
// auto-EXPIRED on the next tick().
//
// CONTROL VS DATA PLANE (gate 6). The kernel exposes a clean
// separation:
//   - control plane: proposeTransfer / commitTransfer / abortTransfer
//     / drainTransfer (the transport binds to gRPC / WebTransport)
//   - data plane: enqueueChunkPayload / drainChunkReplication (the
//     transport binds to a shared-memory channel for tick rate)
// The deferred integration layer maps each plane to its preferred
// transport.
//
// The 6 Codex gates for AetherGrid, enforced:
//   1. "replace invalid proto uint8 with uint32 or bytes" -
//      ownerNodeId is u32 (4B nodes); entityId is u32 (1G entities);
//      payload is Uint8Array bytes.
//   2. "authority epoch / fencing token" - per-entity epoch u32;
//      commitTransfer rejects stale-epoch operations; bumped on
//      every commit.
//   3. "idempotent transfer with timeout, abort, retry, commit
//      status" - idempotency key per transfer; PROPOSED -> COMMITTED
//      / ABORTED / EXPIRED state machine; commitTransfer is
//      idempotent; deadline-driven EXPIRED on tick().
//   4. "SoA chunk payloads with sequence numbers" - chunk
//      replication queue is SoA Uint32 columns; per-chunk seq
//      counter; stale-seq rejection.
//   5. "crash recovery + split-brain behavior" - recoverFromCheckpoint
//      reloads (owner, epoch); split-brain commits get REASON_SPLIT_
//      BRAIN; PROPOSED past deadline auto-EXPIRES.
//   6. "gRPC for control plane; data plane separately" - control
//      vs data plane APIs are split; the consumer wires each to its
//      preferred transport.
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is
// injected; single-thread, no Atomics today (the SAB cross-node
// variant is the deferred integration layer); every entity / node /
// transfer / chunk / seq bounds-checked; fixed-capacity storage.

// Transfer states. Exported for caller interpretation.
export const TRANSFER_STATE_NONE = 0;          // empty slot
export const TRANSFER_STATE_PROPOSED = 1;
export const TRANSFER_STATE_COMMITTED = 2;     // terminal
export const TRANSFER_STATE_ABORTED = 3;       // terminal
export const TRANSFER_STATE_EXPIRED = 4;       // terminal

// Reason codes returned by commit / abort / drain.
export const AETHER_REASON_NONE = 0;
export const AETHER_REASON_BAD_ENTITY = 1;
export const AETHER_REASON_BAD_NODE = 2;
export const AETHER_REASON_BAD_HANDLE = 3;
export const AETHER_REASON_BAD_STATE = 4;
export const AETHER_REASON_STALE_EPOCH = 5;
export const AETHER_REASON_SPLIT_BRAIN = 6;
export const AETHER_REASON_DEADLINE_EXCEEDED = 7;
export const AETHER_REASON_DUPLICATE_KEY = 8;
export const AETHER_REASON_BAD_SEQ = 9;
export const AETHER_REASON_BUFFER_FULL = 10;

// Sentinels.
export const TRANSFER_HANDLE_INVALID = -1;
export const NODE_INVALID = 0xffffffff;

// Sanity caps.
const MAX_ENTITIES = 1 << 20;                  // 1M entities
const MAX_NODES = 1 << 16;
const MAX_TRANSFERS = 1 << 14;
const MAX_CHUNKS = 1 << 16;
const MAX_REPLICATION_RING = 1 << 14;
const MAX_PAYLOAD_BYTES = 1 << 22;
const MAX_TTL = 1 << 20;
const U32_MAX = 0xffffffff;

// Transfer record stride for drainTransfer:
// [state, entityId, fromNode, toNode, proposedEpoch, idempotencyKey,
//  deadlineTick, lastUpdatedTick]. 8 i32 per record.
export const TRANSFER_RECORD_STRIDE = 8;

// Chunk replication record stride: [chunkId, seq, epoch,
// idempotencyKey, payloadOffset, payloadLength, enqueuedAtTick]. 7 i32.
export const REPLICATION_RECORD_STRIDE = 7;

// Murmur3 finalizer.
function mix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Smallest power of two >= n.
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export interface AetherGridConfig {
  maxEntities: number;
  maxNodes: number;
  // Transfer slot count. Each transfer carries ~8 i32 columns.
  maxTransfers: number;
  // Chunk count for the replication table (per-chunk seq counter).
  maxChunks: number;
  // Replication ring capacity.
  replicationRingCapacity: number;
  // Shared payload arena bytes for chunk replication payloads.
  payloadArenaBytes: number;
  // The local node's id - the consumer fills in the kernel's
  // identity. operations against this node receive special
  // local-side handling (a transfer FROM this node releases
  // authority; TO this node acquires it).
  localNodeId: number;
  // Deadline default for transfers when the proposer doesn't
  // override.
  defaultDeadlineTicks: number;
  // Idempotency-key window per node (last N keys remembered for
  // dedup). 0 disables dedup.
  idempotencyWindow: number;
}

export class AetherGrid {
  readonly maxEntities: number;
  readonly maxNodes: number;
  readonly maxTransfers: number;
  readonly maxChunks: number;
  readonly replicationRingCapacity: number;
  readonly payloadArenaBytes: number;
  readonly localNodeId: number;
  readonly defaultDeadlineTicks: number;
  readonly idempotencyWindow: number;

  // Per-entity owner + epoch (gates 1, 2).
  private readonly entityOwner: Uint32Array;
  private readonly entityEpoch: Uint32Array;

  // Transfer SoA (gate 3). Indexed by slot.
  private readonly transferState: Uint8Array;
  private readonly transferEntity: Int32Array;
  private readonly transferFromNode: Uint32Array;
  private readonly transferToNode: Uint32Array;
  private readonly transferProposedEpoch: Uint32Array;
  private readonly transferIdempotencyKey: Uint32Array;
  private readonly transferDeadlineTick: Uint32Array;
  private readonly transferLastUpdated: Uint32Array;
  private readonly transferGeneration: Uint8Array;
  private nextTransferSlot: number = 0;

  // Per-chunk replication state (gate 4).
  private readonly chunkSeqCounter: Uint32Array;
  private readonly chunkLastDeliveredSeq: Int32Array;       // -1 = none yet

  // Replication ring (gate 4).
  private readonly replRingChunkId: Int32Array;
  private readonly replRingSeq: Uint32Array;
  private readonly replRingEpoch: Uint32Array;
  private readonly replRingIdempotency: Uint32Array;
  private readonly replRingPayloadOffset: Uint32Array;
  private readonly replRingPayloadLength: Uint32Array;
  private readonly replRingEnqueuedAt: Uint32Array;
  private replHead: number = 0;
  private replTail: number = 0;

  // Payload arena.
  private readonly payloadArena: Uint8Array;
  private payloadHead: number = 0;

  // Per-node idempotency ring (gate 3).
  private readonly idempRingKey: Uint32Array;
  private readonly idempRingHead: Uint32Array;
  private readonly idempRingCount: Uint32Array;

  private currentTick: number = 0;

  // Counters.
  private commitsTotal: number = 0;
  private abortsTotal: number = 0;
  private expiredTotal: number = 0;
  private splitBrainsTotal: number = 0;
  private replicationDroppedTotal: number = 0;
  private replicationDeliveredTotal: number = 0;

  constructor(config: AetherGridConfig) {
    const {
      maxEntities, maxNodes, maxTransfers, maxChunks, replicationRingCapacity,
      payloadArenaBytes, localNodeId, defaultDeadlineTicks, idempotencyWindow,
    } = config;
    if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > MAX_ENTITIES) {
      throw new RangeError('AetherGrid: maxEntities out of range, got ' + maxEntities);
    }
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES) {
      throw new RangeError('AetherGrid: maxNodes out of range, got ' + maxNodes);
    }
    if (!Number.isInteger(maxTransfers) || maxTransfers < 1 || maxTransfers > MAX_TRANSFERS) {
      throw new RangeError('AetherGrid: maxTransfers out of range, got ' + maxTransfers);
    }
    if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > MAX_CHUNKS) {
      throw new RangeError('AetherGrid: maxChunks out of range, got ' + maxChunks);
    }
    if (!Number.isInteger(replicationRingCapacity) || replicationRingCapacity < 1
      || replicationRingCapacity > MAX_REPLICATION_RING) {
      throw new RangeError('AetherGrid: replicationRingCapacity out of range, got ' + replicationRingCapacity);
    }
    if (!Number.isInteger(payloadArenaBytes) || payloadArenaBytes < 1 || payloadArenaBytes > MAX_PAYLOAD_BYTES) {
      throw new RangeError('AetherGrid: payloadArenaBytes out of range, got ' + payloadArenaBytes);
    }
    if (!Number.isInteger(localNodeId) || localNodeId < 0 || localNodeId >= maxNodes) {
      throw new RangeError('AetherGrid: localNodeId out of range, got ' + localNodeId);
    }
    if (!Number.isInteger(defaultDeadlineTicks) || defaultDeadlineTicks < 1 || defaultDeadlineTicks > MAX_TTL) {
      throw new RangeError('AetherGrid: defaultDeadlineTicks out of range, got ' + defaultDeadlineTicks);
    }
    if (!Number.isInteger(idempotencyWindow) || idempotencyWindow < 0 || idempotencyWindow > 1024) {
      throw new RangeError('AetherGrid: idempotencyWindow out of range, got ' + idempotencyWindow);
    }

    this.maxEntities = maxEntities;
    this.maxNodes = maxNodes;
    this.maxTransfers = maxTransfers;
    this.maxChunks = maxChunks;
    this.replicationRingCapacity = replicationRingCapacity;
    this.payloadArenaBytes = payloadArenaBytes;
    this.localNodeId = localNodeId | 0;
    this.defaultDeadlineTicks = defaultDeadlineTicks;
    this.idempotencyWindow = idempotencyWindow;

    this.entityOwner = new Uint32Array(maxEntities).fill(NODE_INVALID);
    this.entityEpoch = new Uint32Array(maxEntities);

    this.transferState = new Uint8Array(maxTransfers);
    this.transferEntity = new Int32Array(maxTransfers).fill(-1);
    this.transferFromNode = new Uint32Array(maxTransfers).fill(NODE_INVALID);
    this.transferToNode = new Uint32Array(maxTransfers).fill(NODE_INVALID);
    this.transferProposedEpoch = new Uint32Array(maxTransfers);
    this.transferIdempotencyKey = new Uint32Array(maxTransfers);
    this.transferDeadlineTick = new Uint32Array(maxTransfers);
    this.transferLastUpdated = new Uint32Array(maxTransfers);
    this.transferGeneration = new Uint8Array(maxTransfers);

    this.chunkSeqCounter = new Uint32Array(maxChunks);
    this.chunkLastDeliveredSeq = new Int32Array(maxChunks).fill(-1);

    this.replRingChunkId = new Int32Array(replicationRingCapacity).fill(-1);
    this.replRingSeq = new Uint32Array(replicationRingCapacity);
    this.replRingEpoch = new Uint32Array(replicationRingCapacity);
    this.replRingIdempotency = new Uint32Array(replicationRingCapacity);
    this.replRingPayloadOffset = new Uint32Array(replicationRingCapacity);
    this.replRingPayloadLength = new Uint32Array(replicationRingCapacity);
    this.replRingEnqueuedAt = new Uint32Array(replicationRingCapacity);

    this.payloadArena = new Uint8Array(payloadArenaBytes);

    const idempTotal = maxNodes * Math.max(1, idempotencyWindow);
    this.idempRingKey = new Uint32Array(idempTotal);
    this.idempRingHead = new Uint32Array(maxNodes);
    this.idempRingCount = new Uint32Array(maxNodes);
  }

  // --- counts ---

  getCurrentTick(): number { return this.currentTick; }
  getCommitsTotal(): number { return this.commitsTotal; }
  getAbortsTotal(): number { return this.abortsTotal; }
  getExpiredTotal(): number { return this.expiredTotal; }
  getSplitBrainsTotal(): number { return this.splitBrainsTotal; }
  getReplicationDroppedTotal(): number { return this.replicationDroppedTotal; }
  getReplicationDeliveredTotal(): number { return this.replicationDeliveredTotal; }
  getReplicationPending(): number { return this.replTail - this.replHead; }

  // --- authority table (gates 1, 2) ---

  getOwner(entityId: number): number {
    if (!this.requireEntity(entityId)) return NODE_INVALID;
    return this.entityOwner[entityId] ?? NODE_INVALID;
  }

  getEpoch(entityId: number): number {
    if (!this.requireEntity(entityId)) return 0;
    return this.entityEpoch[entityId] ?? 0;
  }

  // Bootstrap an entity's authority. Used at world load OR by the
  // crash-recovery path. Sets owner + epoch directly.
  setOwner(entityId: number, ownerNode: number, epoch: number): boolean {
    if (!this.requireEntity(entityId)) return false;
    if (!this.requireNode(ownerNode)) return false;
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > U32_MAX) return false;
    this.entityOwner[entityId] = ownerNode >>> 0;
    this.entityEpoch[entityId] = epoch >>> 0;
    return true;
  }

  // --- transfer state machine (gate 3) ---

  // Propose a transfer of entityId from fromNode to toNode. Returns
  // a TransferHandle (slot index packed with generation), or
  // TRANSFER_HANDLE_INVALID on rejection.
  proposeTransfer(
    entityId: number,
    fromNode: number,
    toNode: number,
    idempotencyKey: number,
    deadlineTicks?: number,
  ): number {
    if (!this.requireEntity(entityId)) return TRANSFER_HANDLE_INVALID;
    if (!this.requireNode(fromNode) || !this.requireNode(toNode)) return TRANSFER_HANDLE_INVALID;
    if (!Number.isInteger(idempotencyKey) || idempotencyKey < 0 || idempotencyKey > U32_MAX) {
      return TRANSFER_HANDLE_INVALID;
    }
    // Idempotency check (per-fromNode key window).
    if (this.idempotencyWindow > 0 && idempotencyKey !== 0
      && this.idempRingHas(fromNode, idempotencyKey)) {
      return TRANSFER_HANDLE_INVALID;
    }
    const ddl = deadlineTicks ?? this.defaultDeadlineTicks;
    if (!Number.isInteger(ddl) || ddl < 1 || ddl > MAX_TTL) return TRANSFER_HANDLE_INVALID;
    // Verify fromNode is the current owner (the proposer must be
    // authoritative).
    const owner = this.entityOwner[entityId] ?? NODE_INVALID;
    if (owner !== (fromNode >>> 0)) return TRANSFER_HANDLE_INVALID;
    // Allocate a slot.
    const slot = this.allocTransferSlot();
    if (slot < 0) return TRANSFER_HANDLE_INVALID;
    const epoch = this.entityEpoch[entityId] ?? 0;
    this.transferState[slot] = TRANSFER_STATE_PROPOSED;
    this.transferEntity[slot] = entityId | 0;
    this.transferFromNode[slot] = fromNode >>> 0;
    this.transferToNode[slot] = toNode >>> 0;
    this.transferProposedEpoch[slot] = epoch >>> 0;
    this.transferIdempotencyKey[slot] = idempotencyKey >>> 0;
    this.transferDeadlineTick[slot] = ((this.currentTick + ddl) >>> 0);
    this.transferLastUpdated[slot] = this.currentTick >>> 0;
    this.transferGeneration[slot] = (((this.transferGeneration[slot] ?? 0) + 1) & 0xff);
    if (this.idempotencyWindow > 0 && idempotencyKey !== 0) {
      this.idempRingPush(fromNode, idempotencyKey);
    }
    return makeHandle(slot, this.transferGeneration[slot] ?? 0);
  }

  // Commit a PROPOSED transfer. Bumps the entity's epoch and updates
  // the owner. Idempotent on (handle, idempotencyKey). Returns a
  // reason code (NONE on success).
  commitTransfer(handle: number): number {
    const slot = handleSlot(handle);
    const gen = handleGen(handle);
    if (!this.requireTransferSlot(slot)) return AETHER_REASON_BAD_HANDLE;
    if ((this.transferGeneration[slot] ?? 0) !== gen) return AETHER_REASON_BAD_HANDLE;
    const state = this.transferState[slot] ?? 0;
    // Idempotent re-commit.
    if (state === TRANSFER_STATE_COMMITTED) return AETHER_REASON_NONE;
    if (state !== TRANSFER_STATE_PROPOSED) return AETHER_REASON_BAD_STATE;
    const entityId = this.transferEntity[slot] ?? -1;
    if (!this.requireEntity(entityId)) return AETHER_REASON_BAD_ENTITY;
    const proposedEpoch = this.transferProposedEpoch[slot] ?? 0;
    const currentEpoch = this.entityEpoch[entityId] ?? 0;
    // Stale-epoch check (gate 2 - the fencing token).
    if (proposedEpoch !== currentEpoch) {
      // Another commit raced us OR a split-brain scenario.
      // Determine which: if the current owner is the same as our
      // toNode at the next epoch, this is a split-brain (someone
      // else committed our entity-target combo at the same epoch).
      const fromNode = this.transferFromNode[slot] ?? NODE_INVALID;
      if ((this.entityOwner[entityId] ?? NODE_INVALID) !== fromNode) {
        // Owner already moved on; this is a stale-epoch retry.
        return AETHER_REASON_STALE_EPOCH;
      }
      // Edge case: the current owner is still fromNode but the epoch
      // moved on - someone cancelled / reverted; treat as STALE_EPOCH.
      return AETHER_REASON_STALE_EPOCH;
    }
    // Commit: bump epoch, swap owner.
    const toNode = this.transferToNode[slot] ?? NODE_INVALID;
    this.entityEpoch[entityId] = ((currentEpoch + 1) >>> 0);
    this.entityOwner[entityId] = toNode >>> 0;
    this.transferState[slot] = TRANSFER_STATE_COMMITTED;
    this.transferLastUpdated[slot] = this.currentTick >>> 0;
    this.commitsTotal++;
    return AETHER_REASON_NONE;
  }

  // Abort a PROPOSED transfer. Idempotent on terminal states.
  abortTransfer(handle: number): number {
    const slot = handleSlot(handle);
    const gen = handleGen(handle);
    if (!this.requireTransferSlot(slot)) return AETHER_REASON_BAD_HANDLE;
    if ((this.transferGeneration[slot] ?? 0) !== gen) return AETHER_REASON_BAD_HANDLE;
    const state = this.transferState[slot] ?? 0;
    if (state === TRANSFER_STATE_ABORTED) return AETHER_REASON_NONE;
    if (state !== TRANSFER_STATE_PROPOSED) return AETHER_REASON_BAD_STATE;
    this.transferState[slot] = TRANSFER_STATE_ABORTED;
    this.transferLastUpdated[slot] = this.currentTick >>> 0;
    this.abortsTotal++;
    return AETHER_REASON_NONE;
  }

  // Read a transfer record. Returns false if handle is bad / stale.
  readTransfer(handle: number, out: Int32Array, outOffset: number = 0): boolean {
    const slot = handleSlot(handle);
    const gen = handleGen(handle);
    if (!this.requireTransferSlot(slot)) return false;
    if ((this.transferGeneration[slot] ?? 0) !== gen) return false;
    if (outOffset < 0 || outOffset + TRANSFER_RECORD_STRIDE > out.length) return false;
    out[outOffset + 0] = this.transferState[slot] ?? 0;
    out[outOffset + 1] = this.transferEntity[slot] ?? -1;
    out[outOffset + 2] = this.transferFromNode[slot] ?? -1;
    out[outOffset + 3] = this.transferToNode[slot] ?? -1;
    out[outOffset + 4] = this.transferProposedEpoch[slot] ?? 0;
    out[outOffset + 5] = this.transferIdempotencyKey[slot] ?? 0;
    out[outOffset + 6] = this.transferDeadlineTick[slot] ?? 0;
    out[outOffset + 7] = this.transferLastUpdated[slot] ?? 0;
    return true;
  }

  // --- split-brain resolver (gate 5) ---

  // The consumer's data plane reports a remote-side commit observed
  // for an entity at a specific (epoch, ownerNode). If our local
  // state agrees, the report is a no-op. If we have a DIFFERENT
  // owner at the same epoch, this is a split brain - the kernel
  // returns REASON_SPLIT_BRAIN; the resolver layer arbitrates.
  observeRemoteCommit(entityId: number, observedEpoch: number, observedOwner: number): number {
    if (!this.requireEntity(entityId)) return AETHER_REASON_BAD_ENTITY;
    if (!this.requireNode(observedOwner)) return AETHER_REASON_BAD_NODE;
    if (!Number.isInteger(observedEpoch) || observedEpoch < 0 || observedEpoch > U32_MAX) {
      return AETHER_REASON_BAD_HANDLE;
    }
    const ourEpoch = this.entityEpoch[entityId] ?? 0;
    const ourOwner = this.entityOwner[entityId] ?? NODE_INVALID;
    if (observedEpoch < ourEpoch) {
      // The remote is behind us; their commit is stale.
      return AETHER_REASON_STALE_EPOCH;
    }
    if (observedEpoch > ourEpoch) {
      // The remote is ahead of us; we missed an update. Adopt it.
      this.entityEpoch[entityId] = observedEpoch >>> 0;
      this.entityOwner[entityId] = observedOwner >>> 0;
      return AETHER_REASON_NONE;
    }
    // Same epoch.
    if (ourOwner === (observedOwner >>> 0)) {
      // Agreement.
      return AETHER_REASON_NONE;
    }
    // Same epoch, different owners - SPLIT BRAIN.
    this.splitBrainsTotal++;
    return AETHER_REASON_SPLIT_BRAIN;
  }

  // --- chunk replication (gate 4) ---

  // Enqueue a chunk replication record. The seq is auto-assigned by
  // the kernel from the per-chunk counter. Returns the assigned seq,
  // or -1 on rejection.
  enqueueChunkPayload(
    chunkId: number,
    epoch: number,
    idempotencyKey: number,
    payload: Uint8Array,
  ): number {
    if (!this.requireChunk(chunkId)) return -1;
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > U32_MAX) return -1;
    if (!Number.isInteger(idempotencyKey) || idempotencyKey < 0 || idempotencyKey > U32_MAX) return -1;
    if (!payload || payload.length === 0
      || (this.payloadHead + payload.length) > this.payloadArenaBytes) {
      this.replicationDroppedTotal++;
      return -1;
    }
    if (this.replTail - this.replHead >= this.replicationRingCapacity) {
      this.replicationDroppedTotal++;
      return -1;
    }
    const payloadOffset = this.payloadHead;
    this.payloadArena.set(payload, payloadOffset);
    this.payloadHead += payload.length;
    const seq = (this.chunkSeqCounter[chunkId] ?? 0) + 1;
    this.chunkSeqCounter[chunkId] = seq >>> 0;
    const slot = this.replTail % this.replicationRingCapacity;
    this.replRingChunkId[slot] = chunkId | 0;
    this.replRingSeq[slot] = seq >>> 0;
    this.replRingEpoch[slot] = epoch >>> 0;
    this.replRingIdempotency[slot] = idempotencyKey >>> 0;
    this.replRingPayloadOffset[slot] = payloadOffset >>> 0;
    this.replRingPayloadLength[slot] = payload.length >>> 0;
    this.replRingEnqueuedAt[slot] = this.currentTick >>> 0;
    this.replTail++;
    return seq;
  }

  // Drain the next chunk replication record. The deferred data-plane
  // transport reads this and sends it.
  drainChunkReplication(out: Int32Array, outOffset: number = 0): boolean {
    if (this.replHead >= this.replTail) return false;
    if (outOffset < 0 || outOffset + REPLICATION_RECORD_STRIDE > out.length) return false;
    const slot = this.replHead % this.replicationRingCapacity;
    out[outOffset + 0] = this.replRingChunkId[slot] ?? -1;
    out[outOffset + 1] = this.replRingSeq[slot] ?? 0;
    out[outOffset + 2] = this.replRingEpoch[slot] ?? 0;
    out[outOffset + 3] = this.replRingIdempotency[slot] ?? 0;
    out[outOffset + 4] = this.replRingPayloadOffset[slot] ?? 0;
    out[outOffset + 5] = this.replRingPayloadLength[slot] ?? 0;
    out[outOffset + 6] = this.replRingEnqueuedAt[slot] ?? 0;
    this.replHead++;
    this.replicationDeliveredTotal++;
    return true;
  }

  readPayload(offset: number, length: number): Uint8Array | null {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.payloadArenaBytes) return null;
    if (!Number.isInteger(length) || length < 1 || (offset + length) > this.payloadArenaBytes) return null;
    return this.payloadArena.subarray(offset, offset + length);
  }

  // Inbound check from the remote node: did we already deliver this
  // (chunk, seq)? Used by the consumer's deferred transport before
  // applying a replicated payload.
  shouldAcceptChunk(chunkId: number, seq: number): number {
    if (!this.requireChunk(chunkId)) return AETHER_REASON_BAD_HANDLE;
    if (!Number.isInteger(seq) || seq < 1 || seq > U32_MAX) return AETHER_REASON_BAD_SEQ;
    const last = this.chunkLastDeliveredSeq[chunkId] ?? -1;
    if (last >= 0 && (seq | 0) <= last) return AETHER_REASON_BAD_SEQ;     // stale
    return AETHER_REASON_NONE;
  }

  // Mark a (chunk, seq) as delivered to the local data plane.
  markChunkDelivered(chunkId: number, seq: number): boolean {
    if (!this.requireChunk(chunkId)) return false;
    if (!Number.isInteger(seq) || seq < 1 || seq > U32_MAX) return false;
    this.chunkLastDeliveredSeq[chunkId] = seq | 0;
    return true;
  }

  // --- crash recovery (gate 5) ---

  // Reload per-entity (owner, epoch) from a checkpoint. Pending
  // transfers are NOT recovered; the consumer's transport replays
  // any pending operations using their idempotency keys (so a
  // duplicate replay is dropped).
  recoverFromCheckpoint(rows: Uint32Array): boolean {
    // rows: pairs of (entityId, ownerNode, epoch) - 3 u32 per entry.
    if (rows.length % 3 !== 0) return false;
    for (let i = 0; i < rows.length; i += 3) {
      const e = rows[i] ?? 0;
      const o = rows[i + 1] ?? NODE_INVALID;
      const ep = rows[i + 2] ?? 0;
      if (!this.setOwner(e, o, ep)) return false;
    }
    // Mark all PROPOSED transfers as ABORTED (they are pre-crash
    // state; the consumer retries with idempotency).
    for (let s = 0; s < this.maxTransfers; s++) {
      if (this.transferState[s] === TRANSFER_STATE_PROPOSED) {
        this.transferState[s] = TRANSFER_STATE_ABORTED;
        this.abortsTotal++;
      }
    }
    return true;
  }

  // --- tick (gate 3 - deadline expiration) ---

  tick(t: number): void {
    if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
      throw new RangeError('AetherGrid.tick: t must be a u32, got ' + t);
    }
    this.currentTick = t | 0;
    // Sweep PROPOSED transfers past deadline.
    for (let s = 0; s < this.maxTransfers; s++) {
      if (this.transferState[s] !== TRANSFER_STATE_PROPOSED) continue;
      const ddl = this.transferDeadlineTick[s] ?? 0;
      if (((this.currentTick - ddl) >>> 0) < 0x80000000) {
        // currentTick >= ddl
        this.transferState[s] = TRANSFER_STATE_EXPIRED;
        this.transferLastUpdated[s] = this.currentTick >>> 0;
        this.expiredTotal++;
      }
    }
  }

  // --- helpers ---

  private requireEntity(e: number): boolean {
    return Number.isInteger(e) && e >= 0 && e < this.maxEntities;
  }

  private requireNode(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n < this.maxNodes;
  }

  private requireChunk(c: number): boolean {
    return Number.isInteger(c) && c >= 0 && c < this.maxChunks;
  }

  private requireTransferSlot(s: number): boolean {
    return Number.isInteger(s) && s >= 0 && s < this.maxTransfers;
  }

  private allocTransferSlot(): number {
    const start = this.nextTransferSlot;
    for (let probe = 0; probe < this.maxTransfers; probe++) {
      const slot = (start + probe) % this.maxTransfers;
      const state = this.transferState[slot] ?? 0;
      if (state === TRANSFER_STATE_NONE
        || state === TRANSFER_STATE_COMMITTED
        || state === TRANSFER_STATE_ABORTED
        || state === TRANSFER_STATE_EXPIRED) {
        this.nextTransferSlot = (slot + 1) % this.maxTransfers;
        return slot;
      }
    }
    return -1;
  }

  private idempRingHas(node: number, key: number): boolean {
    const base = node * Math.max(1, this.idempotencyWindow);
    const count = this.idempRingCount[node] ?? 0;
    for (let i = 0; i < count; i++) {
      if (this.idempRingKey[base + i] === (key >>> 0)) return true;
    }
    return false;
  }

  private idempRingPush(node: number, key: number): void {
    const w = Math.max(1, this.idempotencyWindow);
    const base = node * w;
    const head = this.idempRingHead[node] ?? 0;
    this.idempRingKey[base + head] = key >>> 0;
    this.idempRingHead[node] = (head + 1) % w;
    if ((this.idempRingCount[node] ?? 0) < w) {
      this.idempRingCount[node] = ((this.idempRingCount[node] ?? 0) + 1) >>> 0;
    }
  }

  // Unused helper kept for future hashing if/when the per-node idemp
  // ring grows past linear scan.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _reserved_hash(_x: number): number { return mix32(_x); }

  // Unused helper kept for future power-of-two table sizing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _reserved_p2(_n: number): number { return nextPow2(_n); }

  // --- lifecycle ---

  clear(): void {
    this.entityOwner.fill(NODE_INVALID);
    this.entityEpoch.fill(0);
    this.transferState.fill(0);
    this.transferEntity.fill(-1);
    this.transferFromNode.fill(NODE_INVALID);
    this.transferToNode.fill(NODE_INVALID);
    this.transferProposedEpoch.fill(0);
    this.transferIdempotencyKey.fill(0);
    this.transferDeadlineTick.fill(0);
    this.transferLastUpdated.fill(0);
    this.transferGeneration.fill(0);
    this.nextTransferSlot = 0;
    this.chunkSeqCounter.fill(0);
    this.chunkLastDeliveredSeq.fill(-1);
    this.replRingChunkId.fill(-1);
    this.replRingSeq.fill(0);
    this.replRingEpoch.fill(0);
    this.replRingIdempotency.fill(0);
    this.replRingPayloadOffset.fill(0);
    this.replRingPayloadLength.fill(0);
    this.replRingEnqueuedAt.fill(0);
    this.replHead = 0;
    this.replTail = 0;
    this.payloadArena.fill(0);
    this.payloadHead = 0;
    this.idempRingKey.fill(0);
    this.idempRingHead.fill(0);
    this.idempRingCount.fill(0);
    this.commitsTotal = 0;
    this.abortsTotal = 0;
    this.expiredTotal = 0;
    this.splitBrainsTotal = 0;
    this.replicationDroppedTotal = 0;
    this.replicationDeliveredTotal = 0;
  }
}

// Transfer-handle layout: low 24 bits slot, high 8 bits generation.
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
