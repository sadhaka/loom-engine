// ParticleEmitterPool - per-entity emitter configuration.
//
// An ECS entity that has a Transform AND a ParticleEmitter spawns
// particles into a shared ParticlePool each tick. The emitter is
// configuration only; the actual spawn happens in
// ParticleEmitterSystem (LOGIC phase).
//
// SoA layout consistent with Transform / Sprite. Numeric fields hot
// in Float32Arrays; the start/end color tuples are split into
// parallel arrays so every per-tick read stays in cache.

import { type EntityId, entityIndex } from '../entity.js';
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';
import type { ColorRGBA } from '../util/color.js';

export const EMITTER_FLAG_ACTIVE = 1 << 0;
export const EMITTER_FLAG_ADDITIVE = 1 << 1;

// Configuration passed to attach. Fields not specified take the
// pool's default values.
export interface EmitterConfig {
  // Particles per second (continuous emission). 0 = no continuous
  // emission; the system can still trigger one-shot bursts via
  // ParticleEmitterPool.burst(e, count).
  rate: number;
  // Each spawned particle's lifetime (seconds).
  particleLife: number;
  // Initial speed range. The emitter samples uniformly in
  // [speedMin, speedMax]. Direction is sampled in a cone defined by
  // coneRadians around (dirX, dirY, dirZ); see emitter-system.ts for
  // the spawn math.
  speedMin: number;
  speedMax: number;
  // Direction of the emission cone. Normalized vector recommended.
  dirX: number;
  dirY: number;
  dirZ: number;
  // Half-angle of the cone in radians (0 = perfectly directional).
  coneRadians: number;
  // Acceleration applied to every spawned particle (gravity, drag).
  ax: number;
  ay: number;
  az: number;
  // Particle visual params.
  startSize: number;
  endSize: number;
  startColor: Readonly<ColorRGBA>;
  endColor: Readonly<ColorRGBA>;
  // Render mode.
  additive: boolean;
}

export class ParticleEmitterPool {
  // Continuous spawn rate (per second).
  rate: Float32Array;
  // Carryover seconds from the last tick (rate < 1/dt scenarios).
  spawnCarry: Float32Array;
  // One-shot burst counter. EmitterSystem decrements this by what it
  // spawns each tick until zero.
  burstRemaining: Int32Array;

  // Per-particle life on spawn.
  particleLife: Float32Array;

  // Speed range
  speedMin: Float32Array;
  speedMax: Float32Array;

  // Cone direction + half-angle
  dirX: Float32Array;
  dirY: Float32Array;
  dirZ: Float32Array;
  coneRadians: Float32Array;

  // Per-particle acceleration
  ax: Float32Array;
  ay: Float32Array;
  az: Float32Array;

  // Visual
  startSize: Float32Array;
  endSize: Float32Array;
  startR: Float32Array;
  startG: Float32Array;
  startB: Float32Array;
  startA: Float32Array;
  endR: Float32Array;
  endG: Float32Array;
  endB: Float32Array;
  endA: Float32Array;

  flags: Uint8Array;

  private capacity: number = 0;
  private highWaterMark: number = 0;

  constructor(initialCapacity: number = 32) {
    this.capacity = nextPow2(initialCapacity);
    const c = this.capacity;
    this.rate = new Float32Array(c);
    this.spawnCarry = new Float32Array(c);
    this.burstRemaining = new Int32Array(c);
    this.particleLife = new Float32Array(c);
    this.speedMin = new Float32Array(c);
    this.speedMax = new Float32Array(c);
    this.dirX = new Float32Array(c);
    this.dirY = new Float32Array(c);
    this.dirZ = new Float32Array(c);
    this.coneRadians = new Float32Array(c);
    this.ax = new Float32Array(c);
    this.ay = new Float32Array(c);
    this.az = new Float32Array(c);
    this.startSize = new Float32Array(c);
    this.endSize = new Float32Array(c);
    this.startR = new Float32Array(c);
    this.startG = new Float32Array(c);
    this.startB = new Float32Array(c);
    this.startA = new Float32Array(c);
    this.endR = new Float32Array(c);
    this.endG = new Float32Array(c);
    this.endB = new Float32Array(c);
    this.endA = new Float32Array(c);
    this.flags = new Uint8Array(c);
  }

