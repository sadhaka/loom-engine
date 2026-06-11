//! loom_ruleset - deterministic data-driven ruleset AST interpreter (Rust core).
//!
//! The native sibling of the TS ruleset-ast.ts and the Python ruleset_ast.py. The
//! ruleset is a strict JSON AST the engine EVALUATES, never code it executes - so
//! any system (5e, PF2e, homebrew) runs with no untrusted-code risk. Builds on
//! loom_math (Pcg32 + floor_div) + loom_snapshot (normalize_tags), so it resolves
//! the same AST + seed to the same mutations and the same world-state hash.
//!
//! Pinned by test_vectors/v3_ast_bleed.json (v1) and
//! test_vectors/ast_v2_families.json (AST v2, scripted dice streams per
//! docs/specs/AST-V2-SPEC.md section 1.3/1.5). Mirrors the post-audit TS
//! contract: integer-only; dice die-by-die so the FIRST die is the natural roll
//! (a zero-sides first die SETS natural to 0 - spec 2.2); floor_div only; mul
//! cannot persist -0 (i64 has none); and a STATIC validation pass runs BEFORE
//! any rng draw or mutation (the reject boundary is byte-identical across
//! surfaces). i128 intermediates make mul OVERFLOW throw the JS-safe-int
//! contract rather than wrapping i64.
//!
//! AST v2 families (docs/specs/AST-V2-SPEC.md - all additive, v1 documents
//! evaluate byte-identically):
//!   A. nat_roll_gte / nat_roll_lte - natural-roll range conditions (spec 2).
//!   B. and - boolean conjunction, MUST short-circuit (spec 3; v1 `or`
//!      short-circuit is normative too - throw-vs-result is observable).
//!   C. compare / has_tag - RNG-free state conditions (spec 4). Operands are a
//!      CLOSED set (roll/dc/delta/natural/prop/literal) - no dice, no math.
//!   D. if - conditional mutations; the untaken branch is completely inert
//!      (zero PRNG, zero state - spec 5).
//!   E. foreach_target - bounded multi-target scope: tag SELECT (re-run per
//!      execution), UTF-16 code-unit ORDER, limit TRUNCATE, per-execution
//!      SNAPSHOT, per-iteration fresh dice; `each` target ref (spec 6).
//!   F. repeat - bounded literal-count iteration, fresh dice per pass (spec 7).
//!   Budgets: document-global accumulators (nodes / dice / applied) threaded by
//!   ONE budget across roll, dc, and EVERY degree branch; static multiplicity M
//!   multiplies dice + applied charges inside foreach/repeat bodies (spec 8).
//!   Fail-closed reject-unknown everywhere, unchanged.
//!
//! Every error is a `Result::Err` end-to-end (never a panic), so the C-ABI /
//! WASM / UniFFI binding rule (spec 10: rejection crosses the FFI as an error
//! return) holds for every path in this crate.

use loom_math::{floor_div, Pcg32};
use serde_json::Value;

const MAX_INT: i64 = 9_007_199_254_740_991; // 2^53 - 1
const MAX_EXPR_DEPTH: i64 = 16;
const MAX_NODES: i64 = 256;
const MAX_DICE_TOTAL: i64 = 1000;
// v2 budget constants (spec 1.2) - shared verbatim with TS/Python.
const MAX_TARGETS: i64 = 32;
const MAX_ITERATIONS: i64 = 16;
const MAX_APPLIED_MUTATIONS: i64 = 1024;
const MAX_WORLD_ENTITIES: usize = 65536;
const DEGREE_ORDER: [&str; 4] = ["critical_success", "success", "failure", "critical_failure"];

/// The single PRNG-consuming surface of the evaluator (spec 10: only rollDie
/// consumes randomness). Production uses `Pcg32`; conformance harnesses script
/// the dice stream (spec 1.3: a scripted roller pops one entry per call, and
/// `roll_die(0)` returns 0 WITHOUT popping, mirroring `Pcg32` exactly).
pub trait DieRoller {
    fn roll_die(&mut self, sides: u32) -> u32;
}

impl DieRoller for Pcg32 {
    fn roll_die(&mut self, sides: u32) -> u32 {
        Pcg32::roll_die(self, sides)
    }
}

/// Back-compat public context for `eval_expression` (the seed-constructed
/// entry points build their own internal context).
pub struct EvalCtx {
    pub actor: String,
    pub target: Option<String>,
    pub rng: Pcg32,
    pub natural: Option<i64>,
}

pub struct ActionResult {
    pub state: Value,
    pub degree: String,
    pub roll: i64,
    pub natural: Option<i64>,
    pub dc: i64,
    pub delta: i64,
    // Codex P2: the applied-mutation records (TS/Python evaluateAction return them),
    // so the original seed-constructed API exposes the same shape as the _with_rng path.
    pub mutations: Vec<AppliedMutation>,
}

// ---- integer helpers -------------------------------------------------------

fn assert_int(n: i64, what: &str) -> Result<i64, String> {
    if n < -MAX_INT || n > MAX_INT {
        return Err(format!("AST: {} must be a JS-safe integer: {}", what, n));
    }
    Ok(n)
}

fn assert_int128(n: i128, what: &str) -> Result<i64, String> {
    if n < -(MAX_INT as i128) || n > (MAX_INT as i128) {
        return Err(format!("AST: {} must be a JS-safe integer: {}", what, n));
    }
    Ok(n as i64)
}

// A JSON number that must be a JS-safe integer. Validation is by VALUE after
// JSON parsing (spec 1.4): an integral float like 3.0 IS the integer 3 (JS
// JSON.parse cannot distinguish them, so a lexical reject is non-conformant);
// a real fraction or an out-of-range value rejects. -0 normalizes to +0
// (the f64 -> i64 cast yields +0; serde parses a lexical `-0` as integer 0).
fn value_int(v: &Value, what: &str) -> Result<i64, String> {
    if let Some(i) = v.as_i64() {
        return assert_int(i, what);
    }
    if let Some(f) = v.as_f64() {
        if f.fract() == 0.0 && f.abs() <= MAX_INT as f64 {
            return assert_int(f as i64, what);
        }
    }
    Err(format!("AST: {} must be a JS-safe integer: {}", what, v))
}

// ---- dice ------------------------------------------------------------------

