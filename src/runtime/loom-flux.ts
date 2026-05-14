// LoomFlux - the Sim-LOD scheduler core: dense per-tier entity
// buckets and a wrap-safe tiered tick.
//
// A simulation-LOD scheduler buckets entities into update tiers and
// ticks far-away / low-relevance tiers less often than near ones -
// T0 every frame, T1 every few frames, T2 rarely - so the per-frame
// cost scales with how much actually matters. The Trinity dossier's
// section 21 (Gemini Volume II).
//
// This file is the SCHEDULER CORE - the part that is self-contained
// and implementable today. The dossier's 7 Codex gates split in two:
//
//   Gates 1-3, enforced here:
//     1. dense per-tier buckets - each tier's entity IDs are packed
//        [0, count); swap-pop on migration keeps them dense.
//     2. tier migrations go through a frame-boundary queue -
//        requestMigration() only queues; tick() drains the queue at
//        the frame boundary, so a bucket is never mutated while a
//        consumer iterates it during the frame.
//     3. wrap-safe frame delta - tick() decides a tier is due via
//        (globalTick - lastProcessed) >>> 0 >= stride. The unsigned
//        subtraction is correct even when the u32 frame counter
//        wraps, and it also tolerates skipped frames (the naive
//        globalTick % stride would miss a tier's slot on a skip).
//
//   Gates 4-7 are the INTEGRATION LAYER, deliberately deferred:
//     4. SoA fast-forward of low tiers needs a nav/collision system.
//     5. "which systems can be analytically fast-forwarded" needs
//        the system roster.
//     6. visual correction needs render integration.
//     7. relevance scoring needs OmniveilSKB importance.
//   None of those systems exist yet. The core is the seam: a
//   consumer computes relevance however it can and drives tiers via
//   assign() / requestMigration(); fast-forward and visual
//   correction live in the consumer's per-tier update function.
//
// Storage is flat typed arrays - one Int32Array of tierCount *
// maxEntities for the buckets, plus per-entity tier / slot index
// arrays - so it allocates nothing after the constructor.

// A tier index is one bit of the tick() return mask, so tierCount is
// capped at 32; 8 is plenty for sim-LOD and keeps the cap sane.
const MAX_TIER_COUNT = 8;
// Sanity cap on the entity-id space.
const MAX_ENTITIES_CAP = 1 << 18;
// entityTier / pendingTarget sentinel: this entity is in no tier /
// has no queued migration.
const UNASSIGNED = -1;
// Inclusive u32 ceiling - globalTick is a 32-bit frame counter.
const U32_MAX = 0xffffffff;

export class LoomFlux {
  // Number of update tiers.
  readonly tierCount: number;
  // Entity-id space: ids are in [0, maxEntities).
  readonly maxEntities: number;

  // Per-tier frame stride: tier t is due when >= strides[t] frames
  // have passed since it was last processed.
  private readonly strides: Int32Array;
  // Per-tier last globalTick processed. Meaningful only once
  // hasTicked is true.
  private readonly lastProcessed: Uint32Array;
  // False until the first tick(); the first tick marks every tier
  // due (frame 0 of the blueprint's % stride is due for all).
  private hasTicked: boolean = false;

  // Flat dense buckets: entity id at tier t, slot s lives at
  // buckets[t * maxEntities + s]. buckets[t*..t*+bucketCount[t]) is
  // the packed live set for tier t.
  private readonly buckets: Int32Array;
  // Number of entities currently in each tier's bucket.
  private readonly bucketCount: Int32Array;
  // Per-entity: which tier it is in (UNASSIGNED if none).
  private readonly entityTier: Int32Array;
  // Per-entity: its index within its tier's bucket - lets a
  // migration swap-pop the entity out in O(1).
  private readonly entitySlot: Int32Array;

  // Per-entity queued migration target tier (UNASSIGNED = none
  // queued). Last write wins, so requesting twice before a tick
  // collapses to one migration.
  private readonly pendingTarget: Int32Array;
  // Dense list of entities with a queued migration this frame, so
  // the tick() drain is O(migrations), not O(maxEntities).
  private readonly pendingList: Int32Array;
  private pendingCount: number = 0;

