import type { ResourceRegistry } from '../resources.js';
export declare const SNAPSHOT_SCHEMA_VERSION: number;
export interface IPersistableResource {
    persistKey?: string;
    serialize?(): unknown;
    deserialize?(data: unknown): void;
}
export interface WorldSnapshot {
    schemaVersion: number;
    engineVersion: string;
    capturedAtMs: number;
    resources: Record<string, unknown>;
}
export declare function serializeWorldSnapshot(registry: ResourceRegistry, engineVersion: string, nowFn?: () => number): WorldSnapshot;
export declare function deserializeWorldSnapshot(registry: ResourceRegistry, snapshot: WorldSnapshot): number;
export declare const RESOURCE_WORLD_SNAPSHOT = "loom.world_snapshot";
//# sourceMappingURL=world-snapshot.d.ts.map