// Phase 0.66.0 - DamageFormula tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  computeDamage,
  RESOURCE_DAMAGE_FORMULA,
} from '../src/index.js';

test('damage: RESOURCE_DAMAGE_FORMULA is the stable string', () => {
  assert.equal(RESOURCE_DAMAGE_FORMULA, 'damage_formula');
});

test('damage: zero attack power = minimum damage', () => {
  const r = computeDamage(
    { attackPower: 0 },
    { armor: 0 },
  );
  assert.equal(r.final, 1); // default minDamage
});

test('damage: no crit chance = no crit', () => {
  const r = computeDamage(
    { attackPower: 100, critChance: 0 },
    { armor: 0 },
    { rng: () => 0 },  // would crit if critChance > 0
  );
  assert.equal(r.isCrit, false);
});

test('damage: crit = 100% always crits', () => {
  const r = computeDamage(
    { attackPower: 100, critChance: 1, critMultiplier: 2 },
    { armor: 0 },
    { rng: () => 0.999 },  // even 0.999 < 1
  );
  assert.equal(r.isCrit, true);
  // raw = 100 * 2 = 200; no armor; no variance.
  assert.equal(r.raw, 200);
  assert.equal(r.final, 200);
});

test('damage: armor reduces damage hyperbolically', () => {
  const r = computeDamage(
    { attackPower: 100 },
    { armor: 100 },
    { armorK: 100, rng: () => 0.5 },
  );
  // mitigation = 100 / 200 = 0.5
  assert.ok(Math.abs(r.mitigationPct - 0.5) < 1e-9);
  assert.equal(r.mitigated, 50);
});

test('damage: no armor = no mitigation', () => {
  const r = computeDamage(
    { attackPower: 100 },
    { armor: 0 },
  );
  assert.equal(r.mitigationPct, 0);
  assert.equal(r.mitigated, 100);
});

test('damage: very high armor approaches 100% mitigation but never reaches', () => {
  const r = computeDamage(
    { attackPower: 100 },
    { armor: 100000 },
    { armorK: 100 },
  );
  assert.ok(r.mitigationPct < 1);
  // Final still >= minDamage.
  assert.ok(r.final >= 1);
});

test('damage: armorPen reduces effective armor', () => {
  const r = computeDamage(
    { attackPower: 100, armorPen: 50 },
    { armor: 50 },  // becomes 0 after pen
    { armorK: 100 },
  );
  // mitigation 0 / 100 = 0.
  assert.equal(r.mitigationPct, 0);
  assert.equal(r.mitigated, 100);
});

test('damage: armorPen exceeding armor caps at 0 (not negative)', () => {
  const r = computeDamage(
    { attackPower: 100, armorPen: 999 },
    { armor: 50 },
  );
  assert.equal(r.mitigationPct, 0);
});

test('damage: variance produces +/- range', () => {
  const r1 = computeDamage(
    { attackPower: 100, variance: 0.1 },
    { armor: 0 },
    { rng: () => 0 },  // produces -variance
  );
  const r2 = computeDamage(
    { attackPower: 100, variance: 0.1 },
    { armor: 0 },
    { rng: () => 0.999 },
  );
  // Variance roll = (0 * 2 - 1) * 0.1 = -0.1; raw = 100 * 0.9 = 90.
  assert.ok(Math.abs(r1.raw - 90) < 1e-6);
  // Roll = (0.999 * 2 - 1) * 0.1 ≈ +0.1; raw ≈ 110.
  assert.ok(r2.raw > 109);
});

test('damage: minDamage floor enforced', () => {
  const r = computeDamage(
    { attackPower: 1 },
    { armor: 10000, flatReduction: 1000 },
    { minDamage: 5 },
  );
  assert.equal(r.final, 5);
});

test('damage: flat reduction applied AFTER mitigation', () => {
  const r = computeDamage(
    { attackPower: 100 },
    { armor: 0, flatReduction: 20 },
  );
  // raw = 100; mitigated = 100; - 20 flat = 80.
  assert.equal(r.final, 80);
});

