export declare function regionHash(key: string | Uint8Array, regionState: unknown): string;
export declare function regionLeaves(key: string | Uint8Array, regions: Record<string, unknown>): Record<string, string>;
export declare function globalRegionHash(key: string | Uint8Array, regions: Record<string, unknown>): string;
export declare function verifyRegion(key: string | Uint8Array, regionState: unknown, expectedHash: string): boolean;
export declare var RESOURCE_REGION_HASH: string;
//# sourceMappingURL=region-hash.d.ts.map