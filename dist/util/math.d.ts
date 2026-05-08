export interface Vec2 {
    x: number;
    y: number;
}
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function vec2(x: number, y: number): Vec2;
export declare function vec3(x: number, y: number, z: number): Vec3;
export declare function rect(x: number, y: number, width: number, height: number): Rect;
export declare function clamp(v: number, lo: number, hi: number): number;
export declare function lerp(a: number, b: number, t: number): number;
export declare function smoothstep(edge0: number, edge1: number, x: number): number;
export declare function approxEq(a: number, b: number, epsilon?: number): boolean;
export declare function rectContains(r: Rect, x: number, y: number): boolean;
export declare function rectIntersects(a: Rect, b: Rect): boolean;
export declare function visibleInView(worldRect: Rect, viewRect: Rect): boolean;
//# sourceMappingURL=math.d.ts.map