// gen-srd5e-vectors.ts - generate the SRD 5e pack golden vectors
// (test_vectors/srd5e_pack_v1.json, { meta, cases } like ast_v2_families.json).
//
// Three case kinds:
//   - 'action': a builder-produced document resolving against a scripted dice
//     stream (spec 1.3 harness rules). Each case carries BOTH the build
//     descriptor (fn + args) and the materialized document - the harness
//     rebuilds via the named builder, asserts byte-equality with the embedded
//     document (pins builder drift), then evaluates.
//   - 'slots': one slot-economy operation (spend / restore / rests /
//     widen-merge / upcast ladder) with exact input/output pools.
//   - 'concentration': one concentration-machine operation with exact states.
//
// Every expectation below is HAND-COMPUTED. Before writing the file this
// generator RUNS the real TS modules over each case and asserts agreement -
// the emitted file is simultaneously hand-pinned and reference-verified.
// Re-run with: npx tsx tools/gen-srd5e-vectors.ts

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import {
  applyTriggeredMutations, evaluateAction,
  type MutationNode, type CheckNode, type EvalContext, type AppliedMutation,
} from '../src/runtime/ruleset-ast.js';
import type { WorldState } from '../src/runtime/world-state-snapshot.js';
import type { Pcg32 } from '../src/runtime/pcg32.js';
import {
  buildWeaponAttackCheck, buildAttackCantripCheck, buildSaveCantripCheck,
  buildAttackSpellCheck, buildSaveSpellCheck, buildMultiTargetSaveTrigger,
  buildMagicMissileTrigger, buildHealTrigger, buildConditionSpellCheck,
} from '../src/runtime/srd5e-pack.js';
import {
  spellSlotsFor, spendSlot, spendLowestAvailable, restoreSlot, shortRest,
  longRest, widenSlots, upcastEffect, totalDiceForCast,
} from '../src/runtime/srd5e-spell-slots.js';
import type { SlotPool } from '../src/runtime/srd5e-spell-slots.js';
import {
  maintainSaveDc, startConcentration, dropConcentration, maintainSave,
} from '../src/runtime/srd5e-concentration.js';
import type { ConcentrationState } from '../src/runtime/srd5e-concentration.js';

// ---- Case shapes -------------------------------------------------------------

interface ActionCase {
  label: string;
  kind: 'action';
  context: 'check' | 'trigger';
  actor: string;
  target?: string;
  state: WorldState;
  build: { fn: string; args: unknown[] };
  ast?: unknown;
  mutations?: unknown;
  dice_stream: number[];
  expect: Record<string, unknown>;
}

interface OpCase {
  label: string;
  kind: 'slots' | 'concentration';
  op: string;
  args: Record<string, unknown>;
  expect: Record<string, unknown>;
}

type VectorCase = ActionCase | OpCase;

var cases: VectorCase[] = [];

// ---- Builder dispatch (shared with the harness contract) ----------------------

export function dispatchBuilder(fn: string, args: unknown[]): unknown {
  if (fn === 'weapon_attack') return buildWeaponAttackCheck(args[0] as { modProp: string; damageDice: string; addModToDamage: boolean });
  if (fn === 'attack_cantrip') return buildAttackCantripCheck(args[0] as string, args[1] as number, args[2] as { agonizing?: boolean } | undefined);
  if (fn === 'save_cantrip') return buildSaveCantripCheck(args[0] as string, args[1] as number);
  if (fn === 'attack_spell') return buildAttackSpellCheck(args[0] as string, args[1] as number);
  if (fn === 'save_spell') return buildSaveSpellCheck(args[0] as string, args[1] as number);
  if (fn === 'multi_save_trigger') return buildMultiTargetSaveTrigger(args[0] as string, args[1] as number, args[2] as { selectTag?: string; maxTargets?: number } | undefined);
  if (fn === 'magic_missile_trigger') return buildMagicMissileTrigger(args[0] as number);
  if (fn === 'heal_trigger') return buildHealTrigger(args[0] as string, args[1] as number);
  if (fn === 'condition_spell') return buildConditionSpellCheck(args[0] as string, args[1] as number);
  throw new Error('unknown builder fn: ' + fn);
}

function action(c: Omit<ActionCase, 'ast' | 'mutations' | 'kind'>): void {
  var doc = dispatchBuilder(c.build.fn, c.build.args);
  var full: ActionCase = c as ActionCase;
  full.kind = 'action';
  if (c.context === 'check') full.ast = doc;
  else full.mutations = doc;
  cases.push(full);
}

// ---- Scripted test PRNG (spec section 1.3) -------------------------------------

interface Scripted { rng: Pcg32; consumed(): number }

function scriptedRng(stream: number[]): Scripted {
  var i = 0;
  var fake = {
    rollDie: function (sides: number): number {
      if (sides === 0) return 0;
      if (i >= stream.length) throw new Error('harness: dice stream exhausted');
      var v = stream[i] as number;
      i++;
      if (!(v >= 1 && v <= sides)) throw new Error('harness: stream entry ' + v + ' out of range for d' + sides);
      return v;
    },
  };
  return { rng: fake as unknown as Pcg32, consumed: function () { return i; } };
}

// ---- Verification ---------------------------------------------------------------

