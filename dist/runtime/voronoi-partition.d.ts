export type DistanceFn = 'euclidean' | 'manhattan' | 'chebyshev';
export interface VoronoiSite {
    id: number;
    x: number;
    y: number;
}
export interface VoronoiOptions {
    seed?: number | string;
    width: number;
    height: number;
    count: number;
    distance?: DistanceFn;
    sites?: ReadonlyArray<{
        x: number;
        y: number;
    }>;
}
export declare class VoronoiPartition {
    private width;
    private height;
    private siteList;
    private distance;
    private constructor();
    static create(opts: VoronoiOptions): VoronoiPartition;
    nearestSite(x: number, y: number): number;
    twoNearest(x: number, y: number): {
        firstId: number;
        secondId: number;
        firstDist: number;
        secondDist: number;
    };
    onBoundary(x: number, y: number, epsilon: number): boolean;
    sites(): ReadonlyArray<VoronoiSite>;
    count(): number;
    getWidth(): number;
    getHeight(): number;
    getDistance(): DistanceFn;
    private dist;
}
export declare const RESOURCE_VORONOI_PARTITION = "voronoi_partition";
//# sourceMappingURL=voronoi-partition.d.ts.map