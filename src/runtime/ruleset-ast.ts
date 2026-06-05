// ruleset-ast.ts - deterministic data-driven ruleset interpreter (the Any-System core).
//
// 3.0 Phase 2. The ruleset is a strict JSON AST the engine EVALUATES, never code
// it executes - so a player can bring any tabletop system (5e, PF2e, homebrew)
// with no untrusted-code risk. This is the consumer-supplied reducer from
// world-replay, expressed as data: (WorldState, action/trigger) -> mutations.
//
// Determinism gates (hard):
//   - integer-only; a dice equation with a '.' is REJECTED, every literal must be
//     a JS-safe integer.
//   - all randomness via Pcg32 (seeded); dice consume the PRNG in a FIXED order
//     (expressions evaluate left-to-right, depth-first), so a replay reproduces
//     the exact rolls.
//   - the ONLY division node is floor_div (toward -inf); native '/' does not exist.
//   - the raw "natural roll" (first die in a check's roll expression) is exposed
//     to degree conditions, so nat_roll_eq (crit on a natural 20) is deterministic.
//
// Cross-language: every numeric op routes through Pcg32 + floorDiv (both already
// byte-parity across TS/Rust/Python), so a faithful Rust/Python port resolves the
// same AST to the same mutations. Pinned by test_vectors/v3_ast_bleed.json.
//
// Code style: var-only in browser source.

import type { WorldState, WorldEntity } from './world-state-snapshot.js';
import { normalizeTags } from './world-state-snapshot.js';
import { Pcg32 } from './pcg32.js';
import { floorDiv } from './integer-math.js';
import { assertCleanString } from './event-chain.js';

var MAX_INT = 9007199254740991; // 2^53 - 1 (referenced by the validation pass)
var MAX_EXPR_DEPTH = 16;        // bound expression + degree-condition nesting
var MAX_NODES = 256;            // audit P1: bound TOTAL AST nodes per action (not just depth)
var MAX_DICE_TOTAL = 1000;      // audit P1: bound summed dice `count` per action (DoS)

// ---- AST node types -------------------------------------------------------

export type ExprNode =
  | { type: 'literal'; value: number }
  | { type: 'dice'; equation: string }
  | { type: 'prop_ref'; target: string; property: string }
  | { type: 'math'; op: 'add' | 'sub' | 'mul' | 'floor_div'; left: ExprNode; right: ExprNode };

export type MutationNode =
  | { type: 'set_prop' | 'add_prop' | 'sub_prop'; target: string; property: string; value: ExprNode }
  | { type: 'add_tag' | 'remove_tag'; target: string; tag: string };

export type DegreeCond =
  | { type: 'delta_gte'; value: number }
  | { type: 'delta_lte'; value: number }
  | { type: 'nat_roll_eq'; value: number }
  | { type: 'or'; conditions: DegreeCond[] };

export interface DegreeBranch { condition: DegreeCond; mutations: MutationNode[]; }

export interface CheckNode {
  type: 'check';
  roll: ExprNode;  // e.g. 1d20 + str_mod; the FIRST die is the natural roll
  dc: ExprNode;
  degrees: Record<string, DegreeBranch>;
}

// Degrees are evaluated in this FIXED order across every surface (first match wins).
var DEGREE_ORDER = ['critical_success', 'success', 'failure', 'critical_failure'];

// ---- Evaluation context ---------------------------------------------------

export interface EvalContext {
  state: WorldState;
  actorId: string;
  targetId: string | undefined;
  rng: Pcg32;
  // The first die rolled while evaluating a check's `roll` expression (the
  // "natural roll"). Reset to null before each check.
  naturalRoll: number | null;
}

export interface ActionResult {
  state: WorldState;
  degree: string;       // the winning degree, or 'none'
  roll: number;
  natural: number | null;
  dc: number;
  delta: number;
  mutations: AppliedMutation[];
}

export interface AppliedMutation {
  target: string; property?: string; tag?: string; op: string; previous?: number; next?: number;
}

// ---- Dice ------------------------------------------------------------------

