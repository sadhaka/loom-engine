export interface BiomeSpec<T = Record<string, unknown>> {
    id: string;
    minElev?: number;
    maxElev?: number;
    minMoist?: number;
    maxMoist?: number;
    data?: T;
}
export declare class BiomeMixer<T = Record<string, unknown>> {
    private biomes;
    private byId;
    private fallbackId;
    private constructor();
    static create<T = Record<string, unknown>>(): BiomeMixer<T>;
    defineBiome(spec: BiomeSpec<T>): boolean;
    removeBiome(id: string): boolean;
    setFallback(id: string | null): void;
    classify(elevation: number, moisture: number): string | null;
    classifyFull(elevation: number, moisture: number): {
        id: string;
        data?: T;
    } | null;
    list(): string[];
    count(): number;
    hasBiome(id: string): boolean;
    getFallback(): string | null;
    clear(): void;
}
export declare const RESOURCE_BIOME_MIXER = "biome_mixer";
//# sourceMappingURL=biome-mixer.d.ts.map