export interface FloatingTextSpawn {
    x: number;
    y: number;
    text: string;
    vx?: number;
    vy?: number;
    ax?: number;
    ay?: number;
    lifetimeMs?: number;
    color?: number;
    scale?: number;
}
export interface FloatingTextRenderState {
    text: string;
    x: number;
    y: number;
    alpha: number;
    color: number;
    scale: number;
    ageMs: number;
    lifetimeMs: number;
}
export interface FloatingTextOptions {
    capacity?: number;
    defaultLifetimeMs?: number;
    defaultVx?: number;
    defaultVy?: number;
    defaultAx?: number;
    defaultAy?: number;
    defaultColor?: number;
    defaultScale?: number;
    fadeFractionEnd?: number;
    fadeFractionStart?: number;
}
export declare class FloatingText {
    private slots;
    private activeIndices;
    private nextSearch;
    private capacityNum;
    private defaults;
    private disposed;
    private constructor();
    static create(opts?: FloatingTextOptions): FloatingText;
    emit(spawn: FloatingTextSpawn): number;
    tick(dtMs: number): void;
    forEach(cb: (state: FloatingTextRenderState) => void): void;
    activeCount(): number;
    capacity(): number;
    clearAll(): void;
    dispose(): void;
    private findFreeSlot;
    private deactivate;
    private computeAlpha;
}
export declare const RESOURCE_FLOATING_TEXT = "floating_text";
//# sourceMappingURL=floating-text.d.ts.map