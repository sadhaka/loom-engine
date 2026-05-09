export interface LetterboxState {
    current: number;
    target: number;
    topBarPct: number;
    bottomBarPct: number;
    isAnimating: boolean;
}
export interface CloseOptions {
    barPct?: number;
    fadeMs?: number;
}
export interface OpenOptions {
    fadeMs?: number;
}
export interface PulseOptions {
    barPct?: number;
    holdMs?: number;
    fadeMs?: number;
    onComplete?: () => void;
}
export interface CinematicLetterboxOptions {
    defaultBarPct?: number;
    defaultFadeMs?: number;
}
export declare class CinematicLetterbox {
    private currentVal;
    private targetVal;
    private fadeStartVolume;
    private fadeRemainingMs;
    private fadeTotalMs;
    private barPct;
    private defaultFadeMs;
    private pulse_;
    private disposed;
    private constructor();
    static create(opts?: CinematicLetterboxOptions): CinematicLetterbox;
    close(opts?: CloseOptions): void;
    open(opts?: OpenOptions): void;
    toggle(opts?: CloseOptions): void;
    setTarget(value: number, opts?: CloseOptions): void;
    pulse(opts?: PulseOptions): void;
    isOpen(): boolean;
    isClosed(): boolean;
    isAnimating(): boolean;
    getState(): LetterboxState;
    tick(dtMs: number): void;
    dispose(): void;
    private startFade;
    private advancePulse;
}
export declare const RESOURCE_CINEMATIC_LETTERBOX = "cinematic_letterbox";
//# sourceMappingURL=cinematic-letterbox.d.ts.map