function verifyAction(v: ActionCase): void {
  var label = v.label;
  var pre = JSON.stringify(v.state);
  var doc = v.context === 'check' ? v.ast : v.mutations;
  assert.deepStrictEqual(dispatchBuilder(v.build.fn, v.build.args), doc, label + ': builder reproduces the embedded document');
  var sr = scriptedRng(v.dice_stream);
  var ctx: EvalContext = {
    state: v.state, actorId: v.actor, targetId: v.target, rng: sr.rng,
    naturalRoll: null, eachId: undefined,
  };
  var ex = v.expect;
  var endState: WorldState;
  var applied: AppliedMutation[];
  if (v.context === 'check') {
    var r = evaluateAction(v.state, doc as CheckNode, ctx);
    endState = r.state; applied = r.mutations;
    assert.strictEqual(r.degree, ex.degree, label + ': degree');
    if (Object.prototype.hasOwnProperty.call(ex, 'roll')) assert.strictEqual(r.roll, ex.roll, label + ': roll');
    if (Object.prototype.hasOwnProperty.call(ex, 'dc')) assert.strictEqual(r.dc, ex.dc, label + ': dc');
    if (Object.prototype.hasOwnProperty.call(ex, 'delta')) assert.strictEqual(r.delta, ex.delta, label + ': delta');
    if (Object.prototype.hasOwnProperty.call(ex, 'natural')) assert.strictEqual(r.natural, ex.natural, label + ': natural');
  } else {
    var rt = applyTriggeredMutations(v.state, doc as MutationNode[], ctx);
    endState = rt.state; applied = rt.mutations;
  }
  assert.strictEqual(sr.consumed(), v.dice_stream.length, label + ': dice stream fully consumed');
  assert.strictEqual(JSON.stringify(v.state), pre, label + ': input state never mutated');
  var listed: Record<string, boolean> = {};
  var id: string;
  var propsAfter = ex.props_after as Record<string, Record<string, number>> | undefined;
  var tagsAfter = ex.tags_after as Record<string, string[]> | undefined;
  var hpAfter = ex.hp_after as Record<string, number> | undefined;
  if (propsAfter) {
    for (id in propsAfter) {
      listed[id] = true;
      assert.deepStrictEqual(endState.entities[id] && endState.entities[id].properties, propsAfter[id], label + ': props_after ' + id);
    }
  }
  if (tagsAfter) {
    for (id in tagsAfter) {
      listed[id] = true;
      assert.deepStrictEqual(endState.entities[id] && endState.entities[id].tags, tagsAfter[id], label + ': tags_after ' + id);
    }
  }
  if (hpAfter) {
    for (id in hpAfter) {
      listed[id] = true;
      assert.strictEqual(endState.entities[id] && endState.entities[id].properties.hp, hpAfter[id], label + ': hp_after ' + id);
    }
  }
  for (id in v.state.entities) {
    if (!listed[id]) assert.deepStrictEqual(endState.entities[id], v.state.entities[id], label + ': entity ' + id + ' unchanged');
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'applied')) assert.deepStrictEqual(applied, ex.applied, label + ': applied list');
  if (Object.prototype.hasOwnProperty.call(ex, 'applied_count')) assert.strictEqual(applied.length, ex.applied_count, label + ': applied_count');
}

function verifyOp(v: OpCase): void {
  var label = v.label;
  var a = v.args;
  var preArgs = JSON.stringify(v.args);
  var got: unknown;
  if (v.kind === 'slots') {
    if (v.op === 'spell_slots_for') got = { pool: spellSlotsFor(a.class as string, a.level as number) };
    else if (v.op === 'spend') {
      var sp = spendSlot(a.pool as SlotPool, a.slot_level as number);
      got = { ok: sp.ok, reason: sp.reason, slot_level: sp.slot_level, pool: sp.slots };
    } else if (v.op === 'spend_lowest') {
      var sl = spendLowestAvailable(a.pool as SlotPool, a.min_level as number);
      got = { ok: sl.ok, reason: sl.reason, slot_level: sl.slot_level, pool: sl.slots };
    } else if (v.op === 'restore') got = { pool: restoreSlot(a.pool as SlotPool, a.slot_level as number, a.count as number | undefined) };
    else if (v.op === 'widen') got = { pool: widenSlots(a.stored as SlotPool | null, a.class as string, a.level as number) };
    else if (v.op === 'short_rest') got = { pool: shortRest(a.class as string, a.level as number, a.pool as SlotPool) };
    else if (v.op === 'long_rest') got = { pool: longRest(a.class as string, a.level as number) };
    else if (v.op === 'upcast') got = { info: upcastEffect(a.spell as string, a.cast_level as number) };
    else if (v.op === 'total_dice') got = { dice: totalDiceForCast(a.base as string, a.spell as string, a.cast_level as number) };
    else throw new Error('unknown slots op: ' + v.op);
  } else {
    if (v.op === 'maintain_dc') got = { dc: maintainSaveDc(a.damage as number) };
    else if (v.op === 'start') {
      got = startConcentration(a.current as ConcentrationState | null, a.spell_id as string, a.spell_name as string | undefined, a.slot_level as number | undefined);
    } else if (v.op === 'drop') got = dropConcentration(a.current as ConcentrationState | null);
    else if (v.op === 'maintain') got = maintainSave(a.current as ConcentrationState | null, a.damage as number, a.con_save_total as number);
    else throw new Error('unknown concentration op: ' + v.op);
  }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), v.expect, label + ': op result');
  assert.strictEqual(JSON.stringify(v.args), preArgs, label + ': op inputs never mutated');
}

