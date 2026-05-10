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
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';
export const PROJECTILE_FLAG_ALIVE = 1 << 0;
// Homing: each tick, projectile re-aims at target's position.
// Without this flag, projectile flies a straight line.
export const PROJECTILE_FLAG_HOMING = 1 << 1;
// Pierce: projectile keeps going after a hit instead of being
// destroyed. Used for spell beams, piercing arrows.
export const PROJECTILE_FLAG_PIERCE = 1 << 2;
export class ProjectilePool {
    // Hot
    x;
    y;
    z;
    vx;
    vy;
    vz;
    life;
    damage;
    ownerIndex;
    targetIndex; // -1 if not homing
    size;
    // Color rgba split.
    r;
    g;
    b;
    a;
    flags;
    capacity = 0;
    liveCount = 0;
    freeList = [];
    highWaterMark = 0;
    maxProjectiles;
    constructor(initialCapacity = 64, maxProjectiles = 512) {
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
        this.ownerIndex = new Int32Array(this.capacity).fill(-1);
        this.targetIndex = new Int32Array(this.capacity).fill(-1);
        this.size = new Float32Array(this.capacity);
        this.r = new Float32Array(this.capacity);
        this.g = new Float32Array(this.capacity);
        this.b = new Float32Array(this.capacity);
        this.a = new Float32Array(this.capacity);
        this.flags = new Uint8Array(this.capacity);
    }
    setMaxProjectiles(n) {
        if (n < 0)
            n = 0;
        this.maxProjectiles = n;
    }
    getMaxProjectiles() { return this.maxProjectiles; }
    getLiveCount() { return this.liveCount; }
    getHighWaterMark() { return this.highWaterMark; }
    getCapacity() { return this.capacity; }
    ensureCapacity(neededIndex) {
        if (neededIndex < this.capacity)
            return;
        const next = nextPow2(neededIndex + 1);
        this.x = growF32(this.x, next);
        this.y = growF32(this.y, next);
        this.z = growF32(this.z, next);
        this.vx = growF32(this.vx, next);
        this.vy = growF32(this.vy, next);
        this.vz = growF32(this.vz, next);
        this.life = growF32(this.life, next);
        this.damage = growF32(this.damage, next);
        const newOwner = new Int32Array(next).fill(-1);
        newOwner.set(this.ownerIndex);
        this.ownerIndex = newOwner;
        const newTarget = new Int32Array(next).fill(-1);
        newTarget.set(this.targetIndex);
        this.targetIndex = newTarget;
        this.size = growF32(this.size, next);
        this.r = growF32(this.r, next);
        this.g = growF32(this.g, next);
        this.b = growF32(this.b, next);
        this.a = growF32(this.a, next);
        this.flags = growU8(this.flags, next);
        this.capacity = next;
    }
    spawn(p) {
        if (this.liveCount >= this.maxProjectiles)
            return -1;
        let i;
        const recycled = this.freeList.pop();
        if (recycled !== undefined) {
            i = recycled;
        }
        else {
            i = this.highWaterMark;
            this.highWaterMark++;
            this.ensureCapacity(i);
        }
        this.x[i] = p.x;
        this.y[i] = p.y;
        this.z[i] = p.z;
        this.vx[i] = p.vx;
        this.vy[i] = p.vy;
        this.vz[i] = p.vz;
        this.life[i] = p.life;
        this.damage[i] = p.damage;
        this.ownerIndex[i] = p.ownerIndex;
        this.targetIndex[i] = p.targetIndex ?? -1;
        this.size[i] = p.size;
        this.r[i] = p.color.r;
        this.g[i] = p.color.g;
        this.b[i] = p.color.b;
        this.a[i] = p.color.a;
        let f = PROJECTILE_FLAG_ALIVE;
        if (p.homing)
            f |= PROJECTILE_FLAG_HOMING;
        if (p.pierce)
            f |= PROJECTILE_FLAG_PIERCE;
        this.flags[i] = f;
        this.liveCount++;
        return i;
    }
    kill(i) {
        if (i < 0 || i >= this.highWaterMark)
            return;
        if ((this.flags[i] ?? 0) === 0)
            return;
        this.flags[i] = 0;
        this.liveCount--;
        this.freeList.push(i);
    }
    isAlive(i) {
        if (i < 0 || i >= this.highWaterMark)
            return false;
        return ((this.flags[i] ?? 0) & PROJECTILE_FLAG_ALIVE) !== 0;
    }
    clear() {
        this.flags.fill(0);
        this.freeList.length = 0;
        this.liveCount = 0;
        this.highWaterMark = 0;
    }
}
export const POOL_PROJECTILE = 'projectile';
//# sourceMappingURL=projectile-pool.js.map