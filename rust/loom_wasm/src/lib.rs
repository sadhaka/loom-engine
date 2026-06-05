//! loom_wasm - the WASM (wasm-bindgen) surface of the Loom Engine core.
//!
//! Exposes the deterministic primitives (from loom_math + loom_combat) to
//! TypeScript / the browser / Cloudflare edge. The TS engine keeps its render +
//! audio in TS and delegates the SIMULATION here, so the browser runs the EXACT
//! same compiled core as a future Python (PyO3) or native server - byte-identical
//! by construction (it's the same Rust). Build: `wasm-pack build`.
//!
//! Phase 3 binding crate (see ../../LOOM-RUST-EXTRACTION-SPEC.md).

use wasm_bindgen::prelude::*;

use loom_combat::range_bands;
use loom_math::{floor_div, Pcg32};

/// The crate version (sanity ping from JS).
#[wasm_bindgen]
pub fn version() -> String {
    "0.1.0".to_string()
}

// ---- range bands ----

// Codex P1: feet is i64 to match the core (a JS bigint), so a TS caller and the
// WASM core classify the SAME integer - no i32 truncation at the boundary.
#[wasm_bindgen(js_name = bandFromDistanceFt)]
pub fn band_from_distance_ft(feet: i64) -> String {
    range_bands::band_from_distance_ft(feet).to_string()
}

#[wasm_bindgen(js_name = bandWithin)]
pub fn band_within(band: &str, max_band: &str) -> bool {
    range_bands::band_within(band, max_band)
}

// ---- deterministic dice (PCG32) ----
// Codex P1: seeds are u64 and the dice sum is u64 (JS bigint), matching the core
// + the Python/C surfaces. A u32-only WASM API truncated both vs every other
// binding - same seed could give a different result. Fixed by using full width.

#[wasm_bindgen(js_name = rollDie)]
pub fn roll_die(seed: u64, sides: u32) -> u32 {
    Pcg32::seeded(seed).roll_die(sides)
}

/// Sum of `count` dice of `sides` faces from a fresh seed (deterministic).
#[wasm_bindgen(js_name = rollDice)]
pub fn roll_dice(seed: u64, count: u32, sides: u32) -> u64 {
    Pcg32::seeded(seed).roll_dice(count, sides)
}

/// The next raw u32 from a seeded PCG32 (for parity-vector checks from JS).
#[wasm_bindgen(js_name = pcg32Next)]
pub fn pcg32_next(seed: u64) -> u32 {
    Pcg32::seeded(seed).next_u32()
}

// ---- cross-language integer division contract ----
// Codex P1: i64 in + out (JS bigint), so floorDiv(i32::MIN, -1) no longer
// truncates to a wrong i32. floor_div itself is panic-free on the overflow edge.

#[wasm_bindgen(js_name = floorDiv)]
pub fn floor_div_js(a: i64, b: i64) -> i64 {
    floor_div(a, b)
}

// ============================================================================
// v3.0 surface - the world-state snapshot hash, the ruleset AST, and the Epoch
// world-tick, exposed JSON-in / JSON-out. The browser runs the SAME compiled Rust
// core as the authoritative server, so a client-side prediction is byte-identical
// to the server's resolution BY CONSTRUCTION - not just by a matching hand-port.
// Each #[wasm_bindgen] entry is a thin wrapper over a pure-Rust *_inner fn
// (Result<String, String>) so the logic is unit-testable natively against the same
// golden vectors the TS / Python ports pass. Build: wasm-pack build (or
// cargo build --target wasm32-unknown-unknown -p loom_wasm).
// ============================================================================

use serde_json::Value;

fn parse_value(s: &str, what: &str) -> Result<Value, String> {
    serde_json::from_str(s).map_err(|e| format!("loom_wasm: bad {} json: {}", what, e))
}

// ---- snapshot hash ----

