export interface AABBLite {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export interface QuadtreeBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface QuadtreeOptions {
    bounds: QuadtreeBounds;
    maxItemsPerNode?: number;
    maxDepth?: number;
}
export declare class Quadtree {
    private root;
    private byId;
    private maxItems;
    private maxDepth;
    private disposed;
    private constructor();
    static create(opts: QuadtreeOptions): Quadtree;
    insert(id: string, aabb: AABBLite): boolean;
    remove(id: string): boolean;
    update(id: string, aabb: AABBLite): boolean;
    has(id: string): boolean;
    size(): number;
    query(aabb: AABBLite): string[];
    queryPoint(x: number, y: number): string[];
    queryRadius(cx: number, cy: number, radius: number): string[];
    clear(): void;
    rebuild(): void;
    dispose(): void;
}
export declare const RESOURCE_QUADTREE = "quadtree";
//# sourceMappingURL=quadtree.d.ts.map