fn parse_dice(eq: &str) -> Result<(i64, i64, i64), String> {
    if eq.contains('.') {
        return Err(format!("AST: dice equation must be a decimal-free string: {}", eq));
    }
    let dpos = eq.find('d').ok_or_else(|| format!("AST: invalid dice equation: {}", eq))?;
    let count_str = &eq[..dpos];
    let rest = &eq[dpos + 1..];
    let (sides_str, mod_str) = match rest.find(|c| c == '+' || c == '-') {
        Some(sp) => (&rest[..sp], Some(&rest[sp..])),
        None => (rest, None),
    };
    let count: i64 = count_str.parse().map_err(|_| format!("AST: invalid dice equation: {}", eq))?;
    let sides: i64 = sides_str.parse().map_err(|_| format!("AST: invalid dice equation: {}", eq))?;
    let modi: i64 = match mod_str {
        Some(m) => m.parse().map_err(|_| format!("AST: invalid dice equation: {}", eq))?,
        None => 0,
    };
    if count < 0 || count > 100 || sides < 0 || sides > 100_000 {
        return Err(format!("AST: dice out of bounds: {}", eq));
    }
    // Codex P1b: the modifier + the whole result range [count+mod .. count*sides+mod]
    // must stay JS-safe, else eval rolls (advancing the PRNG) before assert_int throws
    // - breaking the fail-closed / zero-rng contract. count*sides <= 1e7; compute in
    // i128 so the range check itself cannot overflow. (An i64-overflowing modifier
    // already fails to parse above, also a rejection.)
    let max_int = MAX_INT as i128;
    let max_res = count as i128 * sides as i128 + modi as i128;
    let min_res = count as i128 + modi as i128;
    if (modi as i128).abs() > max_int || max_res.abs() > max_int || min_res.abs() > max_int {
        return Err(format!("AST: dice modifier/result out of safe-integer range: {}", eq));
    }
    Ok((count, sides, modi))
}

// ---- runtime context -------------------------------------------------------

// The internal evaluation context: actor / optional context target, the die
// roller, the captured natural roll, and the `each` binding of the innermost
// executing foreach_target (None outside any - spec 6.2 step 8).
struct RunCtx<'a> {
    actor: &'a str,
    target: Option<&'a str>,
    roller: &'a mut dyn DieRoller,
    natural: Option<i64>,
    each: Option<String>,
}

// The frozen check-resolution quantities (computed once per check, BEFORE the
// degree walk - mutations applied during the same resolution never change
// them). None in trigger context, where they DO NOT EXIST (spec 1.1).
struct CheckQuantities {
    roll: i64,
    dc: i64,
    delta: i64,
    natural: Option<i64>,
}

fn require_q<'q>(q: Option<&'q CheckQuantities>, what: &str) -> Result<&'q CheckQuantities, String> {
    // Validation rejects check-only quantities in trigger context (spec 1.1),
    // so this is defensive (unreachable post-validation), not a reject path.
    q.ok_or_else(|| format!("AST: {} is not valid in trigger context", what))
}

fn resolve_target_rc(t: &str, rc: &RunCtx) -> Result<String, String> {
    match t {
        "actor" | "self" => Ok(rc.actor.to_string()),
        "target" => rc
            .target
            .map(|s| s.to_string())
            .ok_or_else(|| "AST: action references target but none supplied".to_string()),
        "each" => {
            // The static scope rule (spec 6.3) makes a missing binding
            // unreachable post-validation; keep the defensive error so a bug
            // can never silently alias an entity.
            rc.each
                .clone()
                .ok_or_else(|| "AST: target ref each has no foreach_target binding".to_string())
        }
        _ => Err(format!("AST: unknown target ref: {}", t)),
    }
}

fn read_prop(state: &Value, id: &str, prop: &str) -> Result<i64, String> {
    match state.get("entities").and_then(|e| e.get(id)).and_then(|ent| ent.get("properties")).and_then(|p| p.get(prop)) {
        None | Some(Value::Null) => Ok(0),
        Some(v) => value_int(v, "property"),
    }
}

fn entity_mut<'a>(state: &'a mut Value, id: &str) -> Result<&'a mut serde_json::Map<String, Value>, String> {
    let entities = state.get_mut("entities").and_then(|e| e.as_object_mut()).ok_or("AST: state.entities must be an object")?;
    if !entities.contains_key(id) {
        entities.insert(id.to_string(), serde_json::json!({ "properties": {}, "tags": [] }));
    }
    entities.get_mut(id).and_then(|e| e.as_object_mut()).ok_or_else(|| "AST: entity must be an object".to_string())
}

// Exact-string tag membership - the SAME test foreach_target SELECT and
// has_tag share (spec 4.6 / 6.2 step 1).
fn entity_has_tag(ent: &Value, tag: &str) -> bool {
    match ent.get("tags").and_then(|t| t.as_array()) {
        Some(arr) => arr.iter().any(|v| v.as_str() == Some(tag)),
        None => false,
    }
}

// ---- expression evaluation -------------------------------------------------

fn eval_expr(node: &Value, state: &Value, rc: &mut RunCtx, depth: i64) -> Result<i64, String> {
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: expression exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed expression node")?;
    match t {
        "literal" => value_int(&node["value"], "literal"),
        "dice" => {
            let eq = node.get("equation").and_then(|x| x.as_str()).ok_or("AST: dice equation must be a string")?;
            let (count, sides, modi) = parse_dice(eq)?;
            // Roll die-by-die so the FIRST individual die is the natural roll.
            // A zero-sides first die SETS natural to 0 (roll_die(0) is still
            // CALLED, returns 0, consumes zero PRNG draws) - spec 2.2 / A5.
            let mut sum: i64 = 0;
            let mut i = 0;
            while i < count {
                let one = rc.roller.roll_die(sides as u32) as i64;
                if rc.natural.is_none() {
                    rc.natural = Some(one);
                }
                sum += one;
                i += 1;
            }
            assert_int128(sum as i128 + modi as i128, "dice result")
        }
        "prop_ref" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: prop_ref target must be a string")?;
            let id = resolve_target_rc(target, rc)?;
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: prop_ref property must be a string")?;
            read_prop(state, &id, prop)
        }
        "math" => {
            let l = eval_expr(&node["left"], state, rc, depth + 1)?; // LEFT first - fixes PRNG order
            let r = eval_expr(&node["right"], state, rc, depth + 1)?;
            let op = node.get("op").and_then(|x| x.as_str()).ok_or("AST: math op missing")?;
            match op {
                "add" => assert_int128(l as i128 + r as i128, "math result"),
                "sub" => assert_int128(l as i128 - r as i128, "math result"),
                "mul" => assert_int128(l as i128 * r as i128, "math result"),
                "floor_div" => assert_int(floor_div(l, r), "math result"),
                _ => Err(format!("AST: unknown math op: {}", op)),
            }
        }
        _ => Err(format!("AST: unknown expression node type: {}", t)),
    }
}