test('damage: type-resist reduces damage when type matches', () => {
  const r = computeDamage(
    { attackPower: 100, type: 'fire' },
    { armor: 0, resists: { fire: 0.5 } },
  );
  // mitigated = 100; * (1 - 0.5) = 50; minDamage = 1; flat=0; -> 50.
  assert.equal(r.final, 50);
});

test('damage: missing type-resist does nothing', () => {
  const r = computeDamage(
    { attackPower: 100, type: 'fire' },
    { armor: 0, resists: { ice: 0.5 } },
  );
  assert.equal(r.final, 100);
});

test('damage: full pipeline - crit + armor + variance + flat + resist', () => {
  const r = computeDamage(
    {
      attackPower: 100,
      critChance: 1,
      critMultiplier: 2,
      variance: 0,
      type: 'fire',
    },
    {
      armor: 100,
      flatReduction: 10,
      resists: { fire: 0.25 },
    },
    { armorK: 100, rng: () => 0.5 },
  );
  // crit: 100 * 2 = 200
  // mitigation: 100 / 200 = 0.5; mitigated = 200 * 0.5 = 100
  // resist: 100 * 0.75 = 75
  // flat: 75 - 10 = 65
  assert.equal(r.isCrit, true);
  assert.equal(r.raw, 200);
  assert.equal(r.mitigated, 100);
  assert.equal(r.final, 65);
});

test('damage: same RNG output produces same result (deterministic)', () => {
  function run(): number {
    return computeDamage(
      { attackPower: 100, critChance: 0.5, variance: 0.2 },
      { armor: 50 },
      { rng: () => 0.42 },
    ).final;
  }
  const a = run();
  const b = run();
  assert.equal(a, b);
});

test('damage: critChance > 1 clamps to 1', () => {
  const r = computeDamage(
    { attackPower: 100, critChance: 5, critMultiplier: 2 },
    { armor: 0 },
    { rng: () => 0.999 },
  );
  assert.equal(r.isCrit, true);
});

test('damage: variance > 1 clamps to 1', () => {
  // Variance >1 would let damage swing more than 100%; clamp.
  const r = computeDamage(
    { attackPower: 100, variance: 5 },
    { armor: 0 },
    { rng: () => 0 }, // -1.0 effective
  );
  // (0*2-1) * 1 = -1; raw = 100 * 0 = 0; clamped to 0; minDamage=1.
  assert.equal(r.final, 1);
});

test('damage: NaN / negative attackPower treated as 0', () => {
  const r = computeDamage(
    { attackPower: -10 },
    { armor: 0 },
  );
  assert.equal(r.final, 1); // minDamage floor
});

test('damage: result includes per-stage breakdown', () => {
  const r = computeDamage(
    { attackPower: 100, variance: 0.1 },
    { armor: 100 },
    { armorK: 100, rng: () => 0.5 },
  );
  assert.ok('raw' in r);
  assert.ok('mitigated' in r);
  assert.ok('isCrit' in r);
  assert.ok('mitigationPct' in r);
  assert.ok('varianceRoll' in r);
});

test('damage: realistic example - crit fireball into mage', () => {
  // Hero hits mage with fire crit. Mage has fire resist + armor.
  const r = computeDamage(
    {
      attackPower: 200,
      critChance: 1,
      critMultiplier: 2,
      variance: 0,
      type: 'fire',
    },
    {
      armor: 50,
      flatReduction: 5,
      resists: { fire: 0.30 },
    },
    { armorK: 100, rng: () => 0 },
  );
  // raw = 200 * 2 = 400
  // armor mitigation = 50 / 150 = 0.333...; mitigated = 400 * (1 - 0.333) = 266.67
  // resist 30%: 266.67 * 0.7 = 186.67
  // flat -5: 181.67
  assert.equal(r.isCrit, true);
  assert.ok(Math.abs(r.final - 181.67) < 0.5);
});