export interface ParsedDice { count: number; sides: number; mod: number; }

// Parse "NdM", "NdM+K", "NdM-K". Rejects any '.' (no floats) and out-of-bounds.
export function parseDice(equation: string): ParsedDice {
  if (typeof equation !== 'string' || equation.indexOf('.') >= 0) {
    throw new Error('AST: dice equation must be a decimal-free string: ' + equation);
  }
  var m = /^([0-9]+)d([0-9]+)([+-][0-9]+)?$/.exec(equation);
  if (!m) throw new Error('AST: invalid dice equation: ' + equation);
  var count = parseInt(m[1] as string, 10);
  var sides = parseInt(m[2] as string, 10);
  var mod = m[3] ? parseInt(m[3], 10) : 0;
  if (count < 0 || count > 100 || sides < 0 || sides > 100000) {
    throw new Error('AST: dice out of bounds: ' + equation);
  }
  // Codex P1b: the modifier - and the whole result range [count+mod .. count*sides+mod]
  // - must stay JS-safe. Otherwise eval would ROLL the dice (advancing the PRNG)
  // before assertInt throws on the unsafe sum, violating the fail-closed / zero-rng
  // contract (a hostile equation could nudge the PRNG, then "fail"). parseDice runs
  // during validation (before any draw), so rejecting here closes that. count*sides
  // <= 1e7, so the modifier is the only component that can breach safe range.
  if (!Number.isSafeInteger(mod)
    || !Number.isSafeInteger(count * sides + mod)
    || !Number.isSafeInteger(count + mod)) {
    throw new Error('AST: dice modifier/result out of safe-integer range: ' + equation);
  }
  return { count: count, sides: sides, mod: mod };
}

// ---- Helpers ---------------------------------------------------------------

function resolveTarget(t: string, ctx: EvalContext): string {
  if (t === 'actor' || t === 'self') return ctx.actorId;
  if (t === 'target') {
    if (ctx.targetId === undefined) throw new Error('AST: action references target but none supplied');
    return ctx.targetId;
  }
  throw new Error('AST: unknown target ref: ' + t);
}

function ensureEntity(state: WorldState, id: string): WorldEntity {
  var ent = state.entities[id];
  if (!ent) { ent = { properties: {}, tags: [] }; state.entities[id] = ent; }
  return ent;
}

function assertInt(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new Error('AST: ' + what + ' must be a JS-safe integer: ' + n);
  // Audit P0: `mul` can manufacture -0 (e.g. 0 * -1); Number.isSafeInteger(-0) is
  // true, so it would store, then canonicalJson REJECTS -0 at the hash gate - a
  // TS-only throw the integer Rust/Python ports never hit. Normalize -0 -> +0 at
  // this central choke point so every surface stores +0 (and stays hashable).
  if (Object.is(n, -0)) return 0;
  return n;
}

// ---- Expression evaluation -------------------------------------------------

// Evaluate an expression to an integer. PRNG draws happen in evaluation order
// (left-to-right, depth-first), so the sequence is deterministic + replayable.
export function evalExpression(node: ExprNode, ctx: EvalContext, depth: number = 0): number {
  if (depth > MAX_EXPR_DEPTH) throw new Error('AST: expression exceeds max depth ' + MAX_EXPR_DEPTH);
  if (!node || typeof node.type !== 'string') throw new Error('AST: malformed expression node');
  switch (node.type) {
    case 'literal':
      return assertInt(node.value, 'literal');
    case 'dice': {
      var p = parseDice(node.equation);
      // Roll die-by-die (the SAME PRNG sequence rollDice loops), so we can capture
      // the FIRST INDIVIDUAL die as the natural roll - NOT the sum (audit P1: a
      // 2d20 must crit on a natural 20 on one die, not on two 10s summing to 20).
      var sum = 0;
      for (var di = 0; di < p.count; di++) {
        var oneDie = ctx.rng.rollDie(p.sides);
        if (ctx.naturalRoll === null) ctx.naturalRoll = oneDie;
        sum += oneDie;
      }
      return assertInt(sum + p.mod, 'dice result');
    }
    case 'prop_ref': {
      var id = resolveTarget(node.target, ctx);
      var ent = ctx.state.entities[id];
      var v = ent && ent.properties ? ent.properties[node.property] : undefined;
      return assertInt(v === undefined ? 0 : v, 'property ' + node.property);
    }
    case 'math': {
      var l = evalExpression(node.left, ctx, depth + 1);  // LEFT first - fixes PRNG order
      var r = evalExpression(node.right, ctx, depth + 1);
      var out: number;
      if (node.op === 'add') out = l + r;
      else if (node.op === 'sub') out = l - r;
      else if (node.op === 'mul') out = l * r;
      else if (node.op === 'floor_div') out = floorDiv(l, r);
      else throw new Error('AST: unknown math op: ' + (node as { op: string }).op);
      return assertInt(out, 'math result');
    }
    default:
      throw new Error('AST: unknown expression node type: ' + (node as { type: string }).type);
  }
}

