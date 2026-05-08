import { type EasingFn, type EasingName } from './tween.js';
export interface TweenChainStartOptions {
    onComplete?: () => void;
    loop?: boolean | number;
}
export declare class TweenChain {
    private steps;
    private active;
    private cancelled;
    private completed;
    private cursor;
    private elapsedInStep;
    private remainingLoops;
    private loopForever;
    private onComplete;
    private constructor();
    static create(): TweenChain;
    to(from: number, to: number, durationSeconds: number, onUpdate: (value: number) => void, easing?: EasingFn | EasingName): TweenChain;
    delay(durationSeconds: number): TweenChain;
    call(fn: () => void): TweenChain;
    start(opts?: TweenChainStartOptions): TweenChain;
    cancel(): void;
    isActive(): boolean;
    hasCompleted(): boolean;
    totalDuration(): number;
    stepCount(): number;
    update(dtSeconds: number): void;
    private finish;
}
export declare const RESOURCE_TWEEN_CHAIN = "tween_chain";
//# sourceMappingURL=tween-chain.d.ts.map