/// Back-compat wrapper: evaluate an expression with the public `EvalCtx`
/// (production `Pcg32`). The natural-roll capture is threaded back out.
pub fn eval_expression(node: &Value, state: &Value, ctx: &mut EvalCtx, depth: i64) -> Result<i64, String> {
    let EvalCtx { actor, target, rng, natural } = ctx;
    let mut rc = RunCtx {
        actor: actor.as_str(),
        target: target.as_deref(),
        roller: rng,
        natural: *natural,
        each: None,
    };
    let out = eval_expr(node, state, &mut rc, depth);
    let nat = rc.natural;
    *natural = nat;
    out
}

// ---- condition matching (pure: zero PRNG, zero state - spec 8.4 rule 3) -----

// Resolve one compare operand to Some(int), or None (only possible via
// `natural` on a diceless roll). The prop read shares the prop_ref boundary
// exactly: live working state, missing reads 0, the value_int choke point
// (-0 normalized) - spec 4.2 step 1.
fn resolve_operand(opnd: &Value, state: &Value, rc: &RunCtx, q: Option<&CheckQuantities>) -> Result<Option<i64>, String> {
    let src = opnd.get("source").and_then(|x| x.as_str()).ok_or("AST: malformed compare operand")?;
    match src {
        "roll" => Ok(Some(require_q(q, "compare operand source roll")?.roll)),
        "dc" => Ok(Some(require_q(q, "compare operand source dc")?.dc)),
        "delta" => Ok(Some(require_q(q, "compare operand source delta")?.delta)),
        "natural" => Ok(require_q(q, "compare operand source natural")?.natural),
        "prop" => {
            let target = opnd.get("target").and_then(|x| x.as_str()).ok_or("AST: compare prop operand target must be a string")?;
            let id = resolve_target_rc(target, rc)?;
            let prop = opnd.get("property").and_then(|x| x.as_str()).ok_or("AST: compare prop operand property must be a string")?;
            Ok(Some(read_prop(state, &id, prop)?))
        }
        "literal" => Ok(Some(value_int(&opnd["value"], "compare literal operand")?)),
        _ => Err(format!("AST: unknown compare operand source: {}", src)),
    }
}

// Match one condition. `and`/`or` MUST short-circuit - a decided conjunction /
// disjunction never evaluates, resolves operands for, or errors from any later
// child (spec 3.2: throw-vs-result is observable).
fn match_condition(cond: &Value, state: &Value, rc: &RunCtx, q: Option<&CheckQuantities>, depth: i64) -> Result<bool, String> {
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: degree condition exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = cond.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed degree condition")?;
    match t {
        "delta_gte" => Ok(require_q(q, "delta_gte")?.delta >= value_int(&cond["value"], "delta_gte")?),
        "delta_lte" => Ok(require_q(q, "delta_lte")?.delta <= value_int(&cond["value"], "delta_lte")?),
        "nat_roll_eq" => {
            let n = require_q(q, "nat_roll_eq")?.natural;
            let v = value_int(&cond["value"], "nat_roll_eq")?;
            Ok(n == Some(v))
        }
        "nat_roll_gte" => {
            // null natural is FALSE - never an error, never vacuously true (spec 2.2).
            let n = require_q(q, "nat_roll_gte")?.natural;
            let v = value_int(&cond["value"], "nat_roll_gte")?;
            Ok(match n {
                Some(nat) => nat >= v,
                None => false,
            })
        }
        "nat_roll_lte" => {
            let n = require_q(q, "nat_roll_lte")?.natural;
            let v = value_int(&cond["value"], "nat_roll_lte")?;
            Ok(match n {
                Some(nat) => nat <= v,
                None => false,
            })
        }
        "or" => {
            let conds = cond.get("conditions").and_then(|x| x.as_array()).ok_or("AST: or condition requires a conditions array")?;
            for sub in conds {
                if match_condition(sub, state, rc, q, depth + 1)? {
                    return Ok(true); // short-circuit on first TRUE child
                }
            }
            Ok(false) // empty `or` evaluates FALSE (v1 behavior, kept - spec 3.2)
        }
        "and" => {
            let conds = cond.get("conditions").and_then(|x| x.as_array()).ok_or("AST: and requires a non-empty conditions array")?;
            for sub in conds {
                if !match_condition(sub, state, rc, q, depth + 1)? {
                    return Ok(false); // short-circuit on first FALSE child
                }
            }
            Ok(true) // empty array is rejected at validation (fail-OPEN otherwise)
        }
        "compare" => {
            // Resolve left fully, THEN right fully - BOTH operands are ALWAYS
            // resolved, in that order, normatively. A None left does NOT skip
            // the right (a missing-target error there must still fire) - spec
            // 4.2 step 1.
            let lv = resolve_operand(&cond["left"], state, rc, q)?;
            let rv = resolve_operand(&cond["right"], state, rc, q)?;
            // Uniform false-on-null for ALL six ops, including ne (spec 4.2 step 2).
            let (l, r) = match (lv, rv) {
                (Some(l), Some(r)) => (l, r),
                _ => return Ok(false),
            };
            let op = cond.get("op").and_then(|x| x.as_str()).unwrap_or("");
            match op {
                "gt" => Ok(l > r),
                "gte" => Ok(l >= r),
                "lt" => Ok(l < r),
                "lte" => Ok(l <= r),
                "eq" => Ok(l == r),
                "ne" => Ok(l != r),
                _ => Err(format!("AST: unknown compare op: {}", op)),
            }
        }
        "has_tag" => {
            // Tag analog of missing-reads-are-zero: a missing entity has no
            // tags -> FALSE, never an error. Live working state; exact string
            // equality - the identical membership test foreach_target SELECT
            // applies (spec 4.6).
            let target = cond.get("target").and_then(|x| x.as_str()).ok_or("AST: has_tag target must be a string")?;
            let id = resolve_target_rc(target, rc)?;
            let tag = cond.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?;
            match state.get("entities").and_then(|e| e.get(&id)) {
                Some(ent) => Ok(entity_has_tag(ent, tag)),
                None => Ok(false),
            }
        }
        _ => Err(format!("AST: unknown degree condition: {}", t)),
    }
}

