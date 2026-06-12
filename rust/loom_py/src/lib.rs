//! loom_py - native Python bindings (PyO3) for the Loom Engine deterministic core.
//!
//! Phase 3 binding crate #2. The SAME Rust core that loom_wasm exposes to TS and
//! loom_c_abi exposes to C#/Unity, here exposed to CPython - so a Python server
//! computing a band / dice roll / event signature gets a byte-identical result to
//! a browser client. The pure-Python `loom_engine` package (vendored into the
//! backend) is the portable port; this native module is the path to ONE core,
//! zero drift, once the backend is ready to depend on a compiled extension.
//!
//! Build: `maturin develop` (into the active venv) or `maturin build --release`
//! (wheel). Not a `cargo test` crate - PyO3's extension-module feature expects to
//! be loaded by a Python interpreter (hence excluded from the workspace).

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use loom_combat::{range_bands, ruleset};
use loom_events as events;
use loom_math::{floor_div as core_floor_div, Pcg32};

#[pyfunction]
fn version() -> String {
    // Round-5 audit BLOCKER: this was a stale hardcoded literal. It now tracks
    // Cargo.toml (which maturin keeps in lockstep with pyproject) so the
    // runtime can never disagree with the packaging again.
    env!("CARGO_PKG_VERSION").to_string()
}

// ---- range bands ----

#[pyfunction]
fn band_from_distance_ft(feet: i64) -> String {
    range_bands::band_from_distance_ft(feet).to_string()
}

#[pyfunction]
fn band_within(band: &str, max_band: &str) -> bool {
    range_bands::band_within(band, max_band)
}

// ---- deterministic dice (PCG32) ----

#[pyfunction]
fn roll_die(seed: u64, sides: u32) -> u32 {
    Pcg32::seeded(seed).roll_die(sides)
}

#[pyfunction]
fn roll_dice(seed: u64, count: u32, sides: u32) -> u64 {
    Pcg32::seeded(seed).roll_dice(count, sides)
}

#[pyfunction]
fn pcg32_next(seed: u64) -> u32 {
    Pcg32::seeded(seed).next_u32()
}

#[pyfunction]
fn floor_div(a: i64, b: i64) -> PyResult<i64> {
    if b == 0 {
        return Err(PyValueError::new_err("floor_div by zero"));
    }
    // Codex P1: the true result of i64::MIN / -1 is 2^63, not representable in
    // i64. Reject rather than return a wrapped (wrong) value.
    if a == i64::MIN && b == -1 {
        return Err(PyValueError::new_err("floor_div overflow (i64::MIN / -1)"));
    }
    Ok(core_floor_div(a, b))
}

// ---- ruleset: initiative ordering ----

/// Order initiative entries and return their ids. Each entry is a
/// (id, total, modifier, d20) tuple. Same tiebreak as the core: total DESC,
/// modifier DESC, d20 DESC, id ASC (string compare - see the engine's note on the
/// id tiebreak; numeric ids round-trip through to_string/parse here).
#[pyfunction]
fn initiative_order_ids(entries: Vec<(i64, i64, i64, i64)>) -> Vec<i64> {
    let mapped: Vec<ruleset::InitiativeEntry> = entries
        .into_iter()
        .map(|(id, total, modifier, d20)| ruleset::InitiativeEntry {
            id: id.to_string(),
            total,
            modifier,
            d20,
        })
        .collect();
    ruleset::initiative_order(mapped)
        .into_iter()
        .map(|e| e.id.parse::<i64>().unwrap_or(0))
        .collect()
}

// ---- event chain (HMAC-SHA256, byte-identical to the TS chain) ----

#[pyfunction]
fn hmac_sha256_hex(key: &[u8], message: &str) -> String {
    events::hmac_sha256_hex(key, message)
}

