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
import { growF32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
import { NULL_ENTITY } from '../entity.js';
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
    ownerEntity;
    targetEntity; // NULL_ENTITY if not homing
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
        this.ownerEntity = new Uint32Array(this.capacity);
        this.targetEntity = new Uint32Array(this.capacity);
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
    spawnRaw(x, y, z, vx, vy, vz, life, damage, ownerEntity, targetEntity, size, r, g, b, a, homing, pierce) {
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
        this.x[i] = x;
        this.y[i] = y;
        this.z[i] = z;
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.vz[i] = vz;
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
        if (homing)
            f |= PROJECTILE_FLAG_HOMING;
        if (pierce)
            f |= PROJECTILE_FLAG_PIERCE;
        this.flags[i] = f;
        this.liveCount++;
        return i;
    }
    // Object-form spawn. Convenience wrapper over spawnRaw; defaults
    // targetEntity to NULL_ENTITY and homing/pierce to false. Hot
    // callers should use spawnRaw directly.
    spawn(p) {
        return this.spawnRaw(p.x, p.y, p.z, p.vx, p.vy, p.vz, p.life, p.damage, p.ownerEntity, p.targetEntity ?? NULL_ENTITY, p.size, p.color.r, p.color.g, p.color.b, p.color.a, p.homing ?? false, p.pierce ?? false);
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
    // Lower highWaterMark past trailing dead projectiles, and drop
    // free-list slots that fall above the new mark - those slots no
    // longer exist in the iteration range, so spawn must not hand them
    // back. liveCount is unchanged: those slots were already killed.
    tighten() {
        this.highWaterMark = tightenHighWaterMark(this.flags, this.highWaterMark);
        const hwm = this.highWaterMark;
        let w = 0;
        for (let r = 0; r < this.freeList.length; r++) {
            const slot = this.freeList[r] ?? 0;
            if (slot < hwm)
                this.freeList[w++] = slot;
        }
        this.freeList.length = w;
    }
    // --- ISnapshotable: SoA columns [0, highWaterMark) plus the
    // free-list / live-count bookkeeping. Projectiles are not
    // entities, so the pool owns its full index-space state. ---
    snapshotKey = 'loom.projectile-pool';
    snapshotInto(w) {
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
    restoreFrom(r) {
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
        const free = [];
        for (let i = 0; i < fc; i++)
            free.push(r.readU32());
        this.freeList = free;
    }
}
export const POOL_PROJECTILE = 'projectile';
//# sourceMappingURL=projectile-pool.js.map