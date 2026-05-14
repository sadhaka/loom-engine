import { EntityAllocator, type EntityId } from './entity.js';
import { ResourceRegistry } from './resources.js';
import { type System, type SystemPhase } from './system.js';
import { StateSnapshot } from './runtime/state-snapshot.js';
export declare class World {
    readonly entities: EntityAllocator;
    readonly resources: ResourceRegistry;
    private pools;
    private systemsByPhase;
    constructor();
    registerPool<T>(key: string, pool: T): void;
    getPool<T>(key: string): T | undefined;
    requirePool<T>(key: string): T;
    addSystem(system: System, phase?: SystemPhase): void;
    update(dt: number): void;
    countEntities(): number;
    countSystems(): number;
    countSystemsInPhase(phase: SystemPhase): number;
    createEntity(): EntityId;
    destroyEntity(e: EntityId): boolean;
    destroyEntityByLiveIndex(index: number): boolean;
    entityAt(index: number): EntityId;
    snapshotState(): StateSnapshot;
    dispose(): void;
}
export declare const POOL_TRANSFORM = "transform";
export declare const POOL_SPRITE = "sprite";
//# sourceMappingURL=world.d.ts.map