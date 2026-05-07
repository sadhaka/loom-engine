// RangedAttackPool - per-entity ranged attack capability.
//
// Mob with this + Transform + (optional) Pursue fires projectiles
// at its target every cooldownMs when within range. The Pursue
// component handles closing the gap; ranged-only mobs may run
// without Pursue and stay rooted (e.g. summoners). RangedAttackSystem
// reads this each tick.

import { type EntityId, entityIndex } from '../entity.js';
import { growF32, growI32, growU8, nextPow2 } from '../util/typed-arrays.js';
import type { ColorRGBA } from '../util/color.js';

export const RANGED_FLAG_ACTIVE = 1 << 0;
export const RANGED_FLAG_HOMING = 1 << 1;

export interface RangedAttackConfig {
  // Entity index of the target (typically the player).
  target: EntityId;
  // Range in world tile units. If target is farther, no fire.
  range: number;
  // Stop firing when target is closer than this (so melee mobs
  // don't try to ranged-attack at point blank). 0 = always fire
  // when in range.
  minRange: number;
  // ms between successive shots.
  cooldownMs: number;
  // Damage per projectile.
  damage: number;
  // Projectile speed in world units / sec.
  projectileSpeed: number;
  // Projectile lifetime in seconds (caps maximum range and
  // gives a hard despawn for misses).
  projectileLife: number;
  // Visual params.
  projectileSize: number;
  projectileColor: Readonly<ColorRGBA>;
  // If true, projectile homes after launch (re-aims each tick).
  homing: boolean;
}

export class RangedAttackPool {
  // Hot
  range: Float32Array;
  minRange: Float32Array;
  cooldownMs: Float32Array;
  lastFireMs: Float32Array;
  damage: Float32Array;
  projectileSpeed: Float32Array;
  projectileLife: Float32Array;
  projectileSize: Float32Array;
  // Color rgba split.
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  a: Float32Array;
  // Target entity index. -1 = no target.
  targetIndex: Int32Array;
  flags: Uint8Array;

  private capacity: number = 0;
  private highWaterMark: number = 0;

  constructor(initialCapacity: number = 32) {
    this.capacity = nextPow2(initialCapacity);
    this.range = new Float32Array(this.capacity);
    this.minRange = new Float32Array(this.capacity);
    this.cooldownMs = new Float32Array(this.capacity);
    this.lastFireMs = new Float32Array(this.capacity);
    this.damage = new Float32Array(this.capacity);
    this.projectileSpeed = new Float32Array(this.capacity);
    this.projectileLife = new Float32Array(this.capacity);
    this.projectileSize = new Float32Array(this.capacity);
    this.r = new Float32Array(this.capacity);
    this.g = new Float32Array(this.capacity);
    this.b = new Float32Array(this.capacity);
    this.a = new Float32Array(this.capacity);
    this.targetIndex = new Int32Array(this.capacity).fill(-1);
    this.flags = new Uint8Array(this.capacity);
  }

  ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    this.range = growF32(this.range, next);
    this.minRange = growF32(this.minRange, next);
    this.cooldownMs = growF32(this.cooldownMs, next);
    this.lastFireMs = growF32(this.lastFireMs, next);
    this.damage = growF32(this.damage, next);
    this.projectileSpeed = growF32(this.projectileSpeed, next);
    this.projectileLife = growF32(this.projectileLife, next);
    this.projectileSize = growF32(this.projectileSize, next);
    this.r = growF32(this.r, next);
    this.g = growF32(this.g, next);
    this.b = growF32(this.b, next);
    this.a = growF32(this.a, next);
    const newTarget = new Int32Array(next).fill(-1);
    newTarget.set(this.targetIndex);
    this.targetIndex = newTarget;
    this.flags = growU8(this.flags, next);
    this.capacity = next;
    // Mark unused growF32 import as used (TypeScript noUnusedImports).
    if (this.range.length === 0) growI32(this.targetIndex, 0);
  }

  attach(e: EntityId, cfg: RangedAttackConfig): void {
    const i = entityIndex(e);
    this.ensureCapacity(i);
    this.range[i] = cfg.range;
    this.minRange[i] = cfg.minRange;
    this.cooldownMs[i] = cfg.cooldownMs;
    this.lastFireMs[i] = -1;
    this.damage[i] = cfg.damage;
    this.projectileSpeed[i] = cfg.projectileSpeed;
    this.projectileLife[i] = cfg.projectileLife;
    this.projectileSize[i] = cfg.projectileSize;
    this.r[i] = cfg.projectileColor.r;
    this.g[i] = cfg.projectileColor.g;
    this.b[i] = cfg.projectileColor.b;
    this.a[i] = cfg.projectileColor.a;
    this.targetIndex[i] = entityIndex(cfg.target);
    let f = RANGED_FLAG_ACTIVE;
    if (cfg.homing) f |= RANGED_FLAG_HOMING;
    this.flags[i] = f;
    if (i >= this.highWaterMark) this.highWaterMark = i + 1;
  }

  detach(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.flags[i] = 0;
    this.targetIndex[i] = -1;
  }

  setTarget(e: EntityId, target: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.targetIndex[i] = entityIndex(target);
  }

  isActive(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & RANGED_FLAG_ACTIVE) !== 0;
  }

  getHighWaterMark(): number { return this.highWaterMark; }
  getCapacity(): number { return this.capacity; }
}

export const POOL_RANGED = 'ranged';
