export interface CognitiveMapOptions {
    stateSize: number;
    taskCount: number;
    methodCount: number;
    totalMethodSubtasks: number;
    totalMethodPreconds: number;
    totalPrimPreconds: number;
    totalPrimEffects: number;
    maxStackDepth: number;
    maxDecisionDepth: number;
    maxUndoLog: number;
    maxPlanLength: number;
    maxQueuedGoals?: number;
}
export interface DomainSpec {
    slot: number;
    value: number;
}
export interface PrimitiveDefinition {
    preconds?: ReadonlyArray<DomainSpec>;
    effects?: ReadonlyArray<DomainSpec>;
}
export interface MethodDefinition {
    taskId: number;
    subtasks: ReadonlyArray<number>;
    preconds?: ReadonlyArray<DomainSpec>;
}
export type PlanFailureReason = 'no_plan' | 'over_budget';
export type PlanResult = {
    ok: true;
    planGen: number;
    planLength: number;
} | {
    ok: false;
    planGen: number;
    reason: PlanFailureReason;
    failedTaskId: number;
    depth: number;
};
export declare class CognitiveMap {
    readonly stateSize: number;
    readonly taskCount: number;
    readonly methodCount: number;
    readonly maxStackDepth: number;
    readonly maxDecisionDepth: number;
    readonly maxUndoLog: number;
    readonly maxPlanLength: number;
    readonly maxQueuedGoals: number;
    private readonly taskKind;
    private readonly primPrecondStart;
    private readonly primPrecondCount;
    private readonly primEffectStart;
    private readonly primEffectCount;
    private readonly primPrecondSlots;
    private readonly primPrecondValues;
    private readonly primEffectSlots;
    private readonly primEffectValues;
    private primPrecondLen;
    private primEffectLen;
    private readonly methodTask;
    private readonly methodSubtaskStart;
    private readonly methodSubtaskCount;
    private readonly methodPrecondStart;
    private readonly methodPrecondCount;
    private readonly methodSubtaskList;
    private readonly methodPrecondSlots;
    private readonly methodPrecondValues;
    private methodSubtaskLen;
    private methodPrecondLen;
    private definedMethods;
    private readonly taskMethodStart;
    private readonly taskMethodCount;
    private readonly methodIndex;
    private finalized;
    private readonly state;
    private readonly stack;
    private stackTop;
    private readonly decision;
    private decisionTop;
    private readonly undoLog;
    private undoTop;
    private readonly plan;
    private planLen;
    private _planGen;
    private _failedTaskId;
    private _failedDepth;
    private readonly goalQueue;
    private goalQueueCount;
    constructor(opts: CognitiveMapOptions);
    definePrimitive(taskId: number, def: PrimitiveDefinition): void;
    defineMethod(def: MethodDefinition): void;
    finalize(): void;
    setState(slot: number, value: number): void;
    getState(slot: number): number;
    findPlan(goalId: number, stepBudget: number): PlanResult;
    planLength(): number;
    planStep(index: number): number;
    planGen(): number;
    failedTaskId(): number;
    failedDepth(): number;
    enqueueGoal(goalTaskId: number, priority: number): boolean;
    queuedGoalCount(): number;
    runScheduler(stepBudget: number): PlanResult | null;
    clear(): void;
    private tryApplyPrimitive;
    private tryFirstMethod;
    private tryMethod;
    private pushTask;
    private backtrack;
    private rollbackTo;
    private rollbackAll;
    private checkPreconds;
    private failureResult;
    private requireMutable;
    private requireFinalized;
    private requireTask;
    private requireSlot;
    private requireValue;
}
//# sourceMappingURL=cognitive-map.d.ts.map