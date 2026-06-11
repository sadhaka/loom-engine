export declare var CONCENTRATION_MIN_DC: number;
export interface ConcentrationState {
    spell_id: string;
    spell_name: string;
    slot_level?: number;
}
export interface ConcChange {
    concentration: ConcentrationState | null;
    dropped: ConcentrationState | null;
}
export interface MaintainResult {
    needed: boolean;
    dc: number;
    total: number;
    success: boolean;
    concentration: ConcentrationState | null;
    dropped: ConcentrationState | null;
}
export declare function maintainSaveDc(damage: number): number;
export declare function isConcentrating(c: ConcentrationState | null | undefined): boolean;
export declare function startConcentration(c: ConcentrationState | null, spellId: string, spellName?: string, slotLevel?: number): ConcChange;
export declare function dropConcentration(c: ConcentrationState | null): ConcChange;
export declare function maintainSave(c: ConcentrationState | null, damage: number, conSaveTotal: number): MaintainResult;
//# sourceMappingURL=srd5e-concentration.d.ts.map