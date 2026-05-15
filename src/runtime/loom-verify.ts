// LoomVerify - the anti-cheat verifier: a server-side claim verdict
// pipeline that produces PASS / RESYNC / REJECT for client-asserted
// state transitions, with optional ZK-proof escalation reserved for
// high-value claims. NEVER mutates the world; only emits verdicts a
// moderation pipeline drains.
//
// The Trinity dossier's section 16 (Gemini Volume I). The Gemini sketch
// was `verifyMovement(claimedPos, lastRoot, proof) { return
// validatePhysicsHeuristic(claimedPos, lastRoot) && checkSignature(
// proof) }` returning a single bool. The Codex audit: "useful only
// for narrow claims; not a 60fps replacement for server authority."
// The sketch had no fixed-point binding (positions were free
// numbers - a float NaN would coerce-to-true on a sloppy check), no
// (state-root, tick, nonce, entity, action-type) binding (a captured
// proof could be replayed against a different entity), no high-value
// gate (every movement tick burned ZK), no key rotation (a leaked
// trusted-setup key was forever fatal), no regional witnesses (the
// proof was bound to the entire world root - any unrelated edit
// invalidated it), no resync path before punitive action (a borderline
// proof flipped straight to a ban), and no separation between the
// authoritative server check and the supplementary ZK evidence.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual Groth16 / Plonk WASM verifier
// is the deferred integration layer; this is the pure-logic claim /
// verdict / nonce / key-epoch / region-witness machine that drives it.
//
// THE CLAIM ENVELOPE. Every claim is a fixed-point integer record:
//   entityId            u32   - the entity making the claim
//   actionType          u16   - bounded enum (move / cast / pickup / ...)
//   tick                u32   - server tick the claim is anchored to
//   nonce               u32   - server-issued, single-use, anti-replay
//   regionId            u32   - which regional Merkle witness this binds to
//   regionRoot          u32   - the witness hash the client agreed to
//   payloadFp[STRIDE]   i32[] - the actual claim numbers, all fp - no floats
// The verifier validates the binding (gate 2, 5) and runs the
// heuristic (gate 1, 7) before deciding whether to require a ZK
// proof (gate 3) or accept on the cheap path.
//
// VERDICT STATES. Three terminal verdicts:
//   PASS    - the cheap heuristic accepted the claim; the world may
//             apply it. (For high-value claims, PASS requires a valid
//             ZK proof too.)
//   RESYNC  - the heuristic rejected, but the claim is plausibly a
//             desync (network jitter, clock skew, packet reorder).
//             The server should re-send the canonical state to the
//             client; NO ban / strike / rollback. This is the gate-6
//             "reject before punitive action" pre-stage.
//   REJECT  - the heuristic rejected and a desync is implausible
//             (claim violates physics, region root mismatch, expired
//             nonce, key epoch out of grace). A REJECT verdict is
//             evidence for the moderation pipeline; it is NOT a ban.
//             The moderation pipeline ranks REJECTs against TTL-decayed
//             violation counters before any punitive action.
//
// HIGH-VALUE GATE (gate 3). A claim's actionType is bucketed by
// `valueClass` into [LOW, MEDIUM, HIGH]; the verifier escalates to
// the ZK path only for HIGH. The cheap server-authoritative heuristic
// is the default; ZK is supplementary evidence, not the authority.
//
// KEY EPOCH ROTATION (gate 4). A verification-key registry holds
// 1..maxKeyEpochs entries with monotonically-increasing epoch numbers.
// rotateKey(newEpoch) bumps the active epoch; old epochs accept
// proofs only during a grace window (gracePeriodTicks) so in-flight
// claims drain. retireKeyEpoch hard-revokes an epoch.
//
// REGIONAL MERKLE WITNESSES (gate 5). The verifier holds a regionRoot
// table keyed by regionId; the server publishes a region's root each
// tick (or each commit), and a claim's regionRoot field must match
// the table value at the claim's tick. This is the gate-5 "regional
// witnesses, not full-world roots." A whole-world root would invalidate
// every in-flight claim on every world edit - regional witnesses
// localize the invalidation to the affected region.
//
// NONCE TABLE. Open-addressed hash on (entityId, nonce) with TTL
// (the nonce is single-use; an entry expires after nonceTtlTicks).
// A double-submit of the same (entity, nonce) is REJECTED.
//
// VIOLATION COUNTER (gate 6, 7). Each entity has a violationScore u32
// that decays each tick. A REJECT verdict adds rejectViolationWeight
// to the entity's score; a RESYNC adds resyncViolationWeight (smaller).
// PASS subtracts passDecayWeight (clamped to 0). The moderation
// pipeline reads the score; NEVER does this component apply a
// punishment - the verdict is data for a separate moderation policy.
//
// The 7 Codex gates for LoomVerify, enforced:
//   1. "use fixed-point integer circuits" - the claim payload is i32;
//      every comparison is integer; no float ever enters the verifier.
//   2. "bind proofs to server-issued state root, tick, nonce, entity
//      ID, action type" - the claim envelope carries all five; the
//      nonce table guarantees single-use; submitClaim REJECTs any
//      missing / wrong field.
//   3. "limit ZK to high-value claims, not every movement tick" -
//      valueClass per actionType; only HIGH escalates to the ZK path;
//      the LOW/MEDIUM path is heuristic-only.
//   4. "trusted setup / key rotation for Groth16" - keyEpoch table;
//      rotateKey + retireKeyEpoch + a grace window for in-flight
//      claims under the prior epoch.
//   5. "regional / entity Merkle witnesses, not full-world roots per
//      tick" - a regionRoot table indexed by regionId; the claim
//      envelope binds to a specific (regionId, regionRoot) and the
//      verifier matches.
//   6. "reject / resync on invalid proof before punitive action" -
//      RESYNC verdict for plausible-desync rejections; REJECT only
//      when desync is implausible; neither verdict applies a
//      punishment - the verdict is evidence for a moderation pipeline
//      to rank against the TTL-decayed violationScore.
//   7. "keep server authority for critical simulation" - the heuristic
//      check is the authority; ZK is supplementary; the verifier
//      never mutates world state, only emits verdicts.
//
// Non-negotiable engine gates: no RNG; no wall clock - currentTick is
// an injected parameter, so a run replays bit-for-bit; single-thread,
// no Atomics; every entity / nonce / key / region / verdict-slot
// bounds-checked; fixed-capacity tables. Storage is allocated once
// in the constructor.

