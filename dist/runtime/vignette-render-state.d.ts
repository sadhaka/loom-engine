export interface VignetteColor {
    r: number;
    g: number;
    b: number;
}
export interface VignetteSourceSpec {
    id: string;
    color: VignetteColor;
    intensity: number;
    pulseHz?: number;
    pulseAmp?: number;
    data?: Record<string, unknown>;
}
export interface VignetteSource {
    id: string;
    color: VignetteColor;
    intensity: number;
    pulseHz: number;
    pulseAmp: number;
    pulsePhase: number;
    effectiveIntensity: number;
    data?: Record<string, unknown>;
}
export interface VignetteSnapshot {
    active: boolean;
    color: VignetteColor;
    alpha: number;
    dominantId: string;
}
export interface VignetteRenderStateOptions {
    capacity?: number;
    minIntensity?: number;
}
export declare class VignetteRenderState {
    private sources;
    private capacityNum;
    private minIntensity;
    private disposed;
    private constructor();
    static create(opts?: VignetteRenderStateOptions): VignetteRenderState;
    upsert(spec: VignetteSourceSpec): boolean;
    remove(id: string): boolean;
    setIntensity(id: string, value: number): boolean;
    has(id: string): boolean;
    count(): number;
    capacity(): number;
    tick(dtMs: number): void;
    getState(): VignetteSnapshot;
    forEach(cb: (s: VignetteSource) => void): void;
    list(): VignetteSource[];
    clear(): void;
    dispose(): void;
    private indexOf;
    private recomputeEffective;
    private snapshot;
}
export declare const RESOURCE_VIGNETTE_RENDER_STATE = "vignette_render_state";
//# sourceMappingURL=vignette-render-state.d.ts.map