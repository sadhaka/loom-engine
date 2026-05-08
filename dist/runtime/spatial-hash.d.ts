export declare class SpatialHash {
    private readonly cellSize;
    private readonly buckets;
    private readonly entityIndex;
    private inserts;
    private removes;
    private updates;
    private queries;
    constructor(cellSize?: number);
    private toCellX;
    private toCellY;
    insert(entity: number, x: number, y: number): void;
    remove(entity: number): boolean;
    update(entity: number, x: number, y: number): void;
    queryRect(x0: number, y0: number, x1: number, y1: number): number[];
    queryRadius(cx: number, cy: number, radius: number): number[];
    size(): number;
    bucketCount(): number;
    clear(): void;
    stats(): {
        cellSize: number;
        entities: number;
        buckets: number;
        inserts: number;
        removes: number;
        updates: number;
        queries: number;
    };
}
export declare const RESOURCE_SPATIAL_HASH = "loom.spatial_hash";
//# sourceMappingURL=spatial-hash.d.ts.map