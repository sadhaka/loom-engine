//! loom_ruleset - deterministic data-driven ruleset AST interpreter (Rust core).
//!
//! The native sibling of the TS ruleset-ast.ts and the Python ruleset_ast.py. The
//! ruleset is a strict JSON AST the engine EVALUATES, never code it executes - so
//! any system (5e, PF2e, homebrew) runs with no untrusted-code risk. Builds on
//! loom_math (Pcg32 + floor_div) + loom_snapshot (normalize_tags), so it resolves
//! the same AST + seed to the same mutations and the same world-state hash.
//!
//! Pinned by test_vectors/v3_ast_bleed.json: the test loads the SAME AST the TS
//! generator produced and asserts the SAME degree / roll / natural / hash. Mirrors
//! the post-audit TS contract: integer-only; dice die-by-die so the FIRST die is
//! the natural roll; floor_div only; mul cannot persist -0 (i64 has none); and a
//! STATIC validation pass runs BEFORE any rng draw or mutation (the reject boundary
//! is byte-identical across surfaces). i128 intermediates make mul OVERFLOW throw
//! the JS-safe-int contract rather than wrapping i64.

use loom_math::{floor_div, Pcg32};
use serde_json::Value;

const MAX_INT: i64 = 9_007_199_254_740_991; // 2^53 - 1
const MAX_EXPR_DEPTH: i64 = 16;
const MAX_NODES: i64 = 256;
const MAX_DICE_TOTAL: i64 = 1000;
const DEGREE_ORDER: [&str; 4] = ["critical_success", "success", "failure", "critical_failure"];

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

// A JSON number that must be a JS-safe integer (accepts an integral float like 5.0,
// matching JS where 5.0 === 5; rejects a real fraction or an out-of-range value).
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

// ---- helpers ---------------------------------------------------------------

