import type { System } from '../system.js';
import type { World } from '../world.js';
import type { ZoneEvent, ZoneEventType } from '../director/zone/zone-event-envelope.js';
export interface PositionalPlayOptionsStub {
    x?: number;
    y?: number;
    z?: number;
    gain?: number;
    rate?: number;
    loop?: boolean;
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
    distanceModel?: 'linear' | 'inverse' | 'exponential';
}
export interface AudioListenerPoseStub {
    x: number;
    y: number;
    z?: number;
    forward?: {
        x: number;
        y: number;
        z: number;
    };
    up?: {
        x: number;
        y: number;
        z: number;
    };
}
export interface AudioListenerResourceStub {
    pose: AudioListenerPoseStub;
    lastUpdateFrame: number;
}
export interface CueCatalogStub {
    play(name: string, options?: PositionalPlayOptionsStub): unknown;
}
export interface MusicDirectorStub {
    playMusic(name: string, fadeInMs?: number): void;
    stopMusic(fadeOutMs?: number): Promise<void> | void;
    crossfadeMusic(name: string, fadeMs?: number): void;
    currentMusic(): string | null;
}
export declare const RESOURCE_AUDIO_LISTENER_STUB = "audio_listener";
export declare const RESOURCE_CUE_CATALOG_STUB = "cue_catalog";
export declare const RESOURCE_MUSIC_DIRECTOR_STUB = "music_director";
export interface ZoneCuePlay {
    cue: string;
    options?: PositionalPlayOptionsStub;
}
export interface ZoneAudioContext {
    cues: CueCatalogStub | null;
    music: MusicDirectorStub | null;
    localZone: string | null;
    listener: AudioListenerPoseStub;
}
export interface ZoneAudioMapping {
    eventType: ZoneEventType;
    handle(event: ZoneEvent, ctx: ZoneAudioContext): ZoneCuePlay | null;
}
export interface ZoneAudioSystemOptions {
    currentZone?: () => string | null;
    verbose?: boolean;
}
export declare class ZoneAudioSystem implements System {
    readonly name: string;
    private readonly mappings;
    private readonly currentZone;
    private readonly verbose;
    private readonly lastProcessedIdByZone;
    constructor(opts?: ZoneAudioSystemOptions);
    registerMapping(mapping: ZoneAudioMapping): void;
    unregisterMapping(eventType: ZoneEventType): void;
    hasMapping(eventType: ZoneEventType): boolean;
    mappingCount(): number;
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=zone-audio-system.d.ts.map