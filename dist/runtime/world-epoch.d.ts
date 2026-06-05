import { Pcg32 } from './pcg32.js';
import type { CheckNode, MutationNode } from './ruleset-ast.js';
import type { WorldState } from './world-state-snapshot.js';
export declare var DEFAULT_ACTOR_TAG: string;
export type WorldAction = {
    kind: 'check';
    check: CheckNode;
} | {
    kind: 'mutations';
    mutations: MutationNode[];
};
export type Ruleset = Record<string, WorldAction>;
export interface WorldActionProposal {
    actionId: string;
    targetId?: string;
}
export type ProposalMap = Record<string, WorldActionProposal>;
export interface SerializedMutation {
    op: string;
    target: string;
    property?: string;
    tag?: string;
    previous?: number;
    next?: number;
}
export type EpochActionEntry = {
    action_id: string;
    actor_id: string;
    degree: string;
    mutations_applied: SerializedMutation[];
} | {
    action_id: string;
    actor_id: string;
    reason: string;
};
export interface EpochResolvedEvent {
    event_type: 'EpochResolved';
    epoch_number: number;
    actions_processed: EpochActionEntry[];
    pcg_steps_consumed: number;
}
export declare function deriveEpochPrng(worldId: string, epochNumber: number): Pcg32;
export interface TickEpochInput {
    worldId: string;
    state: WorldState;
    epochNumber: number;
    proposals: ProposalMap;
    ruleset: Ruleset;
    actorTags?: string[] | undefined;
    maxActions?: number | undefined;
}
export interface TickEpochResult {
    state: WorldState;
    event: EpochResolvedEvent;
    resolved: number;
    rejected: number;
}
export declare function tickEpoch(input: TickEpochInput): TickEpochResult;
export interface CatchUpInput {
    worldId: string;
    state: WorldState;
    currentEpoch: number;
    maxCatchup: number;
    ruleset: Ruleset;
    proposalsByEpoch?: Record<string, ProposalMap> | undefined;
    actorTags?: string[] | undefined;
    maxActions?: number | undefined;
}
export interface CatchUpResult {
    state: WorldState;
    events: EpochResolvedEvent[];
    epochsResolved: number;
    epochsVoided: number;
}
export declare function catchUpEpochs(input: CatchUpInput): CatchUpResult;
export declare var RESOURCE_WORLD_EPOCH: string;
//# sourceMappingURL=world-epoch.d.ts.map