fn world_state_hash_inner(key: &str, state_json: &str) -> Result<String, String> {
    let state = parse_value(state_json, "state")?;
    loom_snapshot::world_state_hash(key.as_bytes(), &state).map_err(|e| format!("loom_wasm: hash: {:?}", e))
}

/// HMAC-SHA-256 of the canonical world state (byte-identical to the TS / Python
/// worldStateHash). `key` is the runtime secret; `state_json` is the world state.
#[wasm_bindgen(js_name = worldStateHash)]
pub fn world_state_hash_js(key: &str, state_json: &str) -> Result<String, JsError> {
    world_state_hash_inner(key, state_json).map_err(|e| JsError::new(&e))
}

// ---- ruleset AST (the Any-System resolver) ----

fn evaluate_action_inner(state_json: &str, check_json: &str, actor: &str, target: Option<&str>, seed: u64) -> Result<String, String> {
    let state = parse_value(state_json, "state")?;
    let check = parse_value(check_json, "check")?;
    let r = loom_ruleset::evaluate_action(&state, &check, actor, target, seed)?;
    let out = serde_json::json!({
        "state": r.state, "degree": r.degree, "roll": r.roll,
        "natural": r.natural, "dc": r.dc, "delta": r.delta,
    });
    serde_json::to_string(&out).map_err(|e| format!("loom_wasm: serialize: {}", e))
}

/// Resolve a check action (roll vs DC -> degree -> mutations). Returns
/// {state, degree, roll, natural, dc, delta} as JSON.
#[wasm_bindgen(js_name = evaluateAction)]
pub fn evaluate_action_js(state_json: &str, check_json: &str, actor: &str, target: Option<String>, seed: u64) -> Result<String, JsError> {
    evaluate_action_inner(state_json, check_json, actor, target.as_deref(), seed).map_err(|e| JsError::new(&e))
}

fn apply_triggered_mutations_inner(state_json: &str, mutations_json: &str, actor: &str, target: Option<&str>, seed: u64) -> Result<String, String> {
    let state = parse_value(state_json, "state")?;
    let mutations = parse_value(mutations_json, "mutations")?;
    let new_state = loom_ruleset::apply_triggered_mutations(&state, &mutations, actor, target, seed)?;
    serde_json::to_string(&new_state).map_err(|e| format!("loom_wasm: serialize: {}", e))
}

/// Apply a flat mutation list (the trigger path). Returns the new state as JSON.
#[wasm_bindgen(js_name = applyTriggeredMutations)]
pub fn apply_triggered_mutations_js(state_json: &str, mutations_json: &str, actor: &str, target: Option<String>, seed: u64) -> Result<String, JsError> {
    apply_triggered_mutations_inner(state_json, mutations_json, actor, target.as_deref(), seed).map_err(|e| JsError::new(&e))
}

// ---- Epoch world-tick (the Living Persistent World) ----

// Delegate to the VALIDATING JSON boundary in loom_epoch (one core, one validation -
// so the browser rejects the same epoch / maxActions inputs TS + Python reject).
fn tick_epoch_inner(input_json: &str) -> Result<String, String> {
    loom_epoch::tick_epoch_from_json(input_json)
}

/// Resolve one offline epoch. Input: {worldId, state, epochNumber, proposals,
/// ruleset, actorTags?, maxActions?}. Returns {state, event, resolved, rejected}.
#[wasm_bindgen(js_name = tickEpoch)]
pub fn tick_epoch_js(input_json: &str) -> Result<String, JsError> {
    tick_epoch_inner(input_json).map_err(|e| JsError::new(&e))
}

fn catch_up_epochs_inner(input_json: &str) -> Result<String, String> {
    loom_epoch::catch_up_epochs_from_json(input_json)
}

