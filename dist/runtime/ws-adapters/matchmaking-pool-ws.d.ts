import { MatchmakingPool } from '../matchmaking-pool.js';
import type { Match, MatchmakingOptions } from '../matchmaking-pool.js';
export interface MatchmakingWsAdapterOptions<T = Record<string, unknown>> {
    pool?: MatchmakingPool<T>;
    poolOptions?: MatchmakingOptions;
    onMatch?: (matches: Match<T>[]) => void;
    onError?: (err: Error, raw: string) => void;
    tickIntervalMs?: number;
    nowFn: () => number;
}
export interface MatchmakingWsHandle<T = Record<string, unknown>> {
    pool: MatchmakingPool<T>;
    ingest(raw: string): string;
    tick(now?: number): Match<T>[];
    stop(): void;
}
export declare function attachMatchmakingPoolToWs<T = Record<string, unknown>>(opts: MatchmakingWsAdapterOptions<T>): MatchmakingWsHandle<T>;
//# sourceMappingURL=matchmaking-pool-ws.d.ts.map