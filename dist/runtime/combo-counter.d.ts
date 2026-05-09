export interface ComboThreshold {
    count: number;
    callback: (count: number) => void;
    data?: Record<string, unknown>;
}
export interface ComboCounterOptions {
    timeoutMs?: number;
    thresholds?: ComboThreshold[];
    onChain?: (count: number) => void;
    onReset?: (peakCount: number) => void;
}
export declare class ComboCounter {
    private count;
    private peak;
    private remainingMs;
    private timeoutMs;
    private thresholds;
    private onChain;
    private onReset;
    private disposed;
    private constructor();
    static create(opts?: ComboCounterOptions): ComboCounter;
    hit(): number;
    reset(): void;
    tick(dtMs: number): void;
    getCount(): number;
    getPeak(): number;
    getRemainingMs(): number;
    isActive(): boolean;
    setTimeoutMs(ms: number): void;
    addThreshold(t: ComboThreshold): boolean;
    removeThreshold(count: number): boolean;
    dispose(): void;
    private fireResetIfActive;
}
export declare const RESOURCE_COMBO_COUNTER = "combo_counter";
//# sourceMappingURL=combo-counter.d.ts.map