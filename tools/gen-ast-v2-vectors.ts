// gen-ast-v2-vectors.ts - generate the AST v2 six-family golden vectors.
//
// Sibling of gen-ast-vectors.ts. Emits EVERY golden-vector case enumerated by
// docs/specs/AST-V2-SPEC.md (vectors A1-A5, B1-B4, C1-C7, D1-D5, E1-E7, F1-F7,
// H1) plus the two complete example rulesets (section 12 PbtA-style move and
// section 13 d100 BRP-style check) as vector-backed cases, in the NORMATIVE
// section 1.5 schema (label / context / actor / target / state / ast |
// mutations | raw_document / dice_stream / expect).
//
// The dice_stream model is the spec section 1.3 scripted harness: entry k is
// the k-th STREAM-CONSUMING rollDie call; zero-sides dice are CALLED but pop
// NOTHING (mirroring production Pcg32.rollDie(0)); accept vectors must consume
// the stream fully; reject vectors must reject AT VALIDATION with zero draws
// and the state unchanged.
//
// Every expectation below is the spec's hand-computed normative value. Before
// writing the file this generator RUNS the real TS evaluator over each case
// and asserts agreement - so the emitted file is simultaneously spec-pinned
// and reference-verified. Re-run with: npx tsx tools/gen-ast-v2-vectors.ts

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

// ---- Vector shape (spec section 1.5, normative) -----------------------------

interface VectorCase {
  label: string;
  context: 'check' | 'trigger';
  actor: string;
  target?: string;
  state: WorldState;
  ast?: unknown;          // check context
  mutations?: unknown;    // trigger context
  raw_document?: string;  // lexical-form vectors (F7): parse THIS, ignore ast/mutations
  dice_stream: number[];
  expect: Record<string, unknown>;
}

var cases: VectorCase[] = [];

// ---- Scripted test PRNG (spec section 1.3) ----------------------------------

interface Scripted { rng: Pcg32; consumed(): number; }

function scriptedRng(stream: number[]): Scripted {
  var i = 0;
  var fake = {
    rollDie: function (sides: number): number {
      if (sides === 0) return 0; // zero-sides dice pop NOTHING (mirrors production)
      if (i >= stream.length) throw new Error('harness: dice stream exhausted');
      var v = stream[i] as number;
      i++;
      if (!(v >= 1 && v <= sides)) throw new Error('harness: stream entry ' + v + ' out of range for d' + sides);
      return v;
    },
  };
  return { rng: fake as unknown as Pcg32, consumed: function () { return i; } };
}

// ---- Reference verification (the generator refuses to pin a wrong vector) ---

function verifyCase(v: VectorCase): void {
  var label = v.label;
  var pre = JSON.stringify(v.state);
  var doc: unknown = v.raw_document !== undefined ? JSON.parse(v.raw_document)
    : (v.context === 'check' ? v.ast : v.mutations);
  var sr = scriptedRng(v.dice_stream);
  var ctx: EvalContext = {
    state: v.state, actorId: v.actor, targetId: v.target, rng: sr.rng,
    naturalRoll: null, eachId: undefined,
  };
  var ex = v.expect;

  if (ex.reject === true) {
    assert.strictEqual(ex.rng_draws_total, 0, label + ': reject vectors pin rng_draws_total 0');
    assert.strictEqual(ex.state_unchanged, true, label + ': reject vectors pin state_unchanged');
    var threw = false;
    try {
      if (v.context === 'check') evaluateAction(v.state, doc as CheckNode, ctx);
      else applyTriggeredMutations(v.state, doc as MutationNode[], ctx);
    } catch (e) { threw = true; }
    assert.ok(threw, label + ': document must reject');
    assert.strictEqual(sr.consumed(), 0, label + ': zero PRNG draws on reject');
    assert.strictEqual(JSON.stringify(v.state), pre, label + ': state unchanged on reject');
    return;
  }

  var endState: WorldState;
  var applied: AppliedMutation[];
  if (v.context === 'check') {
    var r = evaluateAction(v.state, doc as CheckNode, ctx);
    endState = r.state; applied = r.mutations;
    assert.ok(Object.prototype.hasOwnProperty.call(ex, 'degree'), label + ': check vectors REQUIRE expect.degree');
    assert.strictEqual(r.degree, ex.degree, label + ': degree');
    if (Object.prototype.hasOwnProperty.call(ex, 'roll')) assert.strictEqual(r.roll, ex.roll, label + ': roll');
    if (Object.prototype.hasOwnProperty.call(ex, 'dc')) assert.strictEqual(r.dc, ex.dc, label + ': dc');
    if (Object.prototype.hasOwnProperty.call(ex, 'delta')) assert.strictEqual(r.delta, ex.delta, label + ': delta');
    if (Object.prototype.hasOwnProperty.call(ex, 'natural')) assert.strictEqual(r.natural, ex.natural, label + ': natural');
  } else {
    var rt = applyTriggeredMutations(v.state, doc as MutationNode[], ctx);
    endState = rt.state; applied = rt.mutations;
  }
  // The stream MUST be fully consumed on accept vectors (spec 1.3).
  assert.strictEqual(sr.consumed(), v.dice_stream.length, label + ': dice stream fully consumed');
  if (Object.prototype.hasOwnProperty.call(ex, 'rng_draws_total')) {
    assert.strictEqual(ex.rng_draws_total, v.dice_stream.length, label + ': rng_draws_total must equal stream length');
  }
  assert.strictEqual(JSON.stringify(v.state), pre, label + ': input state never mutated');

  var listed: Record<string, boolean> = {};
  var propsAfter = ex.props_after as Record<string, Record<string, number>> | undefined;
  var tagsAfter = ex.tags_after as Record<string, string[]> | undefined;
  var hpAfter = ex.hp_after as Record<string, number> | undefined;
  var id: string;
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
  // Entities NOT listed in any *_after field are asserted UNCHANGED (spec 1.5).
  for (id in v.state.entities) {
    if (!listed[id]) {
      assert.deepStrictEqual(endState.entities[id], v.state.entities[id], label + ': entity ' + id + ' unchanged');
    }
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'applied')) {
    assert.deepStrictEqual(applied, ex.applied, label + ': applied list');
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'applied_count')) {
    assert.strictEqual(applied.length, ex.applied_count, label + ': applied_count');
  }
}

