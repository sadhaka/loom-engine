import { type EntityId } from '../entity.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';
export declare const HEALTH_FLAG_ACTIVE: number;
export declare const HEALTH_FLAG_DEAD: number;
export declare const HEALTH_FLAG_INVULNERABLE: number;
export declare class HealthPool implements ISnapshotable {
    current: Float32Array;
    max: Float32Array;
    lastDamageMs: Float32Array;
    flags: Uint8Array;
    private capacity;
    private highWaterMark;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    attach(e: EntityId, maxHp: number): void;
    detach(e: EntityId): void;
    applyDamage(e: EntityId, amount: number, nowMs: number): number;
    heal(e: EntityId, amount: number): number;
    setInvulnerable(e: EntityId, invulnerable: boolean): void;
    isAlive(e: EntityId): boolean;
    isDead(e: EntityId): boolean;
    isInvulnerable(e: EntityId): boolean;
    getHp(e: EntityId): number;
    getMaxHp(e: EntityId): number;
    getHighWaterMark(): number;
    getCapacity(): number;
    tighten(): void;
    readonly snapshotKey: string;
    snapshotInto(w: SnapshotWriter): void;
    restoreFrom(r: SnapshotReader): void;
}
export declare const POOL_HEALTH = "health";
//# sourceMappingURL=health.d.ts.map