export declare const SNAPSHOT_DOMAIN = "loom.snapshot/1";
export interface WorldEntity {
    properties: Record<string, number>;
    tags: string[];
}
export interface WorldState {
    epoch: number;
    worldSeed: number;
    entities: Record<string, WorldEntity>;
    regions?: Record<string, unknown>;
    rulesetRef?: string;
}
export interface WorldStateSnapshot {
    eventIndex: number;
    stateHash: string;
}
export interface SnapshotInput {
    key: string | Uint8Array;
    state: unknown;
    eventIndex: number;
}
export declare function normalizeTags(tags: string[]): string[];
export declare function canonicalWorldState(state: unknown): string;
export declare function worldStateHash(key: string | Uint8Array, state: unknown): string;
export declare function snapshotWorldState(input: SnapshotInput): WorldStateSnapshot;
export declare function verifyWorldSnapshot(key: string | Uint8Array, state: unknown, expectedHash: string): boolean;
//# sourceMappingURL=world-state-snapshot.d.ts.map