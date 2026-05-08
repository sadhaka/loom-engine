import type { AudioBus } from './audio-bus.js';
import type { AudioAssetCache } from './audio-asset-cache.js';
export declare class MusicDirector {
    private audioBus;
    private cache;
    private current;
    private constructor();
    static create(audioBus: AudioBus, cache: AudioAssetCache): MusicDirector;
    playMusic(name: string, fadeInMs?: number): void;
    stopMusic(fadeOutMs?: number): Promise<void>;
    crossfadeMusic(name: string, fadeMs?: number): void;
    currentMusic(): string | null;
    private startTrack;
    private fadeOutAndStop;
    private hardStop;
}
export declare const RESOURCE_MUSIC_DIRECTOR = "music_director";
//# sourceMappingURL=music-director.d.ts.map