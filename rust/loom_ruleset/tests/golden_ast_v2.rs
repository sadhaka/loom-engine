//! AST v2 golden-vector harness (docs/specs/AST-V2-SPEC.md) - the Rust port of
//! tests/ruleset-ast-v2.test.ts.
//!
//! Loads test_vectors/ast_v2_families.json and runs every case through the real
//! evaluator with the spec section 1.3 scripted test roller: roll_die pops
//! dice_stream entries in order, roll_die(0) returns 0 WITHOUT popping
//! (mirroring production Pcg32), accept vectors must consume the stream fully,
//! and reject vectors must reject AT VALIDATION - zero draws, state unchanged.
//! Assertions follow the section 1.5 normative schema exactly: an absent expect
//! field is not asserted; entities not listed in any *_after field are asserted
//! unchanged; `reason` strings are informative only and never asserted.

use loom_ruleset::{
    apply_triggered_mutations_with_roller, evaluate_action_with_roller, validate_check,
    validate_triggered_mutations, AppliedMutation, DieRoller,
};
use serde_json::{json, Value};
use std::fs;

// Scripted test roller (spec 1.3): entry k is the k-th STREAM-CONSUMING
// roll_die call; zero-sides dice are CALLED but pop nothing; out-of-range
// entries and an exhausted stream are harness failures (panics are fine in a
// test harness - they never cross an FFI boundary here).
struct Scripted {
    stream: Vec<i64>,
    i: usize,
    label: String,
}

impl DieRoller for Scripted {
    fn roll_die(&mut self, sides: u32) -> u32 {
        if sides == 0 {
            return 0;
        }
        assert!(
            self.i < self.stream.len(),
            "{}: dice stream exhausted (implementation over-draws)",
            self.label
        );
        let v = self.stream[self.i];
        self.i += 1;
        assert!(
            v >= 1 && v <= sides as i64,
            "{}: stream entry {} out of range for d{}",
            self.label,
            v,
            sides
        );
        v as u32
    }
}

fn load_vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/ast_v2_families.json");
    let raw = fs::read_to_string(path).expect("read ast_v2_families.json");
    serde_json::from_str(&raw).expect("parse vector file")
}

// Encode the applied list exactly as the TS AppliedMutation records (present
// fields only), so it compares 1:1 against the vector's `applied` array.
fn applied_json(ms: &[AppliedMutation]) -> Value {
    Value::Array(
        ms.iter()
            .map(|m| {
                let mut o = serde_json::Map::new();
                o.insert("target".to_string(), Value::from(m.target.clone()));
                if let Some(p) = &m.property {
                    o.insert("property".to_string(), Value::from(p.clone()));
                }
                if let Some(t) = &m.tag {
                    o.insert("tag".to_string(), Value::from(t.clone()));
                }
                o.insert("op".to_string(), Value::from(m.op.clone()));
                if let Some(p) = m.previous {
                    o.insert("previous".to_string(), Value::from(p));
                }
                if let Some(n) = m.next {
                    o.insert("next".to_string(), Value::from(n));
                }
                Value::Object(o)
            })
            .collect(),
    )
}