// ================================================================================
// ACTION cases
// ================================================================================

function st(entities: Record<string, { properties: Record<string, number>; tags: string[] }>): WorldState {
  return { epoch: 0, worldSeed: 0, entities: entities } as WorldState;
}

// -- weapon_attack: crit / nat-1 / hit / miss -----------------------------------

action({
  label: 'W1 weapon attack (str 1d8) plain hit: 13+3 vs ac 13, damage 5+3',
  context: 'check', actor: 'hero', target: 'goblin',
  state: st({ hero: { properties: { str_mod: 3 }, tags: [] }, goblin: { properties: { hp: 20, ac: 13 }, tags: [] } }),
  build: { fn: 'weapon_attack', args: [{ modProp: 'str_mod', damageDice: '1d8', addModToDamage: true }] },
  dice_stream: [13, 5],
  expect: { degree: 'success', roll: 16, natural: 13, dc: 13, delta: 3, hp_after: { goblin: 12 }, applied_count: 1 },
});

action({
  label: 'W2 weapon attack nat-20 crit: doubled DICE (2d8), mod once',
  context: 'check', actor: 'hero', target: 'goblin',
  state: st({ hero: { properties: { str_mod: 3 }, tags: [] }, goblin: { properties: { hp: 20, ac: 13 }, tags: [] } }),
  build: { fn: 'weapon_attack', args: [{ modProp: 'str_mod', damageDice: '1d8', addModToDamage: true }] },
  dice_stream: [20, 6, 2],
  expect: { degree: 'critical_success', roll: 23, natural: 20, dc: 13, delta: 10, hp_after: { goblin: 9 }, applied_count: 1 },
});

action({
  label: 'W3 weapon attack nat-1 auto-miss even though the total beats ac 2',
  context: 'check', actor: 'hero', target: 'goblin',
  state: st({ hero: { properties: { str_mod: 3 }, tags: [] }, goblin: { properties: { hp: 20, ac: 2 }, tags: [] } }),
  build: { fn: 'weapon_attack', args: [{ modProp: 'str_mod', damageDice: '1d8', addModToDamage: true }] },
  dice_stream: [1],
  expect: { degree: 'failure', roll: 4, natural: 1, dc: 2, delta: 2, hp_after: { goblin: 20 }, tags_after: { hero: ['missed'] }, applied_count: 1 },
});

action({
  label: 'W4 weapon attack plain miss: damage dice never rolled',
  context: 'check', actor: 'hero', target: 'goblin',
  state: st({ hero: { properties: { str_mod: 3 }, tags: [] }, goblin: { properties: { hp: 20, ac: 13 }, tags: [] } }),
  build: { fn: 'weapon_attack', args: [{ modProp: 'str_mod', damageDice: '1d8', addModToDamage: true }] },
  dice_stream: [5],
  expect: { degree: 'failure', roll: 8, natural: 5, dc: 13, delta: -5, hp_after: { goblin: 20 }, tags_after: { hero: ['missed'] }, applied_count: 1 },
});

// -- fire_bolt tier ladder --------------------------------------------------------

action({
  label: 'FB1 fire_bolt tier 1: flat 1d10, no mod on cantrip damage',
  context: 'check', actor: 'mage', target: 'orc',
  state: st({ mage: { properties: { spell_atk: 5 }, tags: [] }, orc: { properties: { hp: 20, ac: 15 }, tags: [] } }),
  build: { fn: 'attack_cantrip', args: ['fire_bolt', 1] },
  dice_stream: [12, 7],
  expect: { degree: 'success', roll: 17, natural: 12, dc: 15, delta: 2, hp_after: { orc: 13 }, applied_count: 1 },
});

action({
  label: 'FB2 fire_bolt tier 5: 2d10',
  context: 'check', actor: 'mage', target: 'orc',
  state: st({ mage: { properties: { spell_atk: 5 }, tags: [] }, orc: { properties: { hp: 20, ac: 15 }, tags: [] } }),
  build: { fn: 'attack_cantrip', args: ['fire_bolt', 5] },
  dice_stream: [12, 7, 3],
  expect: { degree: 'success', roll: 17, natural: 12, dc: 15, delta: 2, hp_after: { orc: 10 }, applied_count: 1 },
});

action({
  label: 'FB3 fire_bolt tier 11: 3d10',
  context: 'check', actor: 'mage', target: 'orc',
  state: st({ mage: { properties: { spell_atk: 5 }, tags: [] }, orc: { properties: { hp: 20, ac: 15 }, tags: [] } }),
  build: { fn: 'attack_cantrip', args: ['fire_bolt', 11] },
  dice_stream: [12, 5, 5, 5],
  expect: { degree: 'success', roll: 17, natural: 12, dc: 15, delta: 2, hp_after: { orc: 5 }, applied_count: 1 },
});