/// Replay offline epochs up to currentEpoch, bounded by maxCatchup (excess voided).
/// Input: {worldId, state, currentEpoch, maxCatchup, ruleset, proposalsByEpoch?,
/// actorTags?, maxActions?}. Returns {state, events, epochsResolved, epochsVoided}.
#[wasm_bindgen(js_name = catchUpEpochs)]
pub fn catch_up_epochs_js(input_json: &str) -> Result<String, JsError> {
    catch_up_epochs_inner(input_json).map_err(|e| JsError::new(&e))
}

// ---- WorldSession suspend/resume (Phase 4) ----

/// Reconstruct + verify + fast-forward a world from a bundle (fail-closed). Input:
/// {key, bundle, currentEpoch, maxCatchup, ruleset, proposalsByEpoch?, actorTags?,
/// maxActions?}. Returns {worldId, state, newEvents, epochsResolved, epochsVoided}.
/// Throws on a corrupted snapshot, a tampered chain tail, or time-travel.
#[wasm_bindgen(js_name = resumeSession)]
pub fn resume_session_js(input_json: &str) -> Result<String, JsError> {
    loom_session::resume_from_json(input_json).map_err(|e| JsError::new(&e))
}

// ---- command-frame tick (real-time multiplayer, Phase 5.1) ----

/// Resolve one server frame. Input: {worldId, state, frameNumber, commands, ruleset,
/// playerEntities, maxCommandsPerPlayer?, maxCommands?}. Returns {state, event,
/// resolved, rejected}. Throws on an unsafe frameNumber / invalid cap.
#[wasm_bindgen(js_name = tickFrame)]
pub fn tick_frame_js(input_json: &str) -> Result<String, JsError> {
    loom_frame::tick_frame_from_json(input_json).map_err(|e| JsError::new(&e))
}