// ============================================================================
// Family A - nat_roll_gte / nat_roll_lte (spec section 2.4)
// ============================================================================

function astA(): unknown {
  return { type: 'check',
    roll: { type: 'dice', equation: '1d20' },
    dc: { type: 'literal', value: 10 },
    degrees: {
      critical_success: { condition: { type: 'nat_roll_gte', value: 19 },
        mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'literal', value: 10 } }] },
      success: { condition: { type: 'delta_gte', value: 0 },
        mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'literal', value: 5 } }] } } };
}
function stateA(): WorldState {
  return { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: {}, tags: [] },
    dummy: { properties: { hp: 30 }, tags: [] } } };
}

cases.push({
  label: 'A1 nat_roll_gte 19 fires on a natural 19',
  context: 'check', actor: 'hero', target: 'dummy',
  state: stateA(), ast: astA(), dice_stream: [19],
  expect: { degree: 'critical_success', roll: 19, natural: 19, dc: 10, delta: 9,
    hp_after: { dummy: 20 }, applied_count: 1 },
});

cases.push({
  label: 'A2 natural 18 misses the band, falls through to success',
  context: 'check', actor: 'hero', target: 'dummy',
  state: stateA(), ast: astA(), dice_stream: [18],
  expect: { degree: 'success', roll: 18, natural: 18, dc: 10, delta: 8,
    hp_after: { dummy: 25 }, applied_count: 1 },
});

cases.push({
  label: 'A3 1d100 vs skill, 97 lands in the fumble band',
  context: 'check', actor: 'hero',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: { skill: 60 }, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'dice', equation: '1d100' },
    dc: { type: 'prop_ref', target: 'actor', property: 'skill' },
    degrees: {
      success: { condition: { type: 'delta_lte', value: 0 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'succeeded' }] },
      failure: { condition: { type: 'and', conditions: [
          { type: 'delta_gte', value: 1 },
          { type: 'nat_roll_lte', value: 95 }] },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'failed' }] },
      critical_failure: { condition: { type: 'nat_roll_gte', value: 96 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'fumbled' }] } } },
  dice_stream: [97],
  expect: { degree: 'critical_failure', roll: 97, natural: 97, dc: 60, delta: 37,
    tags_after: { hero: ['fumbled'] }, applied_count: 1 },
});

cases.push({
  label: 'A4 diceless roll: nat_roll_gte 1 must NOT match',
  context: 'check', actor: 'hero',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: {}, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'literal', value: 7 },
    dc: { type: 'literal', value: 5 },
    degrees: {
      critical_success: { condition: { type: 'nat_roll_gte', value: 1 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'crit' }] },
      success: { condition: { type: 'delta_gte', value: 0 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'hit' }] } } },
  dice_stream: [],
  expect: { degree: 'success', roll: 7, natural: null, dc: 5, delta: 2,
    tags_after: { hero: ['hit'] }, applied_count: 1 },
});

cases.push({
  label: 'A5 2d0 first: natural is 0 (not null), the d0s pop nothing',
  context: 'check', actor: 'hero',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: {}, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'math', op: 'add',
      left: { type: 'dice', equation: '2d0' },
      right: { type: 'dice', equation: '1d6' } },
    dc: { type: 'literal', value: 3 },
    degrees: {
      critical_success: { condition: { type: 'nat_roll_lte', value: 0 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'zeroed' }] },
      success: { condition: { type: 'delta_gte', value: 0 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'plain' }] } } },
  dice_stream: [4],
  expect: { degree: 'critical_success', roll: 4, natural: 0, dc: 3, delta: 1,
    tags_after: { hero: ['zeroed'] }, applied_count: 1, rng_draws_total: 1 },
});

