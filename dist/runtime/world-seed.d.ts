import type { DungeonResult } from './dungeon-generator.js';
export interface WorldSeedOptions {
    seed: string | number;
    nameCorpus?: string[];
}
export interface GenerateWorldOptions {
    width: number;
    height: number;
    regionCount?: number;
    dungeonCount?: number;
    dungeonWidth?: number;
    dungeonHeight?: number;
    biomes?: BiomeSpecLike[];
    elevationScale?: number;
    moistureScale?: number;
    octaves?: number;
}
export interface BiomeSpecLike {
    id: string;
    minElev?: number;
    maxElev?: number;
    minMoist?: number;
    maxMoist?: number;
}
export interface WorldRegion {
    id: number;
    name: string;
    centerX: number;
    centerY: number;
}
export interface WorldDungeon {
    id: number;
    name: string;
    regionId: number;
    placement: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    layout: DungeonResult;
}
export interface WorldSeedSnapshot {
    seed: string;
    worldName: string;
    width: number;
    height: number;
    elevation: Float32Array;
    moisture: Float32Array;
    biomeId: Uint16Array;
    regionId: Uint16Array;
    biomeNames: string[];
    regions: WorldRegion[];
    dungeons: WorldDungeon[];
}
export declare class WorldSeed {
    private masterSeed;
    private corpus;
    private constructor();
    static create(opts: WorldSeedOptions): WorldSeed;
    generateWorld(opts: GenerateWorldOptions): WorldSeedSnapshot;
    getMasterSeed(): string;
    getCorpusSize(): number;
}
export declare const RESOURCE_WORLD_SEED = "world_seed";
//# sourceMappingURL=world-seed.d.ts.map