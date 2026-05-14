// ParticlePool - flat structure-of-arrays storage for ephemeral
// particles. Particles are NOT ECS entities. They have no
// generation, no entity-id, no participation in the entity allocator.
// They are short-lived render decoration with their own simple
// integer index space and a free-list for slot recycling.
//
// This separation is deliberate. Particles can hit thousands per
// second at peak (a knight on fire, a spell hit, a death explosion);
// going through the entity allocator + transform pool would burn
// EntityId space and force every component pool to grow alongside.
//
// Layout: hot data (position, velocity, life) in Float32Arrays;
// color rgba in four parallel Float32Arrays; size in Float32Array;
// flags in Uint8Array. Capacity grows by 2x; live count tracked
// separately so iteration stays O(live) not O(capacity).
import { growF32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
export const PARTICLE_FLAG_ALIVE = 1 << 0;
export const PARTICLE_FLAG_ADDITIVE = 1 << 1;
export class ParticlePool {
    // Hot per-particle data
    x;
    y;
    z;
    vx;
    vy;
    vz;
    ax;
    ay;
    az;
    life; // seconds remaining
    maxLife; // total seconds at spawn (for fade interpolation)
    size;
    endSize;
    // Color start + end (interpolated by life/maxLife each frame)
    r0;
    g0;
    b0;
    a0;
    r1;
    g1;
    b1;
    a1;
    flags;
    capacity = 0;
    liveCount = 0;
    // Free list of indices below the high-water mark that have been
    // freed. Avoids fragmentation: spawn pulls from here first, then
    // bumps the highWaterMark.
    freeList = [];
    // Index just past the highest slot ever used. Iteration sweeps
    // [0, highWaterMark).
    highWaterMark = 0;
    // Hard cap. Spawn returns -1 when liveCount >= maxParticles. The
    // Director can set this from the Veil Essence budget per frame.
    maxParticles;
    constructor(initialCapacity = 256, maxParticles = 4096) {
        this.capacity = nextPow2(initialCapacity);
        this.maxParticles = maxParticles;
        this.x = new Float32Array(this.capacity);
        this.y = new Float32Array(this.capacity);
        this.z = new Float32Array(this.capacity);
        this.vx = new Float32Array(this.capacity);
        this.vy = new Float32Array(this.capacity);
        this.vz = new Float32Array(this.capacity);
        this.ax = new Float32Array(this.capacity);
        this.ay = new Float32Array(this.capacity);
        this.az = new Float32Array(this.capacity);
        this.life = new Float32Array(this.capacity);
        this.maxLife = new Float32Array(this.capacity);
        this.size = new Float32Array(this.capacity);
        this.endSize = new Float32Array(this.capacity);
        this.r0 = new Float32Array(this.capacity);
        this.g0 = new Float32Array(this.capacity);
        this.b0 = new Float32Array(this.capacity);
        this.a0 = new Float32Array(this.capacity);
        this.r1 = new Float32Array(this.capacity);
        this.g1 = new Float32Array(this.capacity);
        this.b1 = new Float32Array(this.capacity);
        this.a1 = new Float32Array(this.capacity);
        this.flags = new Uint8Array(this.capacity);
    }
    setMaxParticles(n) {
        if (n < 0)
            n = 0;
        this.maxParticles = n;
    }
    getMaxParticles() {
        return this.maxParticles;
    }
    getLiveCount() {
        return this.liveCount;
    }
    getHighWaterMark() {
        return this.highWaterMark;
    }
    getCapacity() {
        return this.capacity;
    }
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
        this.ax = growF32(this.ax, next);
        this.ay = growF32(this.ay, next);
        this.az = growF32(this.az, next);
        this.life = growF32(this.life, next);
        this.maxLife = growF32(this.maxLife, next);
        this.size = growF32(this.size, next);
        this.endSize = growF32(this.endSize, next);
        this.r0 = growF32(this.r0, next);
        this.g0 = growF32(this.g0, next);
        this.b0 = growF32(this.b0, next);
        this.a0 = growF32(this.a0, next);
        this.r1 = growF32(this.r1, next);
        this.g1 = growF32(this.g1, next);
        this.b1 = growF32(this.b1, next);
        this.a1 = growF32(this.a1, next);
        this.flags = growU8(this.flags, next);
        this.capacity = next;
    }
    // Zero-allocation spawn. Writes every column from positional
    // scalars, so a hot emitter loop can spawn without building a
    // ParticleSpawn object + nested color objects per particle.
    // Returns the slot index, or -1 if the maxParticles budget is
    // exhausted.
    spawnRaw(x, y, z, vx, vy, vz, ax, ay, az, life, size, endSize, r0, g0, b0, a0, r1, g1, b1, a1, additive) {
        if (this.liveCount >= this.maxParticles)
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
        this.ax[i] = ax;
        this.ay[i] = ay;
        this.az[i] = az;
        this.life[i] = life;
        this.maxLife[i] = life;
        this.size[i] = size;
        this.endSize[i] = endSize;
        this.r0[i] = r0;
        this.g0[i] = g0;
        this.b0[i] = b0;
        this.a0[i] = a0;
        this.r1[i] = r1;
        this.g1[i] = g1;
        this.b1[i] = b1;
        this.a1[i] = a1;
        this.flags[i] = additive
            ? PARTICLE_FLAG_ALIVE | PARTICLE_FLAG_ADDITIVE
            : PARTICLE_FLAG_ALIVE;
        this.liveCount++;
        return i;
    }
    // Object-form spawn. Convenience wrapper over spawnRaw for non-hot
    // call sites; applies the ParticleSpawn defaults (vx/vy/vz/ax/ay/az
    // default 0, size 4, endSize falls back to size, endColor falls
    // back to the start color faded to alpha 0). Hot loops should call
    // spawnRaw directly to avoid the per-spawn object + color allocs.
    spawn(p) {
        const size = p.size ?? 4;
        const ec = p.endColor;
        return this.spawnRaw(p.x, p.y, p.z, p.vx ?? 0, p.vy ?? 0, p.vz ?? 0, p.ax ?? 0, p.ay ?? 0, p.az ?? 0, p.life, size, p.endSize ?? size, p.color.r, p.color.g, p.color.b, p.color.a, ec ? ec.r : p.color.r, ec ? ec.g : p.color.g, ec ? ec.b : p.color.b, ec ? ec.a : 0, p.additive ?? false);
    }
    // Mark a particle dead and reclaim its slot for reuse.
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
        return ((this.flags[i] ?? 0) & PARTICLE_FLAG_ALIVE) !== 0;
    }
    // Reset everything. Used between scenes / encounters when the
    // engine wants a clean slate.
    clear() {
        this.flags.fill(0);
        this.freeList.length = 0;
        this.liveCount = 0;
        this.highWaterMark = 0;
    }
    // Lower highWaterMark past trailing dead particles, and drop
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
    // free-list / live-count bookkeeping. Particles are not entities,
    // so the pool owns its full index-space state. ---
    snapshotKey = 'loom.particle-pool';
    snapshotInto(w) {
        const n = this.highWaterMark;
        w.writeU32(n);
        w.writeU32(this.liveCount);
        w.writeU32(this.maxParticles);
        w.writeF32Slice(this.x, n);
        w.writeF32Slice(this.y, n);
        w.writeF32Slice(this.z, n);
        w.writeF32Slice(this.vx, n);
        w.writeF32Slice(this.vy, n);
        w.writeF32Slice(this.vz, n);
        w.writeF32Slice(this.ax, n);
        w.writeF32Slice(this.ay, n);
        w.writeF32Slice(this.az, n);
        w.writeF32Slice(this.life, n);
        w.writeF32Slice(this.maxLife, n);
        w.writeF32Slice(this.size, n);
        w.writeF32Slice(this.endSize, n);
        w.writeF32Slice(this.r0, n);
        w.writeF32Slice(this.g0, n);
        w.writeF32Slice(this.b0, n);
        w.writeF32Slice(this.a0, n);
        w.writeF32Slice(this.r1, n);
        w.writeF32Slice(this.g1, n);
        w.writeF32Slice(this.b1, n);
        w.writeF32Slice(this.a1, n);
        w.writeU8Slice(this.flags, n);
        w.writeU32(this.freeList.length);
        for (let i = 0; i < this.freeList.length; i++) {
            w.writeU32(this.freeList[i] ?? 0);
        }
    }
    restoreFrom(r) {
        const n = r.readU32();
        this.liveCount = r.readU32();
        this.maxParticles = r.readU32();
        this.x = r.readF32Slice();
        this.y = r.readF32Slice();
        this.z = r.readF32Slice();
        this.vx = r.readF32Slice();
        this.vy = r.readF32Slice();
        this.vz = r.readF32Slice();
        this.ax = r.readF32Slice();
        this.ay = r.readF32Slice();
        this.az = r.readF32Slice();
        this.life = r.readF32Slice();
        this.maxLife = r.readF32Slice();
        this.size = r.readF32Slice();
        this.endSize = r.readF32Slice();
        this.r0 = r.readF32Slice();
        this.g0 = r.readF32Slice();
        this.b0 = r.readF32Slice();
        this.a0 = r.readF32Slice();
        this.r1 = r.readF32Slice();
        this.g1 = r.readF32Slice();
        this.b1 = r.readF32Slice();
        this.a1 = r.readF32Slice();
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
//# sourceMappingURL=particle-pool.js.map