// ============================================================================
// Family B - and (spec section 3.4): PbtA-style bands, 2d6 + cool vs flat 0
// ============================================================================

function astB(): { degrees: Record<string, { condition: unknown; mutations: unknown[] }> } {
  return { type: 'check',
    roll: { type: 'math', op: 'add',
      left: { type: 'dice', equation: '2d6' },
      right: { type: 'prop_ref', target: 'actor', property: 'cool' } },
    dc: { type: 'literal', value: 0 },
    degrees: {
      critical_success: { condition: { type: 'delta_gte', value: 12 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'advanced' }] },
      success: { condition: { type: 'delta_gte', value: 10 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'full_hit' }] },
      failure: { condition: { type: 'and', conditions: [
          { type: 'delta_gte', value: 7 },
          { type: 'delta_lte', value: 9 }] },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'partial' }] },
      critical_failure: { condition: { type: 'delta_lte', value: 6 },
        mutations: [{ type: 'add_prop', target: 'self', property: 'xp', value: { type: 'literal', value: 1 } }] } } } as never;
}
function stateB(): WorldState {
  return { epoch: 0, worldSeed: 0, entities: {
    pc: { properties: { cool: 1 }, tags: [] } } };
}

cases.push({
  label: 'B1 7-9 partial band via and',
  context: 'check', actor: 'pc',
  state: stateB(), ast: astB(), dice_stream: [4, 3],
  expect: { degree: 'failure', roll: 8, natural: 4, dc: 0, delta: 8,
    tags_after: { pc: ['partial'] }, applied_count: 1 },
});

cases.push({
  label: 'B2 12+ advanced band (and does not over-match)',
  context: 'check', actor: 'pc',
  state: stateB(), ast: astB(), dice_stream: [6, 5],
  expect: { degree: 'critical_success', roll: 12, natural: 6, dc: 0, delta: 12,
    tags_after: { pc: ['advanced'] }, applied_count: 1 },
});

cases.push({
  label: 'B3 6- miss band; and children both false',
  context: 'check', actor: 'pc',
  state: stateB(), ast: astB(), dice_stream: [1, 2],
  expect: { degree: 'critical_failure', roll: 4, natural: 1, dc: 0, delta: 4,
    props_after: { pc: { cool: 1, xp: 1 } }, applied_count: 1 },
});

var astB4 = astB();
astB4.degrees.failure = { condition: { type: 'and', conditions: [] },
  mutations: [{ type: 'add_tag', target: 'self', tag: 'partial' }] };
cases.push({
  label: 'B4 empty and rejects at validation',
  context: 'check', actor: 'pc',
  state: stateB(), ast: astB4, dice_stream: [],
  expect: { reject: true, reason: 'and requires a non-empty conditions array',
    rng_draws_total: 0, state_unchanged: true },
});

// ============================================================================
// Family C - compare / has_tag (spec sections 4.4, 4.6)
// ============================================================================

function astC(): { degrees: Record<string, { condition: { op: string }; mutations: unknown[] }> } {
  return { type: 'check',
    roll: { type: 'math', op: 'add',
      left: { type: 'dice', equation: '1d20' },
      right: { type: 'prop_ref', target: 'actor', property: 'str_mod' } },
    dc: { type: 'literal', value: 0 },
    degrees: {
      success: { condition: { type: 'compare', op: 'gte',
          left: { source: 'roll' },
          right: { source: 'prop', target: 'target', property: 'ac' } },
        mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'dice', equation: '1d8' } }] },
      failure: { condition: { type: 'compare', op: 'lt',
          left: { source: 'roll' },
          right: { source: 'prop', target: 'target', property: 'ac' } },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'missed' }] } } } as never;
}
function stateC(): WorldState {
  return { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: { str_mod: 5 }, tags: [] },
    goblin: { properties: { hp: 20, ac: 15 }, tags: [] } } };
}

cases.push({
  label: 'C1 roll total beats target.ac (no precomputed DC)',
  context: 'check', actor: 'hero', target: 'goblin',
  state: stateC(), ast: astC(), dice_stream: [13, 6],
  expect: { degree: 'success', roll: 18, natural: 13, dc: 0, delta: 18,
    hp_after: { goblin: 14 }, applied_count: 1 },
});

cases.push({
  label: 'C2 roll total under target.ac (damage die never rolled)',
  context: 'check', actor: 'hero', target: 'goblin',
  state: stateC(), ast: astC(), dice_stream: [2],
  expect: { degree: 'failure', roll: 7, natural: 2, dc: 0, delta: 7,
    hp_after: { goblin: 20 }, tags_after: { hero: ['missed'] }, applied_count: 1 },
});

