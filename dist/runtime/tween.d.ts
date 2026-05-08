export type EasingFn = (t: number) => number;
export declare const Easings: {
    readonly linear: (t: number) => number;
    readonly easeInQuad: (t: number) => number;
    readonly easeOutQuad: (t: number) => number;
    readonly easeInOutQuad: (t: number) => number;
    readonly easeInCubic: (t: number) => number;
    readonly easeOutCubic: (t: number) => number;
    readonly easeInOutCubic: (t: number) => number;
    readonly easeInQuart: (t: number) => number;
    readonly easeOutQuart: (t: number) => number;
    readonly easeInOutQuart: (t: number) => number;
    readonly easeInSine: (t: number) => number;
    readonly easeOutSine: (t: number) => number;
    readonly easeInOutSine: (t: number) => number;
};
export type EasingName = keyof typeof Easings;
export interface TweenHandle {
    cancel(): void;
    isActive(): boolean;
}
export interface TweenOptions {
    easing?: EasingName | EasingFn;
    onComplete?: () => void;
}
export declare class Tween {
    private entries;
    private nextId;
    private completedCount;
    private cancelledCount;
    to(from: number, to: number, durationSeconds: number, onUpdate: (value: number) => void, options?: TweenOptions): TweenHandle;
    update(dtSeconds: number): void;
    activeCount(): number;
    cancelAll(): void;
    stats(): {
        active: number;
        completed: number;
        cancelled: number;
    };
}
export declare const RESOURCE_TWEEN = "loom.tween";
//# sourceMappingURL=tween.d.ts.map