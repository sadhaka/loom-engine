import { type EntityId } from '../entity.js';
export declare const PURSUE_FLAG_ACTIVE: number;
export declare class PursuePool {
    speed: Float32Array;
    stopDistance: Float32Array;
    targetIndex: Int32Array;
    contactDamage: Float32Array;
    contactCooldownMs: Float32Array;
    lastHitMs: Float32Array;
    flags: Uint8Array;
    private capacity;
    private highWaterMark;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    attach(e: EntityId, target: EntityId, speed: number, stopDistance: number, contactDamage?: number, contactCooldownMs?: number): void;
    detach(e: EntityId): void;
    setTarget(e: EntityId, target: EntityId): void;
    isActive(e: EntityId): boolean;
    getHighWaterMark(): number;
    getCapacity(): number;
}
export declare const POOL_PURSUE = "pursue";
//# sourceMappingURL=pursue.d.ts.map