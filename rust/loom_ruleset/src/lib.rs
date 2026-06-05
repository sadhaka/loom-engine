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

// ---- public API ------------------------------------------------------------

pub fn apply_triggered_mutations(state: &Value, mutations: &Value, actor: &str, seed: u64) -> Result<Value, String> {
    validate_triggered_mutations(mutations)?; // fail-closed before any rng/mutation
    let mut work = state.clone();
    let mut ctx = EvalCtx { actor: actor.to_string(), target: None, rng: Pcg32::seeded(seed), natural: None };
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
    for m in &chosen_muts {
        apply_mutation(&mut work, m, &mut ctx)?;
    }
    Ok(ActionResult { state: work, degree: chosen, roll, natural, dc, delta })
}
