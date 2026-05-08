export type EntityId = number;
export declare const NULL_ENTITY: EntityId;
export declare function entityIndex(e: EntityId): number;
export declare function entityGeneration(e: EntityId): number;
export declare function makeEntity(index: number, generation: number): EntityId;
export declare class EntityAllocator {
    private generations;
    private freeList;
    private nextFresh;
    private liveCount;
    create(): EntityId;
    destroy(e: EntityId): boolean;
    isAlive(e: EntityId): boolean;
    count(): number;
    capacity(): number;
}
//# sourceMappingURL=entity.d.ts.map