  constructor(tierStrides: readonly number[], maxEntities: number) {
    if (!Array.isArray(tierStrides) || tierStrides.length < 1 || tierStrides.length > MAX_TIER_COUNT) {
      throw new RangeError(
        'LoomFlux: tierStrides must be an array of 1 to ' + MAX_TIER_COUNT + ' strides, got '
        + (Array.isArray(tierStrides) ? tierStrides.length : typeof tierStrides),
      );
    }
    if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > MAX_ENTITIES_CAP) {
      throw new RangeError(
        'LoomFlux: maxEntities must be an integer in [1, ' + MAX_ENTITIES_CAP + '], got ' + maxEntities,
      );
    }
    this.tierCount = tierStrides.length;
    this.maxEntities = maxEntities;
    this.strides = new Int32Array(this.tierCount);
    for (let t = 0; t < this.tierCount; t++) {
      const s = tierStrides[t];
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > U32_MAX) {
        throw new RangeError(
          'LoomFlux: tierStrides[' + t + '] must be a positive integer, got ' + s,
        );
      }
      this.strides[t] = s;
    }
    this.lastProcessed = new Uint32Array(this.tierCount);
    this.buckets = new Int32Array(this.tierCount * maxEntities);
    this.bucketCount = new Int32Array(this.tierCount);
    this.entityTier = new Int32Array(maxEntities).fill(UNASSIGNED);
    this.entitySlot = new Int32Array(maxEntities);
    this.pendingTarget = new Int32Array(maxEntities).fill(UNASSIGNED);
    this.pendingList = new Int32Array(maxEntities);
  }

  // The frame stride of a tier.
  tierStride(tier: number): number {
    this.requireTier(tier, 'tierStride');
    return this.strides[tier] ?? 0;
  }

  // How many entities are currently in a tier's bucket.
  getTierCount(tier: number): number {
    this.requireTier(tier, 'getTierCount');
    return this.bucketCount[tier] ?? 0;
  }

  // The entity id at slot `index` of a tier's dense bucket. Iterate a
  // tier with: for (let i = 0; i < flux.getTierCount(t); i++)
  //              flux.entityInTierAt(t, i)
  // The bucket is stable between tick()s - requestMigration() only
  // queues - so a mid-frame iteration sees a fixed set.
  entityInTierAt(tier: number, index: number): number {
    this.requireTier(tier, 'entityInTierAt');
    const count = this.bucketCount[tier] ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new RangeError(
        'LoomFlux.entityInTierAt: index ' + index + ' out of [0, ' + count + ') for tier ' + tier,
      );
    }
    return this.buckets[tier * this.maxEntities + index] ?? 0;
  }

  // The tier an entity is in, or -1 (UNASSIGNED) if it is in none.
  entityTierOf(entityId: number): number {
    this.requireEntity(entityId, 'entityTierOf');
    return this.entityTier[entityId] ?? UNASSIGNED;
  }

  // Migrations queued but not yet drained by tick().
  pendingMigrationCount(): number {
    return this.pendingCount;
  }

  // Immediately place an unassigned entity into a tier. For setup
  // before the sim loop runs; for a runtime tier change use
  // requestMigration() so it lands on the frame boundary. Throws if
  // the entity is already assigned.
  assign(entityId: number, tier: number): void {
    this.requireEntity(entityId, 'assign');
    this.requireTier(tier, 'assign');
    const current = this.entityTier[entityId] ?? UNASSIGNED;
    if (current !== UNASSIGNED) {
      throw new Error(
        'LoomFlux.assign: entity ' + entityId + ' is already assigned to tier '
        + current + ' - use requestMigration to move it',
      );
    }
    this.appendToTier(entityId, tier);
  }

  // Queue a tier change for an entity, applied on the next tick()
  // (the frame boundary). Works whether the entity is already
  // assigned (a migration) or not (a deferred initial assignment).
  // Requesting twice before a tick collapses to one migration - the
  // last target wins.
  requestMigration(entityId: number, toTier: number): void {
    this.requireEntity(entityId, 'requestMigration');
    this.requireTier(toTier, 'requestMigration');
    if ((this.pendingTarget[entityId] ?? UNASSIGNED) === UNASSIGNED) {
      this.pendingList[this.pendingCount] = entityId;
      this.pendingCount++;
    }
    this.pendingTarget[entityId] = toTier;
  }

  // Advance the scheduler to `globalTick`: drain the queued
  // migrations (gate 2 - the frame boundary), then return a bitmask
  // of the tiers due this frame, bit t set for tier t. The first
  // tick ever marks every tier due.
  tick(globalTick: number): number {
    if (!Number.isInteger(globalTick) || globalTick < 0 || globalTick > U32_MAX) {
      throw new RangeError(
        'LoomFlux.tick: globalTick must be an integer in [0, ' + U32_MAX + '], got ' + globalTick,
      );
    }
    // Drain migrations first - the frame boundary.
    for (let i = 0; i < this.pendingCount; i++) {
      const entityId = this.pendingList[i] ?? 0;
      const toTier = this.pendingTarget[entityId] ?? UNASSIGNED;
      if (toTier !== UNASSIGNED) {
        this.applyMigration(entityId, toTier);
        this.pendingTarget[entityId] = UNASSIGNED;
      }
    }
    this.pendingCount = 0;

    let dueMask = 0;
    if (!this.hasTicked) {
      // First tick: every tier is due, like frame 0 of % stride.
      this.hasTicked = true;
      for (let t = 0; t < this.tierCount; t++) {
        this.lastProcessed[t] = globalTick;
        dueMask |= 1 << t;
      }
      return dueMask;
    }
    for (let t = 0; t < this.tierCount; t++) {
      // Unsigned subtraction: correct even across a u32 wrap, and it
      // tolerates skipped frames.
      const delta = (globalTick - (this.lastProcessed[t] ?? 0)) >>> 0;
      if (delta >= (this.strides[t] ?? 1)) {
        this.lastProcessed[t] = globalTick;
        dueMask |= 1 << t;
      }
    }
    return dueMask;
  }

  // Reset to the constructed-but-empty state.
  clear(): void {
    this.bucketCount.fill(0);
    this.entityTier.fill(UNASSIGNED);
    this.pendingTarget.fill(UNASSIGNED);
    this.lastProcessed.fill(0);
    this.pendingCount = 0;
    this.hasTicked = false;
  }

  // --- private ---

  private requireTier(tier: number, op: string): void {
    if (!Number.isInteger(tier) || tier < 0 || tier >= this.tierCount) {
      throw new RangeError(
        'LoomFlux.' + op + ': tier ' + tier + ' out of [0, ' + this.tierCount + ')',
      );
    }
  }

  private requireEntity(entityId: number, op: string): void {
    if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.maxEntities) {
      throw new RangeError(
        'LoomFlux.' + op + ': entityId ' + entityId + ' out of [0, ' + this.maxEntities + ')',
      );
    }
  }

  // Append an entity to the end of a tier's dense bucket.
  private appendToTier(entityId: number, tier: number): void {
    const slot = this.bucketCount[tier] ?? 0;
    this.buckets[tier * this.maxEntities + slot] = entityId;
    this.entitySlot[entityId] = slot;
    this.bucketCount[tier] = slot + 1;
    this.entityTier[entityId] = tier;
  }

  // Apply one drained migration. An entity not yet in a tier is a
  // deferred initial assignment; otherwise it is swap-popped out of
  // its current tier and appended to the target, keeping both
  // buckets dense.
  private applyMigration(entityId: number, toTier: number): void {
    const fromTier = this.entityTier[entityId] ?? UNASSIGNED;
    if (fromTier === toTier) return;   // already there
    if (fromTier === UNASSIGNED) {
      this.appendToTier(entityId, toTier);
      return;
    }
    // Swap-pop out of fromTier: move the bucket's last entity into
    // this entity's slot, then shrink the bucket.
    const slot = this.entitySlot[entityId] ?? 0;
    const lastIdx = (this.bucketCount[fromTier] ?? 0) - 1;
    const lastEntity = this.buckets[fromTier * this.maxEntities + lastIdx] ?? 0;
    this.buckets[fromTier * this.maxEntities + slot] = lastEntity;
    this.entitySlot[lastEntity] = slot;
    this.bucketCount[fromTier] = lastIdx;
    // Append to toTier.
    this.appendToTier(entityId, toTier);
  }
}
