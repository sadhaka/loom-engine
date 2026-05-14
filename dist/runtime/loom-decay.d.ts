import type { IEntropy } from './entropy.js';
export type MaterialHandle = number;
export declare function makeMaterialHandle(slot: number, generation: number): MaterialHandle;
export declare function materialSlot(handle: MaterialHandle): number;
export declare function materialGeneration(handle: MaterialHandle): number;
export interface TransitionRule {
    fromType: number;
    fatigueThreshold: number;
    toType: number;
    priority: number;
    recycle: boolean;
}
export interface DecayStats {
    decayed: number;
    transitioned: number;
}
export interface CommitStats {
    applied: number;
    rejected: number;
}
export declare class LoomDecay {
    readonly chunkCount: number;
    readonly chunkSize: number;
    readonly capacity: number;
    readonly ruleCount: number;
    private readonly matType;
    private readonly matFatigue;
    private readonly matFlags;
    private readonly matGeneration;
    private readonly ruleFromType;
    private readonly ruleThreshold;
    private readonly ruleToType;
    private readonly rulePriority;
    private readonly ruleRecycle;
    private readonly cmdSlot;
    private readonly cmdGeneration;
    private readonly cmdToType;
    private readonly cmdRecycle;
    private cmdCount;
    private readonly lastDecayTick;
    private readonly chunkEverDecayed;
    private activeCount;
    constructor(chunkCount: number, chunkSize: number, transitionRules: readonly TransitionRule[]);
    getCommandCount(): number;
    getActiveMaterialCount(): number;
    spawn(slot: number, type: number): MaterialHandle;
    isAlive(handle: MaterialHandle): boolean;
    getType(handle: MaterialHandle): number;
    getFatigue(handle: MaterialHandle): number;
    recycle(handle: MaterialHandle): boolean;
    applyDecay(chunkId: number, environmentalFactor: number, currentTick: number, entropy: IEntropy): DecayStats;
    commit(): CommitStats;
    clear(): void;
    private freeSlot;
    private findTransition;
    private emitCommand;
}
//# sourceMappingURL=loom-decay.d.ts.map