// ---- Degree matching -------------------------------------------------------

function matchDegree(cond: DegreeCond, delta: number, natural: number | null, depth: number = 0): boolean {
  if (depth > MAX_EXPR_DEPTH) throw new Error('AST: degree condition exceeds max depth ' + MAX_EXPR_DEPTH);
  if (!cond || typeof cond.type !== 'string') throw new Error('AST: malformed degree condition');
  switch (cond.type) {
    case 'delta_gte': return delta >= assertInt(cond.value, 'delta_gte');
    case 'delta_lte': return delta <= assertInt(cond.value, 'delta_lte');
    case 'nat_roll_eq': return natural !== null && natural === assertInt(cond.value, 'nat_roll_eq');
    case 'or': {
      if (!Array.isArray(cond.conditions)) throw new Error('AST: or condition requires a conditions array');
      for (var i = 0; i < cond.conditions.length; i++) {
        if (matchDegree(cond.conditions[i] as DegreeCond, delta, natural, depth + 1)) return true;
      }
      return false;
    }
    default: throw new Error('AST: unknown degree condition: ' + (cond as { type: string }).type);
  }
}

// ---- Mutation application --------------------------------------------------

// Apply one mutation to the (already-cloned) working state. Returns a record of
// what changed, for the resolved event.
function applyMutation(state: WorldState, node: MutationNode, ctx: EvalContext): AppliedMutation {
  if (!node || typeof node.type !== 'string') throw new Error('AST: malformed mutation node');
  var id = resolveTarget(node.target, ctx);
  var ent = ensureEntity(state, id);
  switch (node.type) {
    case 'set_prop':
    case 'add_prop':
    case 'sub_prop': {
      var value = evalExpression(node.value, ctx);
      var prev = ent.properties[node.property];
      if (prev === undefined) prev = 0;
      var next: number;
      if (node.type === 'set_prop') next = value;
      else if (node.type === 'add_prop') next = prev + value;
      else next = prev - value;
      var finalVal = assertInt(next, 'mutated property ' + node.property);
      ent.properties[node.property] = finalVal;
      return { target: id, property: node.property, op: node.type, previous: prev, next: finalVal };
    }
    case 'add_tag':
      ent.tags = normalizeTags(ent.tags.concat([node.tag]));
      return { target: id, tag: node.tag, op: 'add_tag' };
    case 'remove_tag':
      ent.tags = ent.tags.filter(function (t) { return t !== node.tag; });
      return { target: id, tag: node.tag, op: 'remove_tag' };
    default:
      throw new Error('AST: unknown mutation node type: ' + (node as { type: string }).type);
  }
}

function cloneState(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}

// ---- Static validation pass (audit P1: validate BEFORE any RNG draw / mutation) -
//
// Walks the entire AST once, touching NO rng and NO state, and rejects fail-closed
// on: unknown node types, non-integer literals, over-depth expression OR degree
// subtrees, a non-array `or.conditions`, malformed dice (float / junk / out of
// bounds), unclean or __proto__ property/tag names, and the node + summed-dice
// budgets. Because it runs before evaluateAction/applyTriggeredMutations touch the
// PRNG, a rejected AST advances neither rng nor state - so the reject boundary is
// byte-identical across TS / Rust / Python.

