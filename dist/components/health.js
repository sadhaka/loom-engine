// HealthPool - per-entity health state.
//
// Companion to Transform + Sprite. Entities with Health are subject
// to DamageSystem ticking, AttackSystem damage application, and emit
// death events when HP drops to or below zero.
//
// Layout: hot data (current HP, max HP, last-damage timestamp) in
// Float32Arrays; flags in Uint8Array.
import { entityIndex } from '../entity.js';
import { growF32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
export const HEALTH_FLAG_ACTIVE = 1 << 0;
export const HEALTH_FLAG_DEAD = 1 << 1;
// Entities marked invulnerable take 0 damage. Set / cleared by
// gameplay logic for i-frames after a hit, boss intro phases, etc.
export const HEALTH_FLAG_INVULNERABLE = 1 << 2;
export class HealthPool {
    // Hot data
    current;
    max;
    // Wall-clock ms timestamp of the last damage event. Useful for
    // i-frame logic and damage-number display fade.
    lastDamageMs;
    // Cold data
    flags;
    capacity = 0;
    highWaterMark = 0;
    constructor(initialCapacity = 64) {
        this.capacity = nextPow2(initialCapacity);
        this.current = new Float32Array(this.capacity);
        this.max = new Float32Array(this.capacity);
        this.lastDamageMs = new Float32Array(this.capacity);
        this.flags = new Uint8Array(this.capacity);
    }
    ensureCapacity(neededIndex) {
        if (neededIndex < this.capacity)
            return;
        const next = nextPow2(neededIndex + 1);
        this.current = growF32(this.current, next);
        this.max = growF32(this.max, next);
        this.lastDamageMs = growF32(this.lastDamageMs, next);
        this.flags = growU8(this.flags, next);
        this.capacity = next;
    }
    attach(e, maxHp) {
        const i = entityIndex(e);
        this.ensureCapacity(i);
        this.current[i] = maxHp;
        this.max[i] = maxHp;
        this.lastDamageMs[i] = -1;
        this.flags[i] = HEALTH_FLAG_ACTIVE;
        if (i >= this.highWaterMark)
            this.highWaterMark = i + 1;
    }
    detach(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.flags[i] = 0;
    }
    // Apply damage. Returns the actual amount applied (0 if invulnerable
    // or dead). Caller is responsible for spawning hit VFX, audio, etc.
    applyDamage(e, amount, nowMs) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return 0;
        const f = this.flags[i] ?? 0;
        if ((f & HEALTH_FLAG_ACTIVE) === 0)
            return 0;
        if ((f & HEALTH_FLAG_DEAD) !== 0)
            return 0;
        if ((f & HEALTH_FLAG_INVULNERABLE) !== 0)
            return 0;
        if (amount <= 0)
            return 0;
        const before = this.current[i] ?? 0;
        const after = Math.max(0, before - amount);
        this.current[i] = after;
        this.lastDamageMs[i] = nowMs;
        if (after <= 0) {
            this.flags[i] = (f | HEALTH_FLAG_DEAD);
        }
        return before - after;
    }
    // Heal. Caps at max. Returns amount actually healed (0 if dead /
    // already full). A dead entity stays dead even at heal > 0; a
    // resurrection requires explicit setHealth + clear of DEAD flag.
    heal(e, amount) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return 0;
        const f = this.flags[i] ?? 0;
        if ((f & HEALTH_FLAG_ACTIVE) === 0)
            return 0;
        if ((f & HEALTH_FLAG_DEAD) !== 0)
            return 0;
        if (amount <= 0)
            return 0;
        const before = this.current[i] ?? 0;
        const max = this.max[i] ?? 0;
        const after = Math.min(max, before + amount);
        this.current[i] = after;
        return after - before;
    }
    setInvulnerable(e, invulnerable) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        const f = this.flags[i] ?? 0;
        this.flags[i] = invulnerable ? f | HEALTH_FLAG_INVULNERABLE : f & ~HEALTH_FLAG_INVULNERABLE;
    }
    isAlive(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        const f = this.flags[i] ?? 0;
        return (f & HEALTH_FLAG_ACTIVE) !== 0 && (f & HEALTH_FLAG_DEAD) === 0;
    }
    isDead(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & HEALTH_FLAG_DEAD) !== 0;
    }
    isInvulnerable(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & HEALTH_FLAG_INVULNERABLE) !== 0;
    }
    getHp(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return 0;
        return this.current[i] ?? 0;
    }
    getMaxHp(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return 0;
        return this.max[i] ?? 0;
    }
    getHighWaterMark() {
        return this.highWaterMark;
    }
    getCapacity() {
        return this.capacity;
    }
    // Lower highWaterMark past trailing detached slots. HEALTH_FLAG_-
    // ACTIVE is set by attach and cleared only by detach, so a zero
    // flags byte marks a free slot.
    tighten() {
        this.highWaterMark = tightenHighWaterMark(this.flags, this.highWaterMark);
    }
    // --- ISnapshotable: canonical SoA columns [0, highWaterMark). ---
    snapshotKey = 'loom.health-pool';
    snapshotInto(w) {
        const n = this.highWaterMark;
        w.writeU32(n);
        w.writeF32Slice(this.current, n);
        w.writeF32Slice(this.max, n);
        w.writeF32Slice(this.lastDamageMs, n);
        w.writeU8Slice(this.flags, n);
    }
    restoreFrom(r) {
        const n = r.readU32();
        this.current = r.readF32Slice();
        this.max = r.readF32Slice();
        this.lastDamageMs = r.readF32Slice();
        this.flags = r.readU8Slice();
        this.capacity = n;
        this.highWaterMark = n;
    }
}
export const POOL_HEALTH = 'health';
//# sourceMappingURL=health.js.map