action({
  label: 'FB4 fire_bolt tier 17 nat-20 crit: 4d10 doubles to 8d10',
  context: 'check', actor: 'mage', target: 'orc',
  state: st({ mage: { properties: { spell_atk: 5 }, tags: [] }, orc: { properties: { hp: 50, ac: 15 }, tags: [] } }),
  build: { fn: 'attack_cantrip', args: ['fire_bolt', 17] },
  dice_stream: [20, 1, 2, 3, 4, 5, 6, 7, 8],
  expect: { degree: 'critical_success', roll: 25, natural: 20, dc: 15, delta: 10, hp_after: { orc: 14 }, applied_count: 1 },
});

action({
  label: 'FB5 ray_of_frost hit applies the slowed_10ft rider tag',
  context: 'check', actor: 'mage', target: 'orc',
  state: st({ mage: { properties: { spell_atk: 5 }, tags: [] }, orc: { properties: { hp: 20, ac: 15 }, tags: [] } }),
  build: { fn: 'attack_cantrip', args: ['ray_of_frost', 1] },
  dice_stream: [15, 4],
  expect: { degree: 'success', roll: 20, natural: 15, dc: 15, delta: 5, hp_after: { orc: 16 }, tags_after: { orc: ['slowed_10ft'] }, applied_count: 2 },
});

action({
  label: 'EB1 eldritch_blast one beam, agonizing: 1d10 + cha_mod',
  context: 'check', actor: 'warlock', target: 'imp',
  state: st({ warlock: { properties: { spell_atk: 5, cha_mod: 4 }, tags: [] }, imp: { properties: { hp: 20, ac: 12 }, tags: [] } }),
  build: { fn: 'attack_cantrip', args: ['eldritch_blast', 5, { agonizing: true }] },
  dice_stream: [10, 8],
  expect: { degree: 'success', roll: 15, natural: 10, dc: 12, delta: 3, hp_after: { imp: 8 }, applied_count: 1 },
});

// -- save cantrips ------------------------------------------------------------------

action({
  label: 'SF1 sacred_flame lands: target save 11 under dc 13',
  context: 'check', actor: 'cleric', target: 'zombie',
  state: st({ cleric: { properties: { spell_dc: 13 }, tags: [] }, zombie: { properties: { hp: 20, dex_save: 2 }, tags: [] } }),
  build: { fn: 'save_cantrip', args: ['sacred_flame', 1] },
  dice_stream: [9, 6],
  expect: { degree: 'success', roll: 11, natural: 9, dc: 13, delta: -2, hp_after: { zombie: 14 }, applied_count: 1 },
});

action({
  label: 'SF2 sacred_flame saved: nothing on a save, damage dice never rolled',
  context: 'check', actor: 'cleric', target: 'zombie',
  state: st({ cleric: { properties: { spell_dc: 13 }, tags: [] }, zombie: { properties: { hp: 20, dex_save: 2 }, tags: [] } }),
  build: { fn: 'save_cantrip', args: ['sacred_flame', 1] },
  dice_stream: [18],
  expect: { degree: 'failure', roll: 20, natural: 18, dc: 13, delta: 7, hp_after: { zombie: 20 }, applied_count: 0 },
});

action({
  label: 'SF3 sacred_flame auto-fail: paralyzed target lands the spell despite save 20 (the save d20 is still drawn)',
  context: 'check', actor: 'cleric', target: 'zombie',
  state: st({ cleric: { properties: { spell_dc: 13 }, tags: [] }, zombie: { properties: { hp: 20, dex_save: 2 }, tags: ['paralyzed'] } }),
  build: { fn: 'save_cantrip', args: ['sacred_flame', 1] },
  dice_stream: [18, 6],
  expect: { degree: 'success', roll: 20, natural: 18, dc: 13, delta: 7, hp_after: { zombie: 14 }, tags_after: { zombie: ['paralyzed'] }, applied_count: 1 },
});

action({
  label: 'TD1 toll_the_dead vs a wounded target: live hp < hp_max read upgrades to d12',
  context: 'check', actor: 'cleric', target: 'ghoul',
  state: st({ cleric: { properties: { spell_dc: 13 }, tags: [] }, ghoul: { properties: { hp: 10, hp_max: 20, wis_save: 1 }, tags: [] } }),
  build: { fn: 'save_cantrip', args: ['toll_the_dead', 1] },
  dice_stream: [5, 9],
  expect: { degree: 'success', roll: 6, natural: 5, dc: 13, delta: -7, hp_after: { ghoul: 1 }, applied_count: 1 },
});

action({
  label: 'TD2 toll_the_dead vs an unwounded target: d8 branch',
  context: 'check', actor: 'cleric', target: 'ghoul',
  state: st({ cleric: { properties: { spell_dc: 13 }, tags: [] }, ghoul: { properties: { hp: 20, hp_max: 20, wis_save: 1 }, tags: [] } }),
  build: { fn: 'save_cantrip', args: ['toll_the_dead', 1] },
  dice_stream: [5, 7],
  expect: { degree: 'success', roll: 6, natural: 5, dc: 13, delta: -7, hp_after: { ghoul: 13 }, applied_count: 1 },
});

