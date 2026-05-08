import { ComponentSignature } from './component-signature.js';
export declare class QueryCache {
    private readonly signature;
    private readonly cache;
    private readonly maxEntries;
    private hits;
    private misses;
    constructor(signature: ComponentSignature, maxEntries?: number);
    query(mask: number): Int32Array;
    clear(): void;
    stats(): {
        hits: number;
        misses: number;
        entries: number;
    };
}
export declare const RESOURCE_QUERY_CACHE = "loom.query_cache";
//# sourceMappingURL=query-cache.d.ts.map