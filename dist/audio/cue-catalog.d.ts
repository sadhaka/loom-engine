import type { AudioBus } from './audio-bus.js';
import type { AudioAssetCache } from './audio-asset-cache.js';
import type { PositionalPlayOptions, SpatialAudioBus, SpatialSourceHandle } from './spatial-audio-bus.js';
export type { PositionalPlayOptions, SpatialAudioBus, SpatialSourceHandle, };
export interface CueDefinition {
    asset: string;
    bus?: 'sfx' | 'music' | 'voice' | 'ui' | string;
    spatial?: boolean;
    defaults?: Partial<PositionalPlayOptions> & {
        gain?: number;
        rate?: number;
    };
    cooldownMs?: number;
}
export type CuePlayOptions = Partial<PositionalPlayOptions> & {
    gain?: number;
    rate?: number;
    x?: number;
    y?: number;
};
export interface CueCatalogOptions {
    now?: () => number;
}
export declare class CueCatalog {
    private audioBus;
    private spatialBus;
    private cache;
    private cues;
    private cooldowns;
    private liveHandles;
    private nowMs;
    private constructor();
    static create(audioBus: AudioBus, spatialBus: SpatialAudioBus, cache: AudioAssetCache, options?: CueCatalogOptions): CueCatalog;
    register(name: string, def: CueDefinition): void;
    unregister(name: string): void;
    has(name: string): boolean;
    list(): ReadonlyArray<string>;
    play(name: string, options?: CuePlayOptions): SpatialSourceHandle | null;
    stopAll(name: string): void;
    private markPlayed;
}
export declare const RESOURCE_CUE_CATALOG = "cue_catalog";
//# sourceMappingURL=cue-catalog.d.ts.map