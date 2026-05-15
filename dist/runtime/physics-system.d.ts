import type { SpatialGrid } from './spatial-grid.js';
export type ColliderHandle = number;
export declare function makeColliderHandle(slot: number, generation: number): ColliderHandle;
export declare function colliderSlot(handle: ColliderHandle): number;
export declare function colliderGeneration(handle: ColliderHandle): number;
export interface PhysicsStepStats {
    contacts: number;
    resolved: number;
}
export declare class PhysicsSystem {
    readonly capacity: number;
    readonly maxContacts: number;
    private readonly posX;
    private readonly posY;
    private readonly halfW;
    private readonly halfH;
    private readonly velX;
    private readonly velY;
    private readonly flags;
    private readonly generation;
    private readonly contactA;
    private readonly contactB;
    private contactCount;
    private readonly scratch;
    private activeCount;
    private maxColliderExtent;
    private positionsDirty;
    private lastSyncGrid;
    private lastSyncEpoch;
    constructor(capacity: number, maxContacts: number);
    getActiveColliderCount(): number;
    getContactCount(): number;
    spawn(slot: number, x: number, y: number, halfW: number, halfH: number, vx?: number, vy?: number, isStatic?: boolean): ColliderHandle;
    recycle(handle: ColliderHandle): boolean;
    isAlive(handle: ColliderHandle): boolean;
    isStatic(handle: ColliderHandle): boolean;
    getX(handle: ColliderHandle): number;
    getY(handle: ColliderHandle): number;
    getHalfW(handle: ColliderHandle): number;
    getHalfH(handle: ColliderHandle): number;
    getVelX(handle: ColliderHandle): number;
    getVelY(handle: ColliderHandle): number;
    setPosition(handle: ColliderHandle, x: number, y: number): boolean;
    setVelocity(handle: ColliderHandle, vx: number, vy: number): boolean;
    integrate(dt: number): void;
    syncGrid(grid: SpatialGrid): void;
    detect(grid: SpatialGrid): number;
    resolve(iterations?: number): number;
    step(dt: number, grid: SpatialGrid, iterations?: number): PhysicsStepStats;
    getContactA(index: number): number;
    getContactB(index: number): number;
    clear(): void;
}
//# sourceMappingURL=physics-system.d.ts.map