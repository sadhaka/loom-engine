// Ruleset-AST evaluator tests - v3.0 Phase 2 (post adversarial-audit hardening).
//
// Pins the golden vector (Bleed, 5e attack, PF2e Strike, plus the audit cases:
// mul/-0, a crit that fires, a multi-die natural, an astral tag) and covers the
// fail-closed validation pass: reject BEFORE any rng draw or mutation, the or-depth
// bomb, the node/dice budgets, and unclean / __proto__ names.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyTriggeredMutations, evaluateAction, makeContext, parseDice, evalExpression,
} from '../src/runtime/ruleset-ast.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';
import { Pcg32 } from '../src/runtime/pcg32.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v3_ast_bleed.json'), 'utf8'));

test('golden vector: every AST case resolves to the pinned result', function () {
  assert.ok(vec.cases.length >= 7, 'expected >= 7 golden cases');
  for (var i = 0; i < vec.cases.length; i++) {
    var c = vec.cases[i];
    var seed = BigInt(c.seed);
    if (c.kind === 'condition') {
      var r = applyTriggeredMutations(c.state, c.mutations, makeContext(c.state, c.actor, seed));
      assert.strictEqual(worldStateHash(c.key, r.state), c.expect.state_hash, c.label + ' hash');
    } else {
      var ra = evaluateAction(c.state, c.check, makeContext(c.state, c.actor, seed, c.target));
      assert.strictEqual(ra.degree, c.expect.degree, c.label + ' degree');
      assert.strictEqual(ra.roll, c.expect.roll, c.label + ' roll');
      assert.strictEqual(ra.natural, c.expect.natural, c.label + ' natural');
      assert.strictEqual(worldStateHash(c.key, ra.state), c.expect.state_hash, c.label + ' hash');
    }
  }
});

test('determinism: same seed -> identical resolution', function () {
  var c = vec.cases[1];
  var a = evaluateAction(c.state, c.check, makeContext(c.state, c.actor, BigInt(c.seed), c.target));
  var b = evaluateAction(c.state, c.check, makeContext(c.state, c.actor, BigInt(c.seed), c.target));
  assert.strictEqual(worldStateHash('k', a.state), worldStateHash('k', b.state));
});

test('audit P0: mul never persists -0 (0 * -1 stores +0, stays hashable)', function () {
  var state = { epoch: 0, worldSeed: 0, entities: { e1: { properties: { hp: 5 }, tags: [] } } };
  var r = applyTriggeredMutations(state, [{ type: 'set_prop', target: 'self', property: 'hp',
    value: { type: 'math', op: 'mul', left: { type: 'literal', value: 0 }, right: { type: 'literal', value: -1 } } }],
    makeContext(state, 'e1', 1n));
  assert.strictEqual(r.state.entities.e1.properties.hp, 0);
  assert.ok(!Object.is(r.state.entities.e1.properties.hp, -0), 'must be +0, not -0');
  assert.doesNotThrow(function () { worldStateHash('k', r.state); }, 'must stay hashable');
});

test('audit P1: multi-die natural roll is the FIRST die, not the sum', function () {
  var state = { epoch: 0, worldSeed: 0, entities: { a: { properties: {}, tags: [] }, b: { properties: { ac: 100 }, tags: [] } } };
  var check = { type: 'check' as const, roll: { type: 'dice' as const, equation: '2d20' },
    dc: { type: 'prop_ref' as const, target: 'target', property: 'ac' },
    degrees: { success: { condition: { type: 'delta_gte' as const, value: 0 }, mutations: [] } } };
  var r = evaluateAction(state, check, makeContext(state, 'a', 999n, 'b'));
  assert.strictEqual(r.natural, Pcg32.seeded(999n).rollDie(20), 'natural must equal the first individual d20');
  assert.notStrictEqual(r.natural, r.roll, 'natural (first die) must differ from the sum for this seed');
});

