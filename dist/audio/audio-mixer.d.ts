import type { AudioBus } from './audio-bus.js';
import { type EasingFn, type EasingName } from '../runtime/tween.js';
export interface FadeOptions {
    durationMs: number;
    easing?: EasingFn | EasingName;
    onComplete?: () => void;
}
export interface DuckOptions {
    scalar: number;
    attackMs: number;
    releaseMs: number;
    easing?: EasingFn | EasingName;
}
export interface MixerSnapshot {
    master: number;
    buses: Record<string, number>;
}
export interface AudioMixerOptions {
    bus: AudioBus;
}
export declare class AudioMixer {
    private bus;
    private busFades;
    private masterFade;
    private busTargets;
    private masterTarget;
    private snapshots;
    private ducks;
    private disposed;
    private constructor();
    static create(opts: AudioMixerOptions): AudioMixer;
    fadeBus(name: string, target: number, opts: FadeOptions): void;
    fadeMaster(target: number, opts: FadeOptions): void;
    crossfade(fromBus: string, toBus: string, toTarget: number, opts: FadeOptions): void;
    snapshot(key: string): void;
    hasSnapshot(key: string): boolean;
    restore(key: string, opts?: FadeOptions): void;
    clearSnapshot(key: string): void;
    pushDuck(key: string, busName: string, opts: DuckOptions): void;
    releaseDuck(key: string): void;
    hasDuck(key: string): boolean;
    isFading(name: string): boolean;
    isMasterFading(): boolean;
    getBusTarget(name: string): number;
    getMasterTarget(): number;
    tick(dtMs: number): void;
    dispose(): void;
    private getEffectiveBusTarget;
    private applyBus;
    private computeDuckMultiplier;
}
export declare const RESOURCE_AUDIO_MIXER = "audio_mixer";
//# sourceMappingURL=audio-mixer.d.ts.map