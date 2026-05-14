import type { ISnapshotable, SnapshotWriter, SnapshotReader } from './runtime/state-snapshot.js';
export type EntityId = number;
export declare const NULL_ENTITY: EntityId;
export declare function entityIndex(e: EntityId): number;
export declare function entityGeneration(e: EntityId): number;
export declare function makeEntity(index: number, generation: number): EntityId;
export declare class EntityAllocator implements ISnapshotable {
    private generations;
    private alive;
    private freeList;
    private nextFresh;
    private liveCount;
    create(): EntityId;
    destroy(e: EntityId): boolean;
    destroyByLiveIndex(index: number): boolean;
    isAlive(e: EntityId): boolean;
    entityAt(index: number): EntityId;
    count(): number;
    capacity(): number;
    tighten(): void;
    readonly snapshotKey: string;
    snapshotInto(w: SnapshotWriter): void;
    restoreFrom(r: SnapshotReader): void;
}
//# sourceMappingURL=entity.d.ts.map