/// Sign one event record. `payload_json` is a JSON string (e.g. json.dumps(...));
/// raises ValueError if it is not valid JSON or carries a non-canonicalizable
/// value (e.g. a fractional number - banned from signed event data).
#[pyfunction]
fn sign_record(
    key: &[u8],
    seq: u64,
    type_: &str,
    payload_json: &str,
    prev_sig: &str,
) -> PyResult<String> {
    let payload: serde_json::Value = serde_json::from_str(payload_json)
        .map_err(|e| PyValueError::new_err(format!("invalid payload JSON: {}", e)))?;
    events::sign_record(key, seq, type_, &payload, prev_sig)
        .map_err(|e| PyValueError::new_err(format!("non-canonicalizable payload: {:?}", e)))
}

// ============================================================================
// v3.0 surface - the world-state snapshot hash, the ruleset AST, and the Epoch
// world-tick, exposed JSON-in / JSON-out. The Python server runs the SAME compiled
// Rust core as the browser (loom_wasm) and the native server - byte-identical by
// construction. Mirrors the loom_wasm surface 1:1; verified against the same golden
// vectors (python/tests/test_native_surface.py). Build: maturin develop.
// ============================================================================

fn py_parse(s: &str, what: &str) -> PyResult<serde_json::Value> {
    serde_json::from_str(s).map_err(|e| PyValueError::new_err(format!("bad {} json: {}", what, e)))
}

/// HMAC-SHA-256 of the canonical world state (byte-identical to TS/Python worldStateHash).
#[pyfunction]
fn world_state_hash(key: &str, state_json: &str) -> PyResult<String> {
    let state = py_parse(state_json, "state")?;
    loom_snapshot::world_state_hash(key.as_bytes(), &state)
        .map_err(|e| PyValueError::new_err(format!("hash: {:?}", e)))
}

/// The global region hash (interest-management Merkle root). `regions_json` is
/// { regionId: regionState, ... }. Byte-identical to TS globalRegionHash.
#[pyfunction]
fn global_region_hash(key: &str, regions_json: &str) -> PyResult<String> {
    let regions = py_parse(regions_json, "regions")?;
    loom_snapshot::global_region_hash(key.as_bytes(), &regions)
        .map_err(|e| PyValueError::new_err(format!("region hash: {:?}", e)))
}

/// Resolve a check action (roll vs DC -> degree -> mutations). Returns
/// {state, degree, roll, natural, dc, delta} as a JSON string.
#[pyfunction]
#[pyo3(signature = (state_json, check_json, actor, target=None, seed=0))]
fn evaluate_action(state_json: &str, check_json: &str, actor: &str, target: Option<String>, seed: u64) -> PyResult<String> {
    let state = py_parse(state_json, "state")?;
    let check = py_parse(check_json, "check")?;
    let r = loom_ruleset::evaluate_action(&state, &check, actor, target.as_deref(), seed)
        .map_err(PyValueError::new_err)?;
    let out = serde_json::json!({
        "state": r.state, "degree": r.degree, "roll": r.roll,
        "natural": r.natural, "dc": r.dc, "delta": r.delta,
    });
    serde_json::to_string(&out).map_err(|e| PyValueError::new_err(format!("serialize: {}", e)))
}

/// Apply a flat mutation list (the trigger path). Returns the new state as a JSON string.
#[pyfunction]
#[pyo3(signature = (state_json, mutations_json, actor, target=None, seed=0))]
fn apply_triggered_mutations(state_json: &str, mutations_json: &str, actor: &str, target: Option<String>, seed: u64) -> PyResult<String> {
    let state = py_parse(state_json, "state")?;
    let mutations = py_parse(mutations_json, "mutations")?;
    let new_state = loom_ruleset::apply_triggered_mutations(&state, &mutations, actor, target.as_deref(), seed)
        .map_err(PyValueError::new_err)?;
    serde_json::to_string(&new_state).map_err(|e| PyValueError::new_err(format!("serialize: {}", e)))
}

