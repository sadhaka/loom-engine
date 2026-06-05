//! Cross-language parity: the Rust WorldSession resume must reproduce the
//! TS-generated golden vector (test_vectors/v3_4_world_session.json) byte-for-byte
//! - the same final world-state hash, the same new-events hash, and the same
//! epoch counts - on a REAL HMAC-signed bundle (snapshot verify + chain-tail verify
//! + recorded-mutation reducer + bounded catch-up). This makes the entire Phase 4
//! lifecycle byte-parity (TS reference + the Rust core that WASM/PyO3 bind).

use loom_session::resume_from_json;
use loom_snapshot::world_state_hash;
use serde_json::Value;
use std::fs;

#[test]
fn golden_session_byte_parity_with_ts() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_4_world_session.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read vector")).expect("parse");
    let inputs = &v["inputs"];
    let expect = &v["expect"];
    let key = inputs["key"].as_str().unwrap();

    // inputs already carries {key, bundle, currentEpoch, maxCatchup, ruleset,
    // proposalsByEpoch, actorTags} - exactly resume_from_json's input shape.
    let out: Value = serde_json::from_str(&resume_from_json(&inputs.to_string()).expect("resume")).expect("parse out");

    let sh = world_state_hash(key.as_bytes(), &out["state"]).unwrap();
    assert_eq!(sh, expect["final_state_hash"].as_str().unwrap(), "final state hash");
    let eh = world_state_hash(key.as_bytes(), &out["newEvents"]).unwrap();
    assert_eq!(eh, expect["newEvents_hash"].as_str().unwrap(), "newEvents hash");
    assert_eq!(out["state"]["epoch"].as_i64().unwrap(), expect["final_epoch"].as_i64().unwrap(), "final epoch");
    assert_eq!(out["epochsResolved"].as_i64().unwrap(), expect["epochsResolved"].as_i64().unwrap(), "resolved");
    assert_eq!(out["epochsVoided"].as_i64().unwrap(), expect["epochsVoided"].as_i64().unwrap(), "voided");
    assert_eq!(out["newEvents"].as_array().unwrap().len() as i64, expect["newEvents_count"].as_i64().unwrap(), "count");
}

#[test]
fn corrupted_snapshot_is_rejected() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_4_world_session.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read")).expect("parse");
    let mut inputs = v["inputs"].clone();
    // tamper the snapshot state so its hash no longer matches.
    inputs["bundle"]["snapshot"]["state"]["entities"]["faction_1"]["properties"]["power"] = serde_json::json!(999);
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "corrupted snapshot must be rejected");
    assert!(res.unwrap_err().contains("corrupted snapshot"));
}

#[test]
fn tampered_tail_is_rejected() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_4_world_session.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read")).expect("parse");
    let mut inputs = v["inputs"].clone();
    // mutate a signed payload without re-signing -> HMAC verify fails.
    inputs["bundle"]["chainTail"][0]["payload"]["epoch_number"] = serde_json::json!(999);
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "tampered tail must be rejected");
    assert!(res.unwrap_err().contains("chain tamper"));
}
