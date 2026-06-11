import type { WorldState } from './world-state-snapshot.js';
import { Pcg32 } from './pcg32.js';
export type ExprNode = {
    type: 'literal';
    value: number;
} | {
    type: 'dice';
    equation: string;
} | {
    type: 'prop_ref';
    target: string;
    property: string;
} | {
    type: 'math';
    op: 'add' | 'sub' | 'mul' | 'floor_div';
    left: ExprNode;
    right: ExprNode;
};
export type MutationNode = {
    type: 'set_prop' | 'add_prop' | 'sub_prop';
    target: string;
    property: string;
    value: ExprNode;
} | {
    type: 'add_tag' | 'remove_tag';
    target: string;
    tag: string;
} | {
    type: 'if';
    condition: DegreeCond;
    then: MutationNode[];
    else?: MutationNode[];
} | {
    type: 'foreach_target';
    select: {
        tag: string;
        limit?: number;
    };
    mutations: MutationNode[];
} | {
    type: 'repeat';
    count: number;
    mutations: MutationNode[];
};
export type CompareOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';
export type CompareOperand = {
    source: 'roll';
} | {
    source: 'dc';
} | {
    source: 'delta';
} | {
    source: 'natural';
} | {
    source: 'prop';
    target: string;
    property: string;
} | {
    source: 'literal';
    value: number;
};
export type DegreeCond = {
    type: 'delta_gte';
    value: number;
} | {
    type: 'delta_lte';
    value: number;
} | {
    type: 'nat_roll_eq';
    value: number;
} | {
    type: 'nat_roll_gte';
    value: number;
} | {
    type: 'nat_roll_lte';
    value: number;
} | {
    type: 'or';
    conditions: DegreeCond[];
} | {
    type: 'and';
    conditions: DegreeCond[];
} | {
    type: 'compare';
    op: CompareOp;
    left: CompareOperand;
    right: CompareOperand;
} | {
    type: 'has_tag';
    target: string;
    tag: string;
};
export interface DegreeBranch {
    condition: DegreeCond;
    mutations: MutationNode[];
}
export interface CheckNode {
    type: 'check';
    roll: ExprNode;
    dc: ExprNode;
    degrees: Record<string, DegreeBranch>;
}
export interface EvalContext {
    state: WorldState;
    actorId: string;
    targetId: string | undefined;
    rng: Pcg32;
    naturalRoll: number | null;
    eachId?: string | undefined;
}
export interface ActionResult {
    state: WorldState;
    degree: string;
    roll: number;
    natural: number | null;
    dc: number;
    delta: number;
    mutations: AppliedMutation[];
}
export interface AppliedMutation {
    target: string;
    property?: string;
    tag?: string;
    op: string;
    previous?: number;
    next?: number;
}
export interface ParsedDice {
    count: number;
    sides: number;
    mod: number;
}
export declare function parseDice(equation: string): ParsedDice;
export declare function evalExpression(node: ExprNode, ctx: EvalContext, depth?: number): number;
export declare function validateCheck(check: CheckNode): void;
export declare function validateTriggeredMutations(mutations: MutationNode[]): void;
export declare function applyTriggeredMutations(state: WorldState, mutations: MutationNode[], ctx: EvalContext): {
    state: WorldState;
    mutations: AppliedMutation[];
};
export declare function evaluateAction(state: WorldState, check: CheckNode, ctx: EvalContext): ActionResult;
export declare function makeContext(state: WorldState, actorId: string, seed: bigint, targetId?: string): EvalContext;
//# sourceMappingURL=ruleset-ast.d.ts.map