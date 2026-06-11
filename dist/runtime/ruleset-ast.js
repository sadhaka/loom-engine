// ruleset-ast.ts - deterministic data-driven ruleset interpreter (the Any-System core).
//
// 3.0 Phase 2 baseline + AST v2 (docs/specs/AST-V2-SPEC.md - the adversarially
// reviewed implementation contract). The ruleset is a strict JSON AST the engine
// EVALUATES, never code it executes - so a player can bring any tabletop system
// (5e, PF2e, homebrew) with no untrusted-code risk. This is the consumer-supplied
// reducer from world-replay, expressed as data: (WorldState, action/trigger) ->
// mutations.
//
// Determinism gates (hard):
//   - integer-only; a dice equation with a '.' is REJECTED, every literal must be
//     a JS-safe integer (validation is by VALUE after JSON parsing - spec 1.4).
//   - all randomness via Pcg32 (seeded); dice consume the PRNG in a FIXED order
//     (expressions evaluate left-to-right, depth-first), so a replay reproduces
//     the exact rolls. Conditions NEVER consume PRNG (spec 8.4).
//   - the ONLY division node is floor_div (toward -inf); native '/' does not exist.
//   - the raw "natural roll" (first die in a check's roll expression) is exposed
//     to degree conditions, so nat_roll_eq (crit on a natural 20) is deterministic.
//
// AST v2 families (all additive - v1 documents evaluate byte-identically):
//   A. nat_roll_gte / nat_roll_lte - natural-roll range conditions (spec 2).
//   B. and - boolean conjunction, MUST short-circuit (spec 3; v1 `or` short-
//      circuit is normative too - throw-vs-result is observable, spec 3.2).
//   C. compare / has_tag - RNG-free state conditions (spec 4). Operands are a
//      CLOSED set (roll/dc/delta/natural/prop/literal) - no dice, no math.
//   D. if - conditional mutations; the untaken branch is completely inert
//      (zero PRNG, zero state - spec 5).
//   E. foreach_target - bounded multi-target scope: tag SELECT (re-run per
//      execution), UTF-16 code-unit ORDER, limit TRUNCATE, per-execution
//      SNAPSHOT, per-iteration fresh dice; `each` target ref (spec 6).
//   F. repeat - bounded literal-count iteration, fresh dice per pass (spec 7).
//   Budgets: document-global accumulators (nodes / dice / applied) threaded by
//   ONE ValidateBudget across roll, dc, and EVERY degree branch; static
//   multiplicity M multiplies dice + applied charges inside foreach/repeat
//   bodies (spec 8). Fail-closed reject-unknown everywhere, unchanged.
//
// Cross-language: every numeric op routes through Pcg32 + floorDiv (both already
// byte-parity across TS/Rust/Python), so a faithful Rust/Python port resolves the
// same AST to the same mutations. Pinned by test_vectors/v3_ast_bleed.json (v1)
// and test_vectors/ast_v2_families.json (v2, scripted dice streams per spec 1.3).
//
// Code style: var-only in browser source.
import { normalizeTags } from './world-state-snapshot.js';
import { Pcg32 } from './pcg32.js';
import { floorDiv } from './integer-math.js';
import { assertCleanString } from './event-chain.js';
var MAX_INT = 9007199254740991; // 2^53 - 1 (referenced by the validation pass)
var MAX_EXPR_DEPTH = 16; // bound expression + condition + mutation-structure nesting (3 independent counters - spec 8.3)
var MAX_NODES = 256; // audit P1: bound TOTAL AST nodes per action (not just depth)
var MAX_DICE_TOTAL = 1000; // audit P1: bound summed dice `count` per action (DoS); v2 charges count * M
var MAX_TARGETS = 32; // v2: hard cap on entities one foreach_target may touch; also the default limit
var MAX_ITERATIONS = 16; // v2: hard cap on a repeat node's count
var MAX_APPLIED_MUTATIONS = 1024; // v2: worst-case leaf-mutation APPLICATIONS, summed document-globally at multiplicity M
var MAX_WORLD_ENTITIES = 65536; // v2: RUNTIME cap on working-state entity count at any foreach_target SELECT (spec 8.7)
// Degrees are evaluated in this FIXED order across every surface (first match wins).
var DEGREE_ORDER = ['critical_success', 'success', 'failure', 'critical_failure'];
// Parse "NdM", "NdM+K", "NdM-K". Rejects any '.' (no floats) and out-of-bounds.
export function parseDice(equation) {
    if (typeof equation !== 'string' || equation.indexOf('.') >= 0) {
        throw new Error('AST: dice equation must be a decimal-free string: ' + equation);
    }
    var m = /^([0-9]+)d([0-9]+)([+-][0-9]+)?$/.exec(equation);
    if (!m)
        throw new Error('AST: invalid dice equation: ' + equation);
    var count = parseInt(m[1], 10);
    var sides = parseInt(m[2], 10);
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
function resolveTarget(t, ctx) {
    if (t === 'actor' || t === 'self')
        return ctx.actorId;
    if (t === 'target') {
        if (ctx.targetId === undefined)
            throw new Error('AST: action references target but none supplied');
        return ctx.targetId;
    }
    if (t === 'each') {
        // The static scope rule (spec 6.3) makes a missing binding unreachable
        // post-validation; keep the defensive throw so a bug can never silently
        // alias an entity.
        if (ctx.eachId === undefined)
            throw new Error('AST: target ref each has no foreach_target binding');
        return ctx.eachId;
    }
    throw new Error('AST: unknown target ref: ' + t);
}
function ensureEntity(state, id) {
    var ent = state.entities[id];
    if (!ent) {
        ent = { properties: {}, tags: [] };
        state.entities[id] = ent;
    }
    return ent;
}
function assertInt(n, what) {
    if (!Number.isSafeInteger(n))
        throw new Error('AST: ' + what + ' must be a JS-safe integer: ' + n);
    // Audit P0: `mul` can manufacture -0 (e.g. 0 * -1); Number.isSafeInteger(-0) is
    // true, so it would store, then canonicalJson REJECTS -0 at the hash gate - a
    // TS-only throw the integer Rust/Python ports never hit. Normalize -0 -> +0 at
    // this central choke point so every surface stores +0 (and stays hashable).
    if (Object.is(n, -0))
        return 0;
    return n;
}
// ---- Expression evaluation -------------------------------------------------
// Evaluate an expression to an integer. PRNG draws happen in evaluation order
// (left-to-right, depth-first), so the sequence is deterministic + replayable.
export function evalExpression(node, ctx, depth = 0) {
    if (depth > MAX_EXPR_DEPTH)
        throw new Error('AST: expression exceeds max depth ' + MAX_EXPR_DEPTH);
    if (!node || typeof node.type !== 'string')
        throw new Error('AST: malformed expression node');
    switch (node.type) {
        case 'literal':
            return assertInt(node.value, 'literal');
        case 'dice': {
            var p = parseDice(node.equation);
            // Roll die-by-die (the SAME PRNG sequence rollDice loops), so we can capture
            // the FIRST INDIVIDUAL die as the natural roll - NOT the sum (audit P1: a
            // 2d20 must crit on a natural 20 on one die, not on two 10s summing to 20).
            // A zero-sides first die SETS natural to 0 (rollDie(0) is still CALLED and
            // returns 0 while consuming zero PRNG draws) - spec 2.2, vector A5.
            var sum = 0;
            for (var di = 0; di < p.count; di++) {
                var oneDie = ctx.rng.rollDie(p.sides);
                if (ctx.naturalRoll === null)
                    ctx.naturalRoll = oneDie;
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
            var l = evalExpression(node.left, ctx, depth + 1); // LEFT first - fixes PRNG order
            var r = evalExpression(node.right, ctx, depth + 1);
            var out;
            if (node.op === 'add')
                out = l + r;
            else if (node.op === 'sub')
                out = l - r;
            else if (node.op === 'mul')
                out = l * r;
            else if (node.op === 'floor_div')
                out = floorDiv(l, r);
            else
                throw new Error('AST: unknown math op: ' + node.op);
            return assertInt(out, 'math result');
        }
        default:
            throw new Error('AST: unknown expression node type: ' + node.type);
    }
}
// ---- Condition matching ----------------------------------------------------
// Validation rejects check-only quantities in trigger context (spec 1.1), so
// this guard is defensive (unreachable post-validation), not a reject path.
function requireQuantities(q, what) {
    if (q === null)
        throw new Error('AST: ' + what + ' is not valid in trigger context');
    return q;
}
// Resolve one compare operand to an integer, or null (only possible via
// `natural` on a diceless roll). Pure: zero PRNG, zero state change. The prop
// read shares the prop_ref boundary exactly: live working state, missing reads
// 0, assertInt choke point (-0 normalized) - spec 4.2 step 1.
function resolveOperand(opnd, ctx, q) {
    if (!opnd || typeof opnd !== 'object' || typeof opnd.source !== 'string') {
        throw new Error('AST: malformed compare operand');
    }
    switch (opnd.source) {
        case 'roll': return requireQuantities(q, 'compare operand source roll').roll;
        case 'dc': return requireQuantities(q, 'compare operand source dc').dc;
        case 'delta': return requireQuantities(q, 'compare operand source delta').delta;
        case 'natural': return requireQuantities(q, 'compare operand source natural').natural;
        case 'prop': {
            var id = resolveTarget(opnd.target, ctx);
            var ent = ctx.state.entities[id];
            var v = ent && ent.properties ? ent.properties[opnd.property] : undefined;
            return assertInt(v === undefined ? 0 : v, 'property ' + opnd.property);
        }
        case 'literal':
            return assertInt(opnd.value, 'compare literal operand');
        default:
            throw new Error('AST: unknown compare operand source: ' + opnd.source);
    }
}
// Match one condition. Pure: conditions consume ZERO PRNG and change ZERO
// state, always (spec 8.4 rule 3). `and`/`or` MUST short-circuit - a decided
// conjunction/disjunction never evaluates, resolves operands for, or throws
// from any later child (spec 3.2: throw-vs-result is observable).
function matchCondition(cond, ctx, q, depth) {
    if (depth > MAX_EXPR_DEPTH)
        throw new Error('AST: degree condition exceeds max depth ' + MAX_EXPR_DEPTH);
    if (!cond || typeof cond.type !== 'string')
        throw new Error('AST: malformed degree condition');
    switch (cond.type) {
        case 'delta_gte': return requireQuantities(q, 'delta_gte').delta >= assertInt(cond.value, 'delta_gte');
        case 'delta_lte': return requireQuantities(q, 'delta_lte').delta <= assertInt(cond.value, 'delta_lte');
        case 'nat_roll_eq': {
            var nEq = requireQuantities(q, 'nat_roll_eq').natural;
            return nEq !== null && nEq === assertInt(cond.value, 'nat_roll_eq');
        }
        case 'nat_roll_gte': {
            // null natural is FALSE - never an error, never vacuously true (spec 2.2).
            var nGte = requireQuantities(q, 'nat_roll_gte').natural;
            return nGte !== null && nGte >= assertInt(cond.value, 'nat_roll_gte');
        }
        case 'nat_roll_lte': {
            var nLte = requireQuantities(q, 'nat_roll_lte').natural;
            return nLte !== null && nLte <= assertInt(cond.value, 'nat_roll_lte');
        }
        case 'or': {
            if (!Array.isArray(cond.conditions))
                throw new Error('AST: or condition requires a conditions array');
            for (var i = 0; i < cond.conditions.length; i++) {
                if (matchCondition(cond.conditions[i], ctx, q, depth + 1))
                    return true; // short-circuit on first TRUE child
            }
            return false; // empty `or` evaluates FALSE (v1 behavior, kept - spec 3.2)
        }
        case 'and': {
            if (!Array.isArray(cond.conditions))
                throw new Error('AST: and requires a non-empty conditions array');
            for (var j = 0; j < cond.conditions.length; j++) {
                if (!matchCondition(cond.conditions[j], ctx, q, depth + 1))
                    return false; // short-circuit on first FALSE child
            }
            return true; // empty array is rejected at validation (fail-OPEN otherwise)
        }
        case 'compare': {
            // Resolve left fully, THEN right fully - BOTH operands are ALWAYS
            // resolved, in that order, normatively. A null left does NOT skip the
            // right (a missing-target throw there must still fire) - spec 4.2 step 1.
            var lv = resolveOperand(cond.left, ctx, q);
            var rv = resolveOperand(cond.right, ctx, q);
            // Uniform false-on-null for ALL six ops, including ne (spec 4.2 step 2).
            if (lv === null || rv === null)
                return false;
            if (cond.op === 'gt')
                return lv > rv;
            if (cond.op === 'gte')
                return lv >= rv;
            if (cond.op === 'lt')
                return lv < rv;
            if (cond.op === 'lte')
                return lv <= rv;
            if (cond.op === 'eq')
                return lv === rv;
            if (cond.op === 'ne')
                return lv !== rv;
            throw new Error('AST: unknown compare op: ' + cond.op);
        }
        case 'has_tag': {
            // Tag analog of missing-reads-are-zero: a missing entity has no tags ->
            // FALSE, never an error. Live working state; exact string equality - the
            // identical membership test foreach_target SELECT applies (spec 4.6).
            var tid = resolveTarget(cond.target, ctx);
            var tent = ctx.state.entities[tid];
            if (!tent || !Array.isArray(tent.tags))
                return false;
            return tent.tags.indexOf(cond.tag) >= 0;
        }
        default: throw new Error('AST: unknown degree condition: ' + cond.type);
    }
}
// ---- Mutation application --------------------------------------------------
// Apply one mutation node (leaf or structural) to the working state, pushing
// leaf AppliedMutation records into `applied` in exact application order.
// Structural nodes (if / foreach_target / repeat) emit NO record themselves.
function applyMutationInto(node, ctx, q, applied) {
    if (!node || typeof node.type !== 'string')
        throw new Error('AST: malformed mutation node');
    switch (node.type) {
        case 'set_prop':
        case 'add_prop':
        case 'sub_prop': {
            var id = resolveTarget(node.target, ctx);
            var ent = ensureEntity(ctx.state, id);
            var value = evalExpression(node.value, ctx);
            var prev = ent.properties[node.property];
            if (prev === undefined)
                prev = 0;
            var next;
            if (node.type === 'set_prop')
                next = value;
            else if (node.type === 'add_prop')
                next = prev + value;
            else
                next = prev - value;
            var finalVal = assertInt(next, 'mutated property ' + node.property);
            ent.properties[node.property] = finalVal;
            applied.push({ target: id, property: node.property, op: node.type, previous: prev, next: finalVal });
            return;
        }
        case 'add_tag': {
            var addId = resolveTarget(node.target, ctx);
            var addEnt = ensureEntity(ctx.state, addId);
            addEnt.tags = normalizeTags(addEnt.tags.concat([node.tag]));
            applied.push({ target: addId, tag: node.tag, op: 'add_tag' });
            return;
        }
        case 'remove_tag': {
            var remId = resolveTarget(node.target, ctx);
            var remEnt = ensureEntity(ctx.state, remId);
            remEnt.tags = remEnt.tags.filter(function (t) { return t !== node.tag; });
            applied.push({ target: remId, tag: node.tag, op: 'remove_tag' });
            return;
        }
        case 'if': {
            // Evaluate the condition exactly once, against the LIVE working state and
            // the FROZEN check quantities. The untaken branch is completely inert:
            // zero PRNG, zero state (spec 5.2, vector D3).
            var taken;
            if (matchCondition(node.condition, ctx, q, 0))
                taken = node.then;
            else
                taken = node.else === undefined ? [] : node.else;
            for (var bi = 0; bi < taken.length; bi++) {
                applyMutationInto(taken[bi], ctx, q, applied);
            }
            return;
        }
        case 'foreach_target': {
            // SELECT - re-run on EVERY execution of this node (spec 6.2 step 1,
            // vector E7); caching a selection across executions desynchronizes the
            // dice stream. Entity cap is a RUNTIME bound: the document budgets cannot
            // see state size (spec 8.7).
            var allIds = Object.keys(ctx.state.entities);
            if (allIds.length > MAX_WORLD_ENTITIES) {
                throw new Error('AST: world entity count ' + allIds.length + ' exceeds MAX_WORLD_ENTITIES (' + MAX_WORLD_ENTITIES + ') at foreach_target select');
            }
            var matched = [];
            for (var si = 0; si < allIds.length; si++) {
                var candId = allIds[si];
                var cand = ctx.state.entities[candId];
                if (cand && Array.isArray(cand.tags) && cand.tags.indexOf(node.select.tag) >= 0)
                    matched.push(candId);
            }
            // ORDER: ascending UTF-16 code units - the SAME comparator canonicalJson
            // uses for object keys and normalizeTags uses for tags (the JS default
            // string sort). NOT numeric-aware: "e10" sorts before "e2" (vector E4).
            matched.sort();
            // TRUNCATE: keep the deterministic prefix; over-matching is NOT an error.
            var lim = node.select.limit === undefined ? MAX_TARGETS : node.select.limit;
            if (matched.length > lim)
                matched.length = lim;
            // SNAPSHOT: membership and order are FIXED for this execution (vector E3).
            // ITERATE: `each` binds to the innermost enclosing foreach_target; fresh
            // value-expression evaluation (dice re-roll) per target (spec 6.2 step 5).
            var prevEach = ctx.eachId;
            for (var ti = 0; ti < matched.length; ti++) {
                ctx.eachId = matched[ti];
                for (var fmi = 0; fmi < node.mutations.length; fmi++) {
                    applyMutationInto(node.mutations[fmi], ctx, q, applied);
                }
            }
            ctx.eachId = prevEach;
            return;
        }
        case 'repeat': {
            // Exactly count passes, in order; no early exit, no condition. Value
            // expressions evaluate FRESH each pass (spec 7.2).
            for (var it = 0; it < node.count; it++) {
                for (var rmi = 0; rmi < node.mutations.length; rmi++) {
                    applyMutationInto(node.mutations[rmi], ctx, q, applied);
                }
            }
            return;
        }
        default:
            throw new Error('AST: unknown mutation node type: ' + node.type);
    }
}
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}
function bumpNode(b) {
    b.nodes++;
    if (b.nodes > MAX_NODES)
        throw new Error('AST: node budget exceeded (max ' + MAX_NODES + ')');
}
function chargeDice(w, count, m) {
    w.b.dice += count * m;
    if (w.b.dice > MAX_DICE_TOTAL)
        throw new Error('AST: total dice count exceeds budget ' + MAX_DICE_TOTAL);
}
function chargeApplied(w, m) {
    w.b.applied += m;
    if (w.b.applied > MAX_APPLIED_MUTATIONS)
        throw new Error('AST: applied-mutation budget exceeded (max ' + MAX_APPLIED_MUTATIONS + ')');
}
// `each` is a STATIC scope rule (spec 6.3): legal only lexically inside some
// foreach_target.mutations subtree (eachOk threads that fact).
function validateTargetRef(t, eachOk) {
    if (t === 'actor' || t === 'self' || t === 'target')
        return;
    if (t === 'each') {
        if (eachOk)
            return;
        throw new Error('AST: target ref each is only valid inside a foreach_target body');
    }
    throw new Error('AST: unknown target ref: ' + t);
}
// Player-supplied property / tag names: reject lone surrogates (canonicalJson would
// otherwise throw at the hash gate AFTER mutating - audit P2) and an own __proto__ key.
function assertCleanName(s, what) {
    if (typeof s !== 'string' || s.length === 0)
        throw new Error('AST: ' + what + ' name must be a non-empty string');
    if (s === '__proto__')
        throw new Error('AST: ' + what + ' name "__proto__" is forbidden');
    assertCleanString(s);
}
function validateExpr(node, w, depth, m, eachOk) {
    bumpNode(w.b);
    if (depth > MAX_EXPR_DEPTH)
        throw new Error('AST: expression exceeds max depth ' + MAX_EXPR_DEPTH);
    if (!node || typeof node.type !== 'string')
        throw new Error('AST: malformed expression node');
    switch (node.type) {
        case 'literal':
            assertInt(node.value, 'literal');
            return;
        case 'dice': {
            var p = parseDice(node.equation); // dry-run: throws on float / junk / out-of-bounds
            chargeDice(w, p.count, m); // v2: charged at static multiplicity M (spec 8.2 rule 2)
            return;
        }
        case 'prop_ref':
            validateTargetRef(node.target, eachOk);
            assertCleanName(node.property, 'property');
            return;
        case 'math':
            if (node.op !== 'add' && node.op !== 'sub' && node.op !== 'mul' && node.op !== 'floor_div') {
                throw new Error('AST: unknown math op: ' + node.op);
            }
            validateExpr(node.left, w, depth + 1, m, eachOk);
            validateExpr(node.right, w, depth + 1, m, eachOk);
            return;
        default:
            throw new Error('AST: unknown expression node type: ' + node.type);
    }
}
// Compare operands are leaves: 1 node each, no depth (spec 4.3).
function validateOperand(opnd, w, eachOk) {
    bumpNode(w.b);
    if (!opnd || typeof opnd !== 'object' || typeof opnd.source !== 'string') {
        throw new Error('AST: malformed compare operand');
    }
    switch (opnd.source) {
        case 'roll':
        case 'dc':
        case 'delta':
        case 'natural':
            if (w.trigger)
                throw new Error('AST: compare operand source ' + opnd.source + ' is not valid in trigger context');
            return;
        case 'prop':
            validateTargetRef(opnd.target, eachOk);
            assertCleanName(opnd.property, 'property');
            return;
        case 'literal':
            assertInt(opnd.value, 'compare literal operand');
            return;
        default:
            throw new Error('AST: unknown compare operand source: ' + opnd.source);
    }
}
function validateDegreeCond(cond, w, depth, eachOk) {
    bumpNode(w.b);
    if (depth > MAX_EXPR_DEPTH)
        throw new Error('AST: degree condition exceeds max depth ' + MAX_EXPR_DEPTH);
    if (!cond || typeof cond.type !== 'string')
        throw new Error('AST: malformed degree condition');
    switch (cond.type) {
        case 'delta_gte':
        case 'delta_lte':
        case 'nat_roll_eq':
        case 'nat_roll_gte':
        case 'nat_roll_lte':
            // Check-only quantities DO NOT EXIST in trigger context (spec 1.1).
            if (w.trigger)
                throw new Error('AST: ' + cond.type + ' is not valid in trigger context');
            assertInt(cond.value, cond.type);
            return;
        case 'or':
            // Empty `or` stays ACCEPTED (evaluates false - fail-closed in spirit),
            // exactly as v1 shipped it. The and/or asymmetry is deliberate (spec 3.2).
            if (!Array.isArray(cond.conditions))
                throw new Error('AST: or condition requires a conditions array');
            for (var i = 0; i < cond.conditions.length; i++) {
                validateDegreeCond(cond.conditions[i], w, depth + 1, eachOk);
            }
            return;
        case 'and':
            // An empty `and` would be vacuously TRUE (fail-OPEN) -> REJECT (spec 3.2).
            if (!Array.isArray(cond.conditions) || cond.conditions.length === 0) {
                throw new Error('AST: and requires a non-empty conditions array');
            }
            for (var j = 0; j < cond.conditions.length; j++) {
                validateDegreeCond(cond.conditions[j], w, depth + 1, eachOk);
            }
            return;
        case 'compare':
            if (cond.op !== 'gt' && cond.op !== 'gte' && cond.op !== 'lt' && cond.op !== 'lte'
                && cond.op !== 'eq' && cond.op !== 'ne') {
                throw new Error('AST: unknown compare op: ' + cond.op);
            }
            validateOperand(cond.left, w, eachOk);
            validateOperand(cond.right, w, eachOk);
            return;
        case 'has_tag':
            // Valid in BOTH contexts - it reads only state, never check quantities.
            validateTargetRef(cond.target, eachOk);
            assertCleanName(cond.tag, 'tag');
            return;
        default:
            throw new Error('AST: unknown degree condition: ' + cond.type);
    }
}
function validateMutation(node, w, mdepth, m, eachOk) {
    bumpNode(w.b);
    if (!node || typeof node.type !== 'string')
        throw new Error('AST: malformed mutation node');
    switch (node.type) {
        case 'set_prop':
        case 'add_prop':
        case 'sub_prop':
            validateTargetRef(node.target, eachOk);
            assertCleanName(node.property, 'property');
            validateExpr(node.value, w, 0, m, eachOk);
            chargeApplied(w, m); // leaf mutation: M applied units (spec 8.2 rule 3)
            return;
        case 'add_tag':
        case 'remove_tag':
            validateTargetRef(node.target, eachOk);
            assertCleanName(node.tag, 'tag');
            chargeApplied(w, m);
            return;
        case 'if':
            // Full context table applies to the condition; BOTH branches are charged
            // at the UNCHANGED M - the static pass never reasons about which branch
            // runs (spec 5.3, 8.2 rule 6). The structural node charges no applied units.
            validateDegreeCond(node.condition, w, 0, eachOk);
            if (!Array.isArray(node.then))
                throw new Error('AST: if.then must be a mutation array');
            validateMutationList(node.then, w, mdepth + 1, m, eachOk);
            if (node.else !== undefined) {
                if (!Array.isArray(node.else))
                    throw new Error('AST: if.else must be a mutation array');
                validateMutationList(node.else, w, mdepth + 1, m, eachOk);
            }
            return;
        case 'foreach_target': {
            var sel = node.select;
            if (!sel || typeof sel !== 'object')
                throw new Error('AST: foreach_target.select must be an object');
            assertCleanName(sel.tag, 'tag');
            var lim = MAX_TARGETS;
            if (sel.limit !== undefined) {
                // Integer-ness judged by VALUE after JSON parsing (spec 1.4): a lexical
                // 2.0 IS the integer 2. 0 / negatives / non-integral / > 32 all reject -
                // the cap is a validation-time constant, never a runtime clamp of the
                // LIMIT itself (only the matched SET truncates at runtime).
                if (!Number.isSafeInteger(sel.limit) || sel.limit < 1 || sel.limit > MAX_TARGETS) {
                    throw new Error('AST: foreach_target select.limit must be an integer in 1..' + MAX_TARGETS);
                }
                lim = sel.limit;
            }
            // Multiplicity: reject IMMEDIATELY at body entry when M' overruns - this
            // also caps M itself at 1024, so the algebra can never overflow (spec 8.2
            // rule 4).
            var mForeach = m * lim;
            if (mForeach > MAX_APPLIED_MUTATIONS) {
                throw new Error('AST: applied-mutation budget exceeded (max ' + MAX_APPLIED_MUTATIONS + '): foreach_target multiplicity ' + mForeach);
            }
            if (!Array.isArray(node.mutations))
                throw new Error('AST: foreach_target.mutations must be an array');
            validateMutationList(node.mutations, w, mdepth + 1, mForeach, true); // `each` is in scope inside the body
            return;
        }
        case 'repeat': {
            // count is a plain JSON integer, judged by VALUE (spec 1.4 / 7.3, vector
            // F7): 1..MAX_ITERATIONS only; 0 is rejected (a no-op is an empty list).
            if (!Number.isSafeInteger(node.count) || node.count < 1 || node.count > MAX_ITERATIONS) {
                throw new Error('AST: repeat count must be an integer in 1..' + MAX_ITERATIONS);
            }
            var mRepeat = m * node.count;
            if (mRepeat > MAX_APPLIED_MUTATIONS) {
                throw new Error('AST: applied-mutation budget exceeded (max ' + MAX_APPLIED_MUTATIONS + '): repeat multiplicity ' + mRepeat);
            }
            if (!Array.isArray(node.mutations))
                throw new Error('AST: repeat.mutations must be an array');
            validateMutationList(node.mutations, w, mdepth + 1, mRepeat, eachOk); // repeat introduces no `each` binding
            return;
        }
        default:
            throw new Error('AST: unknown mutation node type: ' + node.type);
    }
}
// mdepth is the NEW mutation-structure depth counter (spec 8.3 counter 3):
// starts at 0 for each top-level mutation list; +1 entering an if branch list,
// a foreach_target body, or a repeat body.
function validateMutationList(mutations, w, mdepth, m, eachOk) {
    if (mdepth > MAX_EXPR_DEPTH)
        throw new Error('AST: mutation structure exceeds max depth ' + MAX_EXPR_DEPTH);
    if (!Array.isArray(mutations))
        throw new Error('AST: mutations must be an array');
    for (var i = 0; i < mutations.length; i++)
        validateMutation(mutations[i], w, mdepth, m, eachOk);
}
// Validate a full check AST fail-closed (no rng / no state). Call before eval, or
// at ruleset-load time. Throws 'AST: ...' on any violation. The budget
// accumulators are DOCUMENT-GLOBAL: one ValidateBudget threads the roll, the dc,
// and EVERY degree branch - all branches CHARGE though at most one EXECUTES
// (spec 8.2 rule 8, vector H1).
export function validateCheck(check) {
    if (!check || check.type !== 'check')
        throw new Error('AST: expected a check node');
    var w = { b: { nodes: 0, dice: 0, applied: 0 }, trigger: false };
    validateExpr(check.roll, w, 0, 1, false);
    validateExpr(check.dc, w, 0, 1, false);
    if (!check.degrees || typeof check.degrees !== 'object')
        throw new Error('AST: check.degrees must be an object');
    var keys = Object.keys(check.degrees).sort();
    for (var k = 0; k < keys.length; k++) {
        var branch = check.degrees[keys[k]];
        if (!branch || typeof branch !== 'object')
            throw new Error('AST: malformed degree branch: ' + keys[k]);
        validateDegreeCond(branch.condition, w, 0, false);
        validateMutationList(branch.mutations, w, 0, 1, false);
    }
}
// Validate a trigger's mutation list fail-closed (no rng / no state). Trigger
// context: roll / dc / delta / natural DO NOT EXIST, so any condition reading
// them rejects here (spec 1.1).
export function validateTriggeredMutations(mutations) {
    var w = { b: { nodes: 0, dice: 0, applied: 0 }, trigger: true };
    validateMutationList(mutations, w, 0, 1, false);
}
// ---- Public API ------------------------------------------------------------
// Apply a list of mutations to a fresh clone of the state (the trigger path -
// e.g. a Bleed condition's on_turn_start effects). Deterministic given the rng.
export function applyTriggeredMutations(state, mutations, ctx) {
    validateTriggeredMutations(mutations); // fail-closed BEFORE any rng draw or mutation (audit P1)
    var work = cloneState(state);
    var ctx2 = { state: work, actorId: ctx.actorId, targetId: ctx.targetId, rng: ctx.rng, naturalRoll: null, eachId: undefined };
    var applied = [];
    for (var i = 0; i < mutations.length; i++) {
        applyMutationInto(mutations[i], ctx2, null, applied);
    }
    return { state: work, mutations: applied };
}
// Resolve a check action: roll vs DC -> winning degree -> apply that degree's
// mutations. Returns the new state + the full resolution (for the chain event).
export function evaluateAction(state, check, ctx) {
    validateCheck(check); // fail-closed BEFORE any rng draw or mutation (audit P1)
    var work = cloneState(state);
    var ctx2 = { state: work, actorId: ctx.actorId, targetId: ctx.targetId, rng: ctx.rng, naturalRoll: null, eachId: undefined };
    ctx2.naturalRoll = null;
    var roll = evalExpression(check.roll, ctx2);
    var natural = ctx2.naturalRoll;
    var dc = evalExpression(check.dc, ctx2);
    // delta exactness (spec 4.2, the required v2 amendment): the exact difference
    // of two JS-safe ints can reach +/-(2^54 - 2), where f64 goes inexact and the
    // serialized event would diverge per surface. assertInt throws (runtime error,
    // after roll/dc dice were consumed - the v1 runtime-error class) exactly when
    // |roll - dc| > 2^53 - 1; in-range deltas are EXACT in f64.
    var delta = assertInt(roll - dc, 'delta');
    var q = { roll: roll, dc: dc, delta: delta, natural: natural };
    var chosen = 'none';
    var muts = [];
    for (var d = 0; d < DEGREE_ORDER.length; d++) {
        var name = DEGREE_ORDER[d];
        var branch = check.degrees[name];
        if (!branch)
            continue;
        if (matchCondition(branch.condition, ctx2, q, 0)) {
            chosen = name;
            muts = branch.mutations;
            break;
        }
    }
    var applied = [];
    for (var i = 0; i < muts.length; i++) {
        applyMutationInto(muts[i], ctx2, q, applied);
    }
    return { state: work, degree: chosen, roll: roll, natural: natural, dc: dc, delta: delta, mutations: applied };
}
// Build a fresh evaluation context from a seed (the deterministic entry point).
export function makeContext(state, actorId, seed, targetId) {
    return { state: state, actorId: actorId, targetId: targetId, rng: Pcg32.seeded(seed), naturalRoll: null, eachId: undefined };
}
//# sourceMappingURL=ruleset-ast.js.map