action({
  label: 'VM1 vicious_mockery lands: 1d4 psychic + the disadv_next_attack rider tag',
  context: 'check', actor: 'bard', target: 'thug',
  state: st({ bard: { properties: { spell_dc: 13 }, tags: [] }, thug: { properties: { hp: 10, wis_save: 0 }, tags: [] } }),
  build: { fn: 'save_cantrip', args: ['vicious_mockery', 1] },
  dice_stream: [3, 2],
  expect: { degree: 'success', roll: 3, natural: 3, dc: 13, delta: -10, hp_after: { thug: 8 }, tags_after: { thug: ['disadv_next_attack'] }, applied_count: 2 },
});

// -- magic_missile upcast -------------------------------------------------------------

action({
  label: 'MM1 magic_missile slot 1: 3 darts, each a fresh 1d4+1 (auto-hit, no check)',
  context: 'trigger', actor: 'mage', target: 'imp',
  state: st({ mage: { properties: {}, tags: [] }, imp: { properties: { hp: 20 }, tags: [] } }),
  build: { fn: 'magic_missile_trigger', args: [1] },
  dice_stream: [2, 4, 1],
  expect: {
    hp_after: { imp: 10 },
    applied: [
      { target: 'imp', property: 'hp', op: 'sub_prop', previous: 20, next: 17 },
      { target: 'imp', property: 'hp', op: 'sub_prop', previous: 17, next: 12 },
      { target: 'imp', property: 'hp', op: 'sub_prop', previous: 12, next: 10 }],
  },
});

action({
  label: 'MM2 magic_missile slot 5: 7 darts',
  context: 'trigger', actor: 'mage', target: 'imp',
  state: st({ mage: { properties: {}, tags: [] }, imp: { properties: { hp: 20 }, tags: [] } }),
  build: { fn: 'magic_missile_trigger', args: [5] },
  dice_stream: [1, 1, 1, 1, 1, 1, 1],
  expect: { hp_after: { imp: 6 }, applied_count: 7 },
});

// -- fireball: the multi-target save -----------------------------------------------------

action({
  label: 'FBL1 fireball slot 3 multi-target: g_a saves (half, floor_div), g_b fails (full), per-target fresh 8d6',
  context: 'trigger', actor: 'hero',
  state: st({
    hero: { properties: { spell_dc: 13 }, tags: [] },
    g_a: { properties: { hp: 40, dex_save: 5 }, tags: ['in_blast'] },
    g_b: { properties: { hp: 40, dex_save: 0 }, tags: ['in_blast'] },
  }),
  build: { fn: 'multi_save_trigger', args: ['fireball', 3] },
  dice_stream: [9, 1, 2, 3, 4, 5, 6, 1, 2, 7, 6, 6, 6, 6, 1, 1, 1, 1],
  expect: {
    props_after: {
      g_a: { hp: 28, dex_save: 5, save_roll: 14 },
      g_b: { hp: 12, dex_save: 0, save_roll: 7 },
    },
    applied_count: 4,
  },
});

