// ProjectilePool - in-flight projectiles (arrows, bolts, spells).
//
// Lives in vfx/ alongside ParticlePool because projectiles are
// short-lived rendered objects with simulation. Unlike particles,
// projectiles damage things on contact, so this pool tracks owner
// + damage payload + an optional homing target.
//
// Projectiles are NOT ECS entities. Same reasoning as ParticlePool
// (Phase 4): ephemeral, fast-spawning, would burn entity-id space.
// Free-list slot recycling. Hard cap configurable per scene.

import { growF32, growI32, growU8, nextPow2 } from '../util/typed-arrays.js';
import type { ColorRGBA } from '../util/color.js';
import { type EntityId, NULL_ENTITY } from '../entity.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';

export const PROJECTILE_FLAG_ALIVE = 1 << 0;
// Homing: each tick, projectile re-aims at target's position.
// Without this flag, projectile flies a straight line.
export const PROJECTILE_FLAG_HOMING = 1 << 1;
// Pierce: projectile keeps going after a hit instead of being
// destroyed. Used for spell beams, piercing arrows.
export const PROJECTILE_FLAG_PIERCE = 1 << 2;

export interface ProjectileSpawn {
  // World-space spawn position.
  x: number;
  y: number;
  z: number;
  // World-space velocity (pre-aim done by caller; for homing the
  // velocity gets adjusted each tick).
  vx: number;
  vy: number;
  vz: number;
  life: number;             // seconds before auto-despawn
  damage: number;           // applied to a HealthPool entity on contact
  // Owner entity handle. The projectile never damages its owner.
  // NULL_ENTITY = no owner (environmental).
  ownerEntity: EntityId;
  // Optional homing target entity handle. NULL_ENTITY = no target.
  targetEntity?: EntityId;
  // Visual params.
  size: number;             // pixel size for render
  color: Readonly<ColorRGBA>;
  homing?: boolean;
  pierce?: boolean;
}

export class ProjectilePool implements ISnapshotable {
  // Hot
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  life: Float32Array;
  damage: Float32Array;
  ownerEntity: Uint32Array;
  targetEntity: Uint32Array;   // NULL_ENTITY if not homing
  size: Float32Array;
  // Color rgba split.
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  a: Float32Array;
  flags: Uint8Array;

  private capacity: number = 0;
  private liveCount: number = 0;
  private freeList: number[] = [];
  private highWaterMark: number = 0;
  private maxProjectiles: number;

  constructor(initialCapacity: number = 64, maxProjectiles: number = 512) {
    this.capacity = nextPow2(initialCapacity);
    this.maxProjectiles = maxProjectiles;
    this.x = new Float32Array(this.capacity);
    this.y = new Float32Array(this.capacity);
    this.z = new Float32Array(this.capacity);
    this.vx = new Float32Array(this.capacity);
    this.vy = new Float32Array(this.capacity);
    this.vz = new Float32Array(this.capacity);
    this.life = new Float32Array(this.capacity);
    this.damage = new Float32Array(this.capacity);
    this.ownerEntity = new Uint32Array(this.capacity);
    this.targetEntity = new Uint32Array(this.capacity);
    this.size = new Float32Array(this.capacity);
    this.r = new Float32Array(this.capacity);
    this.g = new Float32Array(this.capacity);
    this.b = new Float32Array(this.capacity);
    this.a = new Float32Array(this.capacity);
    this.flags = new Uint8Array(this.capacity);
  }

  setMaxProjectiles(n: number): void {
    if (n < 0) n = 0;
    this.maxProjectiles = n;
  }
  getMaxProjectiles(): number { return this.maxProjectiles; }
  getLiveCount(): number { return this.liveCount; }
  getHighWaterMark(): number { return this.highWaterMark; }
  getCapacity(): number { return this.capacity; }

  private ensureCapacity(neededIndex: number): void {
    if (neededIndex < this.capacity) return;
    const next = nextPow2(neededIndex + 1);
    this.x = growF32(this.x, next);
    this.y = growF32(this.y, next);
    this.z = growF32(this.z, next);
    this.vx = growF32(this.vx, next);
    this.vy = growF32(this.vy, next);
    this.vz = growF32(this.vz, next);
    this.life = growF32(this.life, next);
    this.damage = growF32(this.damage, next);
    const newOwner = new Uint32Array(next);
    newOwner.set(this.ownerEntity);
    this.ownerEntity = newOwner;
    const newTarget = new Uint32Array(next);
    newTarget.set(this.targetEntity);
    this.targetEntity = newTarget;
    this.size = growF32(this.size, next);
    this.r = growF32(this.r, next);
    this.g = growF32(this.g, next);
    this.b = growF32(this.b, next);
    this.a = growF32(this.a, next);
    this.flags = growU8(this.flags, next);
    this.capacity = next;
  }

