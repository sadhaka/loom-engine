import type { ColorRGBA } from '../util/color.js';
export declare const PROJECTILE_FLAG_ALIVE: number;
export declare const PROJECTILE_FLAG_HOMING: number;
export declare const PROJECTILE_FLAG_PIERCE: number;
export interface ProjectileSpawn {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    damage: number;
    ownerIndex: number;
    targetIndex?: number;
    size: number;
    color: Readonly<ColorRGBA>;
    homing?: boolean;
    pierce?: boolean;
}
export declare class ProjectilePool {
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    vz: Float32Array;
    life: Float32Array;
    damage: Float32Array;
    ownerIndex: Int32Array;
    targetIndex: Int32Array;
    size: Float32Array;
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
    a: Float32Array;
    flags: Uint8Array;
    private capacity;
    private liveCount;
    private freeList;
    private highWaterMark;
    private maxProjectiles;
    constructor(initialCapacity?: number, maxProjectiles?: number);
    setMaxProjectiles(n: number): void;
    getMaxProjectiles(): number;
    getLiveCount(): number;
    getHighWaterMark(): number;
    getCapacity(): number;
    private ensureCapacity;
    spawn(p: ProjectileSpawn): number;
    kill(i: number): void;
    isAlive(i: number): boolean;
    clear(): void;
}
export declare const POOL_PROJECTILE = "projectile";
//# sourceMappingURL=projectile-pool.d.ts.map