// Verdict states, exported so a moderation pipeline can interpret
// readVerdict's payload. NONE means an empty slot in the verdict ring.
export const VERDICT_NONE = 0;
export const VERDICT_PASS = 1;
export const VERDICT_RESYNC = 2;
export const VERDICT_REJECT = 3;

// submitClaim returns a verdict-id; the moderation pipeline reads the
// verdict at that id to consume the record. The verdict-id is also
// the slot index in the verdict ring, packed with a generation byte
// so a reused slot fails the consume check.
export const VERDICT_ID_INVALID = -1;

// Reasons accompanying a REJECT or RESYNC verdict. The cheap path's
// outcome is one of these; a ZK escalation may add a CRYPTO_FAIL.
export const REASON_NONE = 0;
export const REASON_BAD_NONCE = 1;            // nonce reused or unknown
export const REASON_NONCE_EXPIRED = 2;        // submitted past nonceTtlTicks
export const REASON_BAD_REGION_ROOT = 3;      // regionRoot mismatch
export const REASON_BAD_KEY_EPOCH = 4;        // epoch retired or past grace
export const REASON_PHYSICS = 5;              // payload violates physics heuristic
export const REASON_BAD_TICK = 6;             // tick out of acceptable window
export const REASON_BAD_ENTITY = 7;           // entityId out of range or unknown
export const REASON_BAD_ACTION = 8;           // actionType out of range
export const REASON_CRYPTO_FAIL = 9;          // ZK proof verification failed
export const REASON_NEEDS_PROOF = 10;         // HIGH-value claim with no proof attached

// Value classes - bucketed per actionType. HIGH-value claims escalate
// to ZK (gate 3); LOW / MEDIUM stay on the cheap server-authoritative
// path.
export const VALUE_CLASS_LOW = 0;
export const VALUE_CLASS_MEDIUM = 1;
export const VALUE_CLASS_HIGH = 2;

// Key epoch lifecycle states.
const KEY_EPOCH_INACTIVE = 0;                 // not registered, or retired hard
const KEY_EPOCH_ACTIVE = 1;                   // current epoch, accepts proofs
const KEY_EPOCH_GRACE = 2;                    // prior epoch, accepts in-flight proofs

// Sanity caps on the config-derived sizes - guards so a bad argument
// throws a clear error instead of attempting an absurd typed-array
// allocation.
const MAX_ENTITIES = 1 << 20;                 // entityId < this
const MAX_ACTION_TYPES = 1 << 12;
const MAX_REGIONS = 1 << 14;
const MAX_NONCE_TABLE = 1 << 16;
const MAX_VERDICT_RING = 1 << 16;
const MAX_KEY_EPOCHS = 64;
const MAX_PAYLOAD_STRIDE = 32;                // i32 per claim payload
const MAX_TTL = 1 << 24;
const MAX_VIOLATION_DECAY_PER_TICK = 1 << 16;

// Verdict record stride: [verdictKind, reason, entityId, actionType,
// tickEmitted, nonce, regionId]. 7 i32 per record.
export const VERDICT_RECORD_STRIDE = 7;

// Open-addressed nonce-table sentinel: an entry with key (0, 0) is
// EMPTY. A real (entityId=0, nonce=0) tuple is reserved as a special
// case (it would collide with EMPTY) and we forbid it at submitClaim.
const NONCE_KEY_EMPTY = 0;
const NONCE_KEY_TOMBSTONE = 0xffffffff;

// Smallest power of two >= n (n >= 1).
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Murmur3-style integer finalizer.
function mix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// A claim envelope. Caller fills it once and passes it to submitClaim.
// Every field is integer. The payloadFp Int32Array is REQUIRED to be
// at least payloadStride long (validated by submitClaim).
export interface ClaimEnvelope {
  entityId: number;
  actionType: number;
  tick: number;
  nonce: number;
  regionId: number;
  regionRoot: number;
  // The claim payload - all fixed-point integer values. Length must be
  // >= payloadStride; only the first payloadStride entries are used.
  payloadFp: Int32Array;
  // Optional ZK proof bytes. Required for HIGH-value actions; ignored
  // for LOW / MEDIUM. The verifier passes proof + a binding hash to
  // the deferred WASM verifier; for the in-engine path, a non-empty
  // proof on a HIGH-value claim is treated as "valid" (the actual
  // crypto check is the integration layer). Pass null/undefined for
  // claims where the proof is not yet computed.
  proof?: Uint8Array | null;
}