// ---- mutation serialization (Phase 3 Epoch world-tick) ----------------------

/// One applied mutation, recorded with ONLY the present fields - mirrors the TS
/// `SerializedMutation` so `canonical_json` encodes it identically on every
/// surface. `previous`/`next` are present for prop ops, `tag` for tag ops.
#[derive(Clone, Debug)]
pub struct AppliedMutation {
    pub op: String,
    pub target: String,
    pub property: Option<String>,
    pub tag: Option<String>,
    pub previous: Option<i64>,
    pub next: Option<i64>,
}

/// Result of resolving a check action with a shared rng: the new state, the
/// winning degree, and the applied mutations (for the Epoch event).
pub struct CheckResolution {
    pub state: Value,
    pub degree: String,
    pub mutations: Vec<AppliedMutation>,
}

/// Result of resolving a flat mutation action with a shared rng.
pub struct MutationsResolution {
    pub state: Value,
    pub mutations: Vec<AppliedMutation>,
}

// ---- mutation application ----------------------------------------------------

// Apply one mutation node (leaf or structural) to the working state, pushing
// leaf AppliedMutation records into `applied` in exact application order.
// Structural nodes (if / foreach_target / repeat) emit NO record themselves.
fn apply_mutation_node(
    state: &mut Value,
    node: &Value,
    rc: &mut RunCtx,
    q: Option<&CheckQuantities>,
    applied: &mut Vec<AppliedMutation>,
) -> Result<(), String> {
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed mutation node")?.to_string();
    match t.as_str() {
        "set_prop" | "add_prop" | "sub_prop" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
            // Resolve the target BEFORE evaluating the value expression, so a
            // missing-target error fires before any dice are consumed (TS order).
            let id = resolve_target_rc(target, rc)?;
            let value = eval_expr(&node["value"], &*state, rc, 0)?;
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: property must be a string")?.to_string();
            let prev = read_prop(&*state, &id, &prop)?;
            let nxt = match t.as_str() {
                "set_prop" => value,
                "add_prop" => assert_int128(prev as i128 + value as i128, "mutated property")?,
                _ => assert_int128(prev as i128 - value as i128, "mutated property")?,
            };
            let ent = entity_mut(state, &id)?;
            let props = ent.get_mut("properties").and_then(|p| p.as_object_mut()).ok_or("AST: entity.properties must be an object")?;
            props.insert(prop.clone(), Value::from(nxt));
            applied.push(AppliedMutation {
                op: t.clone(),
                target: id,
                property: Some(prop),
                tag: None,
                previous: Some(prev),
                next: Some(nxt),
            });
            Ok(())
        }
        "add_tag" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
            let id = resolve_target_rc(target, rc)?;
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?.to_string();
            let ent = entity_mut(state, &id)?;
            let mut tags: Vec<String> = ent.get("tags").and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            tags.push(tag.clone());
            let normalized = loom_snapshot::normalize_tags(&tags);
            ent.insert("tags".to_string(), Value::from(normalized));
            applied.push(AppliedMutation {
                op: t.clone(),
                target: id,
                property: None,
                tag: Some(tag),
                previous: None,
                next: None,
            });
            Ok(())
        }
        "remove_tag" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
            let id = resolve_target_rc(target, rc)?;
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?.to_string();
            let ent = entity_mut(state, &id)?;
            let tags: Vec<String> = ent.get("tags").and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).filter(|x| x != &tag).collect())
                .unwrap_or_default();
            ent.insert("tags".to_string(), Value::from(tags));
            applied.push(AppliedMutation {
                op: t.clone(),
                target: id,
                property: None,
                tag: Some(tag),
                previous: None,
                next: None,
            });
            Ok(())
        }
        "if" => {
            // Evaluate the condition exactly once, against the LIVE working
            // state and the FROZEN check quantities. The untaken branch is
            // completely inert: zero PRNG, zero state (spec 5.2, vector D3).
            let cond_true = match_condition(&node["condition"], &*state, &*rc, q, 0)?;
            let branch = if cond_true { node.get("then") } else { node.get("else") };
            if let Some(arr) = branch.and_then(|v| v.as_array()) {
                for m in arr {
                    apply_mutation_node(state, m, rc, q, applied)?;
                }
            }
            Ok(())
        }
        "foreach_target" => {
            // SELECT - re-run on EVERY execution of this node (spec 6.2 step 1,
            // vector E7); caching a selection across executions desynchronizes
            // the dice stream. Entity cap is a RUNTIME bound: the document
            // budgets cannot see state size (spec 8.7).
            let sel = node.get("select").ok_or("AST: foreach_target.select must be an object")?;
            let tag = sel.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag name must be a non-empty string")?;
            let mut matched: Vec<String> = Vec::new();
            {
                let entities = state.get("entities").and_then(|e| e.as_object()).ok_or("AST: state.entities must be an object")?;
                if entities.len() > MAX_WORLD_ENTITIES {
                    return Err(format!(
                        "AST: world entity count {} exceeds MAX_WORLD_ENTITIES ({}) at foreach_target select",
                        entities.len(),
                        MAX_WORLD_ENTITIES
                    ));
                }
                for (id, ent) in entities {
                    if entity_has_tag(ent, tag) {
                        matched.push(id.clone());
                    }
                }
            }
            // ORDER: ascending UTF-16 code units - the SAME comparator
            // canonical_json uses for object keys and normalize_tags uses for
            // tags. NOT Rust's native str Ord (UTF-8 bytes) and NOT the
            // numeric-aware compare_ids: "e10" sorts before "e2" (vector E4).
            matched.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            // TRUNCATE: keep the deterministic prefix; over-matching is NOT an
            // error (spec 6.2 step 3).
            let lim: i64 = match sel.get("limit") {
                None => MAX_TARGETS,
                Some(lv) => value_int(lv, "foreach_target select.limit")
                    .map_err(|_| format!("AST: foreach_target select.limit must be an integer in 1..{}", MAX_TARGETS))?,
            };
            if lim < 0 {
                // Defensive (validation rejects limits outside 1..32).
                return Err(format!("AST: foreach_target select.limit must be an integer in 1..{}", MAX_TARGETS));
            }
            if (matched.len() as i64) > lim {
                matched.truncate(lim as usize);
            }
            // SNAPSHOT: membership and order are FIXED for this execution
            // (vector E3). ITERATE: `each` binds to the innermost enclosing
            // foreach_target; fresh value-expression evaluation (dice re-roll)
            // per target (spec 6.2 step 5).
            let muts = node.get("mutations").and_then(|m| m.as_array()).ok_or("AST: foreach_target.mutations must be an array")?;
            let prev_each = rc.each.clone();
            for id in matched {
                rc.each = Some(id);
                for m in muts {
                    apply_mutation_node(state, m, rc, q, applied)?;
                }
            }
            rc.each = prev_each;
            Ok(())
        }
        "repeat" => {
            // Exactly count passes, in order; no early exit, no condition.
            // Value expressions evaluate FRESH each pass (spec 7.2).
            let count = value_int(&node["count"], "repeat count")
                .map_err(|_| format!("AST: repeat count must be an integer in 1..{}", MAX_ITERATIONS))?;
            let muts = node.get("mutations").and_then(|m| m.as_array()).ok_or("AST: repeat.mutations must be an array")?;
            let mut it: i64 = 0;
            while it < count {
                for m in muts {
                    apply_mutation_node(state, m, rc, q, applied)?;
                }
                it += 1;
            }
            Ok(())
        }
        _ => Err(format!("AST: unknown mutation node type: {}", t)),
    }
}

