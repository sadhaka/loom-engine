import { type EntityId } from '../entity.js';
import type { ColorRGBA } from '../util/color.js';
export declare const RANGED_FLAG_ACTIVE: number;
export declare const RANGED_FLAG_HOMING: number;
export interface RangedAttackConfig {
    target: EntityId;
    range: number;
    minRange: number;
    cooldownMs: number;
    damage: number;
    projectileSpeed: number;
    projectileLife: number;
    projectileSize: number;
    projectileColor: Readonly<ColorRGBA>;
    homing: boolean;
}
export declare class RangedAttackPool {
    range: Float32Array;
    minRange: Float32Array;
    cooldownMs: Float32Array;
    lastFireMs: Float32Array;
    damage: Float32Array;
    projectileSpeed: Float32Array;
    projectileLife: Float32Array;
    projectileSize: Float32Array;
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
    a: Float32Array;
    targetIndex: Int32Array;
    flags: Uint8Array;
    private capacity;
    private highWaterMark;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    attach(e: EntityId, cfg: RangedAttackConfig): void;
    detach(e: EntityId): void;
    setTarget(e: EntityId, target: EntityId): void;
    isActive(e: EntityId): boolean;
    getHighWaterMark(): number;
    getCapacity(): number;
}
export declare const POOL_RANGED = "ranged";
//# sourceMappingURL=ranged-attack.d.ts.map