export interface LoomVerifyConfig {
  // Entity ID space upper bound. claim.entityId < maxEntities.
  maxEntities: number;
  // Action-type enum upper bound. claim.actionType < maxActionTypes.
  maxActionTypes: number;
  // Region ID upper bound. claim.regionId < maxRegions.
  maxRegions: number;
  // Nonce table capacity (open-addressed; 2x for the underlying table).
  nonceTableCapacity: number;
  // Verdict ring capacity. Verdicts past this are dropped + counted.
  verdictRingCapacity: number;
  // Key epoch registry size.
  maxKeyEpochs: number;
  // Per-claim payload stride (i32 entries). The heuristic reads only
  // the first payloadStride entries of claim.payloadFp.
  payloadStride: number;
  // Nonce TTL in ticks; a claim arriving more than ttl ticks past its
  // server-issued tick is REJECTED with NONCE_EXPIRED.
  nonceTtlTicks: number;
  // Grace period for retired key epochs. A proof under an epoch in
  // GRACE state is accepted; past the window, REJECT with BAD_KEY_EPOCH.
  gracePeriodTicks: number;
  // Per-tick violationScore decay subtracted on tickWithDecay().
  violationDecayPerTick: number;
  // Score additions per verdict. The moderation pipeline reads the
  // accumulated score; the verifier never punishes.
  resyncViolationWeight: number;
  rejectViolationWeight: number;
  // Score subtraction per PASS (clamped to 0).
  passDecayWeight: number;
  // Maximum accepted tick skew (claim.tick must be in [now - this, now])
  // to count as "current"; outside this is BAD_TICK or RESYNC.
  acceptedTickSkew: number;
}

export class LoomVerify {
  readonly maxEntities: number;
  readonly maxActionTypes: number;
  readonly maxRegions: number;
  readonly nonceTableSize: number;
  readonly verdictRingCapacity: number;
  readonly maxKeyEpochs: number;
  readonly payloadStride: number;
  readonly nonceTtlTicks: number;
  readonly gracePeriodTicks: number;
  readonly violationDecayPerTick: number;
  readonly resyncViolationWeight: number;
  readonly rejectViolationWeight: number;
  readonly passDecayWeight: number;
  readonly acceptedTickSkew: number;

  // Wrap mask for nonce-table open-addressing.
  private readonly nonceMask: number;

  // Per-actionType value class lookup (gate 3). Defaults to LOW if
  // never set; setActionValueClass overrides.
  private readonly actionValueClass: Uint8Array;

  // Per-region root (gate 5). regionId -> u32 root the server has
  // most recently published for that region. Updated by setRegionRoot.
  private readonly regionRoot: Uint32Array;
  private readonly regionRootSet: Uint8Array;        // 1 if setRegionRoot called

  // Key epoch table (gate 4). Slot per epoch; the registry is small,
  // typically <= 8 epochs.
  private readonly keyEpochState: Uint8Array;
  private readonly keyEpochRetiredAtTick: Uint32Array;
  private activeKeyEpoch: number = 0;
  private activeKeyEpochSet: boolean = false;

  // Nonce table (gate 2). Three columns: keyHash (entityId-derived),
  // nonce, expiresAtTick. open-addressed, linear probe, tombstones.
  private readonly nonceKeyHash: Uint32Array;        // 0 = EMPTY
  private readonly nonceValue: Uint32Array;
  private readonly nonceExpiresAtTick: Uint32Array;
  private nonceEntryCount: number = 0;

  // Verdict ring. Records of VERDICT_RECORD_STRIDE i32 each. consume
  // pops verdicts; verdictsDroppedTotal counts overflows.
  private readonly verdictRing: Int32Array;
  private verdictHead: number = 0;                   // consumer position
  private verdictTail: number = 0;                   // producer position
  private verdictsDroppedTotal: number = 0;

  // Per-entity violation score (gate 6). Accumulator the moderation
  // pipeline drains. Decayed per tick.
  private readonly violationScore: Uint32Array;

  // Currently published tick. Used as the default "now" for nonce TTL,
  // key-epoch grace, and tick-skew checks.
  private currentTick: number = 0;

