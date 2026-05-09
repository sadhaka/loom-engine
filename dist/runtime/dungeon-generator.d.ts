export interface DungeonRoom {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface DungeonCorridor {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export interface DungeonResult {
    width: number;
    height: number;
    tiles: Uint8Array;
    rooms: DungeonRoom[];
    corridors: DungeonCorridor[];
}
export interface DungeonGeneratorOptions {
    seed?: number | string;
    width: number;
    height: number;
    minLeafSize?: number;
    minRoomSize?: number;
    maxRoomSize?: number;
    maxDepth?: number;
}
export declare class DungeonGenerator {
    private width;
    private height;
    private minLeafSize;
    private minRoomSize;
    private maxRoomSize;
    private maxDepth;
    private rng;
    private constructor();
    static create(opts: DungeonGeneratorOptions): DungeonGenerator;
    generate(): DungeonResult;
    private split;
    private placeRooms;
    private connect;
    private pickRoom;
    private carveRooms;
    private carveCorridors;
}
export declare const RESOURCE_DUNGEON_GENERATOR = "dungeon_generator";
//# sourceMappingURL=dungeon-generator.d.ts.map