test('audit P1: validation rejects BEFORE any rng draw (zero PRNG advancement on a bad AST)', function () {
  var state = { epoch: 0, worldSeed: 0, entities: { a: { properties: { ac: 1 }, tags: [] }, b: { properties: { hp: 10, ac: 1 }, tags: [] } } };
  var check = {
    type: 'check' as const,
    roll: { type: 'dice' as const, equation: '1d20' },
    dc: { type: 'prop_ref' as const, target: 'target', property: 'ac' },
    degrees: { success: { condition: { type: 'delta_gte' as const, value: 0 }, mutations: [
      { type: 'sub_prop', target: 'target', property: 'hp', value: { type: 'dice', equation: '1d8' } },
      { type: 'frobnicate', target: 'target', property: 'hp', value: { type: 'literal', value: 1 } },
    ] } },
  };
  var ctx = makeContext(state, 'a', 5n, 'b');
  assert.throws(function () { evaluateAction(state, check as unknown as typeof check, ctx); }, /unknown mutation node/);
  // the shared rng must be untouched - validation ran before any roll
  assert.strictEqual(ctx.rng.nextU32(), Pcg32.seeded(5n).nextU32());
});

test('audit P1: or-depth bomb, malformed or, __proto__ + lone-surrogate names all rejected with AST contract', function () {
  var state = { epoch: 0, worldSeed: 0, entities: { a: { properties: {}, tags: [] }, b: { properties: { ac: 1 }, tags: [] } } };
  function chk(cond: unknown, muts?: unknown) {
    return { type: 'check', roll: { type: 'literal', value: 1 }, dc: { type: 'prop_ref', target: 'target', property: 'ac' },
      degrees: { success: { condition: cond, mutations: muts || [] } } } as Parameters<typeof evaluateAction>[1];
  }
  var mk = function () { return makeContext(state, 'a', 1n, 'b'); };
  var deepOr: unknown = { type: 'delta_gte', value: 0 };
  for (var d = 0; d < 20; d++) deepOr = { type: 'or', conditions: [deepOr] };
  assert.throws(function () { evaluateAction(state, chk(deepOr), mk()); }, /AST: .*depth/);
  assert.throws(function () { evaluateAction(state, chk({ type: 'or' }), mk()); }, /conditions array/);
  assert.throws(function () { evaluateAction(state, chk({ type: 'delta_gte', value: 0 }, [{ type: 'set_prop', target: 'target', property: '__proto__', value: { type: 'literal', value: 1 } }]), mk()); }, /__proto__/);
  assert.throws(function () { evaluateAction(state, chk({ type: 'delta_gte', value: 0 }, [{ type: 'add_tag', target: 'target', tag: '\uD800' }]), mk()); });
});

test('audit P1: summed-dice budget rejected before rolling (no multi-second hang)', function () {
  var state = { epoch: 0, worldSeed: 0, entities: { a: { properties: {}, tags: [] } } };
  var muts: unknown[] = [];
  for (var i = 0; i < 20; i++) muts.push({ type: 'set_prop', target: 'self', property: 'p' + i, value: { type: 'dice', equation: '100d6' } });
  assert.throws(function () { applyTriggeredMutations(state, muts as Parameters<typeof applyTriggeredMutations>[1], makeContext(state, 'a', 1n)); }, /budget/);
});

test('parseDice accepts NdM(+/-K), rejects floats + junk + over-cap', function () {
  assert.deepStrictEqual(parseDice('2d6+4'), { count: 2, sides: 6, mod: 4 });
  assert.deepStrictEqual(parseDice('3d8-1'), { count: 3, sides: 8, mod: -1 });
  assert.throws(function () { parseDice('1d8.5'); }, /decimal/);
  assert.throws(function () { parseDice('d20'); });
  assert.throws(function () { parseDice('2x6'); });
  assert.throws(function () { parseDice('1000d6'); }, /out of bounds/); // count cap tightened to 100
});

test('evalExpression: literal/prop_ref/math (floor_div), fail-closed on unknown + non-integer', function () {
  var state = { epoch: 0, worldSeed: 0, entities: { a: { properties: { x: 10 }, tags: [] } } };
  var ctx = makeContext(state, 'a', 1n);
  assert.strictEqual(evalExpression({ type: 'literal', value: 7 }, ctx), 7);
  assert.strictEqual(evalExpression({ type: 'prop_ref', target: 'actor', property: 'x' }, ctx), 10);
  assert.strictEqual(evalExpression({ type: 'math', op: 'floor_div', left: { type: 'literal', value: -7 }, right: { type: 'literal', value: 2 } }, ctx), -4);
  assert.throws(function () { evalExpression({ type: 'literal', value: 1.5 } as unknown as { type: 'literal'; value: number }, ctx); }, /integer/);
  assert.throws(function () { evalExpression({ type: 'bogus' } as unknown as { type: 'literal'; value: number }, ctx); }, /unknown expression/);
});
