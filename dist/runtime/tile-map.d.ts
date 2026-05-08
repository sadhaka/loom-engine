export interface TileMapOptions {
    width: number;
    height: number;
    defaultTile?: number;
    data?: Uint16Array | ReadonlyArray<number>;
}
export interface TileMapSnapshot {
    width: number;
    height: number;
    data: string;
}
export declare class TileMap {
    private widthN;
    private heightN;
    private tiles;
    private constructor();
    static create(opts: TileMapOptions): TileMap;
    width(): number;
    height(): number;
    cellCount(): number;
    inBounds(x: number, y: number): boolean;
    get(x: number, y: number): number;
    set(x: number, y: number, tile: number): void;
    fill(tile: number): void;
    fillRect(x: number, y: number, w: number, h: number, tile: number): void;
    replaceAll(from: number, to: number): number;
    floodFill(sx: number, sy: number, replacement: number): number;
    forEach(cb: (x: number, y: number, tile: number) => void): void;
    findAll(predicate: (tile: number) => boolean): Array<{
        x: number;
        y: number;
        tile: number;
    }>;
    toSnapshot(): TileMapSnapshot;
    static fromSnapshot(snap: TileMapSnapshot): TileMap | null;
    raw(): Uint16Array;
}
export declare const RESOURCE_TILE_MAP = "tile_map";
//# sourceMappingURL=tile-map.d.ts.map