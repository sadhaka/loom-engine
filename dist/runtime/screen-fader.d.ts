export type FadeDirection = 'in' | 'out' | 'to';
export interface ScreenFaderFadeOptions {
    color?: number;
    durationMs?: number;
    targetAlpha?: number;
    easing?: (t: number) => number;
    data?: Record<string, unknown>;
}
export interface ScreenFaderOptions {
    initialColor?: number;
    initialAlpha?: number;
    onFadeComplete?: (opts: ScreenFaderFadeOptions) => void;
}
export declare class ScreenFader {
    private color;
    private alpha;
    private ramp;
    private onFadeComplete;
    private disposed;
    private constructor();
    static create(opts?: ScreenFaderOptions): ScreenFader;
    fadeTo(opts: ScreenFaderFadeOptions): void;
    fadeIn(opts?: Partial<ScreenFaderFadeOptions>): void;
    fadeOut(opts?: Partial<ScreenFaderFadeOptions>): void;
    tick(dtMs: number): void;
    clear(): void;
    fillOpaque(): void;
    getColor(): number;
    getAlpha(): number;
    isFading(): boolean;
    setColor(color: number): void;
    setAlpha(alpha: number): void;
    dispose(): void;
    private fireComplete;
}
export declare const RESOURCE_SCREEN_FADER = "screen_fader";
//# sourceMappingURL=screen-fader.d.ts.map