//! Cross-language golden-vector runner (Rust side) - the THIRD corner of the
//! parity triangle.
//!
//! Loads the SAME shared file the TS (tests/golden-vectors.test.ts) and Python
//! (python/tests/test_golden_vectors.py) harnesses load, and asserts the Rust
//! core produces byte-identical outputs. If all three pass against one file,
//! the three surfaces are proven identical for those cases - the determinism
//! guarantee the whole engine-is-truth model depends on.
//!
//! Scope note: this runner covers the NUMERIC core (range bands, initiative
//! ordering, the reaction ceiling). It deliberately SKIPS
//! `narration.find_invented_number`: that validator scans LLM prose, which only
//! ever runs on the server - it has no WASM/Unity/native client consumer, so it
//! is intentionally NOT in the Rust core (per the roadmap's "don't pre-build a
//! surface with no consumer" rule). TS + Python own that section.
//!
//! Run: `cargo test -p loom_combat --test golden_vectors`

use loom_combat::range_bands;
use loom_combat::reaction::ReactionLedger;
use loom_combat::ruleset::{compare_ids, initiative_order, InitiativeEntry};
use serde_json::Value;

/// Path to the shared vectors, relative to THIS crate's manifest dir.
/// loom_combat is at <repo>/rust/loom_combat -> vectors at <repo>/test_vectors.
const VECTORS: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v2_3_0_primitives.json");

fn load() -> Value {
    let raw = std::fs::read_to_string(VECTORS)
        .unwrap_or_else(|e| panic!("cannot read shared vectors at {}: {}", VECTORS, e));
    serde_json::from_str(&raw).expect("shared vectors are not valid JSON")
}

/// Replay a scripted reaction op-list against a fresh ledger (round 1), matching
/// the Python `run_reaction_script` semantics exactly. Returns one Value per op:
/// spend/can_react -> Bool, advance -> Number(new_round).
fn run_reaction_script(ops: &[Value]) -> Vec<Value> {
    // Fresh ledger starts at round 1 - so the first `advance` yields 2, matching
    // the Python create_reaction_ledger() default and the vector's expected `2`.
    let mut ledger = ReactionLedger::new(1);
    let mut out = Vec::new();
    for op in ops {
        let kind = op[0].as_str().expect("op[0] must be a string");
        match kind {
            "spend" => {
                let who = op[1].as_str().expect("spend needs an entity");
                out.push(Value::Bool(ledger.spend(who)));
            }
            "can_react" => {
                let who = op[1].as_str().expect("can_react needs an entity");
                out.push(Value::Bool(ledger.can_react(who)));
            }
            "advance" => {
                out.push(Value::from(ledger.advance_round()));
            }
            other => panic!("unknown reaction op kind: {}", other),
        }
    }
    out
}

#[test]
fn golden_vectors_numeric_core() {
    let v = load();
    let mut failures: Vec<String> = Vec::new();
    let mut passed = 0usize;

    // -- range_bands.band_from_distance_ft (integer feet, canonical) --
    for case in v["range_bands.band_from_distance_ft"]
        .as_array()
        .expect("missing band_from_distance_ft section")
    {
        let feet = case["args"][0].as_i64().expect("feet must be an integer");
        let expect = case["expect"].as_str().expect("expect must be a string");
        let got = range_bands::band_from_distance_ft(feet);
        if got == expect {
            passed += 1;
        } else {
            failures.push(format!(
                "band_from_distance_ft({}) = {:?}, expected {:?}",
                feet, got, expect
            ));
        }
    }

    // -- range_bands.band_within --
    for case in v["range_bands.band_within"]
        .as_array()
        .expect("missing band_within section")
    {
        let band = case["args"][0].as_str().unwrap();
        let max_band = case["args"][1].as_str().unwrap();
        let expect = case["expect"].as_bool().expect("expect must be a bool");
        let got = range_bands::band_within(band, max_band);
        if got == expect {
            passed += 1;
        } else {
            failures.push(format!(
                "band_within({:?}, {:?}) = {}, expected {}",
                band, max_band, got, expect
            ));
        }
    }

    // -- ruleset.initiative_order_ids --
    for case in v["ruleset.initiative_order_ids"]
        .as_array()
        .expect("missing initiative_order_ids section")
    {
        let mut entries: Vec<InitiativeEntry> = Vec::new();
        for e in case["entries"].as_array().unwrap() {
            entries.push(InitiativeEntry {
                id: e["id"].as_str().unwrap().to_string(),
                total: e["total"].as_i64().unwrap(),
                modifier: e["modifier"].as_i64().unwrap(),
                d20: e["d20"].as_i64().unwrap(),
            });
        }
        let got: Vec<String> = initiative_order(entries)
            .into_iter()
            .map(|e| e.id)
            .collect();
        let expect: Vec<String> = case["expect"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        if got == expect {
            passed += 1;
        } else {
            failures.push(format!(
                "initiative_order_ids = {:?}, expected {:?}",
                got, expect
            ));
        }
    }

    // -- ruleset.compare_ids (numeric-aware id tiebreak) --
    for case in v["ruleset.compare_ids"]
        .as_array()
        .expect("missing compare_ids section")
    {
        let mut ids: Vec<String> = case["input"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        ids.sort_by(|a, b| compare_ids(a, b));
        let expect: Vec<String> = case["expect_asc"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        if ids == expect {
            passed += 1;
        } else {
            failures.push(format!("compare_ids sort = {:?}, expected {:?}", ids, expect));
        }
    }

    // -- reaction.scripted (mixed bool/number op-replay) --
    for case in v["reaction.scripted"]
        .as_array()
        .expect("missing reaction.scripted section")
    {
        let ops = case["ops"].as_array().unwrap();
        let got = Value::Array(run_reaction_script(ops));
        let expect = &case["expect"];
        if &got == expect {
            passed += 1;
        } else {
            failures.push(format!(
                "reaction.scripted = {}, expected {}",
                got, expect
            ));
        }
    }

    println!(
        "golden vectors (Rust): passed={} failed={}",
        passed,
        failures.len()
    );
    assert!(
        failures.is_empty(),
        "Rust diverges from the shared golden vectors:\n{}",
        failures.join("\n")
    );
}
