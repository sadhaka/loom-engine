// DamageFormula - canonical RPG damage math.
//
// 0.66.0 enabling primitive. The combat math every action / RPG
// game wants:
//
//   1. base damage from attacker stats
//   2. critical roll (chance + multiplier)
//   3. mitigation by defender (armor / resist)
//   4. variance (small ± randomness)
//   5. min damage floor
//
// DamageFormula is a pure-math module: pass attacker / defender
// stats + an RNG, get back a result with raw / mitigated / final
// damage, isCrit flag, and per-stage breakdown for tooltips and
// combat log entries.
//
// The defender's armor mitigation uses the canonical "armor /
// (armor + K)" curve — a hyperbolic falloff that prevents armor
// from ever fully reducing damage to zero. K is configurable
// (default 100) so consumers can tune the curve shape per zone /
// level scaling.
//
// Code style: var-only in browser source.
const DEFAULT_ARMOR_K = 100;
const DEFAULT_MIN_DAMAGE = 1;
const DEFAULT_CRIT_MULT = 1.5;
// Compute damage. Pure - same inputs + same rng output produce
// the same result every call.
export function computeDamage(attacker, defender, opts = {}) {
    var rng = opts.rng ?? Math.random;
    var armorK = opts.armorK !== undefined && opts.armorK >= 0 ? opts.armorK : DEFAULT_ARMOR_K;
    var minDamage = opts.minDamage !== undefined && opts.minDamage >= 0
        ? opts.minDamage : DEFAULT_MIN_DAMAGE;
    var attackPower = attacker.attackPower > 0 ? attacker.attackPower : 0;
    var critChance = attacker.critChance !== undefined ? clamp01(attacker.critChance) : 0;
    var critMul = attacker.critMultiplier !== undefined && attacker.critMultiplier > 0
        ? attacker.critMultiplier : DEFAULT_CRIT_MULT;
    var variance = attacker.variance !== undefined ? clamp01(attacker.variance) : 0;
    var armorPen = attacker.armorPen !== undefined && attacker.armorPen > 0 ? attacker.armorPen : 0;
    // Crit roll.
    var isCrit = false;
    if (critChance > 0) {
        isCrit = rng() < critChance;
    }
    var critScalar = isCrit ? critMul : 1;
    // Variance roll in [-variance, +variance].
    var varRoll = 0;
    if (variance > 0) {
        varRoll = (rng() * 2 - 1) * variance;
    }
    // Raw damage post-crit, post-variance.
    var raw = attackPower * critScalar * (1 + varRoll);
    if (raw < 0)
        raw = 0;
    // Mitigation: effective armor = max(0, defender.armor - armorPen).
    var effectiveArmor = (defender.armor || 0) - armorPen;
    if (effectiveArmor < 0)
        effectiveArmor = 0;
    var mitigationPct = effectiveArmor / (effectiveArmor + armorK);
    if (mitigationPct < 0)
        mitigationPct = 0;
    if (mitigationPct > 1)
        mitigationPct = 1;
    var mitigated = raw * (1 - mitigationPct);
    // Type resist (if attacker has a type and defender has matching
    // resist).
    var resistPct = 0;
    if (attacker.type && defender.resists && Object.prototype.hasOwnProperty.call(defender.resists, attacker.type)) {
        resistPct = clamp01(defender.resists[attacker.type]);
    }
    var afterResist = mitigated * (1 - resistPct);
    // Flat reduction.
    var flatRed = defender.flatReduction !== undefined && defender.flatReduction > 0
        ? defender.flatReduction : 0;
    var final = afterResist - flatRed;
    if (final < minDamage)
        final = minDamage;
    return {
        final: final,
        raw: raw,
        mitigated: mitigated,
        isCrit: isCrit,
        mitigationPct: mitigationPct,
        varianceRoll: varRoll,
    };
}
function clamp01(v) {
    if (!isFinite(v) || v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
// Resource key for the world's resource registry.
export const RESOURCE_DAMAGE_FORMULA = 'damage_formula';
//# sourceMappingURL=damage-formula.js.map