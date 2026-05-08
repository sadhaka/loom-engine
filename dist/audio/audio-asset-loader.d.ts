import type { AudioBus } from './audio-bus.js';
import type { AudioAssetCache } from './audio-asset-cache.js';
export interface AudioAssetManifest {
    [name: string]: string;
}
export declare class AudioAssetLoader {
    private audioBus;
    private cache;
    private inflight;
    private constructor();
    static create(audioBus: AudioBus, cache: AudioAssetCache): AudioAssetLoader;
    load(url: string, name?: string): Promise<AudioBuffer>;
    preload(manifest: AudioAssetManifest): Promise<void>;
    inflightCount(): number;
}
//# sourceMappingURL=audio-asset-loader.d.ts.map