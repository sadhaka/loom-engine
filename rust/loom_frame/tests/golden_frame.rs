//! Cross-language parity: the Rust command-frame tick must reproduce the
//! TS-generated golden vector (test_vectors/v5_1_command_frame.json) byte-for-byte
//! - the same world-state hash, FrameResolved event hash, and resolved/rejected
//! counts across all cases (numeric-aware command order, the per-player rate cap,
//! the unknown-player zero-prng rejection, the check-action path). Makes the
//! multiplayer core byte-parity (TS reference + the Rust core that WASM/PyO3/C-ABI bind).

use loom_frame::tick_frame_from_json;
use loom_snapshot::world_state_hash;
use serde_json::Value;
use std::fs;

#[test]
fn golden_frame_byte_parity_with_ts() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v5_1_command_frame.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read vector")).expect("parse");
    let cases = v["cases"].as_array().expect("cases array");
    assert!(cases.len() >= 4, "expected >= 4 frame cases");

    for c in cases {
        let label = c["label"].as_str().unwrap_or("?");
        let key = c["key"].as_str().unwrap();
        // The case object already carries the tick_frame_from_json input shape
        // (worldId, state, frameNumber, commands, ruleset, playerEntities, caps).
        let out: Value = serde_json::from_str(&tick_frame_from_json(&c.to_string()).unwrap()).unwrap();
        let sh = world_state_hash(key.as_bytes(), &out["state"]).unwrap();
        assert_eq!(sh, c["expect"]["state_hash"].as_str().unwrap(), "{} state_hash", label);
        let eh = world_state_hash(key.as_bytes(), &Value::Array(vec![out["event"].clone()])).unwrap();
        assert_eq!(eh, c["expect"]["event_hash"].as_str().unwrap(), "{} event_hash", label);
        assert_eq!(out["resolved"].as_u64().unwrap(), c["expect"]["resolved"].as_u64().unwrap(), "{} resolved", label);
        assert_eq!(out["rejected"].as_u64().unwrap(), c["expect"]["rejected"].as_u64().unwrap(), "{} rejected", label);
        assert_eq!(
            out["event"]["pcg_steps_consumed"].as_u64().unwrap(),
            c["expect"]["pcg_steps_consumed"].as_u64().unwrap(),
            "{} steps",
            label
        );
    }
}

#[test]
fn reconcile_golden_byte_parity_with_ts() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v5_2_reconciliation.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read")).expect("parse");
    let inputs = &v["inputs"];
    let key = inputs["key"].as_str().unwrap();
    let req = serde_json::json!({
        "worldId": inputs["worldId"],
        "correctedState": inputs["server_corrected_state"],
        "commandsByFrame": inputs["reconcile_commands_by_frame"],
        "toFrame": inputs["to_frame"],
        "ruleset": inputs["ruleset"],
        "playerEntities": inputs["playerEntities"],
    });
    let out: Value = serde_json::from_str(&loom_frame::reconcile_frames_from_json(&req.to_string()).unwrap()).unwrap();
    let sh = world_state_hash(key.as_bytes(), &out["state"]).unwrap();
    assert_eq!(sh, v["expect"]["reconciled_102_hash"].as_str().unwrap(), "reconciled hash");
    assert_eq!(out["framesReplayed"].as_i64().unwrap(), v["expect"]["frames_replayed"].as_i64().unwrap(), "frames replayed");
    let eh = world_state_hash(key.as_bytes(), &out["events"]).unwrap();
    assert_eq!(eh, v["expect"]["reconcile_events_hash"].as_str().unwrap(), "events hash");
}

#[test]
fn frame_from_json_is_fail_closed() {
    // an unsafe frame number is rejected, matching every other surface.
    let bad = serde_json::json!({"worldId":"w","frameNumber":9007199254740992i64,"state":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commands":[],"ruleset":{},"playerEntities":{}});
    assert!(tick_frame_from_json(&bad.to_string()).is_err(), "unsafe frameNumber must be rejected");

    // Codex P2: a negative frameNumber is rejected (matches TS).
    let neg = serde_json::json!({"worldId":"w","frameNumber":-1i64,"state":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commands":[],"ruleset":{},"playerEntities":{}});
    assert!(tick_frame_from_json(&neg.to_string()).is_err(), "negative frameNumber must be rejected");

    // Codex P1: a string seq is rejected here exactly as TS throws - NOT coerced to 0
    // (the old as_i64().unwrap_or(0) divergence). Same for a fractional seq.
    let str_seq = serde_json::json!({"worldId":"w","frameNumber":1,"state":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commands":[{"playerId":"p1","seq":"9","actionId":"move"}],"ruleset":{},"playerEntities":{"p1":"e1"}});
    assert!(tick_frame_from_json(&str_seq.to_string()).is_err(), "string seq must be rejected, not coerced to 0");
    let frac_seq = serde_json::json!({"worldId":"w","frameNumber":1,"state":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commands":[{"playerId":"p1","seq":1.5,"actionId":"move"}],"ruleset":{},"playerEntities":{"p1":"e1"}});
    assert!(tick_frame_from_json(&frac_seq.to_string()).is_err(), "fractional seq must be rejected");
    // a non-string playerId is rejected (cannot be ordered by compare_ids).
    let bad_pid = serde_json::json!({"worldId":"w","frameNumber":1,"state":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commands":[{"playerId":7,"seq":1,"actionId":"move"}],"ruleset":{},"playerEntities":{}});
    assert!(tick_frame_from_json(&bad_pid.to_string()).is_err(), "non-string playerId must be rejected");
}

#[test]
fn reconcile_from_json_is_fail_closed() {
    let base_cmds = serde_json::json!({});
    // correctedState.frame missing -> reject (no silent fallback to 0).
    let no_frame = serde_json::json!({"worldId":"w","correctedState":{"epoch":0,"worldSeed":0,"entities":{}},"commandsByFrame":base_cmds,"toFrame":5,"ruleset":{},"playerEntities":{}});
    assert!(loom_frame::reconcile_frames_from_json(&no_frame.to_string()).is_err(), "missing correctedState.frame must be rejected");
    // negative correctedState.frame -> reject.
    let neg_frame = serde_json::json!({"worldId":"w","correctedState":{"frame":-2,"epoch":0,"worldSeed":0,"entities":{}},"commandsByFrame":base_cmds,"toFrame":5,"ruleset":{},"playerEntities":{}});
    assert!(loom_frame::reconcile_frames_from_json(&neg_frame.to_string()).is_err(), "negative correctedState.frame must be rejected");
    // negative toFrame -> reject.
    let neg_to = serde_json::json!({"worldId":"w","correctedState":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commandsByFrame":base_cmds,"toFrame":-1,"ruleset":{},"playerEntities":{}});
    assert!(loom_frame::reconcile_frames_from_json(&neg_to.to_string()).is_err(), "negative toFrame must be rejected");
    // an oversized replay window (anti-DoS) -> reject.
    let huge = serde_json::json!({"worldId":"w","correctedState":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commandsByFrame":base_cmds,"toFrame":9000,"ruleset":{},"playerEntities":{}});
    assert!(loom_frame::reconcile_frames_from_json(&huge.to_string()).is_err(), "oversized reconcile window must be rejected");
}
