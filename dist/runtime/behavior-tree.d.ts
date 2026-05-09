export type BTStatus = 'success' | 'failure' | 'running';
export interface BTContext {
    blackboard: Record<string, unknown>;
    dtMs: number;
}
export type BTConditionFn = (ctx: BTContext) => boolean;
export type BTActionFn = (ctx: BTContext) => BTStatus;
interface BTNodeBase {
    name?: string;
}
export interface BTSequenceNode extends BTNodeBase {
    kind: 'sequence';
    children: BTNode[];
}
export interface BTSelectorNode extends BTNodeBase {
    kind: 'selector';
    children: BTNode[];
}
export interface BTParallelNode extends BTNodeBase {
    kind: 'parallel';
    children: BTNode[];
    successThreshold?: number;
    failureThreshold?: number;
}
export interface BTInverterNode extends BTNodeBase {
    kind: 'inverter';
    child: BTNode;
}
export interface BTRepeatNode extends BTNodeBase {
    kind: 'repeat';
    child: BTNode;
    count: number;
    stopOnFailure?: boolean;
}
export interface BTCooldownNode extends BTNodeBase {
    kind: 'cooldown';
    child: BTNode;
    cooldownMs: number;
    cooldownStatus?: BTStatus;
}
export interface BTConditionNode extends BTNodeBase {
    kind: 'condition';
    predicate: BTConditionFn;
}
export interface BTActionNode extends BTNodeBase {
    kind: 'action';
    run: BTActionFn;
}
export type BTNode = BTSequenceNode | BTSelectorNode | BTParallelNode | BTInverterNode | BTRepeatNode | BTCooldownNode | BTConditionNode | BTActionNode;
export interface BehaviorTreeOptions {
    root: BTNode;
    blackboard?: Record<string, unknown>;
    onStatus?: (status: BTStatus) => void;
}
export declare class BehaviorTree {
    private root;
    private blackboard;
    private states;
    private onStatus;
    private disposed;
    private constructor();
    static create(opts: BehaviorTreeOptions): BehaviorTree;
    tick(dtMs: number): BTStatus;
    reset(): void;
    setBlackboardEntry(key: string, value: unknown): void;
    getBlackboardEntry(key: string): unknown;
    getBlackboard(): Record<string, unknown>;
    dispose(): void;
    private run;
    private getState;
    private runSequence;
    private runSelector;
    private runParallel;
    private runInverter;
    private runRepeat;
    private runCooldown;
}
export declare const RESOURCE_BEHAVIOR_TREE = "behavior_tree";
export {};
//# sourceMappingURL=behavior-tree.d.ts.map