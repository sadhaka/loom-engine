export declare var ADV_AGAINST_TARGET: string[];
export declare var DISADV_ON_ATTACKER: string[];
export declare var AUTO_FAIL_STR_DEX: string[];
export declare var INCAPACITATED_NO_REACTION: string[];
export interface AdvDetail {
    adv_from: string[];
    dis_from: string[];
    cancelled: boolean;
    prone_skipped: boolean;
}
export declare function coerceConditions(input: unknown): string[];
export declare function attackAdvantageMode(attackerConds: unknown, targetConds: unknown, isMelee: boolean | null): {
    mode: 'adv' | 'dis' | null;
    detail: AdvDetail;
};
export declare function conditionRollNote(mode: 'adv' | 'dis' | null, detail: AdvDetail, kept: number | null, pair: string | null): string;
export declare function autoFailSaveCondition(saveAbility: string, targetConds: unknown): string | null;
export declare function reactionDeniedByConditions(targetConds: unknown): string | null;
//# sourceMappingURL=srd5e-conditions.d.ts.map