fn resolve_target(t: &str, ctx: &EvalCtx) -> Result<String, String> {
    match t {
        "actor" | "self" => Ok(ctx.actor.clone()),
        "target" => ctx.target.clone().ok_or_else(|| "AST: action references target but none supplied".to_string()),
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

// ---- expression evaluation -------------------------------------------------

pub fn eval_expression(node: &Value, state: &Value, ctx: &mut EvalCtx, depth: i64) -> Result<i64, String> {
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: expression exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed expression node")?;
    match t {
        "literal" => value_int(&node["value"], "literal"),
        "dice" => {
            let eq = node.get("equation").and_then(|x| x.as_str()).ok_or("AST: dice equation must be a string")?;
            let (count, sides, modi) = parse_dice(eq)?;
            let mut sum: i64 = 0;
            let mut i = 0;
            while i < count {
                let one = ctx.rng.roll_die(sides as u32) as i64;
                if ctx.natural.is_none() {
                    ctx.natural = Some(one);
                }
                sum += one;
                i += 1;
            }
            assert_int128(sum as i128 + modi as i128, "dice result")
        }
        "prop_ref" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: prop_ref target must be a string")?;
            let id = resolve_target(target, ctx)?;
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: prop_ref property must be a string")?;
            read_prop(state, &id, prop)
        }
        "math" => {
            let l = eval_expression(&node["left"], state, ctx, depth + 1)?;
            let r = eval_expression(&node["right"], state, ctx, depth + 1)?;
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

fn match_degree(cond: &Value, delta: i64, natural: Option<i64>, depth: i64) -> Result<bool, String> {
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: degree condition exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = cond.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed degree condition")?;
    match t {
        "delta_gte" => Ok(delta >= value_int(&cond["value"], "delta_gte")?),
        "delta_lte" => Ok(delta <= value_int(&cond["value"], "delta_lte")?),
        "nat_roll_eq" => Ok(natural.is_some() && natural.unwrap() == value_int(&cond["value"], "nat_roll_eq")?),
        "or" => {
            let conds = cond.get("conditions").and_then(|x| x.as_array()).ok_or("AST: or condition requires a conditions array")?;
            for sub in conds {
                if match_degree(sub, delta, natural, depth + 1)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        _ => Err(format!("AST: unknown degree condition: {}", t)),
    }
}

fn apply_mutation(state: &mut Value, node: &Value, ctx: &mut EvalCtx) -> Result<(), String> {
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed mutation node")?.to_string();
    let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
    let id = resolve_target(target, ctx)?;
    match t.as_str() {
        "set_prop" | "add_prop" | "sub_prop" => {
            let value = eval_expression(&node["value"], &*state, ctx, 0)?; // immutable borrow ends here
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: property must be a string")?.to_string();
            let prev = read_prop(&*state, &id, &prop)?;
            let nxt = match t.as_str() {
                "set_prop" => value,
                "add_prop" => assert_int128(prev as i128 + value as i128, "mutated property")?,
                _ => assert_int128(prev as i128 - value as i128, "mutated property")?,
            };
            let ent = entity_mut(state, &id)?;
            let props = ent.get_mut("properties").and_then(|p| p.as_object_mut()).ok_or("AST: entity.properties must be an object")?;
            props.insert(prop, Value::from(nxt));
            Ok(())
        }
        "add_tag" => {
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?.to_string();
            let ent = entity_mut(state, &id)?;
            let mut tags: Vec<String> = ent.get("tags").and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            tags.push(tag);
            let normalized = loom_snapshot::normalize_tags(&tags);
            ent.insert("tags".to_string(), Value::from(normalized));
            Ok(())
        }
        "remove_tag" => {
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?.to_string();
            let ent = entity_mut(state, &id)?;
            let tags: Vec<String> = ent.get("tags").and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).filter(|x| x != &tag).collect())
                .unwrap_or_default();
            ent.insert("tags".to_string(), Value::from(tags));
            Ok(())
        }
        _ => Err(format!("AST: unknown mutation node type: {}", t)),
    }
}

// ---- static validation pass (validate BEFORE any rng draw / mutation) -------

struct Budget {
    nodes: i64,
    dice: i64,
}

fn bump(b: &mut Budget) -> Result<(), String> {
    b.nodes += 1;
    if b.nodes > MAX_NODES {
        return Err(format!("AST: node budget exceeded (max {})", MAX_NODES));
    }
    Ok(())
}

fn validate_target_ref(t: &str) -> Result<(), String> {
    match t {
        "actor" | "self" | "target" => Ok(()),
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

fn validate_expr(node: &Value, b: &mut Budget, depth: i64) -> Result<(), String> {
    bump(b)?;
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
            b.dice += count;
            if b.dice > MAX_DICE_TOTAL {
                return Err(format!("AST: total dice count exceeds budget {}", MAX_DICE_TOTAL));
            }
            Ok(())
        }
        "prop_ref" => {
            let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: prop_ref target must be a string")?;
            validate_target_ref(target)?;
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: prop_ref property must be a string")?;
            assert_clean_name(prop, "property")
        }
        "math" => {
            let op = node.get("op").and_then(|x| x.as_str()).unwrap_or("");
            if !matches!(op, "add" | "sub" | "mul" | "floor_div") {
                return Err(format!("AST: unknown math op: {}", op));
            }
            validate_expr(&node["left"], b, depth + 1)?;
            validate_expr(&node["right"], b, depth + 1)
        }
        _ => Err(format!("AST: unknown expression node type: {}", t)),
    }
}

fn validate_degree_cond(cond: &Value, b: &mut Budget, depth: i64) -> Result<(), String> {
    bump(b)?;
    if depth > MAX_EXPR_DEPTH {
        return Err(format!("AST: degree condition exceeds max depth {}", MAX_EXPR_DEPTH));
    }
    let t = cond.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed degree condition")?;
    match t {
        "delta_gte" | "delta_lte" | "nat_roll_eq" => {
            value_int(&cond["value"], t)?;
            Ok(())
        }
        "or" => {
            let conds = cond.get("conditions").and_then(|x| x.as_array()).ok_or("AST: or condition requires a conditions array")?;
            for sub in conds {
                validate_degree_cond(sub, b, depth + 1)?;
            }
            Ok(())
        }
        _ => Err(format!("AST: unknown degree condition: {}", t)),
    }
}

fn validate_mutation(node: &Value, b: &mut Budget) -> Result<(), String> {
    bump(b)?;
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed mutation node")?;
    let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
    validate_target_ref(target)?;
    match t {
        "set_prop" | "add_prop" | "sub_prop" => {
            let prop = node.get("property").and_then(|x| x.as_str()).ok_or("AST: property must be a string")?;
            assert_clean_name(prop, "property")?;
            validate_expr(&node["value"], b, 0)
        }
        "add_tag" | "remove_tag" => {
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?;
            assert_clean_name(tag, "tag")
        }
        _ => Err(format!("AST: unknown mutation node type: {}", t)),
    }
}

fn validate_mutation_list(mutations: &Value, b: &mut Budget) -> Result<(), String> {
    let arr = mutations.as_array().ok_or("AST: mutations must be an array")?;
    for m in arr {
        validate_mutation(m, b)?;
    }
    Ok(())
}

pub fn validate_check(check: &Value) -> Result<(), String> {
    if check.get("type").and_then(|x| x.as_str()) != Some("check") {
        return Err("AST: expected a check node".to_string());
    }
    let mut b = Budget { nodes: 0, dice: 0 };
    validate_expr(&check["roll"], &mut b, 0)?;
    validate_expr(&check["dc"], &mut b, 0)?;
    let degrees = check.get("degrees").and_then(|x| x.as_object()).ok_or("AST: check.degrees must be an object")?;
    let mut keys: Vec<&String> = degrees.keys().collect();
    keys.sort();
    for k in keys {
        let branch = &degrees[k];
        validate_degree_cond(&branch["condition"], &mut b, 0)?;
        validate_mutation_list(&branch["mutations"], &mut b)?;
    }
    Ok(())
}

pub fn validate_triggered_mutations(mutations: &Value) -> Result<(), String> {
    let mut b = Budget { nodes: 0, dice: 0 };
    validate_mutation_list(mutations, &mut b)
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

// apply_mutation, but also records the mutation in `applied` exactly as the TS
// AppliedMutation (present fields only), for the Epoch event framing.
fn apply_mutation_recorded(
    state: &mut Value,
    node: &Value,
    ctx: &mut EvalCtx,
    applied: &mut Vec<AppliedMutation>,
) -> Result<(), String> {
    let t = node.get("type").and_then(|x| x.as_str()).ok_or("AST: malformed mutation node")?.to_string();
    let target = node.get("target").and_then(|x| x.as_str()).ok_or("AST: mutation target must be a string")?;
    let id = resolve_target(target, ctx)?;
    match t.as_str() {
        "set_prop" | "add_prop" | "sub_prop" => {
            let value = eval_expression(&node["value"], &*state, ctx, 0)?;
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
                target: id.clone(),
                property: Some(prop),
                tag: None,
                previous: Some(prev),
                next: Some(nxt),
            });
            Ok(())
        }
        "add_tag" => {
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
                target: id.clone(),
                property: None,
                tag: Some(tag),
                previous: None,
                next: None,
            });
            Ok(())
        }
        "remove_tag" => {
            let tag = node.get("tag").and_then(|x| x.as_str()).ok_or("AST: tag must be a string")?.to_string();
            let ent = entity_mut(state, &id)?;
            let tags: Vec<String> = ent.get("tags").and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).filter(|x| x != &tag).collect())
                .unwrap_or_default();
            ent.insert("tags".to_string(), Value::from(tags));
            applied.push(AppliedMutation {
                op: t.clone(),
                target: id.clone(),
                property: None,
                tag: Some(tag),
                previous: None,
                next: None,
            });
            Ok(())
        }
        _ => Err(format!("AST: unknown mutation node type: {}", t)),
    }
}

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
    let mut work = state.clone();
    let mut applied: Vec<AppliedMutation> = Vec::new();
    let arr = mutations.as_array().ok_or("AST: mutations must be an array")?;
    {
        let mut ctx = EvalCtx {
            actor: actor.to_string(),
            target: target.map(|s| s.to_string()),
            rng: Pcg32::seeded(0), // placeholder; real rng threaded via take below
            natural: None,
        };
        // Swap the shared rng into the ctx, run, swap it back out so the caller's
        // draw count is preserved (no clone - the SAME stream advances).
        std::mem::swap(&mut ctx.rng, rng);
        let res = (|| -> Result<(), String> {
            for m in arr {
                apply_mutation_recorded(&mut work, m, &mut ctx, &mut applied)?;
            }
            Ok(())
        })();
        std::mem::swap(&mut ctx.rng, rng);
        res?;
    }
    Ok(MutationsResolution { state: work, mutations: applied })
}

