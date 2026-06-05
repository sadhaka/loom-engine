export type RulesetId = '5e' | 'pf2e';
export interface TurnBudget {
    ruleset: RulesetId;
    resources: {
        [resource: string]: number;
    };
}
export declare function startTurnBudget(ruleset: RulesetId): TurnBudget;
export declare function canSpend(budget: TurnBudget, resource: string, n?: number): boolean;
export declare function spend(budget: TurnBudget, resource: string, n?: number): boolean;
export interface InitiativeEntry {
    id: string;
    total: number;
    modifier?: number;
    d20?: number;
}
export declare function compareIds(a: string, b: string): number;
export declare function initiativeOrder(entries: ReadonlyArray<InitiativeEntry>): InitiativeEntry[];
export declare const DURATION_UNTIL_REMOVED = -1;
export interface ConditionTrack {
    conditions: Map<string, number>;
}
export declare function createConditionTrack(): ConditionTrack;
export declare function applyCondition(track: ConditionTrack, conditionId: string, rounds?: number): void;
export declare function removeCondition(track: ConditionTrack, conditionId: string): boolean;
export declare function hasCondition(track: ConditionTrack, conditionId: string): boolean;
export declare function conditionRemaining(track: ConditionTrack, conditionId: string): number;
export declare function tickConditions(track: ConditionTrack): string[];
export declare function activeConditions(track: ConditionTrack): string[];
export declare const RESOURCE_RULESET = "ruleset";
//# sourceMappingURL=ruleset.d.ts.map