fn run_case(c: &Value) {
    let label = c["label"].as_str().unwrap_or("?").to_string();
    let context = c["context"].as_str().expect("context");
    let actor = c["actor"].as_str().expect("actor");
    let target = c["target"].as_str();
    let state = &c["state"];
    let pre = state.clone();
    // raw_document vectors (F7): parse THIS string with the surface's standard
    // JSON parser and ignore the ast / mutations fields (spec 1.5).
    let doc: Value = if let Some(raw) = c.get("raw_document").and_then(|x| x.as_str()) {
        serde_json::from_str(raw).unwrap_or_else(|e| panic!("{}: raw_document parse: {}", label, e))
    } else if context == "check" {
        c["ast"].clone()
    } else {
        c["mutations"].clone()
    };
    let stream: Vec<i64> = c["dice_stream"]
        .as_array()
        .expect("dice_stream")
        .iter()
        .map(|v| v.as_i64().expect("dice_stream entry"))
        .collect();
    let stream_len = stream.len();
    let mut sr = Scripted { stream, i: 0, label: label.clone() };
    let ex = &c["expect"];

    if ex["reject"].as_bool() == Some(true) {
        let res: Result<(), String> = if context == "check" {
            evaluate_action_with_roller(state, &doc, actor, target, &mut sr).map(|_| ())
        } else {
            apply_triggered_mutations_with_roller(state, &doc, actor, target, &mut sr).map(|_| ())
        };
        assert!(res.is_err(), "{}: must reject", label);
        assert_eq!(sr.i, 0, "{}: reject consumes zero PRNG draws", label);
        assert_eq!(state, &pre, "{}: reject leaves state unchanged", label);
        return;
    }

    let (end_state, applied) = if context == "check" {
        let r = evaluate_action_with_roller(state, &doc, actor, target, &mut sr)
            .unwrap_or_else(|e| panic!("{}: {}", label, e));
        let want_degree = ex
            .get("degree")
            .and_then(|d| d.as_str())
            .unwrap_or_else(|| panic!("{}: check-context vectors require expect.degree", label));
        assert_eq!(r.degree, want_degree, "{}: degree", label);
        if let Some(v) = ex.get("roll") {
            assert_eq!(Some(r.roll), v.as_i64(), "{}: roll", label);
        }
        if let Some(v) = ex.get("dc") {
            assert_eq!(Some(r.dc), v.as_i64(), "{}: dc", label);
        }
        if let Some(v) = ex.get("delta") {
            assert_eq!(Some(r.delta), v.as_i64(), "{}: delta", label);
        }
        if let Some(v) = ex.get("natural") {
            assert_eq!(r.natural, v.as_i64(), "{}: natural", label);
        }
        (r.state, r.mutations)
    } else {
        let r = apply_triggered_mutations_with_roller(state, &doc, actor, target, &mut sr)
            .unwrap_or_else(|e| panic!("{}: {}", label, e));
        (r.state, r.mutations)
    };

    // Accept vectors MUST consume the stream fully (this is how the "untaken
    // branches consume zero RNG" pins work - spec 1.3).
    assert_eq!(sr.i, stream_len, "{}: dice stream fully consumed", label);
    if let Some(v) = ex.get("rng_draws_total") {
        assert_eq!(Some(sr.i as i64), v.as_i64(), "{}: rng_draws_total", label);
    }
    assert_eq!(state, &pre, "{}: input state never mutated", label);

    let mut listed: Vec<String> = Vec::new();
    if let Some(pa) = ex.get("props_after").and_then(|x| x.as_object()) {
        for (id, want) in pa {
            listed.push(id.clone());
            let got = end_state["entities"][id].get("properties");
            assert_eq!(got, Some(want), "{}: props_after {}", label, id);
        }
    }
    if let Some(ta) = ex.get("tags_after").and_then(|x| x.as_object()) {
        for (id, want) in ta {
            listed.push(id.clone());
            let got = end_state["entities"][id].get("tags");
            assert_eq!(got, Some(want), "{}: tags_after {}", label, id);
        }
    }
    if let Some(ha) = ex.get("hp_after").and_then(|x| x.as_object()) {
        for (id, want) in ha {
            listed.push(id.clone());
            let got = &end_state["entities"][id]["properties"]["hp"];
            assert_eq!(got, want, "{}: hp_after {}", label, id);
        }
    }
    // Entities NOT listed in any *_after field are asserted UNCHANGED (spec 1.5).
    if let Some(input_ents) = pre.get("entities").and_then(|e| e.as_object()) {
        for (id, before) in input_ents {
            if !listed.iter().any(|l| l == id) {
                assert_eq!(
                    &end_state["entities"][id], before,
                    "{}: entity {} unchanged",
                    label, id
                );
            }
        }
    }
    if let Some(want) = ex.get("applied") {
        assert_eq!(&applied_json(&applied), want, "{}: applied list (exact order)", label);
    }
    if let Some(v) = ex.get("applied_count") {
        assert_eq!(Some(applied.len() as i64), v.as_i64(), "{}: applied_count", label);
    }
}