  private ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    this.rate = growF32(this.rate, next);
    this.spawnCarry = growF32(this.spawnCarry, next);
    const newBurst = new Int32Array(next);
    newBurst.set(this.burstRemaining);
    this.burstRemaining = newBurst;
    this.particleLife = growF32(this.particleLife, next);
    this.speedMin = growF32(this.speedMin, next);
    this.speedMax = growF32(this.speedMax, next);
    this.dirX = growF32(this.dirX, next);
    this.dirY = growF32(this.dirY, next);
    this.dirZ = growF32(this.dirZ, next);
    this.coneRadians = growF32(this.coneRadians, next);
    this.ax = growF32(this.ax, next);
    this.ay = growF32(this.ay, next);
    this.az = growF32(this.az, next);
    this.startSize = growF32(this.startSize, next);
    this.endSize = growF32(this.endSize, next);
    this.startR = growF32(this.startR, next);
    this.startG = growF32(this.startG, next);
    this.startB = growF32(this.startB, next);
    this.startA = growF32(this.startA, next);
    this.endR = growF32(this.endR, next);
    this.endG = growF32(this.endG, next);
    this.endB = growF32(this.endB, next);
    this.endA = growF32(this.endA, next);
    this.flags = growU8(this.flags, next);
    this.capacity = next;
  }

  attach(e: EntityId, cfg: EmitterConfig): void {
    const i = entityIndex(e);
    this.ensureCapacity(i);
    this.rate[i] = cfg.rate;
    this.spawnCarry[i] = 0;
    this.burstRemaining[i] = 0;
    this.particleLife[i] = cfg.particleLife;
    this.speedMin[i] = cfg.speedMin;
    this.speedMax[i] = cfg.speedMax;
    this.dirX[i] = cfg.dirX;
    this.dirY[i] = cfg.dirY;
    this.dirZ[i] = cfg.dirZ;
    this.coneRadians[i] = cfg.coneRadians;
    this.ax[i] = cfg.ax;
    this.ay[i] = cfg.ay;
    this.az[i] = cfg.az;
    this.startSize[i] = cfg.startSize;
    this.endSize[i] = cfg.endSize;
    this.startR[i] = cfg.startColor.r;
    this.startG[i] = cfg.startColor.g;
    this.startB[i] = cfg.startColor.b;
    this.startA[i] = cfg.startColor.a;
    this.endR[i] = cfg.endColor.r;
    this.endG[i] = cfg.endColor.g;
    this.endB[i] = cfg.endColor.b;
    this.endA[i] = cfg.endColor.a;
    let f = EMITTER_FLAG_ACTIVE;
    if (cfg.additive) f |= EMITTER_FLAG_ADDITIVE;
    this.flags[i] = f;
    if (i >= this.highWaterMark) this.highWaterMark = i + 1;
  }

  detach(e: EntityId): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.flags[i] = 0;
    this.rate[i] = 0;
    this.burstRemaining[i] = 0;
  }

  setActive(e: EntityId, active: boolean): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    const f = this.flags[i] ?? 0;
    this.flags[i] = active ? f | EMITTER_FLAG_ACTIVE : f & ~EMITTER_FLAG_ACTIVE;
  }

  setRate(e: EntityId, rate: number): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.rate[i] = rate;
  }

  // Schedule a one-shot burst to be emitted on the next system tick.
  // Adds to any existing pending burst; useful for multi-trigger
  // hits (e.g. successive sword strikes spawning more sparks).
  burst(e: EntityId, count: number): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    this.burstRemaining[i] = (this.burstRemaining[i] ?? 0) + count;
  }

  isActive(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & EMITTER_FLAG_ACTIVE) !== 0;
  }

  isAdditive(e: EntityId): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    return ((this.flags[i] ?? 0) & EMITTER_FLAG_ADDITIVE) !== 0;
  }

  getHighWaterMark(): number {
    return this.highWaterMark;
  }

  getCapacity(): number {
    return this.capacity;
  }
}
