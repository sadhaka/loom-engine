export interface ObjectPoolOptions<T> {
    factory: () => T;
    reset?: (obj: T) => void;
    initialSize?: number;
    maxSize?: number;
}
export declare class ObjectPool<T> {
    private readonly factory;
    private readonly resetFn;
    private readonly maxSize;
    private free;
    private allocated;
    private acquireCount;
    private releaseCount;
    private capRejectCount;
    constructor(opts: ObjectPoolOptions<T>);
    acquire(): T | null;
    release(obj: T): void;
    freeCount(): number;
    inUseCount(): number;
    totalAllocated(): number;
    clear(): void;
    warm(count: number): number;
    stats(): {
        free: number;
        inUse: number;
        allocated: number;
        maxSize: number;
        acquires: number;
        releases: number;
        capRejects: number;
    };
}
//# sourceMappingURL=object-pool.d.ts.map