#[test]
fn golden_ast_v2_every_vector_case() {
    let vec = load_vectors();
    let cases = vec["cases"].as_array().expect("cases array");
    assert!(cases.len() >= 38, "expected >= 38 v2 golden cases, got {}", cases.len());
    let mut rejects = 0;
    let mut saw_raw = false;
    for c in cases {
        if c["expect"]["reject"].as_bool() == Some(true) {
            rejects += 1;
        }
        if c.get("raw_document").is_some() {
            saw_raw = true;
        }
        run_case(c);
    }
    assert!(rejects >= 8, "expected >= 8 reject vectors, got {}", rejects);
    assert!(saw_raw, "the raw_document lexical-form vector (F7) is present");
}

// Normative spec behaviors a scripted-stream vector cannot express (they pin
// ERROR classes, not resolutions): short-circuit observability (spec 3.2), the
// both-operands rule (4.2 step 1), the delta exactness amendment (4.2), the
// MAX_WORLD_ENTITIES runtime cap (6.2/8.7), the mutation-structure depth
// counter (8.3), and the has_tag `each` static scope rule (4.6). Mirrors the
// TS pins in tests/ruleset-ast-v2.test.ts.
#[test]
fn ast_v2_normative_pins() {
    const MAXI: i64 = 9_007_199_254_740_991;
    fn roller(label: &str) -> Scripted {
        Scripted { stream: Vec::new(), i: 0, label: label.to_string() }
    }
    // expect_err without requiring Debug on the Ok type.
    fn must_err<T>(r: Result<T, String>, msg: &str) -> String {
        match r {
            Ok(_) => panic!("{}", msg),
            Err(e) => e,
        }
    }
    let s_and = json!({ "epoch": 0, "worldSeed": 0, "entities": {
        "a": { "properties": { "hp": 1 }, "tags": [] } } });

    // 3.2: a decided `and` MUST NOT resolve operands of later children - the
    // missing-target error in child 2 must never fire once child 1 is false.
    let and_check = json!({ "type": "check",
        "roll": { "type": "literal", "value": 1 }, "dc": { "type": "literal", "value": 0 },
        "degrees": { "success": { "condition": { "type": "and", "conditions": [
            { "type": "delta_gte", "value": 999 },
            { "type": "compare", "op": "gte",
              "left": { "source": "prop", "target": "target", "property": "hp" },
              "right": { "source": "literal", "value": 0 } } ] },
            "mutations": [] } } });
    let r = evaluate_action_with_roller(&s_and, &and_check, "a", None, &mut roller("and-sc"))
        .expect("short-circuited and returns the decided result, no error");
    assert_eq!(r.degree, "none", "and short-circuit");

    // 3.2 (made normative for v1 `or` too): a decided `or` never reaches child 2.
    let or_check = json!({ "type": "check",
        "roll": { "type": "literal", "value": 1 }, "dc": { "type": "literal", "value": 0 },
        "degrees": { "success": { "condition": { "type": "or", "conditions": [
            { "type": "delta_gte", "value": 0 },
            { "type": "compare", "op": "gte",
              "left": { "source": "prop", "target": "target", "property": "hp" },
              "right": { "source": "literal", "value": 0 } } ] },
            "mutations": [] } } });
    let r = evaluate_action_with_roller(&s_and, &or_check, "a", None, &mut roller("or-sc"))
        .expect("short-circuited or returns the decided result, no error");
    assert_eq!(r.degree, "success", "or short-circuit");

    // 4.2 step 1: BOTH operands are ALWAYS resolved, left then right - a null
    // left (diceless natural) does NOT skip the right operand's missing-target
    // error.
    let both_check = json!({ "type": "check",
        "roll": { "type": "literal", "value": 1 }, "dc": { "type": "literal", "value": 0 },
        "degrees": { "success": { "condition": { "type": "compare", "op": "gte",
            "left": { "source": "natural" },
            "right": { "source": "prop", "target": "target", "property": "hp" } },
            "mutations": [] } } });
    let err = must_err(
        evaluate_action_with_roller(&s_and, &both_check, "a", None, &mut roller("both")),
        "null left operand must still resolve the right operand",
    );
    assert!(err.contains("target"), "missing-target error, got: {}", err);

    // 4.2 delta exactness: |roll - dc| > 2^53 - 1 is a RUNTIME error
    // (validation passes - both literals are individually JS-safe).
    let delta_check = json!({ "type": "check",
        "roll": { "type": "literal", "value": MAXI }, "dc": { "type": "literal", "value": -MAXI },
        "degrees": { "success": { "condition": { "type": "delta_gte", "value": 0 }, "mutations": [] } } });
    assert!(validate_check(&delta_check).is_ok(), "unsafe delta is NOT a validation reject");
    let err = must_err(
        evaluate_action_with_roller(&s_and, &delta_check, "a", None, &mut roller("delta")),
        "unsafe delta errors at runtime",
    );
    assert!(err.contains("delta"), "delta runtime error, got: {}", err);

    // 6.2 / 8.7: MAX_WORLD_ENTITIES (65536) is a runtime cap at foreach SELECT -
    // exactly 65536 entities pass, 65537 error.
    fn big_state(n: usize) -> Value {
        let mut ents = serde_json::Map::new();
        ents.insert("foe_one".to_string(), json!({ "properties": { "hp": 5 }, "tags": ["foe"] }));
        for i in 1..n {
            ents.insert(format!("e{}", i), json!({ "properties": {}, "tags": [] }));
        }
        json!({ "epoch": 0, "worldSeed": 0, "entities": ents })
    }
    let cap_muts = json!([ { "type": "foreach_target", "select": { "tag": "foe" },
        "mutations": [ { "type": "sub_prop", "target": "each", "property": "hp",
                         "value": { "type": "literal", "value": 1 } } ] } ]);
    let at_cap = big_state(65536);
    let ok = apply_triggered_mutations_with_roller(&at_cap, &cap_muts, "foe_one", None, &mut roller("cap-ok"))
        .expect("65536 entities is within the cap");
    assert_eq!(ok.state["entities"]["foe_one"]["properties"]["hp"], json!(4));
    let over_cap = big_state(65537);
    let err = must_err(
        apply_triggered_mutations_with_roller(&over_cap, &cap_muts, "foe_one", None, &mut roller("cap-over")),
        "65537 entities errors at SELECT",
    );
    assert!(err.contains("MAX_WORLD_ENTITIES"), "entity-cap error, got: {}", err);

    // 8.3: the mutation-structure depth counter - 16 nested bodies accept,
    // 17 reject at validation.
    fn nest_repeats(n: usize) -> Value {
        let mut inner = json!([]);
        for _ in 0..n {
            inner = json!([ { "type": "repeat", "count": 1, "mutations": inner } ]);
        }
        inner
    }
    assert!(validate_triggered_mutations(&nest_repeats(16)).is_ok(), "16-deep structure accepts");
    let err = validate_triggered_mutations(&nest_repeats(17)).expect_err("17-deep structure rejects");
    assert!(err.contains("depth"), "depth reject, got: {}", err);

    // 4.6: has_tag with `each` outside any foreach_target body rejects statically.
    let each_cond = json!([ { "type": "if",
        "condition": { "type": "has_tag", "target": "each", "tag": "x" }, "then": [] } ]);
    let err = validate_triggered_mutations(&each_cond).expect_err("has_tag each outside foreach scope rejects");
    assert!(err.contains("each"), "each scope reject, got: {}", err);
}