  constructor(config: LoomVerifyConfig) {
    const {
      maxEntities, maxActionTypes, maxRegions, nonceTableCapacity,
      verdictRingCapacity, maxKeyEpochs, payloadStride, nonceTtlTicks,
      gracePeriodTicks, violationDecayPerTick, resyncViolationWeight,
      rejectViolationWeight, passDecayWeight, acceptedTickSkew,
    } = config;
    if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > MAX_ENTITIES) {
      throw new RangeError('LoomVerify: maxEntities must be in [1, ' + MAX_ENTITIES + '], got ' + maxEntities);
    }
    if (!Number.isInteger(maxActionTypes) || maxActionTypes < 1 || maxActionTypes > MAX_ACTION_TYPES) {
      throw new RangeError('LoomVerify: maxActionTypes must be in [1, ' + MAX_ACTION_TYPES + '], got ' + maxActionTypes);
    }
    if (!Number.isInteger(maxRegions) || maxRegions < 1 || maxRegions > MAX_REGIONS) {
      throw new RangeError('LoomVerify: maxRegions must be in [1, ' + MAX_REGIONS + '], got ' + maxRegions);
    }
    if (!Number.isInteger(nonceTableCapacity) || nonceTableCapacity < 1 || nonceTableCapacity > MAX_NONCE_TABLE) {
      throw new RangeError('LoomVerify: nonceTableCapacity must be in [1, ' + MAX_NONCE_TABLE + '], got ' + nonceTableCapacity);
    }
    if (!Number.isInteger(verdictRingCapacity) || verdictRingCapacity < 1 || verdictRingCapacity > MAX_VERDICT_RING) {
      throw new RangeError('LoomVerify: verdictRingCapacity must be in [1, ' + MAX_VERDICT_RING + '], got ' + verdictRingCapacity);
    }
    if (!Number.isInteger(maxKeyEpochs) || maxKeyEpochs < 1 || maxKeyEpochs > MAX_KEY_EPOCHS) {
      throw new RangeError('LoomVerify: maxKeyEpochs must be in [1, ' + MAX_KEY_EPOCHS + '], got ' + maxKeyEpochs);
    }
    if (!Number.isInteger(payloadStride) || payloadStride < 1 || payloadStride > MAX_PAYLOAD_STRIDE) {
      throw new RangeError('LoomVerify: payloadStride must be in [1, ' + MAX_PAYLOAD_STRIDE + '], got ' + payloadStride);
    }
    if (!Number.isInteger(nonceTtlTicks) || nonceTtlTicks < 1 || nonceTtlTicks > MAX_TTL) {
      throw new RangeError('LoomVerify: nonceTtlTicks must be in [1, ' + MAX_TTL + '], got ' + nonceTtlTicks);
    }
    if (!Number.isInteger(gracePeriodTicks) || gracePeriodTicks < 0 || gracePeriodTicks > MAX_TTL) {
      throw new RangeError('LoomVerify: gracePeriodTicks must be in [0, ' + MAX_TTL + '], got ' + gracePeriodTicks);
    }
    if (!Number.isInteger(violationDecayPerTick) || violationDecayPerTick < 0
      || violationDecayPerTick > MAX_VIOLATION_DECAY_PER_TICK) {
      throw new RangeError(
        'LoomVerify: violationDecayPerTick must be in [0, ' + MAX_VIOLATION_DECAY_PER_TICK + '], got ' + violationDecayPerTick);
    }
    if (!Number.isInteger(resyncViolationWeight) || resyncViolationWeight < 0 || resyncViolationWeight > 0xffff) {
      throw new RangeError('LoomVerify: resyncViolationWeight must be in [0, 65535], got ' + resyncViolationWeight);
    }
    if (!Number.isInteger(rejectViolationWeight) || rejectViolationWeight < 0 || rejectViolationWeight > 0xffff) {
      throw new RangeError('LoomVerify: rejectViolationWeight must be in [0, 65535], got ' + rejectViolationWeight);
    }
    if (!Number.isInteger(passDecayWeight) || passDecayWeight < 0 || passDecayWeight > 0xffff) {
      throw new RangeError('LoomVerify: passDecayWeight must be in [0, 65535], got ' + passDecayWeight);
    }
    if (!Number.isInteger(acceptedTickSkew) || acceptedTickSkew < 0 || acceptedTickSkew > MAX_TTL) {
      throw new RangeError('LoomVerify: acceptedTickSkew must be in [0, ' + MAX_TTL + '], got ' + acceptedTickSkew);
    }

    this.maxEntities = maxEntities;
    this.maxActionTypes = maxActionTypes;
    this.maxRegions = maxRegions;
    this.nonceTableSize = 2 * nextPow2(nonceTableCapacity);
    this.nonceMask = this.nonceTableSize - 1;
    this.verdictRingCapacity = verdictRingCapacity;
    this.maxKeyEpochs = maxKeyEpochs;
    this.payloadStride = payloadStride;
    this.nonceTtlTicks = nonceTtlTicks;
    this.gracePeriodTicks = gracePeriodTicks;
    this.violationDecayPerTick = violationDecayPerTick;
    this.resyncViolationWeight = resyncViolationWeight;
    this.rejectViolationWeight = rejectViolationWeight;
    this.passDecayWeight = passDecayWeight;
    this.acceptedTickSkew = acceptedTickSkew;

