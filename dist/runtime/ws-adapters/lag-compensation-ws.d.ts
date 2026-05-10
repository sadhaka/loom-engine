import { LagCompensation } from '../lag-compensation.js';
import type { LagCompensationOptions, RewindResult, InputEntry } from '../lag-compensation.js';
export interface LagCompensationWsAdapterOptions<TState = unknown, TInput = unknown> {
    lag?: LagCompensation<TState, TInput>;
    lagOptions?: LagCompensationOptions<TState>;
    onResync?: (tick: number, state: TState, surviving: InputEntry<TInput>[]) => void;
    onRewindRequest?: (tick: number, result: RewindResult<TState, TInput> | null) => void;
    onError?: (err: Error, raw: string) => void;
    nowFn: () => number;
}
export interface LagCompensationWsHandle<TState = unknown, TInput = unknown> {
    lag: LagCompensation<TState, TInput>;
    ingest(raw: string): string;
}
export declare function attachLagCompensationToWs<TState = unknown, TInput = unknown>(opts: LagCompensationWsAdapterOptions<TState, TInput>): LagCompensationWsHandle<TState, TInput>;
//# sourceMappingURL=lag-compensation-ws.d.ts.map