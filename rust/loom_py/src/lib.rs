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
    "0.1.0".to_string()
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

/// The module name MUST equal the [lib] name (loom_engine_native).
#[pymodule]
fn loom_engine_native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("__version__", "0.1.0")?;
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
    Ok(())
}
