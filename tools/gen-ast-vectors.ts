// gen-ast-vectors.ts - generate the v3.0 ruleset-AST golden vector.
//
// Runs the REAL TS evaluator over a Bleed condition, a 5e attack, a PF2e Strike,
// and the audit-recommended regression cases (mul/-0, a crit that actually fires,
// a multi-die natural roll, an astral tag), and pins each resolution + resulting
// state_hash into test_vectors/v3_ast_bleed.json. The AST is stored IN the vector,
// so the Rust + Python ports load the SAME AST + assert the SAME outputs.
// Re-run with: npx tsx tools/gen-ast-vectors.ts

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyTriggeredMutations, evaluateAction, makeContext,
  type MutationNode, type CheckNode,
} from '../src/runtime/ruleset-ast.js';
import { worldStateHash, type WorldState } from '../src/runtime/world-state-snapshot.js';
import { Pcg32 } from '../src/runtime/pcg32.js';

var KEY = 'v3-ast-golden-key';
var ASTRAL = String.fromCodePoint(0x1F40D); // U+1F40D - ASCII-safe construction

interface Case {
  label: string; kind: string; key: string; seed: string;
  actor: string; target?: string;
  state: WorldState; mutations?: MutationNode[]; check?: CheckNode;
  expect: Record<string, unknown>;
}
var cases: Case[] = [];

function condition(label: string, seed: bigint, actor: string, state: WorldState, mutations: MutationNode[]): void {
  var r = applyTriggeredMutations(state, mutations, makeContext(state, actor, seed));
  cases.push({ label, kind: 'condition', key: KEY, seed: seed.toString(), actor, state, mutations,
    expect: { hp_after: r.state.entities[actor] ? r.state.entities[actor].properties.hp : null, applied: r.mutations, state_hash: worldStateHash(KEY, r.state) } });
}
function action(label: string, seed: bigint, actor: string, target: string, state: WorldState, check: CheckNode): void {
  var r = evaluateAction(state, check, makeContext(state, actor, seed, target));
  cases.push({ label, kind: 'action', key: KEY, seed: seed.toString(), actor, target, state, check,
    expect: { degree: r.degree, roll: r.roll, natural: r.natural, dc: r.dc, delta: r.delta, hp_after: r.state.entities[target].properties.hp, state_hash: worldStateHash(KEY, r.state) } });
}

// 1. Bleed: sub hp by floor_div(1d8,2) on turn start (Gemini's case).
condition('Bleed: sub_prop hp by floor_div(1d8,2)', 123456789n, 'e1',
  { epoch: 1, worldSeed: 0, entities: { e1: { properties: { hp: 50 }, tags: [] } } },
  [{ type: 'sub_prop', target: 'self', property: 'hp', value: { type: 'math', op: 'floor_div', left: { type: 'dice', equation: '1d8' }, right: { type: 'literal', value: 2 } } }])

var combat: WorldState = { epoch: 1, worldSeed: 0, entities: {
  hero: { properties: { str_mod: 5 }, tags: [] },
  goblin: { properties: { hp: 20, ac: 12 }, tags: ['foe'] },
} }
var attack5e: CheckNode = {
  type: 'check',
  roll: { type: 'math', op: 'add', left: { type: 'dice', equation: '1d20' }, right: { type: 'prop_ref', target: 'actor', property: 'str_mod' } },
  dc: { type: 'prop_ref', target: 'target', property: 'ac' },
  degrees: {
    critical_success: { condition: { type: 'nat_roll_eq', value: 20 }, mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'dice', equation: '2d8' } }] },
    success: { condition: { type: 'delta_gte', value: 0 }, mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'dice', equation: '1d8' } }] },
  },
}
// 2. 5e attack. 3. PF2e Strike.
action('5e attack: 1d20+str vs AC (seed 777)', 777n, 'hero', 'goblin', combat, attack5e)
var strikePf2e: CheckNode = {
  type: 'check',
  roll: { type: 'math', op: 'add', left: { type: 'dice', equation: '1d20' }, right: { type: 'prop_ref', target: 'actor', property: 'str_mod' } },
  dc: { type: 'prop_ref', target: 'target', property: 'ac' },
  degrees: {
    critical_success: { condition: { type: 'or', conditions: [{ type: 'delta_gte', value: 10 }, { type: 'nat_roll_eq', value: 20 }] },
      mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'math', op: 'mul', left: { type: 'dice', equation: '1d8' }, right: { type: 'literal', value: 2 } } }] },
    success: { condition: { type: 'delta_gte', value: 0 }, mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'dice', equation: '1d8' } }] },
  },
}
action('PF2e Strike: 4 degrees (seed 4242)', 4242n, 'hero', 'goblin', combat, strikePf2e)