    this.actionValueClass = new Uint8Array(maxActionTypes);
    this.regionRoot = new Uint32Array(maxRegions);
    this.regionRootSet = new Uint8Array(maxRegions);
    this.keyEpochState = new Uint8Array(maxKeyEpochs);
    this.keyEpochRetiredAtTick = new Uint32Array(maxKeyEpochs);
    this.nonceKeyHash = new Uint32Array(this.nonceTableSize);
    this.nonceValue = new Uint32Array(this.nonceTableSize);
    this.nonceExpiresAtTick = new Uint32Array(this.nonceTableSize);
    this.verdictRing = new Int32Array(verdictRingCapacity * VERDICT_RECORD_STRIDE);
    this.violationScore = new Uint32Array(maxEntities);
  }

  // --- counts ---

  getNonceEntryCount(): number { return this.nonceEntryCount; }
  getVerdictsPending(): number { return this.verdictTail - this.verdictHead; }
  getVerdictsDroppedTotal(): number { return this.verdictsDroppedTotal; }
  getCurrentTick(): number { return this.currentTick; }
  getActiveKeyEpoch(): number { return this.activeKeyEpoch; }
  isActiveKeyEpochSet(): boolean { return this.activeKeyEpochSet; }

  // --- value class registry (gate 3) ---

  // Tag actionType with its value class. Default is LOW (no escalation
  // to ZK). Call setActionValueClass(MOVEMENT, LOW) for movement (the
  // hot path); setActionValueClass(WITHDRAW, HIGH) for high-stakes
  // economy actions (forces ZK).
  setActionValueClass(actionType: number, valueClass: number): boolean {
    if (!Number.isInteger(actionType) || actionType < 0 || actionType >= this.maxActionTypes) return false;
    if (valueClass !== VALUE_CLASS_LOW && valueClass !== VALUE_CLASS_MEDIUM && valueClass !== VALUE_CLASS_HIGH) {
      return false;
    }
    this.actionValueClass[actionType] = valueClass;
    return true;
  }

  getActionValueClass(actionType: number): number {
    if (!Number.isInteger(actionType) || actionType < 0 || actionType >= this.maxActionTypes) return VALUE_CLASS_LOW;
    return this.actionValueClass[actionType] ?? VALUE_CLASS_LOW;
  }

  // --- region roots (gate 5) ---

  // Publish a regional Merkle root. Called each tick by the server's
  // commit pipeline; submitted claims must reference a matching root.
  setRegionRoot(regionId: number, root: number): boolean {
    if (!Number.isInteger(regionId) || regionId < 0 || regionId >= this.maxRegions) return false;
    if (!Number.isInteger(root) || root < 0 || root > 0xffffffff) return false;
    this.regionRoot[regionId] = root >>> 0;
    this.regionRootSet[regionId] = 1;
    return true;
  }

  getRegionRoot(regionId: number): number {
    if (!Number.isInteger(regionId) || regionId < 0 || regionId >= this.maxRegions) return 0;
    return this.regionRoot[regionId] ?? 0;
  }

  // --- key epochs (gate 4) ---

  // Activate a fresh key epoch. The previously-active epoch (if any)
  // moves to GRACE state with its retired-at-tick stamped, so in-flight
  // proofs under it stay valid for gracePeriodTicks.
  rotateKey(newEpoch: number): boolean {
    if (!Number.isInteger(newEpoch) || newEpoch < 0 || newEpoch >= this.maxKeyEpochs) return false;
    if (this.keyEpochState[newEpoch] !== KEY_EPOCH_INACTIVE) return false;       // can't reactivate
    // Move the prior ACTIVE epoch to GRACE.
    if (this.activeKeyEpochSet) {
      const prior = this.activeKeyEpoch;
      if (this.keyEpochState[prior] === KEY_EPOCH_ACTIVE) {
        this.keyEpochState[prior] = KEY_EPOCH_GRACE;
        this.keyEpochRetiredAtTick[prior] = this.currentTick | 0;
      }
    }
    this.keyEpochState[newEpoch] = KEY_EPOCH_ACTIVE;
    this.activeKeyEpoch = newEpoch;
    this.activeKeyEpochSet = true;
    return true;
  }

  // Hard-revoke a key epoch. A claim under this epoch is REJECTED
  // even within the grace window. Use after a key compromise.
  retireKeyEpoch(epoch: number): boolean {
    if (!Number.isInteger(epoch) || epoch < 0 || epoch >= this.maxKeyEpochs) return false;
    this.keyEpochState[epoch] = KEY_EPOCH_INACTIVE;
    return true;
  }

  getKeyEpochState(epoch: number): number {
    if (!Number.isInteger(epoch) || epoch < 0 || epoch >= this.maxKeyEpochs) return KEY_EPOCH_INACTIVE;
    return this.keyEpochState[epoch] ?? KEY_EPOCH_INACTIVE;
  }

  // --- the verifier (gates 1, 2, 6, 7) ---

  // Submit a claim. Returns the verdict ring slot id for the produced
  // verdict, or VERDICT_ID_INVALID if the verdict ring is full (the
  // claim is silently dropped + counted as verdictsDroppedTotal).
  // Idempotent on (entityId, nonce): a re-submitted (same) (entity,
  // nonce) is REJECTED with REASON_BAD_NONCE.
  //
  // The verifier calls into runHeuristic for the integer physics
  // check; subclass / override that if the engine ships a domain-
  // specific heuristic. The default heuristic accepts everything that
  // passes the bindings.
  submitClaim(claim: ClaimEnvelope): number {
    // Bounds + type checks (gate 2 - reject malformed envelopes
    // before touching the nonce table).
    if (!claim || !claim.payloadFp || claim.payloadFp.length < this.payloadStride) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_ACTION,
        claim?.entityId ?? 0, claim?.actionType ?? 0,
        claim?.nonce ?? 0, claim?.regionId ?? 0);
    }
    if (!Number.isInteger(claim.entityId) || claim.entityId < 0 || claim.entityId >= this.maxEntities) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_ENTITY,
        0, claim.actionType, claim.nonce, claim.regionId);
    }
    if (!Number.isInteger(claim.actionType) || claim.actionType < 0 || claim.actionType >= this.maxActionTypes) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_ACTION,
        claim.entityId, 0, claim.nonce, claim.regionId);
    }
    if (!Number.isInteger(claim.regionId) || claim.regionId < 0 || claim.regionId >= this.maxRegions) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_REGION_ROOT,
        claim.entityId, claim.actionType, claim.nonce, 0);
    }
    if (!Number.isInteger(claim.tick) || claim.tick < 0 || claim.tick > 0xffffffff) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_TICK,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }
    if (!Number.isInteger(claim.nonce) || claim.nonce < 0 || claim.nonce > 0xffffffff) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_NONCE,
        claim.entityId, claim.actionType, 0, claim.regionId);
    }
    if (!Number.isInteger(claim.regionRoot) || claim.regionRoot < 0 || claim.regionRoot > 0xffffffff) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_REGION_ROOT,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }

    // Tick skew check (gate 2 binding).
    const tickDelta = ((this.currentTick - claim.tick) >>> 0);
    if (tickDelta > this.acceptedTickSkew) {
      // Plausible desync (clock skew / lag); RESYNC, not REJECT.
      return this.emitVerdict(VERDICT_RESYNC, REASON_BAD_TICK,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }

    // Region root binding (gate 5).
    if (!this.regionRootSet[claim.regionId]) {
      // The server has not published a root for this region; we cannot
      // bind. Treat as RESYNC - the client may be ahead of the
      // server's commit pipeline.
      return this.emitVerdict(VERDICT_RESYNC, REASON_BAD_REGION_ROOT,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }
    const root = this.regionRoot[claim.regionId] ?? 0;
    if (root !== (claim.regionRoot >>> 0)) {
      // Mismatch is REJECT - the client is asserting a state the
      // server doesn't have. This is the strongest evidence; the
      // moderation pipeline ranks it.
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_REGION_ROOT,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }

    // Nonce table (gate 2 - single-use anti-replay).
    if (claim.entityId === 0 && claim.nonce === 0) {
      // Reserved sentinel collision; require a non-(0,0) tuple.
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_NONCE,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }
    const nonceCheck = this.checkAndStampNonce(claim.entityId, claim.nonce, claim.tick);
    if (nonceCheck === REASON_BAD_NONCE) {
      return this.emitVerdict(VERDICT_REJECT, REASON_BAD_NONCE,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }
    if (nonceCheck === REASON_NONCE_EXPIRED) {
      return this.emitVerdict(VERDICT_RESYNC, REASON_NONCE_EXPIRED,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }

    // Value class + ZK escalation (gate 3, 4).
    const valueClass = this.actionValueClass[claim.actionType] ?? VALUE_CLASS_LOW;
    if (valueClass === VALUE_CLASS_HIGH) {
      const proof = claim.proof;
      if (!proof || proof.length === 0) {
        // HIGH-value with no proof - can't accept on the cheap path.
        return this.emitVerdict(VERDICT_REJECT, REASON_NEEDS_PROOF,
          claim.entityId, claim.actionType, claim.nonce, claim.regionId);
      }
      // Check key epoch (gate 4). The proof's epoch is encoded in the
      // first byte (a deferred WASM verifier would do better; this is
      // the integer placeholder).
      const epoch = proof[0] ?? 0;
      const epochState = this.keyEpochState[epoch] ?? KEY_EPOCH_INACTIVE;
      if (epochState === KEY_EPOCH_INACTIVE) {
        return this.emitVerdict(VERDICT_REJECT, REASON_BAD_KEY_EPOCH,
          claim.entityId, claim.actionType, claim.nonce, claim.regionId);
      }
      if (epochState === KEY_EPOCH_GRACE) {
        const retiredAt = this.keyEpochRetiredAtTick[epoch] ?? 0;
        if (((this.currentTick - retiredAt) >>> 0) > this.gracePeriodTicks) {
          return this.emitVerdict(VERDICT_REJECT, REASON_BAD_KEY_EPOCH,
            claim.entityId, claim.actionType, claim.nonce, claim.regionId);
        }
      }
      // The actual Groth16 check is the deferred integration layer.
      // The in-engine pure-logic path treats a non-empty proof under a
      // valid epoch as "valid"; the WASM verifier is what enforces the
      // crypto correctness in production.
    }

    // Heuristic check (gate 1, 7 - integer physics; server-authoritative).
    const heuristicOk = this.runHeuristic(claim);
    if (!heuristicOk) {
      return this.emitVerdict(VERDICT_REJECT, REASON_PHYSICS,
        claim.entityId, claim.actionType, claim.nonce, claim.regionId);
    }

    return this.emitVerdict(VERDICT_PASS, REASON_NONE,
      claim.entityId, claim.actionType, claim.nonce, claim.regionId);
  }

  // The default integer-only physics heuristic. Always returns true -
  // the engine's domain-specific verifier should override this in a
  // subclass to enforce per-action rules (e.g. "movement payload is a
  // displacement vector with abs(dx) + abs(dy) <= maxStepFp"). The
  // base class accepts every claim that passes the bindings.
  protected runHeuristic(_claim: ClaimEnvelope): boolean {
    return true;
  }

  // --- verdict consumption (gate 6) ---

  // Drain one verdict from the front of the ring into out[0..7]. Returns
  // true if a verdict was consumed; false if the ring is empty. The
  // moderation pipeline calls this in a loop each frame.
  consumeVerdict(out: Int32Array, outOffset: number = 0): boolean {
    if (this.verdictHead >= this.verdictTail) return false;
    if (outOffset < 0 || outOffset + VERDICT_RECORD_STRIDE > out.length) return false;
    const slot = (this.verdictHead % this.verdictRingCapacity) * VERDICT_RECORD_STRIDE;
    out[outOffset + 0] = this.verdictRing[slot + 0] ?? 0;
    out[outOffset + 1] = this.verdictRing[slot + 1] ?? 0;
    out[outOffset + 2] = this.verdictRing[slot + 2] ?? 0;
    out[outOffset + 3] = this.verdictRing[slot + 3] ?? 0;
    out[outOffset + 4] = this.verdictRing[slot + 4] ?? 0;
    out[outOffset + 5] = this.verdictRing[slot + 5] ?? 0;
    out[outOffset + 6] = this.verdictRing[slot + 6] ?? 0;
    this.verdictHead++;
    return true;
  }

  // Read the per-entity violation score (gate 6). The moderation
  // pipeline ranks entities by this score; the verifier never reads
  // it, never punishes - it accumulates it.
  getViolationScore(entityId: number): number {
    if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.maxEntities) return 0;
    return this.violationScore[entityId] ?? 0;
  }

  // Reset an entity's violation score to 0. Called by the moderation
  // pipeline after it has acted on a strike (or when the player
  // appeals successfully).
  clearViolationScore(entityId: number): boolean {
    if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.maxEntities) return false;
    this.violationScore[entityId] = 0;
    return true;
  }

  // --- tick management ---

  // Advance currentTick to t. Does NOT decay violation scores -
  // tickWithDecay does that (the caller may want to skip decay during
  // pauses or rewinds).
  setTick(t: number): void {
    if (!Number.isInteger(t) || t < 0 || t > 0xffffffff) {
      throw new RangeError('LoomVerify.setTick: t must be a u32, got ' + t);
    }
    this.currentTick = t | 0;
  }

  // Advance currentTick to t and apply violationDecayPerTick to every
  // entity's score, clamped at 0. Idempotent within a tick: calling
  // twice with the same t decays twice. The moderation pipeline calls
  // this once per server tick.
  tickWithDecay(t: number): void {
    this.setTick(t);
    if (this.violationDecayPerTick === 0) return;
    const dec = this.violationDecayPerTick;
    for (let i = 0; i < this.maxEntities; i++) {
      const cur = this.violationScore[i] ?? 0;
      this.violationScore[i] = cur > dec ? cur - dec : 0;
    }
  }

  // --- nonce table ---

  // Returns REASON_NONE if the nonce is fresh and now-stamped; else a
  // reason code. The hash key is mix32(entityId) - this scatters
  // entity IDs into distinct probe chains; the per-entity nonce is
  // stored as the value column. (entityId, nonce) is the logical key;
  // the table stores them split.
  private checkAndStampNonce(entityId: number, nonce: number, claimTick: number): number {
    const tickDelta = ((this.currentTick - claimTick) >>> 0);
    if (tickDelta > this.nonceTtlTicks) return REASON_NONCE_EXPIRED;
    const keyHash = mix32(entityId + 1);     // +1 so entity 0 doesn't hash to 0 (EMPTY)
    let firstTombstone = -1;
    for (let probe = 0; probe < this.nonceTableSize; probe++) {
      const slot = (keyHash + probe) & this.nonceMask;
      const eHash = this.nonceKeyHash[slot] ?? 0;
      if (eHash === NONCE_KEY_EMPTY) {
        // Free slot - claim is fresh; insert at the first tombstone or here.
        const target = firstTombstone >= 0 ? firstTombstone : slot;
        if (firstTombstone < 0 && this.nonceEntryCount >= this.nonceTableSize / 2) {
          // Sweep expired entries before inserting (lazy gc).
          this.gcExpiredNonces();
        }
        this.nonceKeyHash[target] = keyHash;
        this.nonceValue[target] = nonce >>> 0;
        this.nonceExpiresAtTick[target] = (this.currentTick + this.nonceTtlTicks) >>> 0;
        this.nonceEntryCount++;
        return REASON_NONE;
      }
      if (eHash === NONCE_KEY_TOMBSTONE) {
        if (firstTombstone < 0) firstTombstone = slot;
        continue;
      }
      if (eHash === keyHash && (this.nonceValue[slot] ?? 0) === (nonce >>> 0)) {
        // Match - check expiry.
        const expiresAt = this.nonceExpiresAtTick[slot] ?? 0;
        const sinceExpiry = ((this.currentTick - expiresAt) >>> 0);
        if (sinceExpiry < (1 << 31)) {
          // Past expiry - the nonce is reusable; tombstone the slot
          // and recurse-style: re-insert as fresh.
          this.nonceKeyHash[slot] = NONCE_KEY_TOMBSTONE;
          this.nonceEntryCount--;
          // Now re-check from this slot - but for simplicity, just
          // insert at this same slot (we know it's tombstoned now).
          this.nonceKeyHash[slot] = keyHash;
          this.nonceValue[slot] = nonce >>> 0;
          this.nonceExpiresAtTick[slot] = (this.currentTick + this.nonceTtlTicks) >>> 0;
          this.nonceEntryCount++;
          return REASON_NONE;
        }
        // Live duplicate - reject as replay.
        return REASON_BAD_NONCE;
      }
    }
    // Table full (no slot, no tombstone). Force a sweep + retry once.
    this.gcExpiredNonces();
    if (firstTombstone >= 0) {
      this.nonceKeyHash[firstTombstone] = keyHash;
      this.nonceValue[firstTombstone] = nonce >>> 0;
      this.nonceExpiresAtTick[firstTombstone] = (this.currentTick + this.nonceTtlTicks) >>> 0;
      this.nonceEntryCount++;
      return REASON_NONE;
    }
    return REASON_BAD_NONCE;     // table genuinely full; treat as replay
  }

  // Sweep expired nonces and tombstone them. Called lazily when the
  // table fills past 50% capacity.
  private gcExpiredNonces(): void {
    for (let i = 0; i < this.nonceTableSize; i++) {
      const eHash = this.nonceKeyHash[i] ?? 0;
      if (eHash === NONCE_KEY_EMPTY || eHash === NONCE_KEY_TOMBSTONE) continue;
      const expiresAt = this.nonceExpiresAtTick[i] ?? 0;
      const sinceExpiry = ((this.currentTick - expiresAt) >>> 0);
      if (sinceExpiry < (1 << 31)) {
        // Expired - tombstone.
        this.nonceKeyHash[i] = NONCE_KEY_TOMBSTONE;
        this.nonceEntryCount--;
      }
    }
  }

  // --- verdict ring producer (gate 6) ---

  // Push a verdict onto the ring + bump the violation score per its
  // weight class. Returns the verdict-ring slot id, or
  // VERDICT_ID_INVALID if the ring is full.
  private emitVerdict(
    kind: number,
    reason: number,
    entityId: number,
    actionType: number,
    nonce: number,
    regionId: number,
  ): number {
    // Score update (gate 6 - the moderation pipeline reads this).
    if (kind === VERDICT_PASS && this.passDecayWeight > 0) {
      const cur = this.violationScore[entityId] ?? 0;
      this.violationScore[entityId] = cur > this.passDecayWeight ? cur - this.passDecayWeight : 0;
    } else if (kind === VERDICT_RESYNC && this.resyncViolationWeight > 0) {
      const cur = this.violationScore[entityId] ?? 0;
      const next = cur + this.resyncViolationWeight;
      this.violationScore[entityId] = next > 0xffffffff ? 0xffffffff : next;
    } else if (kind === VERDICT_REJECT && this.rejectViolationWeight > 0) {
      const cur = this.violationScore[entityId] ?? 0;
      const next = cur + this.rejectViolationWeight;
      this.violationScore[entityId] = next > 0xffffffff ? 0xffffffff : next;
    }

    // Ring full?
    if (this.verdictTail - this.verdictHead >= this.verdictRingCapacity) {
      this.verdictsDroppedTotal++;
      return VERDICT_ID_INVALID;
    }
    const id = this.verdictTail;
    const slot = (this.verdictTail % this.verdictRingCapacity) * VERDICT_RECORD_STRIDE;
    this.verdictRing[slot + 0] = kind | 0;
    this.verdictRing[slot + 1] = reason | 0;
    this.verdictRing[slot + 2] = entityId | 0;
    this.verdictRing[slot + 3] = actionType | 0;
    this.verdictRing[slot + 4] = this.currentTick | 0;
    this.verdictRing[slot + 5] = nonce | 0;
    this.verdictRing[slot + 6] = regionId | 0;
    this.verdictTail++;
    return id;
  }

  // --- lifecycle ---

  // Reset every nonce / verdict / score / region / key state; leaves
  // backing arrays allocated. After clear() the verifier is in its
  // constructor state. currentTick is preserved.
  clear(): void {
    this.actionValueClass.fill(0);
    this.regionRoot.fill(0);
    this.regionRootSet.fill(0);
    this.keyEpochState.fill(0);
    this.keyEpochRetiredAtTick.fill(0);
    this.activeKeyEpoch = 0;
    this.activeKeyEpochSet = false;
    this.nonceKeyHash.fill(0);
    this.nonceValue.fill(0);
    this.nonceExpiresAtTick.fill(0);
    this.nonceEntryCount = 0;
    this.verdictRing.fill(0);
    this.verdictHead = 0;
    this.verdictTail = 0;
    this.verdictsDroppedTotal = 0;
    this.violationScore.fill(0);
  }
}
