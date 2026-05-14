import { type EntityId } from '../entity.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';
export declare const PURSUE_FLAG_ACTIVE: number;
export declare class PursuePool implements ISnapshotable {
    speed: Float32Array;
    stopDistance: Float32Array;
    targetEntity: Uint32Array;
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
    tighten(): void;
    readonly snapshotKey: string;
    snapshotInto(w: SnapshotWriter): void;
    restoreFrom(r: SnapshotReader): void;
}
export declare const POOL_PURSUE = "pursue";
//# sourceMappingURL=pursue.d.ts.map