/// Resolve a check action threading a SHARED rng (the Epoch PRNG). Same contract
/// as `apply_triggered_mutations_with_rng`.
pub fn evaluate_action_with_rng(
    state: &Value,
    check: &Value,
    actor: &str,
    target: Option<&str>,
    rng: &mut Pcg32,
) -> Result<CheckResolution, String> {
    let mut work = state.clone();
    let mut applied: Vec<AppliedMutation> = Vec::new();
    let mut degree = "none".to_string();
    {
        let mut ctx = EvalCtx {
            actor: actor.to_string(),
            target: target.map(|s| s.to_string()),
            rng: Pcg32::seeded(0),
            natural: None,
        };
        std::mem::swap(&mut ctx.rng, rng);
        let res = (|| -> Result<(), String> {
            let roll = eval_expression(&check["roll"], &work, &mut ctx, 0)?;
            let natural = ctx.natural;
            let dc = eval_expression(&check["dc"], &work, &mut ctx, 0)?;
            let delta = roll - dc;
            let degrees = check.get("degrees").and_then(|x| x.as_object()).ok_or("AST: check.degrees must be an object")?;
            let mut chosen_muts: Vec<Value> = Vec::new();
            for name in DEGREE_ORDER.iter() {
                if let Some(branch) = degrees.get(*name) {
                    if match_degree(&branch["condition"], delta, natural, 0)? {
                        degree = (*name).to_string();
                        chosen_muts = branch.get("mutations").and_then(|m| m.as_array()).cloned().unwrap_or_default();
                        break;
                    }
                }
            }
            for m in &chosen_muts {
                apply_mutation_recorded(&mut work, m, &mut ctx, &mut applied)?;
            }
            Ok(())
        })();
        std::mem::swap(&mut ctx.rng, rng);
        res?;
    }
    Ok(CheckResolution { state: work, degree, mutations: applied })
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
/// to the TS `compareIds` / Python `compare_ids`.
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
    let mut work = state.clone();
    // Codex P1a: preserve the target (TS/Python applyTriggeredMutations carry ctx.target)
    // so a triggered mutation can act on a target entity, not only the actor.
    let mut ctx = EvalCtx { actor: actor.to_string(), target: target.map(|s| s.to_string()), rng: Pcg32::seeded(seed), natural: None };
    let arr = mutations.as_array().ok_or("AST: mutations must be an array")?;
    for m in arr {
        apply_mutation(&mut work, m, &mut ctx)?;
    }
    Ok(work)
}