// ---- static validation pass (validate BEFORE any rng draw / mutation) -------
//
// Walks the entire AST once, touching NO rng and NO state, and rejects
// fail-closed on: unknown node / condition / mutation / operand types,
// non-integer values (judged by VALUE after JSON parsing - spec 1.4),
// over-depth subtrees (three independent counters share MAX_EXPR_DEPTH:
// expression, condition, and the mutation-structure depth - spec 8.3), a
// non-array or.conditions, an EMPTY and.conditions (vacuous truth is fail-open
// - spec 3.2), malformed dice, unclean / __proto__ names, check-only
// quantities in trigger context (spec 1.1), `each` outside any foreach_target
// body (static scope rule - spec 6.3), bad repeat counts / select limits, and
// the document-global budgets: nodes, dice (charged count * M), applied
// mutations (charged M per leaf), and the multiplicity cap
// M' <= MAX_APPLIED_MUTATIONS at every body entry (spec 8.2). Extra (unlisted)
// fields are IGNORED: not walked, not validated, charging no budget (spec 1.4,
// vector D5).

struct Budget {
    nodes: i64,
    dice: i64,
    applied: i64,
}

// The walk threads ONE document-global budget (spec 8.2 rule 8: every degree
// branch CHARGES even though at most one EXECUTES - vector H1) plus the
// validation-context flag (spec 1.1: check vs trigger).
struct WalkCtx {
    b: Budget,
    trigger: bool,
}

fn bump(w: &mut WalkCtx) -> Result<(), String> {
    w.b.nodes += 1;
    if w.b.nodes > MAX_NODES {
        return Err(format!("AST: node budget exceeded (max {})", MAX_NODES));
    }
    Ok(())
}

fn charge_dice(w: &mut WalkCtx, count: i64, m: i64) -> Result<(), String> {
    w.b.dice += count * m;
    if w.b.dice > MAX_DICE_TOTAL {
        return Err(format!("AST: total dice count exceeds budget {}", MAX_DICE_TOTAL));
    }
    Ok(())
}

fn charge_applied(w: &mut WalkCtx, m: i64) -> Result<(), String> {
    w.b.applied += m;
    if w.b.applied > MAX_APPLIED_MUTATIONS {
        return Err(format!("AST: applied-mutation budget exceeded (max {})", MAX_APPLIED_MUTATIONS));
    }
    Ok(())
}

// `each` is a STATIC scope rule (spec 6.3): legal only lexically inside some
// foreach_target.mutations subtree (each_ok threads that fact).
fn validate_target_ref(t: &str, each_ok: bool) -> Result<(), String> {
    match t {
        "actor" | "self" | "target" => Ok(()),
        "each" => {
            if each_ok {
                Ok(())
            } else {
                Err("AST: target ref each is only valid inside a foreach_target body".to_string())
            }
        }
        _ => Err(format!("AST: unknown target ref: {}", t)),
    }
}

// A Rust &str is always valid UTF-8, so it CANNOT hold a lone surrogate - the
// TS/Python lone-surrogate rejection is structurally satisfied here. We still
// reject an empty name and an own "__proto__" key for cross-surface parity.
fn assert_clean_name(s: &str, what: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err(format!("AST: {} name must be a non-empty string", what));
    }
    if s == "__proto__" {
        return Err(format!("AST: {} name \"__proto__\" is forbidden", what));
    }
    Ok(())
}

fn validate_expr(node: &Value, w: &mut WalkCtx, depth: i64, m: i64, each_ok: bool) -> Result<(), String> {
    bump(w)?;
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: expression exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed expression node")?;
    match t {
        "literal" => {
            value_int(&node["value"], "literal")?;
            Ok(())
        }
        "dice" => {
            let eq = node.get("equation").and_then(|x| x.as_str()).ok_or("AST: dice equation must be a string")?;
            let (count, _sides, _mod) = parse_dice(eq)?;
            charge_dice(w, count, m) // v2: charged at static multiplicity M (spec 8.2 rule 2)
        }
        "prop_ref" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: prop_ref target must be a string")?;
            validate_target_ref(target, each_ok)?;
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: prop_ref property must be a string")?;
            assert_clean_name(prop, "property")
        }
        "math" => {
            let op = node.get("op").and_then(|x| x.as_str()).unwrap_or("");
            if !matches!(op, "add" | "sub" | "mul" | "floor_div") {
                return Err(format!("AST: unknown math op: {}", op));
            }
            validate_expr(&node["left"], w, depth + 1, m, each_ok)?;
            validate_expr(&node["right"], w, depth + 1, m, each_ok)
        }
        _ => Err(format!("AST: unknown expression node type: {}", t)),
    }
}