  // Zero-allocation spawn. Writes every column from positional
  // scalars, so a per-shot caller can spawn without building a
  // ProjectileSpawn object + nested color object. Returns the slot
  // index, or -1 if the maxProjectiles budget is exhausted.
  spawnRaw(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, damage: number,
    ownerEntity: EntityId, targetEntity: EntityId,
    size: number,
    r: number, g: number, b: number, a: number,
    homing: boolean, pierce: boolean,
  ): number {
    if (this.liveCount >= this.maxProjectiles) return -1;
    let i: number;
    const recycled = this.freeList.pop();
    if (recycled !== undefined) {
      i = recycled;
    } else {
      i = this.highWaterMark;
      this.highWaterMark++;
      this.ensureCapacity(i);
    }
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life;
    this.damage[i] = damage;
    this.ownerEntity[i] = ownerEntity;
    this.targetEntity[i] = targetEntity;
    this.size[i] = size;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.a[i] = a;
    let f = PROJECTILE_FLAG_ALIVE;
    if (homing) f |= PROJECTILE_FLAG_HOMING;
    if (pierce) f |= PROJECTILE_FLAG_PIERCE;
    this.flags[i] = f;
    this.liveCount++;
    return i;
  }

  // Object-form spawn. Convenience wrapper over spawnRaw; defaults
  // targetEntity to NULL_ENTITY and homing/pierce to false. Hot
  // callers should use spawnRaw directly.
  spawn(p: ProjectileSpawn): number {
    return this.spawnRaw(
      p.x, p.y, p.z,
      p.vx, p.vy, p.vz,
      p.life, p.damage,
      p.ownerEntity, p.targetEntity ?? NULL_ENTITY,
      p.size,
      p.color.r, p.color.g, p.color.b, p.color.a,
      p.homing ?? false, p.pierce ?? false,
    );
  }

  kill(i: number): void {
    if (i < 0 || i >= this.highWaterMark) return;
    if ((this.flags[i] ?? 0) === 0) return;
    this.flags[i] = 0;
    this.liveCount--;
    this.freeList.push(i);
  }

  isAlive(i: number): boolean {
    if (i < 0 || i >= this.highWaterMark) return false;
    return ((this.flags[i] ?? 0) & PROJECTILE_FLAG_ALIVE) !== 0;
  }

  clear(): void {
    this.flags.fill(0);
    this.freeList.length = 0;
    this.liveCount = 0;
    this.highWaterMark = 0;
  }

  // --- ISnapshotable: SoA columns [0, highWaterMark) plus the
  // free-list / live-count bookkeeping. Projectiles are not
  // entities, so the pool owns its full index-space state. ---

  readonly snapshotKey: string = 'loom.projectile-pool';

  snapshotInto(w: SnapshotWriter): void {
    const n = this.highWaterMark;
    w.writeU32(n);
    w.writeU32(this.liveCount);
    w.writeU32(this.maxProjectiles);
    w.writeF32Slice(this.x, n);
    w.writeF32Slice(this.y, n);
    w.writeF32Slice(this.z, n);
    w.writeF32Slice(this.vx, n);
    w.writeF32Slice(this.vy, n);
    w.writeF32Slice(this.vz, n);
    w.writeF32Slice(this.life, n);
    w.writeF32Slice(this.damage, n);
    w.writeU32Slice(this.ownerEntity, n);
    w.writeU32Slice(this.targetEntity, n);
    w.writeF32Slice(this.size, n);
    w.writeF32Slice(this.r, n);
    w.writeF32Slice(this.g, n);
    w.writeF32Slice(this.b, n);
    w.writeF32Slice(this.a, n);
    w.writeU8Slice(this.flags, n);
    w.writeU32(this.freeList.length);
    for (let i = 0; i < this.freeList.length; i++) {
      w.writeU32(this.freeList[i] ?? 0);
    }
  }

  restoreFrom(r: SnapshotReader): void {
    const n = r.readU32();
    this.liveCount = r.readU32();
    this.maxProjectiles = r.readU32();
    this.x = r.readF32Slice();
    this.y = r.readF32Slice();
    this.z = r.readF32Slice();
    this.vx = r.readF32Slice();
    this.vy = r.readF32Slice();
    this.vz = r.readF32Slice();
    this.life = r.readF32Slice();
    this.damage = r.readF32Slice();
    this.ownerEntity = r.readU32Slice();
    this.targetEntity = r.readU32Slice();
    this.size = r.readF32Slice();
    this.r = r.readF32Slice();
    this.g = r.readF32Slice();
    this.b = r.readF32Slice();
    this.a = r.readF32Slice();
    this.flags = r.readU8Slice();
    this.capacity = n;
    this.highWaterMark = n;
    const fc = r.readU32();
    const free: number[] = [];
    for (let i = 0; i < fc; i++) free.push(r.readU32());
    this.freeList = free;
  }
}

export const POOL_PROJECTILE = 'projectile';
