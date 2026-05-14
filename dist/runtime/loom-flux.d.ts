export declare class LoomFlux {
    readonly tierCount: number;
    readonly maxEntities: number;
    private readonly strides;
    private readonly lastProcessed;
    private hasTicked;
    private readonly buckets;
    private readonly bucketCount;
    private readonly entityTier;
    private readonly entitySlot;
    private readonly pendingTarget;
    private readonly pendingList;
    private pendingCount;
    constructor(tierStrides: readonly number[], maxEntities: number);
    tierStride(tier: number): number;
    getTierCount(tier: number): number;
    entityInTierAt(tier: number, index: number): number;
    entityTierOf(entityId: number): number;
    pendingMigrationCount(): number;
    assign(entityId: number, tier: number): void;
    requestMigration(entityId: number, toTier: number): void;
    tick(globalTick: number): number;
    clear(): void;
    private requireTier;
    private requireEntity;
    private appendToTier;
    private applyMigration;
}
//# sourceMappingURL=loom-flux.d.ts.map