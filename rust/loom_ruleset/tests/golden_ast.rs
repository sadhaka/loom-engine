//! Cross-language parity: the Rust ruleset AST must reproduce the TS-generated
//! golden vector (test_vectors/v3_ast_bleed.json) byte-for-byte - same degree,
//! roll, natural roll, and resulting world-state hash, across all 7 cases (incl
//! mul/-0 -> +0, the crit, the multi-die natural, the astral tag). This makes the
//! entire Any-System engine tri-language byte-parity (TS + Python + Rust).

use loom_ruleset::{apply_triggered_mutations, evaluate_action};
use loom_snapshot::world_state_hash;
use serde_json::Value;
use std::fs;

#[test]
fn golden_ast_byte_parity_with_ts() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_ast_bleed.json");
    let raw = fs::read_to_string(path).expect("read v3_ast_bleed.json");
    let v: Value = serde_json::from_str(&raw).expect("parse vector");
    let cases = v["cases"].as_array().expect("cases array");
    assert!(cases.len() >= 7, "expected >= 7 AST cases");

    for c in cases {
        let label = c["label"].as_str().unwrap_or("?");
        let key = c["key"].as_str().unwrap();
        let seed: u64 = c["seed"].as_str().unwrap().parse().expect("seed");
        let kind = c["kind"].as_str().unwrap();
        let actor = c["actor"].as_str().unwrap();

        if kind == "condition" {
            let state = apply_triggered_mutations(&c["state"], &c["mutations"], actor, c["target"].as_str(), seed)
                .unwrap_or_else(|e| panic!("{}: {}", label, e));
            let hash = world_state_hash(key.as_bytes(), &state).unwrap();
            assert_eq!(hash, c["expect"]["state_hash"].as_str().unwrap(), "{} hash", label);
        } else {
            let target = c["target"].as_str();
            let r = evaluate_action(&c["state"], &c["check"], actor, target, seed)
                .unwrap_or_else(|e| panic!("{}: {}", label, e));
            assert_eq!(r.degree, c["expect"]["degree"].as_str().unwrap(), "{} degree", label);
            assert_eq!(r.roll, c["expect"]["roll"].as_i64().unwrap(), "{} roll", label);
            assert_eq!(r.natural, c["expect"]["natural"].as_i64(), "{} natural", label);
            let hash = world_state_hash(key.as_bytes(), &r.state).unwrap();
            assert_eq!(hash, c["expect"]["state_hash"].as_str().unwrap(), "{} hash", label);
        }
    }
}

// Codex P1b: an unsafe dice modifier (here the result exceeds 2^53-1) must be
// rejected at VALIDATION time - before any PRNG draw - so a hostile equation cannot
// nudge the stream and then "fail". parse_dice now validates the modifier + result
// range, and validate_check parses dice during its budget pass, so this is fail-closed.
#[test]
fn p1b_unsafe_dice_modifier_rejected_at_validation() {
    use loom_ruleset::validate_check;
    let check = serde_json::json!({
        "type": "check",
        "roll": { "type": "dice", "equation": "1d6+9007199254740992" },
        "dc": { "type": "literal", "value": 0 },
        "degrees": {}
    });
    assert!(validate_check(&check).is_err(), "unsafe dice modifier must be rejected at validation");
}
