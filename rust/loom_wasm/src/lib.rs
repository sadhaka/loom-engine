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

#[wasm_bindgen(js_name = bandFromDistanceFt)]
pub fn band_from_distance_ft(feet: i32) -> String {
    range_bands::band_from_distance_ft(feet as i64).to_string()
}

#[wasm_bindgen(js_name = bandWithin)]
pub fn band_within(band: &str, max_band: &str) -> bool {
    range_bands::band_within(band, max_band)
}

// ---- deterministic dice (PCG32) ----

#[wasm_bindgen(js_name = rollDie)]
pub fn roll_die(seed: u32, sides: u32) -> u32 {
    Pcg32::seeded(seed as u64).roll_die(sides)
}

/// Sum of `count` dice of `sides` faces from a fresh seed (deterministic).
#[wasm_bindgen(js_name = rollDice)]
pub fn roll_dice(seed: u32, count: u32, sides: u32) -> u32 {
    Pcg32::seeded(seed as u64).roll_dice(count, sides) as u32
}

/// The next raw u32 from a seeded PCG32 (for parity-vector checks from JS).
#[wasm_bindgen(js_name = pcg32Next)]
pub fn pcg32_next(seed: u32) -> u32 {
    Pcg32::seeded(seed as u64).next_u32()
}

// ---- cross-language integer division contract ----

#[wasm_bindgen(js_name = floorDiv)]
pub fn floor_div_js(a: i32, b: i32) -> i32 {
    floor_div(a as i64, b as i64) as i32
}
