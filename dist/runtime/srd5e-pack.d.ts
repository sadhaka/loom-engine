import type { CheckNode, MutationNode } from './ruleset-ast.js';
import type { SlotPool } from './srd5e-spell-slots.js';
export interface CantripDef {
    id: string;
    name: string;
    kind: 'spell_attack' | 'save';
    damage_dice: string;
    damaged_dice?: string;
    damage_type: string;
    save_ability?: string;
    beams?: boolean;
    no_scale?: boolean;
    rider_tag?: string;
    aoe_radius_ft?: number;
}
export declare var CANTRIPS: {
    [id: string]: CantripDef;
};
export declare var CLASS_CANTRIPS: {
    [classId: string]: string[];
};
export interface LeveledDef {
    id: string;
    name: string;
    kind: 'auto' | 'spell_attack' | 'save' | 'save_utility' | 'heal' | 'utility';
    base_level: number;
    base_dice?: string;
    damage_type?: string;
    save_ability?: string;
    half_on_save?: boolean;
    darts?: number;
    dart_bonus?: number;
    add_ability_to_damage?: boolean;
    applies_tag?: string;
    applies_duration_rounds?: number;
    cures?: string[];
    ritual?: boolean;
    area?: {
        shape: 'caster_burst' | 'target_cluster';
        default_max_targets: number;
    };
}
export declare var LEVELED_SPELLS: {
    [id: string]: LeveledDef;
};
export declare var CLASS_LEVELED_SPELLS: {
    [classId: string]: string[];
};
export declare function classCanCast(classId: string, spellId: string): boolean;
export declare function cantripDiceCount(level: number): number;
export declare function eldritchBlastBeams(level: number): number;
export declare function scaledCantripDice(dice: string, level: number): string;
export declare function buildWeaponAttackCheck(opts: {
    modProp: string;
    damageDice: string;
    addModToDamage: boolean;
}): CheckNode;
export declare function buildAttackCantripCheck(cantripId: string, casterLevel: number, opts?: {
    agonizing?: boolean;
}): CheckNode;
export declare function buildSaveCantripCheck(cantripId: string, casterLevel: number): CheckNode;
export declare function buildAttackSpellCheck(spellId: string, castSlotLevel: number): CheckNode;
export declare function buildSaveSpellCheck(spellId: string, castSlotLevel: number): CheckNode;
export declare function buildMultiTargetSaveTrigger(spellId: string, castSlotLevel: number, opts?: {
    selectTag?: string;
    maxTargets?: number;
}): MutationNode[];
export declare function buildMagicMissileTrigger(castSlotLevel: number): MutationNode[];
export declare function buildHealTrigger(spellId: string, castSlotLevel: number): MutationNode[];
export declare function buildConditionSpellCheck(spellId: string, castSlotLevel: number): CheckNode;
export interface CastPlan {
    ok: boolean;
    reason: 'ok' | 'no_slot' | 'not_known' | 'not_a_caster';
    slots: SlotPool;
    slot_level: number | null;
    concentration_spell: string | null;
    spell_name: string;
}
export declare function planLeveledCast(slots: SlotPool, spellId: string, classId: string, requestedSlotLevel?: number | null): CastPlan;
//# sourceMappingURL=srd5e-pack.d.ts.map