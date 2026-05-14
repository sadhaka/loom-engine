// RangedAttackPool - per-entity ranged attack capability.
//
// Mob with this + Transform + (optional) Pursue fires projectiles
// at its target every cooldownMs when within range. The Pursue
// component handles closing the gap; ranged-only mobs may run
// without Pursue and stay rooted (e.g. summoners). RangedAttackSystem
// reads this each tick.
import { entityIndex, NULL_ENTITY } from '../entity.js';
import { growF32, growU8, nextPow2, tightenHighWaterMark } from '../util/typed-arrays.js';
export const RANGED_FLAG_ACTIVE = 1 << 0;
export const RANGED_FLAG_HOMING = 1 << 1;
export class RangedAttackPool {
    // Hot
    range;
    minRange;
    cooldownMs;
    lastFireMs;
    damage;
    projectileSpeed;
    projectileLife;
    projectileSize;
    // Color rgba split.
    r;
    g;
    b;
    a;
    // Full EntityId of target. NULL_ENTITY = no target.
    targetEntity;
    flags;
    capacity = 0;
    highWaterMark = 0;
    constructor(initialCapacity = 32) {
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
        this.targetEntity = new Uint32Array(this.capacity);
        this.flags = new Uint8Array(this.capacity);
    }
    ensureCapacity(neededIndex) {
        if (neededIndex < this.capacity)
            return;
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
        const newTarget = new Uint32Array(next);
        newTarget.set(this.targetEntity);
        this.targetEntity = newTarget;
        this.flags = growU8(this.flags, next);
        this.capacity = next;
    }
    attach(e, cfg) {
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
        this.targetEntity[i] = cfg.target;
        let f = RANGED_FLAG_ACTIVE;
        if (cfg.homing)
            f |= RANGED_FLAG_HOMING;
        this.flags[i] = f;
        if (i >= this.highWaterMark)
            this.highWaterMark = i + 1;
    }
    detach(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.flags[i] = 0;
        this.targetEntity[i] = NULL_ENTITY;
    }
    setTarget(e, target) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return;
        this.targetEntity[i] = target;
    }
    isActive(e) {
        const i = entityIndex(e);
        if (i >= this.capacity)
            return false;
        return ((this.flags[i] ?? 0) & RANGED_FLAG_ACTIVE) !== 0;
    }
    getHighWaterMark() { return this.highWaterMark; }
    getCapacity() { return this.capacity; }
    // Lower highWaterMark past trailing detached slots. RangedAttack-
    // System and detach both zero the flags byte, so a zero flags byte
    // marks a slot that no longer fires.
    tighten() {
        this.highWaterMark = tightenHighWaterMark(this.flags, this.highWaterMark);
    }
    // --- ISnapshotable: canonical SoA columns [0, highWaterMark). ---
    snapshotKey = 'loom.ranged-attack-pool';
    snapshotInto(w) {
        const n = this.highWaterMark;
        w.writeU32(n);
        w.writeF32Slice(this.range, n);
        w.writeF32Slice(this.minRange, n);
        w.writeF32Slice(this.cooldownMs, n);
        w.writeF32Slice(this.lastFireMs, n);
        w.writeF32Slice(this.damage, n);
        w.writeF32Slice(this.projectileSpeed, n);
        w.writeF32Slice(this.projectileLife, n);
        w.writeF32Slice(this.projectileSize, n);
        w.writeF32Slice(this.r, n);
        w.writeF32Slice(this.g, n);
        w.writeF32Slice(this.b, n);
        w.writeF32Slice(this.a, n);
        w.writeU32Slice(this.targetEntity, n);
        w.writeU8Slice(this.flags, n);
    }
    restoreFrom(r) {
        const n = r.readU32();
        this.range = r.readF32Slice();
        this.minRange = r.readF32Slice();
        this.cooldownMs = r.readF32Slice();
        this.lastFireMs = r.readF32Slice();
        this.damage = r.readF32Slice();
        this.projectileSpeed = r.readF32Slice();
        this.projectileLife = r.readF32Slice();
        this.projectileSize = r.readF32Slice();
        this.r = r.readF32Slice();
        this.g = r.readF32Slice();
        this.b = r.readF32Slice();
        this.a = r.readF32Slice();
        this.targetEntity = r.readU32Slice();
        this.flags = r.readU8Slice();
        this.capacity = n;
        this.highWaterMark = n;
    }
}
export const POOL_RANGED = 'ranged';
//# sourceMappingURL=ranged-attack.js.map