/// Client-side rollback reconciliation. Input: {worldId, correctedState,
/// commandsByFrame, toFrame, ruleset, playerEntities, maxCommandsPerPlayer?,
/// maxCommands?}. Returns {state, events, framesReplayed}.
#[wasm_bindgen(js_name = reconcileFrames)]
pub fn reconcile_frames_js(input_json: &str) -> Result<String, JsError> {
    loom_frame::reconcile_frames_from_json(input_json).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod v3_surface_tests {
    use super::*;
    use std::fs;

    fn read_vector(name: &str) -> Value {
        let path = format!("{}/../../test_vectors/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&fs::read_to_string(path).expect("read vector")).expect("parse vector")
    }

    // The WASM surface resolves the SAME golden vector the TS/Python/Rust ports pass.
    #[test]
    fn ast_surface_matches_golden() {
        let v = read_vector("v3_ast_bleed.json");
        for c in v["cases"].as_array().unwrap() {
            let key = c["key"].as_str().unwrap();
            let seed: u64 = c["seed"].as_str().unwrap().parse().unwrap();
            let actor = c["actor"].as_str().unwrap();
            let label = c["label"].as_str().unwrap_or("?");
            if c["kind"] == "condition" {
                let out = apply_triggered_mutations_inner(
                    &serde_json::to_string(&c["state"]).unwrap(),
                    &serde_json::to_string(&c["mutations"]).unwrap(),
                    actor, c["target"].as_str(), seed,
                ).unwrap();
                let new_state: Value = serde_json::from_str(&out).unwrap();
                let hash = loom_snapshot::world_state_hash(key.as_bytes(), &new_state).unwrap();
                assert_eq!(hash, c["expect"]["state_hash"].as_str().unwrap(), "{} hash", label);
            } else {
                let out = evaluate_action_inner(
                    &serde_json::to_string(&c["state"]).unwrap(),
                    &serde_json::to_string(&c["check"]).unwrap(),
                    actor, c["target"].as_str(), seed,
                ).unwrap();
                let res: Value = serde_json::from_str(&out).unwrap();
                assert_eq!(res["degree"].as_str().unwrap(), c["expect"]["degree"].as_str().unwrap(), "{} degree", label);
                let hash = loom_snapshot::world_state_hash(key.as_bytes(), &res["state"]).unwrap();
                assert_eq!(hash, c["expect"]["state_hash"].as_str().unwrap(), "{} hash", label);
            }
        }
    }

    #[test]
    fn epoch_surface_matches_golden() {
        let v = read_vector("v3_3_epoch_tick.json");
        for c in v["cases"].as_array().unwrap() {
            let key = c["key"].as_str().unwrap();
            let label = c["label"].as_str().unwrap_or("?");
            if c["kind"] == "tick" {
                let r: Value = serde_json::from_str(&tick_epoch_inner(&serde_json::to_string(c).unwrap()).unwrap()).unwrap();
                let sh = loom_snapshot::world_state_hash(key.as_bytes(), &r["state"]).unwrap();
                assert_eq!(sh, c["expect"]["state_hash"].as_str().unwrap(), "{} state", label);
                let eh = loom_snapshot::world_state_hash(key.as_bytes(), &serde_json::json!([r["event"]])).unwrap();
                assert_eq!(eh, c["expect"]["events_hash"].as_str().unwrap(), "{} events", label);
            } else {
                let r: Value = serde_json::from_str(&catch_up_epochs_inner(&serde_json::to_string(c).unwrap()).unwrap()).unwrap();
                let sh = loom_snapshot::world_state_hash(key.as_bytes(), &r["state"]).unwrap();
                assert_eq!(sh, c["expect"]["state_hash"].as_str().unwrap(), "{} state", label);
                let eh = loom_snapshot::world_state_hash(key.as_bytes(), &r["events"]).unwrap();
                assert_eq!(eh, c["expect"]["events_hash"].as_str().unwrap(), "{} events", label);
            }
        }
    }

    #[test]
    fn session_surface_matches_golden() {
        let v = read_vector("v3_4_world_session.json");
        let inputs = &v["inputs"];
        let key = inputs["key"].as_str().unwrap();
        let out: Value = serde_json::from_str(&loom_session::resume_from_json(&inputs.to_string()).unwrap()).unwrap();
        let sh = loom_snapshot::world_state_hash(key.as_bytes(), &out["state"]).unwrap();
        assert_eq!(sh, v["expect"]["final_state_hash"].as_str().unwrap(), "final state");
        let eh = loom_snapshot::world_state_hash(key.as_bytes(), &out["newEvents"]).unwrap();
        assert_eq!(eh, v["expect"]["newEvents_hash"].as_str().unwrap(), "newEvents");
    }

    #[test]
    fn frame_surface_matches_golden() {
        let v = read_vector("v5_1_command_frame.json");
        for c in v["cases"].as_array().unwrap() {
            let key = c["key"].as_str().unwrap();
            let label = c["label"].as_str().unwrap_or("?");
            let out: Value = serde_json::from_str(&loom_frame::tick_frame_from_json(&c.to_string()).unwrap()).unwrap();
            let sh = loom_snapshot::world_state_hash(key.as_bytes(), &out["state"]).unwrap();
            assert_eq!(sh, c["expect"]["state_hash"].as_str().unwrap(), "{} state", label);
        }
    }

    #[test]
    fn reconcile_surface_matches_golden() {
        let v = read_vector("v5_2_reconciliation.json");
        let inputs = &v["inputs"];
        let key = inputs["key"].as_str().unwrap();
        let req = serde_json::json!({
            "worldId": inputs["worldId"], "correctedState": inputs["server_corrected_state"],
            "commandsByFrame": inputs["reconcile_commands_by_frame"], "toFrame": inputs["to_frame"],
            "ruleset": inputs["ruleset"], "playerEntities": inputs["playerEntities"],
        });
        let out: Value = serde_json::from_str(&loom_frame::reconcile_frames_from_json(&req.to_string()).unwrap()).unwrap();
        let sh = loom_snapshot::world_state_hash(key.as_bytes(), &out["state"]).unwrap();
        assert_eq!(sh, v["expect"]["reconciled_102_hash"].as_str().unwrap(), "reconciled");
    }
}