/// Resolve one offline epoch. Input JSON: {worldId, state, epochNumber, proposals,
/// ruleset, actorTags?, maxActions?}. Returns {state, event, resolved, rejected}.
// Delegates to the VALIDATING JSON boundary in loom_epoch (one core, one validation -
// so the Python server rejects the same epoch / maxActions inputs TS + the pure port do).
#[pyfunction]
fn tick_epoch(input_json: &str) -> PyResult<String> {
    loom_epoch::tick_epoch_from_json(input_json).map_err(PyValueError::new_err)
}

/// Replay offline epochs up to currentEpoch, bounded by maxCatchup (excess voided).
/// Input JSON: {worldId, state, currentEpoch, maxCatchup, ruleset, proposalsByEpoch?,
/// actorTags?, maxActions?}. Returns {state, events, epochsResolved, epochsVoided}.
#[pyfunction]
fn catch_up_epochs(input_json: &str) -> PyResult<String> {
    loom_epoch::catch_up_epochs_from_json(input_json).map_err(PyValueError::new_err)
}

/// Reconstruct + verify + fast-forward a world from a bundle (Phase 4, fail-closed).
/// Input JSON: {key, bundle, currentEpoch, maxCatchup, ruleset, proposalsByEpoch?,
/// actorTags?, maxActions?}. Returns {worldId, state, newEvents, epochsResolved,
/// epochsVoided}. Raises ValueError on a corrupted snapshot, tampered tail, or time-travel.
#[pyfunction]
fn resume_session(input_json: &str) -> PyResult<String> {
    loom_session::resume_from_json(input_json).map_err(PyValueError::new_err)
}

/// Resolve one server frame (real-time multiplayer). Input JSON: {worldId, state,
/// frameNumber, commands, ruleset, playerEntities, maxCommandsPerPlayer?,
/// maxCommands?}. Returns {state, event, resolved, rejected}.
#[pyfunction]
fn tick_frame(input_json: &str) -> PyResult<String> {
    loom_frame::tick_frame_from_json(input_json).map_err(PyValueError::new_err)
}

/// Client-side rollback reconciliation. Input JSON: {worldId, correctedState,
/// commandsByFrame, toFrame, ruleset, playerEntities, maxCommandsPerPlayer?,
/// maxCommands?}. Returns {state, events, framesReplayed}.
#[pyfunction]
fn reconcile_frames(input_json: &str) -> PyResult<String> {
    loom_frame::reconcile_frames_from_json(input_json).map_err(PyValueError::new_err)
}

/// The module name MUST equal the [lib] name (loom_engine_native).
#[pymodule]
fn loom_engine_native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add_function(wrap_pyfunction!(band_from_distance_ft, m)?)?;
    m.add_function(wrap_pyfunction!(band_within, m)?)?;
    m.add_function(wrap_pyfunction!(roll_die, m)?)?;
    m.add_function(wrap_pyfunction!(roll_dice, m)?)?;
    m.add_function(wrap_pyfunction!(pcg32_next, m)?)?;
    m.add_function(wrap_pyfunction!(floor_div, m)?)?;
    m.add_function(wrap_pyfunction!(initiative_order_ids, m)?)?;
    m.add_function(wrap_pyfunction!(hmac_sha256_hex, m)?)?;
    m.add_function(wrap_pyfunction!(sign_record, m)?)?;
    // v3.0 surface
    m.add_function(wrap_pyfunction!(world_state_hash, m)?)?;
    m.add_function(wrap_pyfunction!(global_region_hash, m)?)?;
    m.add_function(wrap_pyfunction!(evaluate_action, m)?)?;
    m.add_function(wrap_pyfunction!(apply_triggered_mutations, m)?)?;
    m.add_function(wrap_pyfunction!(tick_epoch, m)?)?;
    m.add_function(wrap_pyfunction!(catch_up_epochs, m)?)?;
    m.add_function(wrap_pyfunction!(resume_session, m)?)?;
    m.add_function(wrap_pyfunction!(tick_frame, m)?)?;
    m.add_function(wrap_pyfunction!(reconcile_frames, m)?)?;
    Ok(())
}
