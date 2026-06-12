//! Cross-language parity: the Rust Epoch world-tick must reproduce the
//! TS-generated golden vector (test_vectors/v3_3_epoch_tick.json) byte-for-byte -
//! the same resulting world-state hash AND the same EpochResolved event hash, plus
//! the same resolved/rejected/pcg_steps/epochsVoided counts, across all 7 cases
//! (numeric-vs-byte id ordering, zero-prng-on-reject, the max_actions cap, and the
//! bounded catch-up + void). This makes the entire Phase 3 tick tri-language
//! byte-parity (TS + Python + Rust).

use loom_epoch::{catch_up_epochs, tick_epoch, CatchUpInput, TickEpochInput};
use loom_snapshot::world_state_hash;
use serde_json::Value;
use std::fs;

#[test]
fn golden_epoch_byte_parity_with_ts() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_3_epoch_tick.json");
    let raw = fs::read_to_string(path).expect("read v3_3_epoch_tick.json");
    let v: Value = serde_json::from_str(&raw).expect("parse vector");
    let cases = v["cases"].as_array().expect("cases array");
    assert!(cases.len() >= 7, "expected >= 7 epoch cases");

    for c in cases {
        let label = c["label"].as_str().unwrap_or("?");
        let key = c["key"].as_str().unwrap();
        let world_id = c["worldId"].as_str().unwrap();
        let actor_tags: Vec<String> = c["actorTags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        let ruleset = &c["ruleset"];
        let state = &c["state"];
        let expect = &c["expect"];
        let kind = c["kind"].as_str().unwrap();

        if kind == "tick" {
            let epoch_number = c["epochNumber"].as_i64().unwrap();
            let proposals = &c["proposals"];
            let max_actions = c.get("maxActions").and_then(|m| m.as_u64());
            let r = tick_epoch(TickEpochInput {
                world_id,
                state,
                epoch_number,
                proposals,
                ruleset,
                actor_tags: actor_tags.clone(),
                max_actions,
            }).expect("golden inputs are NFC-clean");
            let sh = world_state_hash(key.as_bytes(), &r.state).unwrap();
            assert_eq!(sh, expect["state_hash"].as_str().unwrap(), "{} state_hash", label);
            let eh = world_state_hash(key.as_bytes(), &Value::Array(vec![r.event.clone()])).unwrap();
            assert_eq!(eh, expect["events_hash"].as_str().unwrap(), "{} events_hash", label);
            assert_eq!(
                r.event["pcg_steps_consumed"].as_u64().unwrap(),
                expect["pcg_steps_consumed"].as_u64().unwrap(),
                "{} steps",
                label
            );
            assert_eq!(r.resolved, expect["resolved"].as_u64().unwrap(), "{} resolved", label);
            assert_eq!(r.rejected, expect["rejected"].as_u64().unwrap(), "{} rejected", label);
        } else {
            let current_epoch = c["currentEpoch"].as_i64().unwrap();
            let max_catchup = c["maxCatchup"].as_i64().unwrap();
            let proposals_by_epoch = &c["proposalsByEpoch"];
            let r = catch_up_epochs(CatchUpInput {
                world_id,
                state,
                current_epoch,
                max_catchup,
                ruleset,
                proposals_by_epoch,
                actor_tags: actor_tags.clone(),
                max_actions: None,
            }).expect("golden inputs are NFC-clean");
            let sh = world_state_hash(key.as_bytes(), &r.state).unwrap();
            assert_eq!(sh, expect["state_hash"].as_str().unwrap(), "{} state_hash", label);
            let eh = world_state_hash(key.as_bytes(), &Value::Array(r.events.clone())).unwrap();
            assert_eq!(eh, expect["events_hash"].as_str().unwrap(), "{} events_hash", label);
            assert_eq!(r.epochs_resolved, expect["epochsResolved"].as_i64().unwrap(), "{} resolved", label);
            assert_eq!(r.epochs_voided, expect["epochsVoided"].as_i64().unwrap(), "{} voided", label);
        }
    }
}

// Codex P1: the validating JSON boundary rejects the same inputs TS/Python reject.
#[test]
fn from_json_boundary_is_fail_closed() {
    // F1: epoch beyond the JS-safe range.
    let bad_epoch = serde_json::json!({"worldId":"w","epochNumber":9007199254740992i64,"state":{"epoch":0,"worldSeed":0,"entities":{}},"proposals":{},"ruleset":{}});
    assert!(loom_epoch::tick_epoch_from_json(&bad_epoch.to_string()).is_err(), "unsafe epoch must be rejected");
    // F3: a fractional maxActions.
    let bad_cap = serde_json::json!({"worldId":"w","epochNumber":1,"state":{"epoch":0,"worldSeed":0,"entities":{}},"proposals":{},"ruleset":{},"maxActions":0.5});
    assert!(loom_epoch::tick_epoch_from_json(&bad_cap.to_string()).is_err(), "fractional maxActions must be rejected");
    // F2: a negative maxCatchup.
    let bad_catchup = serde_json::json!({"worldId":"w","currentEpoch":2,"maxCatchup":-1,"state":{"epoch":0,"worldSeed":0,"entities":{}},"ruleset":{}});
    assert!(loom_epoch::catch_up_epochs_from_json(&bad_catchup.to_string()).is_err(), "negative maxCatchup must be rejected");
    // sanity: a valid tick still succeeds through the boundary.
    let ok = serde_json::json!({"worldId":"w","epochNumber":1,"state":{"epoch":0,"worldSeed":0,"entities":{}},"proposals":{},"ruleset":{}});
    assert!(loom_epoch::tick_epoch_from_json(&ok.to_string()).is_ok(), "valid tick must pass");
}

#[test]
fn non_nfc_world_id_is_rejected_on_every_epoch_entry_point() {
    // Round-6 audit HIGH: TS/Python reject a non-NFC worldId at the epoch
    // seed derivation; Rust hashed the decomposed bytes and derived a
    // DIFFERENT PRNG - a cross-surface determinism fork reachable through
    // WASM/PyO3/C-ABI via tick_epoch_from_json. Every entry point rejects.
    let dirty = "cafe\u{0301}";
    assert!(loom_epoch::derive_epoch_prng(dirty, 1).is_err());
    let bad_tick = serde_json::json!({"worldId": dirty, "epochNumber": 1,
        "state": {"epoch": 0, "worldSeed": 0, "entities": {}},
        "proposals": {}, "ruleset": {}});
    let e = loom_epoch::tick_epoch_from_json(&bad_tick.to_string());
    assert!(e.is_err() && e.unwrap_err().contains("non-NFC"));
    let bad_catchup = serde_json::json!({"worldId": dirty, "currentEpoch": 5,
        "maxCatchup": 5, "state": {"epoch": 0, "worldSeed": 0, "entities": {}},
        "proposalsByEpoch": {}, "ruleset": {}});
    assert!(loom_epoch::catch_up_epochs_from_json(&bad_catchup.to_string()).is_err());
    // The precomposed twin (same grapheme, NFC bytes) is accepted.
    assert!(loom_epoch::derive_epoch_prng("caf\u{00e9}", 1).is_ok());
}