// Compare operands are leaves: 1 node each, no depth (spec 4.3).
fn validate_operand(opnd: &Value, w: &mut WalkCtx, each_ok: bool) -> Result<(), String> {
    bump(w)?;
    let src = opnd.get("source").and_then(|x| x.as_str()).ok_or("AST: malformed compare operand")?;
    match src {
        "roll" | "dc" | "delta" | "natural" => {
            if w.trigger {
                return Err(format!("AST: compare operand source {} is not valid in trigger context", src));
            }
            Ok(())
        }
        "prop" => {
            let target = opnd.get("target").and_then(|x| x.as_str()).ok_or("AST: compare prop operand target must be a string")?;
            validate_target_ref(target, each_ok)?;
            let prop = opnd.get("property").and_then(|x| x.as_str()).ok_or("AST: compare prop operand property must be a string")?;
            assert_clean_name(prop, "property")
        }
        "literal" => {
            value_int(&opnd["value"], "compare literal operand")?;
            Ok(())
        }
        _ => Err(format!("AST: unknown compare operand source: {}", src)),
    }
}

fn validate_degree_cond(cond: &Value, w: &mut WalkCtx, depth: i64, each_ok: bool) -> Result<(), String> {
    bump(w)?;
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: degree condition exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = cond.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed degree condition")?;
    match t {
        "delta_gte" | "delta_lte" | "nat_roll_eq" | "nat_roll_gte" | "nat_roll_lte" => {
            // Check-only quantities DO NOT EXIST in trigger context (spec 1.1).
            if w.trigger {
                return Err(format!("AST: {} is not valid in trigger context", t));
            }
            value_int(&cond["value"], t)?;
            Ok(())
        }
        "or" => {
            // Empty `or` stays ACCEPTED (evaluates false - fail-closed in
            // spirit), exactly as v1 shipped it. The and/or asymmetry is
            // deliberate (spec 3.2).
            let conds = cond.get("conditions").and_then(|x| x.as_array()).ok_or("AST: or condition requires a conditions array")?;
            for sub in conds {
                validate_degree_cond(sub, w, depth + 1, each_ok)?;
            }
            Ok(())
        }
        "and" => {
            // An empty `and` would be vacuously TRUE (fail-OPEN) -> REJECT (spec 3.2).
            let conds = cond.get("conditions").and_then(|x| x.as_array());
            let conds = match conds {
                Some(c) if !c.is_empty() => c,
                _ => return Err("AST: and requires a non-empty conditions array".to_string()),
            };
            for sub in conds {
                validate_degree_cond(sub, w, depth + 1, each_ok)?;
            }
            Ok(())
        }
        "compare" => {
            let op = cond.get("op").and_then(|x| x.as_str()).unwrap_or("");
            if !matches!(op, "gt" | "gte" | "lt" | "lte" | "eq" | "ne") {
                return Err(format!("AST: unknown compare op: {}", op));
            }
            validate_operand(&cond["left"], w, each_ok)?;
            validate_operand(&cond["right"], w, each_ok)
        }
        "has_tag" => {
            // Valid in BOTH contexts - it reads only state, never check quantities.
            let target = cond.get("target").and_then(|x| x.as_str()).ok_or("AST: has_tag target must be a string")?;
            validate_target_ref(target, each_ok)?;
            let tag = cond.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?;
            assert_clean_name(tag, "tag")
        }
        _ => Err(format!("AST: unknown degree condition: {}", t)),
    }
}

fn validate_mutation(node: &Value, w: &mut WalkCtx, mdepth: i64, m: i64, each_ok: bool) -> Result<(), String> {
    bump(w)?;
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed mutation node")?;
    match t {
        "set_prop" | "add_prop" | "sub_prop" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
            validate_target_ref(target, each_ok)?;
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: property must be a string")?;
            assert_clean_name(prop, "property")?;
            validate_expr(&node["value"], w, 0, m, each_ok)?;
            charge_applied(w, m) // leaf mutation: M applied units (spec 8.2 rule 3)
        }
        "add_tag" | "remove_tag" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
            validate_target_ref(target, each_ok)?;
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?;
            assert_clean_name(tag, "tag")?;
            charge_applied(w, m)
        }
        "if" => {
            // Full context table applies to the condition; BOTH branches are
            // charged at the UNCHANGED M - the static pass never reasons about
            // which branch runs (spec 5.3, 8.2 rule 6). The structural node
            // charges no applied units.
            validate_degree_cond(&node["condition"], w, 0, each_ok)?;
            let then = node.get("then").and_then(|x| x.as_array()).ok_or("AST: if.then must be a mutation array")?;
            validate_mutation_slice(then, w, mdepth + 1, m, each_ok)?;
            if let Some(els) = node.get("else") {
                let els = els.as_array().ok_or("AST: if.else must be a mutation array")?;
                validate_mutation_slice(els, w, mdepth + 1, m, each_ok)?;
            }
            Ok(())
        }
        "foreach_target" => {
            let sel = node.get("select").and_then(|s| s.as_object()).ok_or("AST: foreach_target.select must be an object")?;
            let tag = sel.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag name must be a non-empty string")?;
            assert_clean_name(tag, "tag")?;
            let mut lim = MAX_TARGETS;
            if let Some(lv) = sel.get("limit") {
                // Integer-ness judged by VALUE after JSON parsing (spec 1.4): a
                // lexical 2.0 IS the integer 2. 0 / negatives / non-integral /
                // > 32 all reject - the cap is a validation-time constant,
                // never a runtime clamp of the LIMIT itself (only the matched
                // SET truncates at runtime).
                let l = value_int(lv, "foreach_target select.limit")
                    .map_err(|_| format!("AST: foreach_target select.limit must be an integer in 1..{}", MAX_TARGETS))?;
                if !(1..=MAX_TARGETS).contains(&l) {
                    return Err(format!("AST: foreach_target select.limit must be an integer in 1..{}", MAX_TARGETS));
                }
                lim = l;
            }
            // Multiplicity: reject IMMEDIATELY at body entry when M' overruns -
            // this also caps M itself at 1024, so the algebra can never
            // overflow (spec 8.2 rule 4).
            let m_foreach = m * lim;
            if m_foreach > MAX_APPLIED_MUTATIONS {
                return Err(format!(
                    "AST: applied-mutation budget exceeded (max {}): foreach_target multiplicity {}",
                    MAX_APPLIED_MUTATIONS, m_foreach
                ));
            }
            let muts = node.get("mutations").and_then(|x| x.as_array()).ok_or("AST: foreach_target.mutations must be an array")?;
            validate_mutation_slice(muts, w, mdepth + 1, m_foreach, true) // `each` is in scope inside the body
        }
        "repeat" => {
            // count is a plain JSON integer, judged by VALUE (spec 1.4 / 7.3,
            // vector F7): 1..MAX_ITERATIONS only; 0 is rejected (a no-op is an
            // empty list).
            let count = match value_int(&node["count"], "repeat count") {
                Ok(c) if (1..=MAX_ITERATIONS).contains(&c) => c,
                _ => return Err(format!("AST: repeat count must be an integer in 1..{}", MAX_ITERATIONS)),
            };
            let m_repeat = m * count;
            if m_repeat > MAX_APPLIED_MUTATIONS {
                return Err(format!(
                    "AST: applied-mutation budget exceeded (max {}): repeat multiplicity {}",
                    MAX_APPLIED_MUTATIONS, m_repeat
                ));
            }
            let muts = node.get("mutations").and_then(|x| x.as_array()).ok_or("AST: repeat.mutations must be an array")?;
            validate_mutation_slice(muts, w, mdepth + 1, m_repeat, each_ok) // repeat introduces no `each` binding
        }
        _ => Err(format!("AST: unknown mutation node type: {}", t)),
    }
}

