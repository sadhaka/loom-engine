export interface ScreenShakeOptions {
    decayPerSecond?: number;
    maxOffsetPx?: number;
    maxAngleRad?: number;
    rng?: () => number;
}
export interface ShakeOffset {
    x: number;
    y: number;
    angle: number;
}
export declare class ScreenShake {
    private trauma;
    private decayPerSecond;
    private maxOffsetPx;
    private maxAngleRad;
    private rng;
    private disposed;
    private constructor();
    static create(opts?: ScreenShakeOptions): ScreenShake;
    addTrauma(amount: number): void;
    setTrauma(value: number): void;
    getTrauma(): number;
    getOffset(): ShakeOffset;
    tick(dtMs: number): void;
    isShaking(): boolean;
    setMaxOffset(px: number): void;
    setDecayPerSecond(rate: number): void;
    setMaxAngleRad(rad: number): void;
    reset(): void;
    dispose(): void;
}
export declare const RESOURCE_SCREEN_SHAKE = "screen_shake";
//# sourceMappingURL=screen-shake.d.ts.map