pub fn evaluate_action(state: &Value, check: &Value, actor: &str, target: Option<&str>, seed: u64) -> Result<ActionResult, String> {
    validate_check(check)?; // fail-closed before any rng/mutation
    let mut work = state.clone();
    let mut ctx = EvalCtx { actor: actor.to_string(), target: target.map(|s| s.to_string()), rng: Pcg32::seeded(seed), natural: None };
    let roll = eval_expression(&check["roll"], &work, &mut ctx, 0)?;
    let natural = ctx.natural;
    let dc = eval_expression(&check["dc"], &work, &mut ctx, 0)?;
    let delta = roll - dc;
    let degrees = check.get("degrees").and_then(|x| x.as_object()).ok_or("AST: check.degrees must be an object")?;
    let mut chosen = "none".to_string();
    let mut chosen_muts: Vec<Value> = Vec::new();
    for name in DEGREE_ORDER.iter() {
        if let Some(branch) = degrees.get(*name) {
            if match_degree(&branch["condition"], delta, natural, 0)? {
                chosen = (*name).to_string();
                chosen_muts = branch.get("mutations").and_then(|m| m.as_array()).cloned().unwrap_or_default();
                break;
            }
        }
    }
    let mut applied: Vec<AppliedMutation> = Vec::new();
    for m in &chosen_muts {
        apply_mutation_recorded(&mut work, m, &mut ctx, &mut applied)?;
    }
    Ok(ActionResult { state: work, degree: chosen, roll, natural, dc, delta, mutations: applied })
}