cases.push({
  label: 'C3 finisher: crit branch requires target.hp <= 5',
  context: 'check', actor: 'hero', target: 'goblin',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: {}, tags: [] },
    goblin: { properties: { hp: 4, ac: 10 }, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'dice', equation: '1d20' },
    dc: { type: 'prop_ref', target: 'target', property: 'ac' },
    degrees: {
      critical_success: { condition: { type: 'and', conditions: [
          { type: 'delta_gte', value: 0 },
          { type: 'compare', op: 'lte',
            left: { source: 'prop', target: 'target', property: 'hp' },
            right: { source: 'literal', value: 5 } }] },
        mutations: [{ type: 'set_prop', target: 'target', property: 'hp', value: { type: 'literal', value: 0 } }] },
      success: { condition: { type: 'delta_gte', value: 0 },
        mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'literal', value: 1 } }] } } },
  dice_stream: [15],
  expect: { degree: 'critical_success', roll: 15, natural: 15, dc: 10, delta: 5,
    hp_after: { goblin: 0 }, applied_count: 1 },
});

cases.push({
  label: 'C4 compare natural gte 1 must NOT match when natural is null',
  context: 'check', actor: 'hero',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: {}, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'literal', value: 3 },
    dc: { type: 'literal', value: 0 },
    degrees: {
      success: { condition: { type: 'compare', op: 'gte',
          left: { source: 'natural' }, right: { source: 'literal', value: 1 } },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'lucky' }] },
      failure: { condition: { type: 'delta_gte', value: 0 },
        mutations: [{ type: 'add_tag', target: 'self', tag: 'flat' }] } } },
  dice_stream: [],
  expect: { degree: 'failure', roll: 3, natural: null, dc: 0, delta: 3,
    tags_after: { hero: ['flat'] }, applied_count: 1 },
});

var astC5 = astC();
astC5.degrees.success.condition.op = 'div';
cases.push({
  label: 'C5 unknown compare op rejects at validation',
  context: 'check', actor: 'hero', target: 'goblin',
  state: stateC(), ast: astC5, dice_stream: [],
  expect: { reject: true, reason: 'unknown compare op',
    rng_draws_total: 0, state_unchanged: true },
});

function mutationsC6(): unknown {
  return [
    { type: 'if',
      condition: { type: 'has_tag', target: 'self', tag: 'bleeding' },
      then: [{ type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '1d4' } }] }];
}

cases.push({
  label: 'C6 has_tag gates a bleed tick - tag present',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 10 }, tags: ['bleeding'] } } },
  mutations: mutationsC6(), dice_stream: [3],
  expect: { props_after: { e1: { hp: 7 } }, tags_after: { e1: ['bleeding'] },
    applied_count: 1, rng_draws_total: 1 },
});

cases.push({
  label: 'C7 has_tag gates a bleed tick - tag absent: zero draws, zero mutations',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 10 }, tags: [] } } },
  mutations: mutationsC6(), dice_stream: [],
  expect: { props_after: { e1: { hp: 10 } }, tags_after: { e1: [] },
    applied_count: 0, rng_draws_total: 0 },
});

// ============================================================================
// Family D - if (spec section 5.4)
// ============================================================================

function mutationsD1(): unknown {
  return [
    { type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '1d8' } },
    { type: 'if',
      condition: { type: 'compare', op: 'lte',
        left: { source: 'prop', target: 'self', property: 'hp' },
        right: { source: 'literal', value: 0 } },
      then: [
        { type: 'set_prop', target: 'self', property: 'hp', value: { type: 'literal', value: 0 } },
        { type: 'add_tag', target: 'self', tag: 'down' }] }];
}

cases.push({
  label: 'D1 bleed tick then clamp hp at 0 (live-state read)',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 5 }, tags: [] } } },
  mutations: mutationsD1(), dice_stream: [7],
  expect: {
    props_after: { e1: { hp: 0 } }, tags_after: { e1: ['down'] },
    applied: [
      { target: 'e1', property: 'hp', op: 'sub_prop', previous: 5, next: -2 },
      { target: 'e1', property: 'hp', op: 'set_prop', previous: -2, next: 0 },
      { target: 'e1', tag: 'down', op: 'add_tag' }] },
});

cases.push({
  label: 'D2 false condition with no else is a no-op',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 20 }, tags: [] } } },
  mutations: mutationsD1(), dice_stream: [3],
  expect: { props_after: { e1: { hp: 17 } }, tags_after: { e1: [] }, applied_count: 1 },
});