interface ValidateBudget { nodes: number; dice: number; }

function bumpNode(b: ValidateBudget): void {
  b.nodes++;
  if (b.nodes > MAX_NODES) throw new Error('AST: node budget exceeded (max ' + MAX_NODES + ')');
}

function validateTargetRef(t: string): void {
  if (t !== 'actor' && t !== 'self' && t !== 'target') throw new Error('AST: unknown target ref: ' + t);
}

// Player-supplied property / tag names: reject lone surrogates (canonicalJson would
// otherwise throw at the hash gate AFTER mutating - audit P2) and an own __proto__ key.
function assertCleanName(s: string, what: string): void {
  if (typeof s !== 'string' || s.length === 0) throw new Error('AST: ' + what + ' name must be a non-empty string');
  if (s === '__proto__') throw new Error('AST: ' + what + ' name "__proto__" is forbidden');
  assertCleanString(s);
}

function validateExpr(node: ExprNode, b: ValidateBudget, depth: number): void {
  bumpNode(b);
  if (depth > MAX_EXPR_DEPTH) throw new Error('AST: expression exceeds max depth ' + MAX_EXPR_DEPTH);
  if (!node || typeof node.type !== 'string') throw new Error('AST: malformed expression node');
  switch (node.type) {
    case 'literal':
      assertInt(node.value, 'literal');
      return;
    case 'dice': {
      var p = parseDice(node.equation); // dry-run: throws on float / junk / out-of-bounds
      b.dice += p.count;
      if (b.dice > MAX_DICE_TOTAL) throw new Error('AST: total dice count exceeds budget ' + MAX_DICE_TOTAL);
      return;
    }
    case 'prop_ref':
      validateTargetRef(node.target);
      assertCleanName(node.property, 'property');
      return;
    case 'math':
      if (node.op !== 'add' && node.op !== 'sub' && node.op !== 'mul' && node.op !== 'floor_div') {
        throw new Error('AST: unknown math op: ' + (node as { op: string }).op);
      }
      validateExpr(node.left, b, depth + 1);
      validateExpr(node.right, b, depth + 1);
      return;
    default:
      throw new Error('AST: unknown expression node type: ' + (node as { type: string }).type);
  }
}

function validateDegreeCond(cond: DegreeCond, b: ValidateBudget, depth: number): void {
  bumpNode(b);
  if (depth > MAX_EXPR_DEPTH) throw new Error('AST: degree condition exceeds max depth ' + MAX_EXPR_DEPTH);
  if (!cond || typeof cond.type !== 'string') throw new Error('AST: malformed degree condition');
  switch (cond.type) {
    case 'delta_gte':
    case 'delta_lte':
    case 'nat_roll_eq':
      assertInt(cond.value, cond.type);
      return;
    case 'or':
      if (!Array.isArray(cond.conditions)) throw new Error('AST: or condition requires a conditions array');
      for (var i = 0; i < cond.conditions.length; i++) {
        validateDegreeCond(cond.conditions[i] as DegreeCond, b, depth + 1);
      }
      return;
    default:
      throw new Error('AST: unknown degree condition: ' + (cond as { type: string }).type);
  }
}

function validateMutation(node: MutationNode, b: ValidateBudget): void {
  bumpNode(b);
  if (!node || typeof node.type !== 'string') throw new Error('AST: malformed mutation node');
  validateTargetRef(node.target);
  switch (node.type) {
    case 'set_prop':
    case 'add_prop':
    case 'sub_prop':
      assertCleanName(node.property, 'property');
      validateExpr(node.value, b, 0);
      return;
    case 'add_tag':
    case 'remove_tag':
      assertCleanName(node.tag, 'tag');
      return;
    default:
      throw new Error('AST: unknown mutation node type: ' + (node as { type: string }).type);
  }
}

