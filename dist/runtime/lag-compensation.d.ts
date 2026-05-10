export interface SnapshotEntry<TState = unknown> {
    tick: number;
    state: TState;
}
export interface InputEntry<TInput = unknown> {
    tick: number;
    input: TInput;
}
export interface RewindResult<TState = unknown, TInput = unknown> {
    snapshot: SnapshotEntry<TState>;
    inputs: InputEntry<TInput>[];
}
export interface LagCompensationOptions<TState = unknown> {
    historySize?: number;
    stateSerialize?: (s: TState) => TState;
}
export declare class LagCompensation<TState = unknown, TInput = unknown> {
    private snapshots;
    private inputs;
    private historySize;
    private serialize;
    private constructor();
    static create<TState = unknown, TInput = unknown>(opts?: LagCompensationOptions<TState>): LagCompensation<TState, TInput>;
    recordState(tick: number, state: TState): void;
    recordInput(tick: number, input: TInput): void;
    rewind(tick: number): RewindResult<TState, TInput> | null;
    resync(tick: number, authoritativeState: TState): InputEntry<TInput>[];
    snapshotCount(): number;
    inputCount(): number;
    oldestSnapshotTick(): number | null;
    newestSnapshotTick(): number | null;
    newestInputTick(): number | null;
    getHistorySize(): number;
    setHistorySize(n: number): void;
    clear(): void;
    private findSnapshotIndex;
    private findInputInsertIndex;
    private evictOldSnapshots;
    private evictOldInputs;
}
export declare const RESOURCE_LAG_COMPENSATION = "lag_compensation";
//# sourceMappingURL=lag-compensation.d.ts.map