cases.push({
  label: 'D3 dice in the untaken then-branch must not advance the PRNG',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 10, flag: 0 }, tags: [] } } },
  mutations: [
    { type: 'if',
      condition: { type: 'compare', op: 'eq',
        left: { source: 'prop', target: 'self', property: 'flag' },
        right: { source: 'literal', value: 1 } },
      then: [{ type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '1d6' } }],
      else: [{ type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'literal', value: 1 } }] },
    { type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '1d6' } }],
  dice_stream: [4],
  expect: { props_after: { e1: { hp: 5, flag: 0 } }, applied_count: 2, rng_draws_total: 1 },
});

cases.push({
  label: 'D4 delta_gte inside a trigger-context if rejects',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 10 }, tags: [] } } },
  mutations: [
    { type: 'if', condition: { type: 'delta_gte', value: 0 },
      then: [{ type: 'add_tag', target: 'self', tag: 'x' }] }],
  dice_stream: [],
  expect: { reject: true, reason: 'delta_gte is not valid in trigger context',
    rng_draws_total: 0, state_unchanged: true },
});

cases.push({
  label: 'D5 stray els next to then is invisible on every surface',
  context: 'trigger', actor: 'e1',
  state: { epoch: 0, worldSeed: 0, entities: {
    e1: { properties: { hp: 5 }, tags: [] } } },
  mutations: [
    { type: 'if',
      condition: { type: 'compare', op: 'gte',
        left: { source: 'prop', target: 'self', property: 'hp' },
        right: { source: 'literal', value: 100 } },
      then: [{ type: 'add_tag', target: 'self', tag: 'big' }],
      els: [{ type: 'totally_unknown_node' }] }],
  dice_stream: [],
  expect: { props_after: { e1: { hp: 5 } }, tags_after: { e1: [] },
    applied_count: 0, rng_draws_total: 0 },
});

// ============================================================================
// Family E - foreach_target (spec section 6.4)
// ============================================================================

function astE(limit: number): unknown {
  return { type: 'check',
    roll: { type: 'dice', equation: '1d20' },
    dc: { type: 'literal', value: 10 },
    degrees: {
      success: { condition: { type: 'delta_gte', value: 0 },
        mutations: [
          { type: 'foreach_target', select: { tag: 'foe', limit: limit },
            mutations: [{ type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'dice', equation: '1d6' } }] }] } } };
}
function stateE(): WorldState {
  return { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: {}, tags: [] },
    goblin_a: { properties: { hp: 10 }, tags: ['foe'] },
    goblin_b: { properties: { hp: 12 }, tags: ['foe'] },
    ally: { properties: { hp: 8 }, tags: [] } } };
}

cases.push({
  label: 'E1 success branch hits every foe with its own 1d6',
  context: 'check', actor: 'hero',
  state: stateE(), ast: astE(8), dice_stream: [15, 3, 5],
  expect: { degree: 'success', roll: 15, natural: 15, dc: 10, delta: 5,
    hp_after: { goblin_a: 7, goblin_b: 7, ally: 8 },
    applied: [
      { target: 'goblin_a', property: 'hp', op: 'sub_prop', previous: 10, next: 7 },
      { target: 'goblin_b', property: 'hp', op: 'sub_prop', previous: 12, next: 7 }] },
});

cases.push({
  label: 'E2 limit truncates to the deterministic prefix',
  context: 'check', actor: 'hero',
  state: stateE(), ast: astE(1), dice_stream: [15, 4],
  expect: { degree: 'success',
    hp_after: { goblin_a: 6, goblin_b: 12, ally: 8 }, applied_count: 1 },
});

cases.push({
  label: 'E3 ally gains foe during the loop but is NOT iterated (snapshot)',
  context: 'trigger', actor: 'caster', target: 'ally',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: {}, tags: [] },
    g_a: { properties: { hp: 10 }, tags: ['foe'] },
    g_b: { properties: { hp: 12 }, tags: ['foe'] },
    ally: { properties: { hp: 8 }, tags: [] } } },
  mutations: [
    { type: 'foreach_target', select: { tag: 'foe' },
      mutations: [
        { type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'literal', value: 2 } },
        { type: 'add_tag', target: 'target', tag: 'foe' }] }],
  dice_stream: [],
  expect: { hp_after: { g_a: 8, g_b: 10, ally: 8 },
    tags_after: { ally: ['foe'] }, applied_count: 4 },
});

cases.push({
  label: 'E4 ids sort by UTF-16 code units (e10 before e2), then limit 2 keeps the prefix',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: {}, tags: [] },
    e10: { properties: { hp: 10 }, tags: ['foe'] },
    e2: { properties: { hp: 10 }, tags: ['foe'] },
    e3: { properties: { hp: 10 }, tags: ['foe'] } } },
  mutations: [
    { type: 'foreach_target', select: { tag: 'foe', limit: 2 },
      mutations: [{ type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'dice', equation: '1d4' } }] }],
  dice_stream: [2, 3],
  expect: { hp_after: { e10: 8, e2: 7, e3: 10 }, applied_count: 2 },
});