function validateMutationList(mutations: MutationNode[], b: ValidateBudget): void {
  if (!Array.isArray(mutations)) throw new Error('AST: mutations must be an array');
  for (var i = 0; i < mutations.length; i++) validateMutation(mutations[i] as MutationNode, b);
}

// Validate a full check AST fail-closed (no rng / no state). Call before eval, or
// at ruleset-load time. Throws 'AST: ...' on any violation.
export function validateCheck(check: CheckNode): void {
  if (!check || check.type !== 'check') throw new Error('AST: expected a check node');
  var b: ValidateBudget = { nodes: 0, dice: 0 };
  validateExpr(check.roll, b, 0);
  validateExpr(check.dc, b, 0);
  if (!check.degrees || typeof check.degrees !== 'object') throw new Error('AST: check.degrees must be an object');
  var keys = Object.keys(check.degrees).sort();
  for (var k = 0; k < keys.length; k++) {
    var branch = check.degrees[keys[k] as string];
    if (!branch || typeof branch !== 'object') throw new Error('AST: malformed degree branch: ' + keys[k]);
    validateDegreeCond(branch.condition, b, 0);
    validateMutationList(branch.mutations, b);
  }
}

// Validate a trigger's mutation list fail-closed (no rng / no state).
export function validateTriggeredMutations(mutations: MutationNode[]): void {
  validateMutationList(mutations, { nodes: 0, dice: 0 });
}

// ---- Public API ------------------------------------------------------------

// Apply a list of mutations to a fresh clone of the state (the trigger path -
// e.g. a Bleed condition's on_turn_start effects). Deterministic given the rng.
export function applyTriggeredMutations(
  state: WorldState, mutations: MutationNode[], ctx: EvalContext): { state: WorldState; mutations: AppliedMutation[] } {
  validateTriggeredMutations(mutations); // fail-closed BEFORE any rng draw or mutation (audit P1)
  var work = cloneState(state);
  var ctx2: EvalContext = { state: work, actorId: ctx.actorId, targetId: ctx.targetId, rng: ctx.rng, naturalRoll: null };
  var applied: AppliedMutation[] = [];
  for (var i = 0; i < mutations.length; i++) {
    applied.push(applyMutation(work, mutations[i] as MutationNode, ctx2));
  }
  return { state: work, mutations: applied };
}

// Resolve a check action: roll vs DC -> winning degree -> apply that degree's
// mutations. Returns the new state + the full resolution (for the chain event).
export function evaluateAction(state: WorldState, check: CheckNode, ctx: EvalContext): ActionResult {
  validateCheck(check); // fail-closed BEFORE any rng draw or mutation (audit P1)
  var work = cloneState(state);
  var ctx2: EvalContext = { state: work, actorId: ctx.actorId, targetId: ctx.targetId, rng: ctx.rng, naturalRoll: null };
  ctx2.naturalRoll = null;
  var roll = evalExpression(check.roll, ctx2);
  var natural = ctx2.naturalRoll;
  var dc = evalExpression(check.dc, ctx2);
  var delta = roll - dc;
  var chosen = 'none';
  var muts: MutationNode[] = [];
  for (var d = 0; d < DEGREE_ORDER.length; d++) {
    var name = DEGREE_ORDER[d] as string;
    var branch = check.degrees[name];
    if (!branch) continue;
    if (matchDegree(branch.condition, delta, natural)) { chosen = name; muts = branch.mutations; break; }
  }
  var applied: AppliedMutation[] = [];
  for (var i = 0; i < muts.length; i++) {
    applied.push(applyMutation(work, muts[i] as MutationNode, ctx2));
  }
  return { state: work, degree: chosen, roll: roll, natural: natural, dc: dc, delta: delta, mutations: applied };
}

// Build a fresh evaluation context from a seed (the deterministic entry point).
export function makeContext(state: WorldState, actorId: string, seed: bigint, targetId?: string): EvalContext {
  return { state: state, actorId: actorId, targetId: targetId, rng: Pcg32.seeded(seed), naturalRoll: null };
}
