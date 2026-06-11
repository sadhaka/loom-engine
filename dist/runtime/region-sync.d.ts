import type { WorldState } from './world-state-snapshot.js';
export declare var DEFAULT_REGION_TAG_PREFIX: string;
export declare function partitionRegions(state: WorldState, prefix?: string): Record<string, WorldState>;
export interface RegionLeafDiff {
    changed: string[];
    added: string[];
    removed: string[];
}
export declare function diffRegionLeaves(cachedLeaves: Record<string, string>, serverLeaves: Record<string, string>): RegionLeafDiff;
export interface PartialSyncInput {
    key: string | Uint8Array;
    cachedRegions: Record<string, unknown>;
    pulledRegions: Record<string, unknown>;
    serverLeaves: Record<string, string>;
    serverRoot: string;
}
export interface PartialSyncResult {
    regions: Record<string, unknown>;
    root: string;
    pulled: string[];
    kept: string[];
}
export declare function applyPartialSync(input: PartialSyncInput): PartialSyncResult;
export declare var RESOURCE_REGION_SYNC: string;
//# sourceMappingURL=region-sync.d.ts.map