// mdepth is the mutation-structure depth counter (spec 8.3 counter 3): starts
// at 0 for each top-level mutation list; +1 entering an if branch list, a
// foreach_target body, or a repeat body.
fn validate_mutation_slice(mutations: &[Value], w: &mut WalkCtx, mdepth: i64, m: i64, each_ok: bool) -> Result<(), String> {
    if mdepth > MAX_EXPR_DEPTH {
        return Err(format!("AST: mutation structure exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    for mu in mutations {
        validate_mutation(mu, w, mdepth, m, each_ok)?;
    }
    Ok(())
}

fn validate_mutation_list(mutations: &Value, w: &mut WalkCtx, mdepth: i64, m: i64, each_ok: bool) -> Result<(), String> {
    if mdepth > MAX_EXPR_DEPTH {
        return Err(format!("AST: mutation structure exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let arr = mutations.as_array().ok_or("AST: mutations must be an array")?;
    validate_mutation_slice(arr, w, mdepth, m, each_ok)
}

/// Validate a full check AST fail-closed (no rng / no state). The budget
/// accumulators are DOCUMENT-GLOBAL: one budget threads the roll, the dc, and
/// EVERY degree branch - all branches CHARGE though at most one EXECUTES
/// (spec 8.2 rule 8, vector H1).
pub fn validate_check(check: &Value) -> Result<(), String> {
    if check.get("type").and_then(|x| x.as_str()) != Some("check") {
        return Err("AST: expected a check node".to_string());
    }
    let mut w = WalkCtx { b: Budget { nodes: 0, dice: 0, applied: 0 }, trigger: false };
    validate_expr(&check["roll"], &mut w, 0, 1, false)?;
    validate_expr(&check["dc"], &mut w, 0, 1, false)?;
    let degrees = check.get("degrees").and_then(|x| x.as_object()).ok_or("AST: check.degrees must be an object")?;
    let mut keys: Vec<&String> = degrees.keys().collect();
    keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    for k in keys {
        let branch = &degrees[k];
        validate_degree_cond(&branch["condition"], &mut w, 0, false)?;
        validate_mutation_list(&branch["mutations"], &mut w, 0, 1, false)?;
    }
    Ok(())
}

/// Validate a trigger's mutation list fail-closed (no rng / no state). Trigger
/// context: roll / dc / delta / natural DO NOT EXIST, so any condition reading
/// them rejects here (spec 1.1).
pub fn validate_triggered_mutations(mutations: &Value) -> Result<(), String> {
    let mut w = WalkCtx { b: Budget { nodes: 0, dice: 0, applied: 0 }, trigger: true };
    validate_mutation_list(mutations, &mut w, 0, 1, false)
}

// ---- shared resolution cores -------------------------------------------------

// Resolve a flat mutation list against a CLONE of the state. NO validation here
// - the validating entry points call it after their fail-closed pass; the
// _with_rng entry points leave validation to the caller (the Epoch tick
// validates separately to assign reason codes).
fn apply_trigger_core(
    state: &Value,
    mutations: &Value,
    actor: &str,
    target: Option<&str>,
    roller: &mut dyn DieRoller,
) -> Result<MutationsResolution, String> {
    let mut work = state.clone();
    let mut applied: Vec<AppliedMutation> = Vec::new();
    let arr = mutations.as_array().ok_or("AST: mutations must be an array")?;
    let mut rc = RunCtx { actor, target, roller, natural: None, each: None };
    for m in arr {
        apply_mutation_node(&mut work, m, &mut rc, None, &mut applied)?;
    }
    Ok(MutationsResolution { state: work, mutations: applied })
}

// Resolve a check against a CLONE of the state. NO validation here (see
// apply_trigger_core).
fn eval_check_core(
    state: &Value,
    check: &Value,
    actor: &str,
    target: Option<&str>,
    roller: &mut dyn DieRoller,
) -> Result<ActionResult, String> {
    let mut work = state.clone();
    let mut rc = RunCtx { actor, target, roller, natural: None, each: None };
    let roll = eval_expr(&check["roll"], &work, &mut rc, 0)?;
    let natural = rc.natural;
    let dc = eval_expr(&check["dc"], &work, &mut rc, 0)?;
    // delta exactness (spec 4.2, the required v2 amendment): the exact
    // difference of two JS-safe ints can reach +/-(2^54 - 2). It MUST pass the
    // same JS-safe choke point - a RUNTIME error (after the roll/dc dice were
    // consumed, the v1 runtime-error class), identical on every surface.
    let delta = assert_int128(roll as i128 - dc as i128, "delta")?;
    let q = CheckQuantities { roll, dc, delta, natural };
    let degrees = check.get("degrees").and_then(|x| x.as_object()).ok_or("AST: check.degrees must be an object")?;
    let mut chosen = "none".to_string();
    let mut chosen_muts: Vec<Value> = Vec::new();
    for name in DEGREE_ORDER.iter() {
        if let Some(branch) = degrees.get(*name) {
            if match_condition(&branch["condition"], &work, &rc, Some(&q), 0)? {
                chosen = (*name).to_string();
                chosen_muts = branch.get("mutations").and_then(|m| m.as_array()).cloned().unwrap_or_default();
                break;
            }
        }
    }
    let mut applied: Vec<AppliedMutation> = Vec::new();
    for m in &chosen_muts {
        apply_mutation_node(&mut work, m, &mut rc, Some(&q), &mut applied)?;
    }
    Ok(ActionResult { state: work, degree: chosen, roll, natural, dc, delta, mutations: applied })
}

// ---- shared-rng API (Epoch world-tick; validation is the caller's job) ------

/// Resolve a flat mutation action threading a SHARED rng (the Epoch world-tick
/// supplies the epoch PRNG). Validation is the caller's responsibility (the
/// Epoch tick validates first, separately, to assign reason codes); this clones
/// state and never mutates the input.
pub fn apply_triggered_mutations_with_rng(
    state: &Value,
    mutations: &Value,
    actor: &str,
    target: Option<&str>,
    rng: &mut Pcg32,
) -> Result<MutationsResolution, String> {
    apply_trigger_core(state, mutations, actor, target, rng)
}

/// Resolve a check action threading a SHARED rng (the Epoch PRNG). Same
/// contract as `apply_triggered_mutations_with_rng`.
pub fn evaluate_action_with_rng(
    state: &Value,
    check: &Value,
    actor: &str,
    target: Option<&str>,
    rng: &mut Pcg32,
) -> Result<CheckResolution, String> {
    let r = eval_check_core(state, check, actor, target, rng)?;
    Ok(CheckResolution { state: r.state, degree: r.degree, mutations: r.mutations })
}

// ---- roller API (conformance harnesses; validates fail-closed first) --------

/// Resolve a check with an arbitrary `DieRoller` (the conformance-harness entry
/// point: a scripted dice stream per spec 1.3). Validates fail-closed FIRST -
/// a rejected document consumes zero rolls and the input state is untouched.
pub fn evaluate_action_with_roller(
    state: &Value,
    check: &Value,
    actor: &str,
    target: Option<&str>,
    roller: &mut dyn DieRoller,
) -> Result<ActionResult, String> {
    validate_check(check)?;
    eval_check_core(state, check, actor, target, roller)
}

/// Resolve a flat mutation list with an arbitrary `DieRoller`. Validates
/// fail-closed FIRST (trigger context - spec 1.1).
pub fn apply_triggered_mutations_with_roller(
    state: &Value,
    mutations: &Value,
    actor: &str,
    target: Option<&str>,
    roller: &mut dyn DieRoller,
) -> Result<MutationsResolution, String> {
    validate_triggered_mutations(mutations)?;
    apply_trigger_core(state, mutations, actor, target, roller)
}

// ---- compare_ids (numeric-aware id sort, Phase 3 Epoch actor order) ---------

// UTF-8 byte comparison - matches the TS utf8Compare + Python encode('utf-8')
// compare. (Rust &str Ord is already UTF-8 byte order, but we compare raw bytes
// explicitly for clarity + exact parity with the ported algorithm.)
fn utf8_compare(a: &str, b: &str) -> std::cmp::Ordering {
    a.as_bytes().cmp(b.as_bytes())
}

// A "pure numeric" id: optional '-' then >=1 ASCII digit.
fn is_pure_numeric(s: &str) -> bool {
    let rest = if s.as_bytes().first() == Some(&b'-') { &s[1..] } else { s };
    if rest.is_empty() {
        return false;
    }
    rest.bytes().all(|c| (b'0'..=b'9').contains(&c))
}

// Split a pure-numeric id into (neg, magnitude-with-leading-zeros-stripped).
// -0 is +0. Mirrors the TS normalizeNumeric.
fn normalize_numeric(s: &str) -> (bool, String) {
    let neg = s.as_bytes().first() == Some(&b'-');
    let digits = if neg { &s[1..] } else { s };
    let bytes = digits.as_bytes();
    let mut i = 0;
    while i < bytes.len() - 1 && bytes[i] == b'0' {
        i += 1;
    }
    let mut mag = digits[i..].to_string();
    if mag.is_empty() {
        mag = "0".to_string();
    }
    let neg = neg && mag != "0";
    (neg, mag)
}

/// Numeric-aware id comparison: pure-numeric ids sort by VALUE (2 < 10), strings
/// lexicographically (UTF-8 bytes), numbers before strings. No integer parsing -
/// sign + digit-length + UTF-8 bytes, so ids beyond i64 are correct. Byte-identical
/// to the TS `compareIds` / Python `compare_ids`. (NOT the foreach_target SELECT
/// order - that is the UTF-16 code-unit sort, spec 6.2 step 2.)
pub fn compare_ids(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let na = is_pure_numeric(a);
    let nb = is_pure_numeric(b);
    if na && !nb {
        return Ordering::Less; // numbers before strings
    }
    if !na && nb {
        return Ordering::Greater;
    }
    if !na && !nb {
        return utf8_compare(a, b);
    }
    let (an_neg, an_mag) = normalize_numeric(a);
    let (bn_neg, bn_mag) = normalize_numeric(b);
    if !an_neg && bn_neg {
        return Ordering::Greater; // +a > -b
    }
    if an_neg && !bn_neg {
        return Ordering::Less;
    }
    let mag = if an_mag.len() != bn_mag.len() {
        if an_mag.len() < bn_mag.len() { Ordering::Less } else { Ordering::Greater }
    } else {
        utf8_compare(&an_mag, &bn_mag)
    };
    let by_value = if an_neg { mag.reverse() } else { mag }; // both negative: larger magnitude is smaller
    if by_value != Ordering::Equal {
        return by_value;
    }
    utf8_compare(a, b) // math-equal (e.g. "02" vs "2"): raw bytes, total order
}

// ---- public API (seed-constructed rng; back-compat with golden_ast) ---------

pub fn apply_triggered_mutations(state: &Value, mutations: &Value, actor: &str, target: Option<&str>, seed: u64) -> Result<Value, String> {
    validate_triggered_mutations(mutations)?; // fail-closed before any rng/mutation
    // Codex P1a: preserve the target (TS/Python applyTriggeredMutations carry
    // ctx.target) so a triggered mutation can act on a target entity, not only
    // the actor.
    let mut rng = Pcg32::seeded(seed);
    Ok(apply_trigger_core(state, mutations, actor, target, &mut rng)?.state)
}

pub fn evaluate_action(state: &Value, check: &Value, actor: &str, target: Option<&str>, seed: u64) -> Result<ActionResult, String> {
    validate_check(check)?; // fail-closed before any rng/mutation
    let mut rng = Pcg32::seeded(seed);
    eval_check_core(state, check, actor, target, &mut rng)
}
