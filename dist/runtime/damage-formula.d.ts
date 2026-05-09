export interface AttackerStats {
    attackPower: number;
    critChance?: number;
    critMultiplier?: number;
    variance?: number;
    armorPen?: number;
    type?: string;
}
export interface DefenderStats {
    armor: number;
    flatReduction?: number;
    resists?: Record<string, number>;
}
export interface DamageOptions {
    armorK?: number;
    minDamage?: number;
    rng?: () => number;
}
export interface DamageResult {
    final: number;
    raw: number;
    mitigated: number;
    isCrit: boolean;
    mitigationPct: number;
    varianceRoll: number;
}
export declare function computeDamage(attacker: AttackerStats, defender: DefenderStats, opts?: DamageOptions): DamageResult;
export declare const RESOURCE_DAMAGE_FORMULA = "damage_formula";
//# sourceMappingURL=damage-formula.d.ts.map