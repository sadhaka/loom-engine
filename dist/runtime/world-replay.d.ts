import type { WorldState } from './world-state-snapshot.js';
export type WorldEventReducer<E = unknown> = (state: WorldState, event: E, index: number) => WorldState;
export interface ReplayResult {
    headState: WorldState;
    headHash: string;
}
export declare function replayEvents<E>(base: WorldState, events: E[], reducer: WorldEventReducer<E>, startIndex?: number): WorldState;
export declare function replayFromSnapshot<E>(key: string | Uint8Array, snapshotState: WorldState, snapshotIndex: number, eventsAfter: E[], reducer: WorldEventReducer<E>): ReplayResult;
export declare function verifyReplayEquivalence<E>(key: string | Uint8Array, genesisState: WorldState, allEvents: E[], snapshotIndex: number, reducer: WorldEventReducer<E>): boolean;
//# sourceMappingURL=world-replay.d.ts.map