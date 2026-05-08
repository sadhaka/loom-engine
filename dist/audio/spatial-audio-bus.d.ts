import type { AudioBus } from './audio-bus.js';
export interface PositionalPlayOptions {
    x: number;
    y: number;
    z?: number;
    distanceModel?: 'linear' | 'inverse' | 'exponential';
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
    gain?: number;
    rate?: number;
    loop?: boolean;
}
export interface AudioListenerPose {
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
export interface SpatialSourceHandle {
    stop(): void;
    setPosition(x: number, y: number, z?: number): void;
    fadeOut(durationMs: number): Promise<void>;
    isPlaying(): boolean;
}
export declare const SPATIAL_BUS_NAME = "spatial";
export declare function spatialDistance(listener: {
    x: number;
    y: number;
    z?: number;
}, source: {
    x: number;
    y: number;
    z?: number;
}): number;
export declare class SpatialAudioBus {
    private readonly audioBus;
    private readonly ctx;
    private active;
    private lastPose;
    private constructor();
    static create(audioBus: AudioBus): SpatialAudioBus;
    getAudioBus(): AudioBus;
    getListenerPose(): AudioListenerPose;
    setListener(pose: AudioListenerPose): void;
    playPositional(buffer: AudioBuffer, options: PositionalPlayOptions): SpatialSourceHandle | null;
    playPositionalTone(freq: number, durationMs: number, options: PositionalPlayOptions & {
        type?: OscillatorType;
    }): SpatialSourceHandle | null;
    stopAll(): void;
    dispose(): void;
    private canPlay;
    private startSource;
    private applyPositionTo;
    private releaseSource;
}
//# sourceMappingURL=spatial-audio-bus.d.ts.map