cases.push({
  label: 'E5 each with no enclosing foreach_target rejects at validation',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: { hp: 5 }, tags: [] } } },
  mutations: [{ type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'literal', value: 1 } }],
  dice_stream: [],
  expect: { reject: true, reason: "target ref 'each' is only valid inside foreach_target",
    rng_draws_total: 0, state_unchanged: true },
});

cases.push({
  label: 'E6 every foe saves vs the caster DC; half damage on success (scratch-property idiom)',
  context: 'trigger', actor: 'hero',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: { spell_dc: 13 }, tags: [] },
    g_a: { properties: { hp: 20, dex_save: 5 }, tags: ['foe'] },
    g_b: { properties: { hp: 15, dex_save: 0 }, tags: ['foe'] } } },
  mutations: [
    { type: 'foreach_target', select: { tag: 'foe' },
      mutations: [
        { type: 'set_prop', target: 'each', property: 'save_roll',
          value: { type: 'math', op: 'add',
            left: { type: 'dice', equation: '1d20' },
            right: { type: 'prop_ref', target: 'each', property: 'dex_save' } } },
        { type: 'if',
          condition: { type: 'compare', op: 'gte',
            left: { source: 'prop', target: 'each', property: 'save_roll' },
            right: { source: 'prop', target: 'actor', property: 'spell_dc' } },
          then: [{ type: 'sub_prop', target: 'each', property: 'hp',
            value: { type: 'math', op: 'floor_div',
              left: { type: 'dice', equation: '2d6' },
              right: { type: 'literal', value: 2 } } }],
          else: [{ type: 'sub_prop', target: 'each', property: 'hp',
            value: { type: 'dice', equation: '2d6' } }] }] }],
  dice_stream: [9, 4, 5, 7, 6, 2],
  expect: { props_after: {
      g_a: { hp: 16, dex_save: 5, save_roll: 14 },
      g_b: { hp: 7, dex_save: 0, save_roll: 7 } },
    applied_count: 4, rng_draws_total: 6 },
});

cases.push({
  label: 'E7 a tag added in repeat-iteration 1 joins iteration 2 selection (re-select per execution)',
  context: 'trigger', actor: 'caster', target: 'recruit',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: {}, tags: [] },
    g_a: { properties: { hp: 10 }, tags: ['foe'] },
    recruit: { properties: { hp: 10 }, tags: [] } } },
  mutations: [
    { type: 'repeat', count: 2,
      mutations: [
        { type: 'foreach_target', select: { tag: 'foe' },
          mutations: [
            { type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'dice', equation: '1d4' } },
            { type: 'add_tag', target: 'target', tag: 'foe' }] }] }],
  dice_stream: [2, 3, 1],
  expect: { props_after: { g_a: { hp: 5 }, recruit: { hp: 9 } },
    tags_after: { g_a: ['foe'], recruit: ['foe'] },
    applied_count: 6, rng_draws_total: 3 },
});

// ============================================================================
// Family F - repeat (spec section 7.4)
// ============================================================================

cases.push({
  label: 'F1 repeat 3 of sub_prop target.hp 1d4+1 (each missile rolled fresh)',
  context: 'trigger', actor: 'mage', target: 'imp',
  state: { epoch: 0, worldSeed: 0, entities: {
    mage: { properties: {}, tags: [] },
    imp: { properties: { hp: 20 }, tags: [] } } },
  mutations: [
    { type: 'repeat', count: 3,
      mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'dice', equation: '1d4+1' } }] }],
  dice_stream: [2, 4, 1],
  expect: { hp_after: { imp: 10 },
    applied: [
      { target: 'imp', property: 'hp', op: 'sub_prop', previous: 20, next: 17 },
      { target: 'imp', property: 'hp', op: 'sub_prop', previous: 17, next: 12 },
      { target: 'imp', property: 'hp', op: 'sub_prop', previous: 12, next: 10 }] },
});

cases.push({
  label: 'F2 two ticks per foe (repeat inside foreach; target order is the outer loop)',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: {}, tags: [] },
    g_a: { properties: { hp: 5 }, tags: ['foe'] },
    g_b: { properties: { hp: 5 }, tags: ['foe'] } } },
  mutations: [
    { type: 'foreach_target', select: { tag: 'foe' },
      mutations: [
        { type: 'repeat', count: 2,
          mutations: [{ type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'literal', value: 1 } }] }] }],
  dice_stream: [],
  expect: { hp_after: { g_a: 3, g_b: 3 }, applied_count: 4 },
});

cases.push({
  label: 'F3 repeat count 0 rejects',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: { hp: 5 }, tags: [] } } },
  mutations: [{ type: 'repeat', count: 0, mutations: [] }],
  dice_stream: [],
  expect: { reject: true, reason: 'repeat count must be an integer in 1..16',
    rng_draws_total: 0, state_unchanged: true },
});

