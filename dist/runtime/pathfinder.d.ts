export type IsWalkableFn = (x: number, y: number) => boolean;
export type CellCostFn = (x: number, y: number) => number;
export type HeuristicFn = (dx: number, dy: number) => number;
export interface PathfinderOptions {
    allowDiagonal?: boolean;
    blockCornerCutting?: boolean;
    maxNodes?: number;
    cost?: CellCostFn;
    heuristic?: HeuristicFn;
}
export interface PathPoint {
    x: number;
    y: number;
}
export interface PathResult {
    path: PathPoint[];
    cost: number;
    nodesExpanded: number;
}
export declare function findPath(startX: number, startY: number, goalX: number, goalY: number, isWalkable: IsWalkableFn, opts?: PathfinderOptions): PathResult | null;
export declare const RESOURCE_PATHFINDER = "pathfinder";
//# sourceMappingURL=pathfinder.d.ts.map