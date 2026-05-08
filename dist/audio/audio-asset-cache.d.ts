export declare class AudioAssetCache {
    private buffers;
    get(name: string): AudioBuffer | null;
    has(name: string): boolean;
    set(name: string, buffer: AudioBuffer): void;
    drop(name: string): void;
    clear(): void;
    list(): ReadonlyArray<string>;
}
export declare const RESOURCE_AUDIO_ASSET_CACHE = "audio_asset_cache";
export declare function createAudioAssetCache(): AudioAssetCache;
//# sourceMappingURL=audio-asset-cache.d.ts.map