cases.push({
  label: 'F4 repeat count 17 rejects (over MAX_ITERATIONS)',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: { hp: 5 }, tags: [] } } },
  mutations: [{ type: 'repeat', count: 17, mutations: [] }],
  dice_stream: [],
  expect: { reject: true, reason: 'repeat count must be an integer in 1..16',
    rng_draws_total: 0, state_unchanged: true },
});

cases.push({
  label: 'F5 multiplicity overruns MAX_APPLIED_MUTATIONS (3 leaves x 512 = 1536 > 1024)',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: {}, tags: [] } } },
  mutations: [
    { type: 'repeat', count: 16,
      mutations: [
        { type: 'foreach_target', select: { tag: 'foe', limit: 32 },
          mutations: [
            { type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'literal', value: 1 } },
            { type: 'add_tag', target: 'each', tag: 'burning' },
            { type: 'remove_tag', target: 'each', tag: 'hidden' }] }] }],
  dice_stream: [],
  expect: { reject: true, reason: 'applied-mutation budget exceeded (max 1024)',
    rng_draws_total: 0, state_unchanged: true },
});

cases.push({
  label: 'F6 multiplied dice overrun MAX_DICE_TOTAL (2d6 x 512 = 1024 > 1000)',
  context: 'trigger', actor: 'caster',
  state: { epoch: 0, worldSeed: 0, entities: {
    caster: { properties: {}, tags: [] } } },
  mutations: [
    { type: 'foreach_target', select: { tag: 'foe', limit: 32 },
      mutations: [
        { type: 'repeat', count: 16,
          mutations: [{ type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'dice', equation: '2d6' } }] }] }],
  dice_stream: [],
  expect: { reject: true, reason: 'total dice count exceeds budget 1000',
    rng_draws_total: 0, state_unchanged: true },
});

cases.push({
  label: 'F7 repeat count written as 3.0 parses to integer 3 everywhere',
  context: 'trigger', actor: 'mage', target: 'imp',
  state: { epoch: 0, worldSeed: 0, entities: {
    mage: { properties: {}, tags: [] },
    imp: { properties: { hp: 20 }, tags: [] } } },
  raw_document: '[{"type":"repeat","count":3.0,"mutations":[{"type":"sub_prop","target":"target","property":"hp","value":{"type":"dice","equation":"1d4+1"}}]}]',
  dice_stream: [2, 4, 1],
  expect: { hp_after: { imp: 10 }, applied_count: 3, rng_draws_total: 3 },
});

// ============================================================================
// Vector H1 - the budget accumulator is document-global (spec section 8.6)
// ============================================================================

function threeBigHits(): unknown[] {
  return [
    { type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '100d6' } },
    { type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '100d6' } },
    { type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'dice', equation: '100d6' } }];
}

cases.push({
  label: 'H1 dice budget sums across ALL degree branches',
  context: 'check', actor: 'hero',
  state: { epoch: 0, worldSeed: 0, entities: {
    hero: { properties: { hp: 1000 }, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'dice', equation: '1d20' },
    dc: { type: 'literal', value: 10 },
    degrees: {
      critical_success: { condition: { type: 'delta_gte', value: 10 }, mutations: threeBigHits() },
      success: { condition: { type: 'delta_gte', value: 0 }, mutations: threeBigHits() },
      failure: { condition: { type: 'delta_lte', value: -1 }, mutations: threeBigHits() },
      critical_failure: { condition: { type: 'delta_lte', value: -10 }, mutations: threeBigHits() } } },
  dice_stream: [],
  expect: { reject: true, reason: 'total dice count exceeds budget 1000',
    rng_draws_total: 0, state_unchanged: true },
});

// ============================================================================
// Example ruleset 1 - PbtA-style move "Act Under Pressure" (spec section 12)
// ============================================================================

cases.push({
  label: 'S12 PbtA Act Under Pressure: 2d6+cool, 7-9 partial hit costs 1 stress',
  context: 'check', actor: 'pc',
  state: { epoch: 0, worldSeed: 0, entities: {
    pc: { properties: { cool: 1 }, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'math', op: 'add',
      left: { type: 'dice', equation: '2d6' },
      right: { type: 'prop_ref', target: 'actor', property: 'cool' } },
    dc: { type: 'literal', value: 0 },
    degrees: {
      critical_success: {
        condition: { type: 'delta_gte', value: 12 },
        mutations: [
          { type: 'add_tag', target: 'actor', tag: 'advanced_hit' },
          { type: 'add_prop', target: 'actor', property: 'momentum', value: { type: 'literal', value: 2 } },
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 3 } }] },
      success: {
        condition: { type: 'delta_gte', value: 10 },
        mutations: [
          { type: 'add_tag', target: 'actor', tag: 'full_hit' },
          { type: 'add_prop', target: 'actor', property: 'momentum', value: { type: 'literal', value: 1 } },
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 2 } }] },
      failure: {
        condition: { type: 'and', conditions: [
          { type: 'delta_gte', value: 7 },
          { type: 'delta_lte', value: 9 }] },
        mutations: [
          { type: 'add_tag', target: 'actor', tag: 'partial_hit' },
          { type: 'add_prop', target: 'actor', property: 'stress', value: { type: 'literal', value: 1 } },
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 1 } }] },
      critical_failure: {
        condition: { type: 'delta_lte', value: 6 },
        mutations: [
          { type: 'add_tag', target: 'actor', tag: 'missed' },
          { type: 'add_prop', target: 'actor', property: 'xp', value: { type: 'literal', value: 1 } },
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 0 } }] } } },
  dice_stream: [4, 3],
  expect: { degree: 'failure', roll: 8, natural: 4, dc: 0, delta: 8,
    props_after: { pc: { cool: 1, stress: 1, last_outcome: 1 } },
    tags_after: { pc: ['partial_hit'] },
    applied_count: 3, rng_draws_total: 2 },
});

