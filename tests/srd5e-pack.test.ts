// srd5e-pack tests - the SRD 5e action pack.
//
// Three gates:
//   1. BUDGET CONFORMANCE: every document every builder can emit (all
//      cantrips x tiers, all leveled spells x legal slot levels, weapon
//      variants, the worst-case multi-target limit) passes validateCheck /
//      validateTriggeredMutations - the ~256-node / dice / multiplicity
//      budgets are a test gate, not a hope.
//   2. The generated pack JSON (packs/srd5e/srd5e_actions_v1.json): every
//      embedded document re-validates from the file (what Python/Rust hosts
//      will consume).
//   3. The GOLDEN VECTORS (test_vectors/srd5e_pack_v1.json): every case runs
//      against the real evaluator / modules with the spec 1.3 scripted dice
//      stream. This runner is an independent implementation of the harness
//      contract - it shares no code with the generator's verifier.
// Plus planLeveledCast economy semantics and catalog structural invariants.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateCheck, validateTriggeredMutations, evaluateAction, applyTriggeredMutations,
} from '../src/runtime/ruleset-ast.js';
import type { CheckNode, MutationNode, EvalContext, AppliedMutation } from '../src/runtime/ruleset-ast.js';
import type { WorldState } from '../src/runtime/world-state-snapshot.js';
import type { Pcg32 } from '../src/runtime/pcg32.js';
import {
  CANTRIPS, CLASS_CANTRIPS, LEVELED_SPELLS, CLASS_LEVELED_SPELLS,
  classCanCast, cantripDiceCount, eldritchBlastBeams, scaledCantripDice,
  buildWeaponAttackCheck, buildAttackCantripCheck, buildSaveCantripCheck,
  buildAttackSpellCheck, buildSaveSpellCheck, buildMultiTargetSaveTrigger,
  buildMagicMissileTrigger, buildHealTrigger, buildConditionSpellCheck,
  planLeveledCast,
} from '../src/runtime/srd5e-pack.js';
import { MAX_SLOT_LEVEL, spellSlotsFor } from '../src/runtime/srd5e-spell-slots.js';
import type { SlotPool } from '../src/runtime/srd5e-spell-slots.js';
import type { ConcentrationState } from '../src/runtime/srd5e-concentration.js';
import {
  spendSlot, spendLowestAvailable, restoreSlot, shortRest, longRest,
  widenSlots, upcastEffect, totalDiceForCast,
} from '../src/runtime/srd5e-spell-slots.js';
import {
  maintainSaveDc, startConcentration, dropConcentration, maintainSave,
} from '../src/runtime/srd5e-concentration.js';

var here = dirname(fileURLToPath(import.meta.url));
var TIERS = [1, 5, 11, 17];

// ---- Gate 1: every builder output validates (budget conformance) ---------------

test('srd5e-pack: every buildable document passes AST v2 validation', function () {
  var id: string;
  var t: number;
  var L: number;
  var count = 0;
  for (id in CANTRIPS) {
    var cdef = CANTRIPS[id] as { kind: string };
    for (var ti = 0; ti < TIERS.length; ti++) {
      t = TIERS[ti] as number;
      if (cdef.kind === 'spell_attack') {
        validateCheck(buildAttackCantripCheck(id, t)); count++;
        if (id === 'eldritch_blast') {
          validateCheck(buildAttackCantripCheck(id, t, { agonizing: true })); count++;
        }
      } else {
        validateCheck(buildSaveCantripCheck(id, t)); count++;
      }
    }
  }
  for (id in LEVELED_SPELLS) {
    var ldef = LEVELED_SPELLS[id] as { kind: string; base_level: number; area?: unknown };
    for (L = ldef.base_level; L <= MAX_SLOT_LEVEL; L++) {
      if (ldef.kind === 'auto') { validateTriggeredMutations(buildMagicMissileTrigger(L)); count++; }
      else if (ldef.kind === 'heal') { validateTriggeredMutations(buildHealTrigger(id, L)); count++; }
      else if (ldef.kind === 'spell_attack') { validateCheck(buildAttackSpellCheck(id, L)); count++; }
      else if (ldef.kind === 'save') {
        validateCheck(buildSaveSpellCheck(id, L)); count++;
        if (ldef.area) {
          validateTriggeredMutations(buildMultiTargetSaveTrigger(id, L)); count++;
          // Worst case: limit 32 at the top slot - must still clear the
          // dice (1000) and applied (1024) budgets.
          validateTriggeredMutations(buildMultiTargetSaveTrigger(id, MAX_SLOT_LEVEL, { maxTargets: 32 })); count++;
        }
      } else if (ldef.kind === 'save_utility') { validateCheck(buildConditionSpellCheck(id, L)); count++; }
    }
  }
  var dice = ['1d4', '1d6', '1d8', '1d10', '1d12', '2d6'];
  var mods = ['str_mod', 'dex_mod'];
  for (var m = 0; m < mods.length; m++) {
    for (var d = 0; d < dice.length; d++) {
      validateCheck(buildWeaponAttackCheck({ modProp: mods[m] as string, damageDice: dice[d] as string, addModToDamage: true }));
      validateCheck(buildWeaponAttackCheck({ modProp: mods[m] as string, damageDice: dice[d] as string, addModToDamage: false }));
      count += 2;
    }
  }
  assert.ok(count >= 200, 'expected to validate >= 200 built documents, got ' + count);
});

