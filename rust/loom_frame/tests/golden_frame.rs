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
fn frame_from_json_is_fail_closed() {
    // an unsafe frame number is rejected, matching every other surface.
    let bad = serde_json::json!({"worldId":"w","frameNumber":9007199254740992i64,"state":{"frame":0,"epoch":0,"worldSeed":0,"entities":{}},"commands":[],"ruleset":{},"playerEntities":{}});
    assert!(tick_frame_from_json(&bad.to_string()).is_err(), "unsafe frameNumber must be rejected");
}
