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
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';
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
    // Spawn a particle. Returns the slot index, or -1 if the budget
    // (maxParticles) is exhausted. Callers that emit per-frame should
    // check the return value to know if their burst was clipped.
    spawn(p) {
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
        this.x[i] = p.x;
        this.y[i] = p.y;
        this.z[i] = p.z;
        this.vx[i] = p.vx ?? 0;
        this.vy[i] = p.vy ?? 0;
        this.vz[i] = p.vz ?? 0;
        this.ax[i] = p.ax ?? 0;
        this.ay[i] = p.ay ?? 0;
        this.az[i] = p.az ?? 0;
        this.life[i] = p.life;
        this.maxLife[i] = p.life;
        this.size[i] = p.size ?? 4;
        this.endSize[i] = p.endSize ?? p.size ?? 4;
        this.r0[i] = p.color.r;
        this.g0[i] = p.color.g;
        this.b0[i] = p.color.b;
        this.a0[i] = p.color.a;
        if (p.endColor) {
            this.r1[i] = p.endColor.r;
            this.g1[i] = p.endColor.g;
            this.b1[i] = p.endColor.b;
            this.a1[i] = p.endColor.a;
        }
        else {
            // Default fade to fully transparent, same hue.
            this.r1[i] = p.color.r;
            this.g1[i] = p.color.g;
            this.b1[i] = p.color.b;
            this.a1[i] = 0;
        }
        let f = PARTICLE_FLAG_ALIVE;
        if (p.additive)
            f |= PARTICLE_FLAG_ADDITIVE;
        this.flags[i] = f;
        this.liveCount++;
        return i;
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
}
//# sourceMappingURL=particle-pool.js.map