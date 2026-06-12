//! Cross-language parity: the Rust WorldSession resume must reproduce the
//! TS-generated golden vector (test_vectors/v3_4_world_session.json)
//! byte-for-byte (the same final world-state hash, the same new-events hash,
//! and the same epoch counts) on a REAL HMAC-signed bundle (snapshot verify +
//! structural seal verify + chain-tail verify + recorded-mutation reducer +
//! bounded catch-up). This makes the entire Phase 4 lifecycle byte-parity
//! (TS reference + the Rust core that WASM/PyO3 bind). Bundle format v2: the
//! fail-closed seal gates are covered directly below, mirroring
//! tests/world-session.test.ts: an end-truncated tail, a missing (pre-v2) seal,
//! a forged seal, a swapped valid-but-stale seal, and an out-of-range
//! snapshotEventIndex are all rejected.

use loom_events::EventChain;
use loom_session::resume_from_json;
use loom_snapshot::world_state_hash;
use serde_json::{json, Value};
use std::fs;

fn load_inputs() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_4_world_session.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read vector")).expect("parse");
    v["inputs"].clone()
}

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
fn reducer_does_not_panic_on_malformed_state() {
    // Codex P0: a state whose `entities` is not a JSON object (a hostile bundle whose
    // snapshot hash matched but whose shape is malformed) must NOT panic the reducer -
    // a panic across the C ABI is UB. The mutation is simply skipped, deterministically.
    let state = serde_json::json!({ "epoch": 0, "worldSeed": 0, "entities": 0 });
    let event = serde_json::json!({
        "event_type": "EpochResolved", "epoch_number": 1,
        "actions_processed": [{ "action_id": "a", "actor_id": "x", "degree": "none",
            "mutations_applied": [{ "op": "add_prop", "target": "x", "property": "hp", "next": 5 }] }],
        "pcg_steps_consumed": 0
    });
    let out = loom_session::replay_epoch_event(&state, &event); // must not panic
    assert_eq!(out["epoch"].as_i64(), Some(1), "epoch still advances; no panic");
}

#[test]
fn tampered_tail_is_rejected() {
    let mut inputs = load_inputs();
    // mutate a signed payload without re-signing -> HMAC verify fails.
    inputs["bundle"]["chainTail"][0]["payload"]["epoch_number"] = serde_json::json!(999);
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "tampered tail must be rejected");
    assert!(res.unwrap_err().contains("chain tamper"));
}

// ---- bundle format v2: the structural seal (fail-closed, no escape hatch) ----

#[test]
fn end_truncated_tail_is_rejected_by_the_structural_seal() {
    // The exact attack the seal closes: the vector bundle's tail loses its
    // trailing record. Before bundle format v2 this verified CLEAN and resume()
    // silently replaced the dropped history with re-simulated catch-up.
    let mut inputs = load_inputs();
    let tail = inputs["bundle"]["chainTail"].as_array().expect("tail").clone();
    assert!(!tail.is_empty(), "vector bundle has a tail to truncate");
    inputs["bundle"]["chainTail"] = Value::Array(tail[..tail.len() - 1].to_vec());
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "end-truncated tail must be rejected");
    let e = res.unwrap_err();
    assert!(e.contains("does not match the seal"), "reason is the seal, got: {}", e);
}

#[test]
fn seal_less_pre_v2_bundle_is_rejected() {
    let mut inputs = load_inputs();
    inputs["bundle"].as_object_mut().expect("bundle object").remove("seal");
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "seal-less bundle must be rejected");
    let e = res.unwrap_err();
    assert!(e.contains("carries no chain seal"), "reason is the missing seal, got: {}", e);
}

#[test]
fn forged_seal_signature_is_rejected() {
    let mut inputs = load_inputs();
    let sig = inputs["bundle"]["seal"]["sig"].as_str().expect("seal sig").to_string();
    let flipped_tail = if sig.ends_with("00") { "11" } else { "00" };
    inputs["bundle"]["seal"]["sig"] = json!(format!("{}{}", &sig[..sig.len() - 2], flipped_tail));
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "forged seal must be rejected");
    let e = res.unwrap_err();
    assert!(e.contains("seal signature invalid"), "reason is the forged sig, got: {}", e);
}