// ============================================================================
// Example ruleset 2 - d100 BRP-style skill check (spec section 13)
// ============================================================================

cases.push({
  label: 'S13 BRP d100 roll-under: natural 7 vs skill 40 is a special success (rider inside success)',
  context: 'check', actor: 'adventurer',
  state: { epoch: 0, worldSeed: 0, entities: {
    adventurer: { properties: { skill: 40, skill_fifth: 8 }, tags: [] } } },
  ast: { type: 'check',
    roll: { type: 'dice', equation: '1d100' },
    dc: { type: 'prop_ref', target: 'actor', property: 'skill' },
    degrees: {
      critical_success: {
        condition: { type: 'and', conditions: [
          { type: 'nat_roll_lte', value: 5 },
          { type: 'delta_lte', value: 0 }] },
        mutations: [
          { type: 'add_tag', target: 'actor', tag: 'crit' },
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 4 } }] },
      success: {
        condition: { type: 'and', conditions: [
          { type: 'delta_lte', value: 0 },
          { type: 'nat_roll_lte', value: 95 }] },
        mutations: [
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 2 } },
          { type: 'if',
            condition: { type: 'compare', op: 'lte',
              left: { source: 'natural' },
              right: { source: 'prop', target: 'actor', property: 'skill_fifth' } },
            then: [
              { type: 'add_tag', target: 'actor', tag: 'special_success' },
              { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 3 } }] }] },
      failure: {
        condition: { type: 'and', conditions: [
          { type: 'delta_gte', value: 1 },
          { type: 'nat_roll_lte', value: 95 }] },
        mutations: [
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 1 } }] },
      critical_failure: {
        condition: { type: 'nat_roll_gte', value: 96 },
        mutations: [
          { type: 'add_tag', target: 'actor', tag: 'fumble' },
          { type: 'set_prop', target: 'actor', property: 'last_outcome', value: { type: 'literal', value: 0 } }] } } },
  dice_stream: [7],
  expect: { degree: 'success', roll: 7, natural: 7, dc: 40, delta: -33,
    props_after: { adventurer: { skill: 40, skill_fifth: 8, last_outcome: 3 } },
    tags_after: { adventurer: ['special_success'] },
    applied_count: 3, rng_draws_total: 1 },
});

// ---- Verify every case against the real evaluator, then write ---------------

for (var ci = 0; ci < cases.length; ci++) {
  verifyCase(cases[ci] as VectorCase);
}

var out = {
  meta: {
    generator: 'tools/gen-ast-v2-vectors.ts',
    generated_note: 'Regenerate with: npx tsx tools/gen-ast-v2-vectors.ts (runs the real TS ruleset-AST evaluator over every scripted dice stream and asserts the hand-computed AST-V2-SPEC.md expectation before writing).',
    vector: 'AST v2 six-family golden vectors (scripted dice streams, spec section 1.5 schema)',
    spec: 'docs/specs/AST-V2-SPEC.md',
    note: 'Machine-readable form of every golden vector AST-V2-SPEC.md enumerates (A1-A5, B1-B4, C1-C7, D1-D5, E1-E7, F1-F7, H1) plus the section 12 PbtA move and section 13 BRP check as vector-backed cases (S12, S13). Harness rules per spec 1.3/1.5: scripted rollDie pops stream entries in order; rollDie(0) returns 0 and pops NOTHING; accept vectors must consume the stream fully; reject vectors reject AT VALIDATION (zero draws, state unchanged); reason strings are informative only, never asserted.',
  },
  cases: cases,
};
var dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'test_vectors', 'ast_v2_families.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote ' + dest + ' (' + cases.length + ' cases, all verified against the TS evaluator)');
for (var li = 0; li < cases.length; li++) {
  console.log('  ' + (cases[li] as VectorCase).label);
}