test('srd5e-pack: builders reject unknown ids and bad options', function () {
  assert.throws(function () { buildAttackCantripCheck('nonsense', 1); }, /SRD5E/);
  assert.throws(function () { buildAttackCantripCheck('sacred_flame', 1); }, /SRD5E/, 'save cantrip via the attack builder rejects');
  assert.throws(function () { buildSaveCantripCheck('fire_bolt', 1); }, /SRD5E/);
  assert.throws(function () { buildAttackSpellCheck('fireball', 3); }, /SRD5E/, 'save spell via the attack builder rejects');
  assert.throws(function () { buildSaveSpellCheck('guiding_bolt', 1); }, /SRD5E/);
  assert.throws(function () { buildMultiTargetSaveTrigger('hellish_rebuke', 1); }, /SRD5E/, 'no area -> not multi-target');
  assert.throws(function () { buildMultiTargetSaveTrigger('fireball', 3, { maxTargets: 0 }); }, /SRD5E/);
  assert.throws(function () { buildMultiTargetSaveTrigger('fireball', 3, { maxTargets: 33 }); }, /SRD5E/);
  assert.throws(function () { buildHealTrigger('fireball', 3); }, /SRD5E/);
  assert.throws(function () { buildConditionSpellCheck('fireball', 3); }, /SRD5E/);
  assert.throws(function () { buildWeaponAttackCheck({ modProp: 'cha_mod', damageDice: '1d8', addModToDamage: true }); }, /SRD5E/);
  assert.throws(function () { buildWeaponAttackCheck({ modProp: 'str_mod', damageDice: '1d8.5', addModToDamage: true }); }, /SRD5E/);
});

test('srd5e-pack: catalog structural invariants', function () {
  var cls: string;
  var i: number;
  for (cls in CLASS_CANTRIPS) {
    var clist = CLASS_CANTRIPS[cls] as string[];
    for (i = 0; i < clist.length; i++) {
      assert.ok(CANTRIPS[clist[i] as string], cls + ' cantrip ' + clist[i] + ' exists in CANTRIPS');
    }
  }
  for (cls in CLASS_LEVELED_SPELLS) {
    var llist = CLASS_LEVELED_SPELLS[cls] as string[];
    for (i = 0; i < llist.length; i++) {
      assert.ok(LEVELED_SPELLS[llist[i] as string], cls + ' spell ' + llist[i] + ' exists in LEVELED_SPELLS');
    }
  }
  var id: string;
  for (id in CANTRIPS) {
    var c = CANTRIPS[id] as { id: string; kind: string; save_ability?: string };
    assert.strictEqual(c.id, id, 'cantrip id matches its key');
    if (c.kind === 'save') assert.ok(c.save_ability, id + ' save cantrip declares its save');
  }
  for (id in LEVELED_SPELLS) {
    var l = LEVELED_SPELLS[id] as { id: string; kind: string; base_level: number; save_ability?: string; half_on_save?: boolean; applies_tag?: string };
    assert.strictEqual(l.id, id, 'spell id matches its key');
    assert.ok(l.base_level >= 1 && l.base_level <= 9, id + ' base level sane');
    if (l.kind === 'save') assert.ok(l.save_ability && l.half_on_save !== undefined, id + ' save spell declares save + half rule');
    if (l.kind === 'save_utility') assert.ok(l.save_ability && l.applies_tag, id + ' condition spell declares save + tag');
  }
  assert.strictEqual(classCanCast('wizard', 'fire_bolt'), true);
  assert.strictEqual(classCanCast('wizard', 'fireball'), true);
  assert.strictEqual(classCanCast('cleric', 'fireball'), false);
  assert.strictEqual(classCanCast('warlock', 'eldritch_blast'), true);
  assert.strictEqual(classCanCast('fighter', 'fireball'), false);
  assert.strictEqual(classCanCast('wizard', 'nonsense'), false);
});

