export interface CachedPathPoint {
    x: number;
    y: number;
}
export interface CachedPathResult {
    path: CachedPathPoint[] | null;
    cost: number;
    nodesExpanded: number;
}
export interface CacheEntry {
    result: CachedPathResult;
    insertedAtMs: number;
    ageMs: number;
    hitCount: number;
}
export interface PathfindingCacheOptions {
    capacity?: number;
    ttlMs?: number;
    gridVersion?: number;
}
export declare class PathfindingCache {
    private entries;
    private capacity;
    private ttlMs;
    private gridVersion;
    private elapsedMs;
    private accessTick;
    private hitCount;
    private missCount;
    private disposed;
    private constructor();
    static create(opts?: PathfindingCacheOptions): PathfindingCache;
    get(startX: number, startY: number, goalX: number, goalY: number): CachedPathResult | undefined;
    set(startX: number, startY: number, goalX: number, goalY: number, result: CachedPathResult): void;
    getOrCompute(startX: number, startY: number, goalX: number, goalY: number, computeFn: () => CachedPathResult): CachedPathResult | null;
    bumpGridVersion(): number;
    invalidateAll(): number;
    invalidateAt(x: number, y: number): number;
    invalidateBySource(x: number, y: number): number;
    invalidateByGoal(x: number, y: number): number;
    size(): number;
    hits(): number;
    misses(): number;
    hitRate(): number;
    getGridVersion(): number;
    resetStats(): void;
    tick(dtMs: number): void;
    dispose(): void;
    private evictLRU;
}
export declare const RESOURCE_PATHFINDING_CACHE = "pathfinding_cache";
//# sourceMappingURL=pathfinding-cache.d.ts.map