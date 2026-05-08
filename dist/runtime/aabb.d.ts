export interface AABB {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export interface Vec2Pt {
    x: number;
    y: number;
}
export declare function aabb(minX: number, minY: number, maxX: number, maxY: number): AABB;
export declare function aabbFromRect(x: number, y: number, width: number, height: number): AABB;
export declare function aabbFromPoints(points: ReadonlyArray<Vec2Pt>): AABB;
export declare function aabbContainsPoint(box: AABB, px: number, py: number): boolean;
export declare function aabbContainsAabb(outer: AABB, inner: AABB): boolean;
export declare function aabbOverlaps(a: AABB, b: AABB): boolean;
export declare function aabbWidth(box: AABB): number;
export declare function aabbHeight(box: AABB): number;
export declare function aabbArea(box: AABB): number;
export declare function aabbCenter(box: AABB, out?: Vec2Pt): Vec2Pt;
export declare function aabbExpand(box: AABB, margin: number): AABB;
export declare function aabbTranslate(box: AABB, dx: number, dy: number): AABB;
export declare function aabbUnion(a: AABB, b: AABB): AABB;
export declare function aabbIntersection(a: AABB, b: AABB): AABB | null;
export declare function aabbRangeQuery(boxes: ReadonlyArray<AABB>, query: AABB, out?: number[]): number[];
export declare function aabbRaycastSegment(box: AABB, p0x: number, p0y: number, p1x: number, p1y: number): number | null;
export declare const RESOURCE_AABB = "aabb";
//# sourceMappingURL=aabb.d.ts.map