test('srd5e-pack: tier scaling helpers', function () {
  assert.strictEqual(cantripDiceCount(1), 1);
  assert.strictEqual(cantripDiceCount(4), 1);
  assert.strictEqual(cantripDiceCount(5), 2);
  assert.strictEqual(cantripDiceCount(10), 2);
  assert.strictEqual(cantripDiceCount(11), 3);
  assert.strictEqual(cantripDiceCount(16), 3);
  assert.strictEqual(cantripDiceCount(17), 4);
  assert.strictEqual(cantripDiceCount(20), 4);
  assert.strictEqual(eldritchBlastBeams(1), 1);
  assert.strictEqual(eldritchBlastBeams(5), 2);
  assert.strictEqual(eldritchBlastBeams(11), 3);
  assert.strictEqual(eldritchBlastBeams(17), 4);
  assert.strictEqual(scaledCantripDice('1d10', 11), '3d10');
  assert.strictEqual(scaledCantripDice('1d8', 1), '1d8');
  assert.strictEqual(scaledCantripDice('1d4+1', 5), '2d4+1', 'flat mod preserved once');
  assert.strictEqual(scaledCantripDice('junk', 5), 'junk', 'non-dice pass through');
});

test('srd5e-pack: planLeveledCast - the dice-free economy half', function () {
  var pool = spellSlotsFor('wizard', 7); // 4/3/3/1
  var pre = JSON.stringify(pool);
  var plan = planLeveledCast(pool, 'fireball', 'wizard');
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.reason, 'ok');
  assert.strictEqual(plan.slot_level, 3);
  assert.strictEqual(plan.concentration_spell, null);
  assert.strictEqual(plan.spell_name, 'Fireball');
  assert.strictEqual((plan.slots['3'] as { used: number }).used, 1);
  assert.strictEqual(JSON.stringify(pool), pre, 'input pool never mutated');
  // Auto-upcast: base tier dry -> the next available slot is spent.
  var dry: SlotPool = { '3': { max: 3, used: 3 }, '4': { max: 1, used: 0 } } as SlotPool;
  var up = planLeveledCast(dry, 'fireball', 'wizard');
  assert.strictEqual(up.slot_level, 4);
  // Requested level clamps into base..9.
  var lowReq = planLeveledCast(pool, 'fireball', 'wizard', 1);
  assert.strictEqual(lowReq.slot_level, 3, 'a sub-base request casts at base');
  var hiReq = planLeveledCast(spellSlotsFor('wizard', 20), 'fireball', 'wizard', 99);
  assert.strictEqual(hiReq.slot_level, 9);
  // Concentration flag fires from the upcast ladder.
  var conc = planLeveledCast(spellSlotsFor('wizard', 3), 'witch_bolt', 'wizard');
  assert.strictEqual(conc.concentration_spell, 'witch_bolt');
  // Gates: unknown spell / wrong class / non-caster / dry pool.
  assert.strictEqual(planLeveledCast(pool, 'nonsense', 'wizard').reason, 'not_known');
  assert.strictEqual(planLeveledCast(pool, 'fireball', 'cleric').reason, 'not_known');
  assert.strictEqual(planLeveledCast(pool, 'fireball', 'fighter').reason, 'not_a_caster');
  var empty = planLeveledCast({ '3': { max: 3, used: 3 } } as SlotPool, 'fireball', 'wizard');
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.reason, 'no_slot');
  assert.strictEqual(empty.slot_level, null);
  // Warlock pact casting.
  var lock = planLeveledCast(spellSlotsFor('warlock', 5), 'hellish_rebuke', 'warlock');
  assert.strictEqual(lock.ok, true);
  assert.strictEqual(lock.slot_level, 3, 'pact slots cast at the pact level');
});

