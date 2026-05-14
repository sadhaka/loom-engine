// PursuePool - per-entity AI that walks toward a target each tick.
//
// Minimum-viable Phase 7 enemy AI. PursueSystem reads:
//   - this entity's Transform (current position)
//   - target entity's Transform (where to walk to)
//   - this entity's PursueComponent (speed, stop-distance, target ref)
// And writes the pursuer's Transform x/y each tick toward the
// target.
//
// More sophisticated AI (steering, obstacle avoidance, group
// behaviour) is post-Phase 7. This is enough to demo a knight
// being mobbed by 3 enemies that walk at it and start damaging
// when in range.

import { type EntityId, entityIndex, NULL_ENTITY } from '../entity.js';
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';

export const PURSUE_FLAG_ACTIVE = 1 << 0;

export class PursuePool {
  // Hot
  speed: Float32Array;          // world units per second
  stopDistance: Float32Array;   // stop pursuing once within this distance of target
  targetEntity: Uint32Array;    // full EntityId of target; NULL_ENTITY = none
  // Damage applied to target when in range, per tick (not per second
  // - DamageSystem multiplies by dt elsewhere if continuous). This
  // is melee contact damage; ranged is a separate component.
  contactDamage: Float32Array;
  contactCooldownMs: Float32Array;     // ms between successive contact hits
  lastHitMs: Float32Array;             // last successful contact hit timestamp

  flags: Uint8Array;

  private capacity: number = 0;
  private highWaterMark: number = 0;

  constructor(initialCapacity: number = 64) {
    this.capacity = nextPow2(initialCapacity);
    this.speed = new Float32Array(this.capacity);
    this.stopDistance = new Float32Array(this.capacity);
    this.targetEntity = new Uint32Array(this.capacity);
    this.contactDamage = new Float32Array(this.capacity);
    this.contactCooldownMs = new Float32Array(this.capacity);
    this.lastHitMs = new Float32Array(this.capacity);
    this.flags = new Uint8Array(this.capacity);
  }

  ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    this.speed = growF32(this.speed, next);
    this.stopDistance = growF32(this.stopDistance, next);
    const newTarget = new Uint32Array(next);
    newTarget.set(this.targetEntity);
    this.targetEntity = newTarget;
    this.contactDamage = growF32(this.contactDamage, next);
    this.contactCooldownMs = growF32(this.contactCooldownMs, next);
    this.lastHitMs = growF32(this.lastHitMs, next);
    this.flags = growU8(this.flags, next);
    this.capacity = next;
  }

  attach(
    e: EntityId,
    target: EntityId,
    speed: number,
    stopDistance: number,
    contactDamage: number = 0,
    contactCooldownMs: number = 1000,
  ): void {
    const i = entityIndex(e);
    this.ensureCapacity(i);
    this.speed[i] = speed;
    this.stopDistance[i] = stopDistance;
    this.targetEntity[i] = target;
    this.contactDamage[i] = contactDamage;
    this.contactCooldownMs[i] = contactCooldownMs;
    this.lastHitMs[i] = -1;
    this.flags[i] = PURSUE_FLAG_ACTIVE;
    if (i >= this.highWaterMark) this.highWaterMark = i + 1;
  }

  detach(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.flags[i] = 0;
    this.targetEntity[i] = NULL_ENTITY;
  }

  setTarget(e: EntityId, target: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.targetEntity[i] = target;
  }

  isActive(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & PURSUE_FLAG_ACTIVE) !== 0;
  }

  getHighWaterMark(): number {
    return this.highWaterMark;
  }

  getCapacity(): number {
    return this.capacity;
  }
}

export const POOL_PURSUE = 'pursue';
