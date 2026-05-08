export type DistanceModelName = 'linear' | 'inverse' | 'exponential';
export interface AttenuationOptions {
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
}
export declare function linearAttenuation(distance: number, opts?: AttenuationOptions): number;
export declare function inverseAttenuation(distance: number, opts?: AttenuationOptions): number;
export declare function exponentialAttenuation(distance: number, opts?: AttenuationOptions): number;
export declare function attenuationByModel(model: DistanceModelName, distance: number, opts?: AttenuationOptions): number;
export type AttenuationFn = (distance: number, opts?: AttenuationOptions) => number;
export declare class AttenuationRegistry {
    private curves;
    constructor();
    register(name: string, fn: AttenuationFn): void;
    unregister(name: string): boolean;
    has(name: string): boolean;
    evaluate(name: string, distance: number, opts?: AttenuationOptions): number;
    names(): string[];
}
export declare const RESOURCE_ATTENUATION_REGISTRY = "attenuation_registry";
//# sourceMappingURL=spatial-audio-curves.d.ts.map