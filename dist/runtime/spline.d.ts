export interface Vec2Like {
    x: number;
    y: number;
}
export interface SplineOptions {
    tension?: number;
    closed?: boolean;
}
export declare function linearPath(points: ReadonlyArray<Vec2Like>, t: number): Vec2Like;
export declare function catmullRomPath(points: ReadonlyArray<Vec2Like>, t: number, opts?: SplineOptions): Vec2Like;
export interface HermiteKey {
    p: Vec2Like;
    m: Vec2Like;
}
export declare function hermitePath(keys: ReadonlyArray<HermiteKey>, t: number): Vec2Like;
export declare const RESOURCE_SPLINE = "spline";
//# sourceMappingURL=spline.d.ts.map