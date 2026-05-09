export interface NoiseFieldOptions {
    seed?: number | string;
    octaves?: number;
    persistence?: number;
    lacunarity?: number;
    scale?: number;
}
export declare class NoiseField {
    private seed;
    private octaves;
    private persistence;
    private lacunarity;
    private scale;
    private constructor();
    static create(opts?: NoiseFieldOptions): NoiseField;
    private value;
    sample(x: number, y: number): number;
    sample01(x: number, y: number): number;
    setSeed(seed: number | string): void;
    getSeed(): number;
    getOctaves(): number;
    getPersistence(): number;
    getLacunarity(): number;
    getScale(): number;
}
export declare const RESOURCE_NOISE_FIELD = "noise_field";
//# sourceMappingURL=noise-field.d.ts.map