// 4. Audit P0: mul manufactures -0 -> must normalize to +0 (hashable on every surface).
condition('mul-neg-zero-stays-positive: set hp = mul(0,-1) -> +0', 1n, 'e1',
  { epoch: 0, worldSeed: 0, entities: { e1: { properties: { hp: 5 }, tags: [] } } },
  [{ type: 'set_prop', target: 'self', property: 'hp', value: { type: 'math', op: 'mul', left: { type: 'literal', value: 0 }, right: { type: 'literal', value: -1 } } }])

// 5. A crit that ACTUALLY fires: brute-force a seed whose first d20 is a natural 20.
var critSeed = 0n
for (var s = 1n; s < 100000n; s++) { if (Pcg32.seeded(s).rollDie(20) === 20) { critSeed = s; break; } }
var critState: WorldState = { epoch: 0, worldSeed: 0, entities: { hero: { properties: { str_mod: 0 }, tags: [] }, goblin: { properties: { hp: 30, ac: 5 }, tags: [] } } }
var critCheck: CheckNode = {
  type: 'check',
  roll: { type: 'math', op: 'add', left: { type: 'dice', equation: '1d20' }, right: { type: 'prop_ref', target: 'actor', property: 'str_mod' } },
  dc: { type: 'prop_ref', target: 'target', property: 'ac' }, // delta also >=0, so crit MUST beat success (precedence)
  degrees: {
    critical_success: { condition: { type: 'nat_roll_eq', value: 20 }, mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'literal', value: 100 } }] },
    success: { condition: { type: 'delta_gte', value: 0 }, mutations: [{ type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'literal', value: 1 } }] },
  },
}
action('crit-fires-nat20 (first-die natural, crit beats success)', critSeed, 'hero', 'goblin', critState, critCheck)

// 6. Multi-die natural: 2d20, natural is the FIRST die (not the sum).
var mdState: WorldState = { epoch: 0, worldSeed: 0, entities: { hero: { properties: {}, tags: [] }, goblin: { properties: { hp: 50, ac: 100 }, tags: [] } } }
var mdCheck: CheckNode = {
  type: 'check',
  roll: { type: 'dice', equation: '2d20' },
  dc: { type: 'prop_ref', target: 'target', property: 'ac' },
  degrees: { critical_success: { condition: { type: 'nat_roll_eq', value: 20 }, mutations: [] }, success: { condition: { type: 'delta_gte', value: 0 }, mutations: [] } },
}
action('multi-die-natural: 2d20 natural is first die (seed 999)', 999n, 'hero', 'goblin', mdState, mdCheck)

// 7. add_tag with an astral char: UTF-16 tag sort survives a mutation + hashes identically.
condition('tag-add-remove-astral (UTF-16 tag sort post-mutation)', 1n, 'e1',
  { epoch: 0, worldSeed: 0, entities: { e1: { properties: { hp: 1 }, tags: ['a', 'z'] } } },
  [{ type: 'add_tag', target: 'self', tag: ASTRAL }])

var out = {
  meta: {
    vector: 'v3.0 ruleset-AST resolution',
    key: KEY,
    note: 'Generated by the real TS evaluator (post audit fixes). Rust + Python ports load the same AST + assert the same outputs (incl floor_div, mul/-0 normalized to +0, first-die natural roll, degree precedence, the UTF-16 tag sort, and the resulting world-state hash).',
  },
  cases,
}
var dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'test_vectors', 'v3_ast_bleed.json')
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log('wrote ' + dest + ' (' + cases.length + ' cases; critSeed=' + critSeed + ')')
for (var i = 0; i < cases.length; i++) {
  console.log('  ' + cases[i].label + ' -> ' + JSON.stringify(cases[i].expect).slice(0, 90))
}