#[test]
fn swapped_valid_but_stale_seal_is_rejected() {
    // A VALID seal taken from a different chain state (here: an empty chain's
    // seal) cannot be swapped in - the sealed head no longer matches the tail.
    let mut inputs = load_inputs();
    let key = inputs["key"].as_str().expect("key").to_string();
    let genesis = inputs["bundle"]["tailGenesis"].as_str().expect("tailGenesis").to_string();
    let empty = EventChain::create(key.as_bytes(), &genesis);
    let stale = empty.seal().expect("clean tailGenesis seals"); // count 0, head == tailGenesis - validly signed
    inputs["bundle"]["seal"] = json!({ "count": stale.count, "head": stale.head, "sig": stale.sig });
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "stale seal must be rejected");
    let e = res.unwrap_err();
    // Bundle format v3: the binding signs the sealed (count, head) with the
    // snapshot identity, so swapping in a stale seal whose count/head differ
    // from what was bound is caught by the binding gate - a stronger rejection
    // than the structural head check. Either way the bundle is rejected.
    assert!(
        e.contains("binding invalid") || e.contains("does not match the seal"),
        "reason is the binding or seal mismatch, got: {}",
        e
    );
}

// Codex audit P1: the leading-truncation forge is rejected by the binding.
#[test]
fn leading_truncation_forge_is_rejected() {
    let mut inputs = load_inputs();
    let tail = inputs["bundle"]["chainTail"].as_array().cloned().unwrap_or_default();
    if tail.len() < 2 {
        return; // the fixture has a short tail; nothing to truncate
    }
    let dropped_sig = tail[0]["sig"].as_str().unwrap_or("").to_string();
    let new_tail: Vec<_> = tail[1..].to_vec();
    let idx = inputs["bundle"]["snapshot"]["eventIndex"].as_u64().unwrap_or(0);
    inputs["bundle"]["chainTail"] = json!(new_tail);
    inputs["bundle"]["snapshot"]["eventIndex"] = json!(idx + 1);
    inputs["bundle"]["tailGenesis"] = json!(dropped_sig);
    let res = resume_from_json(&inputs.to_string());
    assert!(res.is_err(), "the leading-truncation forge must be rejected");
    assert!(res.unwrap_err().contains("binding invalid"));
}

#[test]
fn suspend_rejects_index_past_the_end_of_the_chain() {
    // The recon finding: an index past the chain end yields a bundle claiming a
    // snapshot at a nonexistent event. suspend() now refuses to pack it.
    let state = json!({ "epoch": 2, "worldSeed": 0,
        "entities": { "faction_1": { "properties": { "power": 0 }, "tags": ["faction"] } } });
    let chain = EventChain::create(b"k", "g"); // empty chain: last seq 0
    let res = loom_session::suspend(b"k", "w", &state, 1, &chain);
    assert!(res.is_err(), "index past the end must be rejected");
    let e = res.unwrap_err();
    assert!(e.contains("past the end of the chain"), "reason is the range, got: {}", e);
}

#[test]
fn suspend_rejects_negative_or_unsafe_index() {
    let state = json!({ "epoch": 2, "worldSeed": 0,
        "entities": { "faction_1": { "properties": { "power": 0 }, "tags": ["faction"] } } });
    let chain = EventChain::create(b"k", "g");
    let neg = loom_session::suspend(b"k", "w", &state, -1, &chain);
    assert!(neg.is_err(), "negative index must be rejected");
    assert!(neg.unwrap_err().contains("JS-safe integer"), "reason is the integer guard");
    // Past the JS-safe range (the i64 analogue of the TS non-integer 0.5 case).
    let unsafe_idx = loom_session::suspend(b"k", "w", &state, 9007199254740992, &chain);
    assert!(unsafe_idx.is_err(), "unsafe index must be rejected");
    assert!(unsafe_idx.unwrap_err().contains("JS-safe integer"), "reason is the integer guard");
}
