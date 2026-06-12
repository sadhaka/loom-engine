import { EventChain } from './event-chain.js';
import type { ChainedRecord, ChainSeal } from './event-chain.js';
import type { WorldState } from './world-state-snapshot.js';
import type { EpochResolvedEvent, Ruleset, ProposalMap } from './world-epoch.js';
export interface WorldBundle {
    worldId: string;
    snapshot: {
        eventIndex: number;
        stateHash: string;
        state: WorldState;
    };
    chainTail: ChainedRecord<EpochResolvedEvent>[];
    tailGenesis: string;
    seal: ChainSeal;
    binding: string;
}
export declare function replayEpochEvent(state: WorldState, event: EpochResolvedEvent): WorldState;
export interface SuspendInput {
    key: string | Uint8Array;
    worldId: string;
    snapshotState: WorldState;
    snapshotEventIndex: number;
    chain: EventChain<EpochResolvedEvent>;
}
export declare function suspend(input: SuspendInput): WorldBundle;
export interface ResumeInput {
    key: string | Uint8Array;
    bundle: WorldBundle;
    currentEpoch: number;
    ruleset: Ruleset;
    proposalsByEpoch?: Record<string, ProposalMap> | undefined;
    maxCatchup: number;
    actorTags?: string[] | undefined;
    maxActions?: number | undefined;
    expectedWorldId?: string | undefined;
}
export interface ResumeResult {
    worldId: string;
    state: WorldState;
    newEvents: EpochResolvedEvent[];
    epochsResolved: number;
    epochsVoided: number;
}
export declare function resume(input: ResumeInput): ResumeResult;
export declare var RESOURCE_WORLD_SESSION: string;
//# sourceMappingURL=world-session.d.ts.map