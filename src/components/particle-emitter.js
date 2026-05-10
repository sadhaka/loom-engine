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
import { entityIndex } from '../entity.js';
import { growF32, growU8, nextPow2 } from '../util/typed-arrays.js';
export const EMITTER_FLAG_ACTIVE = 1 << 0;
export const EMITTER_FLAG_ADDITIVE = 1 << 1;
export class ParticleEmitterPool {
    // Continuous spawn rate (per second).
    rate;
    // Carryover seconds from the last tick (rate < 1/dt scenarios).
    spawnCarry;
    // One-shot burst counter. EmitterSystem decrements this by what it
    // spawns each tick until zero.
    burstRemaining;
    // Per-particle life on spawn.
    particleLife;
    // Speed range
    speedMin;
    speedMax;
    // Cone direction + half-angle
    dirX;
    dirY;
    dirZ;
    coneRadians;
    // Per-particle acceleration
    ax;
    ay;
    az;
    // Visual
    startSize;
    endSize;
    startR;
    startG;
    startB;
    startA;
    endR;
    endG;
    endB;
    endA;
    flags;
    capacity = 0;
    highWaterMark = 0;
    constructor(initialCapacity = 32) {
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
    ensureCapacity(neededIndex) {
        if (neededIndex < this.capacity)
            return;
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
    attach(e, cfg) {
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
        if (cfg.additive)
            f |= EMITTER_FLAG_ADDITIVE;
        this.flags[i] = f;
        if (i >= this.highWaterMark)
            this.highWaterMark = i + 1;
    }
    detach(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.flags[i] = 0;
        this.rate[i] = 0;
        this.burstRemaining[i] = 0;
    }
    setActive(e, active) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        const f = this.flags[i] ?? 0;
        this.flags[i] = active ? f | EMITTER_FLAG_ACTIVE : f & ~EMITTER_FLAG_ACTIVE;
    }
    setRate(e, rate) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.rate[i] = rate;
    }
    // Schedule a one-shot burst to be emitted on the next system tick.
    // Adds to any existing pending burst; useful for multi-trigger
    // hits (e.g. successive sword strikes spawning more sparks).
    burst(e, count) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.burstRemaining[i] = (this.burstRemaining[i] ?? 0) + count;
    }
    isActive(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & EMITTER_FLAG_ACTIVE) !== 0;
    }
    isAdditive(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & EMITTER_FLAG_ADDITIVE) !== 0;
    }
    getHighWaterMark() {
        return this.highWaterMark;
    }
    getCapacity() {
        return this.capacity;
    }
}
//# sourceMappingURL=particle-emitter.js.map