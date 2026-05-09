export interface LayerSpec {
    id: string;
    volume?: number;
    target?: number;
    defaultFadeMs?: number;
    data?: Record<string, unknown>;
}
export interface LayerSnapshot {
    id: string;
    volume: number;
    target: number;
    fadeRemainingMs: number;
    data?: Record<string, unknown>;
}
export interface SetTargetOptions {
    fadeMs?: number;
}
export interface AmbientLayerMixerOptions {
    volumeClamp?: (raw: number) => number;
}
export declare class AmbientLayerMixer {
    private layers;
    private volumeClamp;
    private disposed;
    private constructor();
    static create(opts?: AmbientLayerMixerOptions): AmbientLayerMixer;
    registerLayer(spec: LayerSpec): boolean;
    removeLayer(id: string): boolean;
    hasLayer(id: string): boolean;
    getLayer(id: string): LayerSnapshot | null;
    layerCount(): number;
    layerIds(): string[];
    setTarget(id: string, target: number, opts?: SetTargetOptions): boolean;
    setTargets(targets: Record<string, number>, opts?: SetTargetOptions): void;
    snap(id: string, volume: number): boolean;
    silenceAll(): void;
    tick(dtMs: number): void;
    forEach(cb: (l: LayerSnapshot) => void): void;
    list(): LayerSnapshot[];
    clear(): void;
    dispose(): void;
    private snapshot;
}
export declare const RESOURCE_AMBIENT_LAYER_MIXER = "ambient_layer_mixer";
//# sourceMappingURL=ambient-layer-mixer.d.ts.map