// ---- Gate 2: the generated pack JSON re-validates from disk ---------------------

test('srd5e-pack: packs/srd5e/srd5e_actions_v1.json - every document validates', function () {
  var pack = JSON.parse(readFileSync(join(here, '..', 'packs', 'srd5e', 'srd5e_actions_v1.json'), 'utf8'));
  assert.ok(pack.meta && typeof pack.meta.generator === 'string', 'pack has meta provenance');
  assert.ok(Array.isArray(pack.actions), 'pack has an actions array');
  assert.strictEqual(pack.actions.length, 245, 'expected exactly 245 enumerated actions');
  var ids: Record<string, boolean> = {};
  for (var i = 0; i < pack.actions.length; i++) {
    var a = pack.actions[i] as { id: string; action_type: string; document: unknown };
    assert.ok(typeof a.id === 'string' && a.id.length > 0, 'action ' + i + ' has an id');
    assert.ok(!ids[a.id], 'duplicate action id: ' + a.id);
    ids[a.id] = true;
    if (a.action_type === 'check') validateCheck(a.document as CheckNode);
    else if (a.action_type === 'trigger') validateTriggeredMutations(a.document as MutationNode[]);
    else assert.fail('unknown action_type on ' + a.id);
  }
  // The headline shapes are present.
  assert.ok(ids['fireball_blast_l3'], 'fireball multi-target trigger');
  assert.ok(ids['fireball_single_l3'], 'fireball single-target check');
  assert.ok(ids['magic_missile_l9'], 'magic missile top slot');
  assert.ok(ids['eldritch_blast_beam_agonizing'], 'agonizing EB beam');
  assert.ok(ids['weapon_attack_str_1d8'], 'weapon attack variant');
  assert.ok(ids['toll_the_dead_t17'], 'toll the dead top tier');
  assert.ok(ids['hold_person'], 'condition spell');
  assert.ok(ids['thunderclap_burst_t5'], 'thunderclap burst trigger');
});

// ---- Gate 3: the golden vectors (independent harness implementation) ------------

var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'srd5e_pack_v1.json'), 'utf8'));

interface ActionCase {
  label: string;
  kind: string;
  context: string;
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
  kind: string;
  op: string;
  args: Record<string, unknown>;
  expect: Record<string, unknown>;
}