action({
  label: 'FBL2 fireball slot 5 single-target check variant: failed save takes the full 10d6',
  context: 'check', actor: 'mage', target: 'troll',
  state: st({ mage: { properties: { spell_dc: 13 }, tags: [] }, troll: { properties: { hp: 50, dex_save: 0 }, tags: [] } }),
  build: { fn: 'save_spell', args: ['fireball', 5] },
  dice_stream: [4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  expect: { degree: 'success', roll: 4, natural: 4, dc: 13, delta: -9, hp_after: { troll: 20 }, applied_count: 1 },
});

action({
  label: 'TW1 thunderwave slot 1 multi (CON save - no auto-fail arms): one target fails, takes full 2d8',
  context: 'trigger', actor: 'druid',
  state: st({
    druid: { properties: { spell_dc: 12 }, tags: [] },
    r_a: { properties: { hp: 10, con_save: 1 }, tags: ['in_burst'] },
  }),
  build: { fn: 'multi_save_trigger', args: ['thunderwave', 1, { selectTag: 'in_burst' }] },
  dice_stream: [10, 4, 5],
  expect: { props_after: { r_a: { hp: 1, con_save: 1, save_roll: 11 } }, applied_count: 2 },
});

action({
  label: 'HR1 hellish_rebuke saved: half damage via floor_div on a FRESH 2d10',
  context: 'check', actor: 'warlock', target: 'knight',
  state: st({ warlock: { properties: { spell_dc: 13 }, tags: [] }, knight: { properties: { hp: 20, dex_save: 2 }, tags: [] } }),
  build: { fn: 'save_spell', args: ['hellish_rebuke', 1] },
  dice_stream: [16, 5, 6],
  expect: { degree: 'failure', roll: 18, natural: 16, dc: 13, delta: 5, hp_after: { knight: 15 }, applied_count: 1 },
});

// -- heals ----------------------------------------------------------------------------

action({
  label: 'CW1 cure_wounds slot 1: 1d8 + spell_mod, then the hp_max overheal clamp',
  context: 'trigger', actor: 'cleric', target: 'ally',
  state: st({ cleric: { properties: { spell_mod: 3 }, tags: [] }, ally: { properties: { hp: 18, hp_max: 20 }, tags: [] } }),
  build: { fn: 'heal_trigger', args: ['cure_wounds', 1] },
  dice_stream: [7],
  expect: {
    props_after: { ally: { hp: 20, hp_max: 20 } },
    applied: [
      { target: 'ally', property: 'hp', op: 'add_prop', previous: 18, next: 28 },
      { target: 'ally', property: 'hp', op: 'set_prop', previous: 28, next: 20 }],
  },
});

action({
  label: 'HW1 healing_word slot 3: 3d4 + spell_mod, clamp branch untaken',
  context: 'trigger', actor: 'bard', target: 'ally',
  state: st({ bard: { properties: { spell_mod: 2 }, tags: [] }, ally: { properties: { hp: 5, hp_max: 30 }, tags: [] } }),
  build: { fn: 'heal_trigger', args: ['healing_word', 3] },
  dice_stream: [2, 3, 1],
  expect: { props_after: { ally: { hp: 13, hp_max: 30 } }, applied_count: 1 },
});

// -- condition spells --------------------------------------------------------------------

action({
  label: 'HP1 hold_person lands: paralyzed tag, zero damage by construction',
  context: 'check', actor: 'cleric', target: 'bandit',
  state: st({ cleric: { properties: { spell_dc: 13 }, tags: [] }, bandit: { properties: { hp: 10, wis_save: 1 }, tags: [] } }),
  build: { fn: 'condition_spell', args: ['hold_person', 2] },
  dice_stream: [5],
  expect: { degree: 'success', roll: 6, natural: 5, dc: 13, delta: -7, hp_after: { bandit: 10 }, tags_after: { bandit: ['paralyzed'] }, applied_count: 1 },
});

action({
  label: 'WB1 web lands via the DEX auto-fail or-arm: stunned target is restrained despite save 23',
  context: 'check', actor: 'wizard', target: 'ogre',
  state: st({ wizard: { properties: { spell_dc: 13 }, tags: [] }, ogre: { properties: { hp: 30, dex_save: 4 }, tags: ['stunned'] } }),
  build: { fn: 'condition_spell', args: ['web', 2] },
  dice_stream: [19],
  expect: { degree: 'success', roll: 23, natural: 19, dc: 13, delta: 10, hp_after: { ogre: 30 }, tags_after: { ogre: ['restrained', 'stunned'] }, applied_count: 1 },
});

action({
  label: 'SR1 scorching_ray one ray nat-20 crit: 2d6 doubles to 4d6',
  context: 'check', actor: 'mage', target: 'imp',
  state: st({ mage: { properties: { spell_atk: 5 }, tags: [] }, imp: { properties: { hp: 20, ac: 12 }, tags: [] } }),
  build: { fn: 'attack_spell', args: ['scorching_ray', 2] },
  dice_stream: [20, 4, 2, 1, 6],
  expect: { degree: 'critical_success', roll: 25, natural: 20, dc: 12, delta: 13, hp_after: { imp: 7 }, applied_count: 1 },
});

// ================================================================================
// SLOTS cases (slot-economy transitions, incl. the P0 widen-merge)
// ================================================================================

function slots(label: string, op: string, args: Record<string, unknown>, expect: Record<string, unknown>): void {
  cases.push({ label: label, kind: 'slots', op: op, args: args, expect: expect });
}

slots('S1 wizard 1 fresh pool', 'spell_slots_for', { class: 'wizard', level: 1 },
  { pool: { '1': { max: 2, used: 0 } } });
slots('S2 wizard 5 fresh pool', 'spell_slots_for', { class: 'wizard', level: 5 },
  { pool: { '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 2, used: 0 } } });
slots('S3 wizard 20 fresh pool (the full SRD row)', 'spell_slots_for', { class: 'wizard', level: 20 },
  { pool: { '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 3, used: 0 }, '4': { max: 3, used: 0 }, '5': { max: 3, used: 0 }, '6': { max: 2, used: 0 }, '7': { max: 2, used: 0 }, '8': { max: 1, used: 0 }, '9': { max: 1, used: 0 } } });
slots('S4 paladin 1 has no slots yet', 'spell_slots_for', { class: 'paladin', level: 1 }, { pool: {} });
slots('S5 paladin 5 half-caster row', 'spell_slots_for', { class: 'paladin', level: 5 },
  { pool: { '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } } });
slots('S6 warlock 5 pact slots', 'spell_slots_for', { class: 'warlock', level: 5 },
  { pool: { pact: { slot_level: 3, max: 2, used: 0 } } });
slots('S7 fighter has no pool', 'spell_slots_for', { class: 'fighter', level: 10 }, { pool: {} });

slots('S8 spend an open level-3 slot', 'spend',
  { pool: { '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 2, used: 0 } }, slot_level: 3 },
  { ok: true, reason: 'ok', slot_level: 3, pool: { '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 2, used: 1 } } });
slots('S9 spend a dry level: no_slot, pool unchanged', 'spend',
  { pool: { '1': { max: 2, used: 2 } }, slot_level: 1 },
  { ok: false, reason: 'no_slot', slot_level: null, pool: { '1': { max: 2, used: 2 } } });
slots('S10 spend slot 0 is not a slot (a cantrip)', 'spend',
  { pool: { '1': { max: 2, used: 0 } }, slot_level: 0 },
  { ok: false, reason: 'not_a_slot', slot_level: null, pool: { '1': { max: 2, used: 0 } } });
slots('S11 spend slot 10 is a bad slot level', 'spend',
  { pool: { '1': { max: 2, used: 0 } }, slot_level: 10 },
  { ok: false, reason: 'bad_slot_level', slot_level: null, pool: { '1': { max: 2, used: 0 } } });
slots('S12 spend_lowest auto-upcasts when the base tier is dry (5e RAW)', 'spend_lowest',
  { pool: { '1': { max: 2, used: 2 }, '2': { max: 3, used: 0 } }, min_level: 1 },
  { ok: true, reason: 'ok', slot_level: 2, pool: { '1': { max: 2, used: 2 }, '2': { max: 3, used: 1 } } });
slots('S13 spend_lowest with the whole walk dry: no_higher_slot', 'spend_lowest',
  { pool: { '1': { max: 2, used: 2 }, '2': { max: 3, used: 3 } }, min_level: 1 },
  { ok: false, reason: 'no_higher_slot', slot_level: null, pool: { '1': { max: 2, used: 2 }, '2': { max: 3, used: 3 } } });
slots('S14 spend a pact slot at its level', 'spend',
  { pool: { pact: { slot_level: 3, max: 2, used: 0 } }, slot_level: 3 },
  { ok: true, reason: 'ok', slot_level: 3, pool: { pact: { slot_level: 3, max: 2, used: 1 } } });
slots('S15 spend_lowest walks up to the pact tier', 'spend_lowest',
  { pool: { pact: { slot_level: 3, max: 2, used: 0 } }, min_level: 1 },
  { ok: true, reason: 'ok', slot_level: 3, pool: { pact: { slot_level: 3, max: 2, used: 1 } } });
slots('S16 restore 2 spent level-2 slots', 'restore',
  { pool: { '2': { max: 3, used: 2 } }, slot_level: 2, count: 2 },
  { pool: { '2': { max: 3, used: 0 } } });
slots('S17 restore floors used at 0', 'restore',
  { pool: { '1': { max: 2, used: 1 } }, slot_level: 1, count: 5 },
  { pool: { '1': { max: 2, used: 0 } } });

slots('S18 widen-merge level-up (THE P0): shape derives fresh, used carries over', 'widen',
  { stored: { '1': { max: 4, used: 4 }, '2': { max: 3, used: 1 } }, class: 'wizard', level: 5 },
  { pool: { '1': { max: 4, used: 4 }, '2': { max: 3, used: 1 }, '3': { max: 2, used: 0 } } });
slots('S19 widen-merge caps carried used at the new max', 'widen',
  { stored: { '1': { max: 2, used: 7 } }, class: 'wizard', level: 1 },
  { pool: { '1': { max: 2, used: 2 } } });
slots('S20 widen for a non-caster returns the stored pool untouched', 'widen',
  { stored: { '1': { max: 4, used: 2 } }, class: 'fighter', level: 5 },
  { pool: { '1': { max: 4, used: 2 } } });
slots('S21 widen with null stored returns the fresh pool', 'widen',
  { stored: null, class: 'wizard', level: 3 },
  { pool: { '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } } });
slots('S22 widen-merge re-derives the pact shape, carrying pact used', 'widen',
  { stored: { pact: { slot_level: 1, max: 2, used: 1 } }, class: 'warlock', level: 5 },
  { pool: { pact: { slot_level: 3, max: 2, used: 1 } } });

slots('S23 short rest refreshes pact slots (warlock)', 'short_rest',
  { class: 'warlock', level: 5, pool: { pact: { slot_level: 3, max: 2, used: 2 } } },
  { pool: { pact: { slot_level: 3, max: 2, used: 0 } } });
slots('S24 short rest is a no-op for a wizard', 'short_rest',
  { class: 'wizard', level: 5, pool: { '1': { max: 4, used: 3 } } },
  { pool: { '1': { max: 4, used: 3 } } });
slots('S25 long rest refreshes everything', 'long_rest',
  { class: 'wizard', level: 4 },
  { pool: { '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 } } });

slots('S26 upcast fireball at slot 5: +2d6', 'upcast', { spell: 'fireball', cast_level: 5 },
  { info: { spell_id: 'fireball', base_level: 3, cast_level: 5, levels_above: 2, effect: 'damage', concentration: false, added_dice: '2d6', extra_instances: 0, note: '+1d6 damage per slot level above 3rd' } });
slots('S27 upcast magic_missile at slot 9: 8 extra darts', 'upcast', { spell: 'magic_missile', cast_level: 9 },
  { info: { spell_id: 'magic_missile', base_level: 1, cast_level: 9, levels_above: 8, effect: 'damage', concentration: false, added_dice: '', extra_instances: 8, note: 'one extra dart per slot level above 1st' } });
slots('S28 upcast spiritual_weapon at slot 5: one even step (+1d8)', 'upcast', { spell: 'spiritual_weapon', cast_level: 5 },
  { info: { spell_id: 'spiritual_weapon', base_level: 2, cast_level: 5, levels_above: 3, effect: 'damage', concentration: false, added_dice: '1d8', extra_instances: 0, note: '+1d8 damage per TWO slot levels above 2nd - generated variants exist only at even slot levels' } });
slots('S29 upcast hold_person at slot 4: 2 extra targets, concentration', 'upcast', { spell: 'hold_person', cast_level: 4 },
  { info: { spell_id: 'hold_person', base_level: 2, cast_level: 4, levels_above: 2, effect: 'utility', concentration: true, added_dice: '', extra_instances: 2, note: 'one extra humanoid target per slot level above 2nd (host enumerates targets)' } });
slots('S30 upcast of an unknown spell is null', 'upcast', { spell: 'wish', cast_level: 9 }, { info: null });
slots('S31 total dice: fireball 8d6 at slot 5 is 10d6', 'total_dice',
  { base: '8d6', spell: 'fireball', cast_level: 5 }, { dice: '10d6' });
slots('S32 total dice: spiritual_weapon 1d8 at slot 6 is 3d8 (two even steps)', 'total_dice',
  { base: '1d8', spell: 'spiritual_weapon', cast_level: 6 }, { dice: '3d8' });
slots('S33 total dice: magic_missile dice never scale (darts do)', 'total_dice',
  { base: '1d4', spell: 'magic_missile', cast_level: 9 }, { dice: '1d4' });

// ================================================================================
// CONCENTRATION cases
// ================================================================================

function conc(label: string, op: string, args: Record<string, unknown>, expect: Record<string, unknown>): void {
  cases.push({ label: label, kind: 'concentration', op: op, args: args, expect: expect });
}

conc('C1 dc floors at 10 for small hits', 'maintain_dc', { damage: 7 }, { dc: 10 });
conc('C2 dc is half damage above the floor', 'maintain_dc', { damage: 22 }, { dc: 11 });
conc('C3 dc 18 at damage 36', 'maintain_dc', { damage: 36 }, { dc: 18 });
conc('C4 dc floors at 10 even at damage 21 (floor_div)', 'maintain_dc', { damage: 21 }, { dc: 10 });
conc('C5 dc at the boundary: damage 23 -> 11', 'maintain_dc', { damage: 23 }, { dc: 11 });

conc('C6 start concentrating from idle', 'start',
  { current: null, spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 },
  { concentration: { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 }, dropped: null });
conc('C7 starting a second spell DROPS the first (one at a time)', 'start',
  { current: { spell_id: 'bless', spell_name: 'Bless' }, spell_id: 'witch_bolt', spell_name: 'Witch Bolt', slot_level: 1 },
  { concentration: { spell_id: 'witch_bolt', spell_name: 'Witch Bolt', slot_level: 1 }, dropped: { spell_id: 'bless', spell_name: 'Bless' } });
conc('C8 drop while idle is a no-op', 'drop', { current: null }, { concentration: null, dropped: null });
conc('C9 drop ends the active spell', 'drop',
  { current: { spell_id: 'web', spell_name: 'Web', slot_level: 2 } },
  { concentration: null, dropped: { spell_id: 'web', spell_name: 'Web', slot_level: 2 } });
conc('C10 maintain while not concentrating: nothing needed, nothing drops', 'maintain',
  { current: null, damage: 18, con_save_total: 2 },
  { needed: false, dc: 10, total: 2, success: true, concentration: null, dropped: null });
conc('C11 maintain keeps at exactly the dc (total >= dc)', 'maintain',
  { current: { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 }, damage: 22, con_save_total: 11 },
  { needed: true, dc: 11, total: 11, success: true, concentration: { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 }, dropped: null });
conc('C12 maintain fails one under the dc: the spell drops', 'maintain',
  { current: { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 }, damage: 22, con_save_total: 10 },
  { needed: true, dc: 11, total: 10, success: false, concentration: null, dropped: { spell_id: 'hold_person', spell_name: 'Hold Person', slot_level: 2 } });

// ---- Verify every case, then write ------------------------------------------------

for (var ci = 0; ci < cases.length; ci++) {
  var c = cases[ci] as VectorCase;
  if (c.kind === 'action') verifyAction(c as ActionCase);
  else verifyOp(c as OpCase);
}

var out = {
  meta: {
    generator: 'tools/gen-srd5e-vectors.ts',
    generated_note: 'Regenerate with: npx tsx tools/gen-srd5e-vectors.ts (runs the real srd5e modules + the ruleset-AST evaluator over every case and asserts the hand-computed expectation before writing).',
    vector: 'SRD 5e action-pack golden vectors: builder documents on scripted dice streams + slot-economy transitions (incl. the widen-merge) + concentration flows',
    spec: 'docs/specs/AST-V2-SPEC.md',
    note: "Harness rules for kind 'action' follow AST-V2-SPEC sections 1.3/1.5 (scripted rollDie pops stream entries in order; accept vectors consume the stream fully; entities not listed in a *_after field are asserted unchanged). The harness MUST also rebuild each action's document via build.fn/build.args and assert deep equality with the embedded ast/mutations - that is the builder-drift pin. Kinds 'slots' and 'concentration' are pure op cases compared with deep equality; op inputs must never be mutated.",
  },
  cases: cases,
};
var dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'test_vectors', 'srd5e_pack_v1.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote ' + dest + ' (' + cases.length + ' cases, all verified against the TS modules)');
