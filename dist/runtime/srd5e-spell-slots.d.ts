export declare var MAX_SLOT_LEVEL: number;
export declare var PACT_KEY: string;
export interface SlotEntry {
    max: number;
    used: number;
}
export interface PactEntry {
    slot_level: number;
    max: number;
    used: number;
}
export type SlotPool = {
    [level: string]: SlotEntry;
} & {
    pact?: PactEntry;
};
export interface SpendResult {
    ok: boolean;
    reason: 'ok' | 'no_slot' | 'no_higher_slot' | 'bad_slot_level' | 'not_a_slot';
    slot_level: number | null;
    slots: SlotPool;
}
export interface UpcastInfo {
    spell_id: string;
    base_level: number;
    cast_level: number;
    levels_above: number;
    effect: 'damage' | 'heal' | 'utility';
    concentration: boolean;
    added_dice: string;
    extra_instances: number;
    note: string;
}
export declare function casterKind(classId: string): 'full' | 'half' | 'pact' | null;
export declare function isCaster(classId: string): boolean;
export declare function spellAbilityForClass(classId: string): 'int' | 'wis' | 'cha' | null;
export declare function sanitizeSlotPool(slots: SlotPool): SlotPool;
export declare function spellSlotsFor(classId: string, level: number): SlotPool;
export declare function highestSlotLevel(slots: SlotPool): number;
export declare function slotAvailable(slots: SlotPool, slotLevel: number): number;
export declare function spendSlot(slots: SlotPool, slotLevel: number): SpendResult;
export declare function spendLowestAvailable(slots: SlotPool, minLevel: number): SpendResult;
export declare function restoreSlot(slots: SlotPool, slotLevel: number, count?: number): SlotPool;
export declare function slotsRemaining(slots: SlotPool): {
    [level: number]: number;
};
export declare function longRest(classId: string, level: number): SlotPool;
export declare function shortRest(classId: string, level: number, slots: SlotPool): SlotPool;
export declare function widenSlots(stored: SlotPool | null | undefined, classId: string, level: number): SlotPool;
export declare function spellRequiresConcentration(spellId: string): boolean;
export declare function spellBaseLevel(spellId: string): number | null;
export declare function upcastEffect(spellId: string, castSlotLevel: number): UpcastInfo | null;
export declare function totalDiceForCast(baseDice: string, spellId: string, castSlotLevel: number): string;
//# sourceMappingURL=srd5e-spell-slots.d.ts.map