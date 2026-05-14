export declare class SpatialGrid {
    readonly cellSize: number;
    readonly gridWidth: number;
    readonly gridHeight: number;
    readonly numCells: number;
    readonly maxEntities: number;
    private readonly head;
    private readonly next;
    private _epoch;
    constructor(cellSize: number, gridWidth: number, gridHeight: number, maxEntities: number);
    get epoch(): number;
    cellIndexOf(x: number, y: number): number;
    clear(): void;
    insert(entityId: number, cellIdx: number): void;
    query(cellIdx: number, out: Int32Array): number;
    firstInCell(cellIdx: number): number;
    nextOf(entityId: number): number;
}
//# sourceMappingURL=spatial-grid.d.ts.map