function scriptedRng(stream: number[], label: string): { rng: Pcg32; consumed(): number } {
  var i = 0;
  var fake = {
    rollDie: function (sides: number): number {
      if (sides === 0) return 0;
      assert.ok(i < stream.length, label + ': dice stream exhausted (implementation over-draws)');
      var v = stream[i] as number;
      i++;
      assert.ok(v >= 1 && v <= sides, label + ': stream entry ' + v + ' out of range for d' + sides);
      return v;
    },
  };
  return { rng: fake as unknown as Pcg32, consumed: function () { return i; } };
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function rebuild(fn: string, args: unknown[]): unknown {
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

function runActionCase(v: ActionCase): void {
  var label = v.label;
  var pre = JSON.stringify(v.state);
  var doc = v.context === 'check' ? v.ast : v.mutations;
  // The builder-drift pin: the named builder must reproduce the embedded
  // document byte-for-byte (JSON-normalized).
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rebuild(v.build.fn, v.build.args))), doc,
    label + ': builder reproduces the embedded document');
  var sr = scriptedRng(v.dice_stream, label);
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
    if (has(ex, 'roll')) assert.strictEqual(r.roll, ex.roll, label + ': roll');
    if (has(ex, 'dc')) assert.strictEqual(r.dc, ex.dc, label + ': dc');
    if (has(ex, 'delta')) assert.strictEqual(r.delta, ex.delta, label + ': delta');
    if (has(ex, 'natural')) assert.strictEqual(r.natural, ex.natural, label + ': natural');
  } else {
    var rt = applyTriggeredMutations(v.state, doc as MutationNode[], ctx);
    endState = rt.state; applied = rt.mutations;
  }
  assert.strictEqual(sr.consumed(), v.dice_stream.length, label + ': dice stream fully consumed');
  assert.strictEqual(JSON.stringify(v.state), pre, label + ': input state never mutated');
  var listed: Record<string, boolean> = {};
  var id: string;
  if (has(ex, 'props_after')) {
    var propsAfter = ex.props_after as Record<string, Record<string, number>>;
    for (id in propsAfter) {
      listed[id] = true;
      var entP = endState.entities[id];
      assert.ok(entP, label + ': entity ' + id + ' exists');
      assert.deepStrictEqual(entP.properties, propsAfter[id], label + ': props_after ' + id);
    }
  }
  if (has(ex, 'tags_after')) {
    var tagsAfter = ex.tags_after as Record<string, string[]>;
    for (id in tagsAfter) {
      listed[id] = true;
      var entT = endState.entities[id];
      assert.ok(entT, label + ': entity ' + id + ' exists');
      assert.deepStrictEqual(entT.tags, tagsAfter[id], label + ': tags_after ' + id);
    }
  }
  if (has(ex, 'hp_after')) {
    var hpAfter = ex.hp_after as Record<string, number>;
    for (id in hpAfter) {
      listed[id] = true;
      var entH = endState.entities[id];
      assert.ok(entH, label + ': entity ' + id + ' exists');
      assert.strictEqual(entH.properties.hp, hpAfter[id], label + ': hp_after ' + id);
    }
  }
  for (id in v.state.entities) {
    if (!listed[id]) {
      assert.deepStrictEqual(endState.entities[id], v.state.entities[id], label + ': entity ' + id + ' unchanged');
    }
  }
  if (has(ex, 'applied')) assert.deepStrictEqual(applied, ex.applied, label + ': applied list (exact order)');
  if (has(ex, 'applied_count')) assert.strictEqual(applied.length, ex.applied_count, label + ': applied_count');
}

function runOpCase(v: OpCase): void {
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
    else assert.fail(label + ': unknown slots op ' + v.op);
  } else {
    if (v.op === 'maintain_dc') got = { dc: maintainSaveDc(a.damage as number) };
    else if (v.op === 'start') got = startConcentration(a.current as ConcentrationState | null, a.spell_id as string, a.spell_name as string | undefined, a.slot_level as number | undefined);
    else if (v.op === 'drop') got = dropConcentration(a.current as ConcentrationState | null);
    else if (v.op === 'maintain') got = maintainSave(a.current as ConcentrationState | null, a.damage as number, a.con_save_total as number);
    else assert.fail(label + ': unknown concentration op ' + v.op);
  }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), v.expect, label + ': op result');
  assert.strictEqual(JSON.stringify(v.args), preArgs, label + ': op inputs never mutated');
}

test('srd5e-pack golden vectors: every case (actions on scripted streams + slots + concentration)', function () {
  assert.ok(Array.isArray(vec.cases), 'vector file has a cases array');
  assert.ok(vec.cases.length >= 70, 'expected >= 70 golden cases, got ' + vec.cases.length);
  var sawAction = false; var sawSlots = false; var sawConc = false;
  for (var i = 0; i < vec.cases.length; i++) {
    var c = vec.cases[i] as { kind: string };
    if (c.kind === 'action') { sawAction = true; runActionCase(c as unknown as ActionCase); }
    else if (c.kind === 'slots') { sawSlots = true; runOpCase(c as unknown as OpCase); }
    else if (c.kind === 'concentration') { sawConc = true; runOpCase(c as unknown as OpCase); }
    else assert.fail('unknown case kind: ' + c.kind);
  }
  assert.ok(sawAction && sawSlots && sawConc, 'all three case kinds are exercised');
});
