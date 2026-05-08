export interface LRUCacheOptions<V> {
    capacity?: number;
    onEvict?: (key: string, value: V) => void;
}
export declare class LRUCache<V = unknown> {
    private map;
    private capacityNum;
    private onEvict;
    private hitCount;
    private missCount;
    private evictionCount;
    private disposed;
    private constructor();
    static create<V = unknown>(opts?: LRUCacheOptions<V>): LRUCache<V>;
    get(key: string): V | undefined;
    set(key: string, value: V): {
        key: string;
        value: V;
    } | undefined;
    peek(key: string): V | undefined;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    size(): number;
    capacity(): number;
    setCapacity(newCapacity: number): void;
    keys(): string[];
    values(): V[];
    stats(): {
        size: number;
        capacity: number;
        hits: number;
        misses: number;
        evictions: number;
    };
    dispose(): void;
}
export declare const RESOURCE_LRU_CACHE = "lru_cache";
//# sourceMappingURL=lru-cache.d.ts.map