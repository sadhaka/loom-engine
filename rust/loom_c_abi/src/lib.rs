//! loom_c_abi - the C ABI surface of the Loom Engine deterministic core.
//!
//! Phase 3 binding crate #3. The SAME Rust core (loom_math + loom_combat +
//! loom_events) behind a flat C ABI, so a C# (Unity) client, a Godot GDExtension,
//! a Go (cgo) server, or any C consumer runs byte-identical simulation to the TS
//! browser and the Python server. cbindgen generates loom_engine.h from this file.
//!
//! ABI conventions (boring + total, FFI-safe):
//!   - bands are INT codes (0 engaged, 1 near, 2 far) - no string marshaling;
//!   - dice / division return by value or via an out-pointer + status int;
//!   - hashes are written into a CALLER-allocated buffer (>= 65 bytes for the
//!     64-hex + NUL); the function returns bytes written, or a negative status;
//!   - every pointer is null-checked; no Rust panic crosses the boundary; the
//!     library never allocates memory the caller must free.

use std::ffi::{c_char, CStr};
use std::os::raw::c_int;

use loom_combat::{range_bands, ruleset};
use loom_events as events;
use loom_math::{floor_div as core_floor_div, Pcg32};

/// Band codes (closeness ascending). Mirror loom_combat::range_bands.
pub const LOOM_BAND_ENGAGED: c_int = 0;
pub const LOOM_BAND_NEAR: c_int = 1;
pub const LOOM_BAND_FAR: c_int = 2;

/// Library version as a borrowed, NUL-terminated static C string (never freed).
#[no_mangle]
pub extern "C" fn loom_version() -> *const c_char {
    b"0.1.0\0".as_ptr() as *const c_char
}

fn code_to_band(code: c_int) -> Option<&'static str> {
    match code {
        LOOM_BAND_ENGAGED => Some("engaged"),
        LOOM_BAND_NEAR => Some("near"),
        LOOM_BAND_FAR => Some("far"),
        _ => None,
    }
}

/// Distance (feet) -> band code. Negative/uncomputable -> NEAR, like the core.
#[no_mangle]
pub extern "C" fn loom_band_from_distance_ft(feet: i64) -> c_int {
    match range_bands::band_from_distance_ft(feet) {
        "engaged" => LOOM_BAND_ENGAGED,
        "far" => LOOM_BAND_FAR,
        _ => LOOM_BAND_NEAR,
    }
}

/// 1 iff `band` is at least as close as `max_band`; 0 otherwise / on a bad code.
#[no_mangle]
pub extern "C" fn loom_band_within(band: c_int, max_band: c_int) -> c_int {
    match (code_to_band(band), code_to_band(max_band)) {
        (Some(b), Some(m)) => c_int::from(range_bands::band_within(b, m)),
        _ => 0,
    }
}

/// Deterministic single die [1, sides] from a fresh seed.
#[no_mangle]
pub extern "C" fn loom_roll_die(seed: u64, sides: u32) -> u32 {
    Pcg32::seeded(seed).roll_die(sides)
}

/// Deterministic sum of `count` dice of `sides` faces from a fresh seed.
#[no_mangle]
pub extern "C" fn loom_roll_dice(seed: u64, count: u32, sides: u32) -> u64 {
    Pcg32::seeded(seed).roll_dice(count, sides)
}

/// Next raw u32 from a seeded PCG32 (for parity checks).
#[no_mangle]
pub extern "C" fn loom_pcg32_next(seed: u64) -> u32 {
    Pcg32::seeded(seed).next_u32()
}

/// Python-floor division into `*out`. Returns 0 on success, -1 on a null out,
/// division by zero, or the i64::MIN / -1 overflow (true result 2^63 is not
/// representable in i64).
///
/// # Safety
/// `out` must be a valid, writable `*mut i64` (or null, which returns -1).
#[no_mangle]
pub unsafe extern "C" fn loom_floor_div(a: i64, b: i64, out: *mut i64) -> c_int {
    if b == 0 || out.is_null() || (a == i64::MIN && b == -1) {
        return -1;
    }
    *out = core_floor_div(a, b);
    0
}

/// One initiative entry over the C ABI.
#[repr(C)]
pub struct LoomInitiativeEntry {
    pub id: i64,
    pub total: i64,
    pub modifier: i64,
    pub d20: i64,
}

/// Order `n` entries; write the ordered ids into `out_ids` (capacity `out_cap`,
/// which MUST be >= n). Returns 0 on success, -1 on a null pointer / out_cap < n.
/// Tiebreak: total/modifier/d20 DESC, then a numeric-aware id compare.
///
/// # Safety
/// `entries` must point to `n` initialized `LoomInitiativeEntry`; `out_ids` must
/// point to writable storage for at least `out_cap` `i64`, with `out_cap >= n`.
#[no_mangle]
pub unsafe extern "C" fn loom_initiative_order(
    entries: *const LoomInitiativeEntry,
    n: usize,
    out_ids: *mut i64,
    out_cap: usize,
) -> c_int {
    // Codex P0: never write past the caller buffer. Require out_cap >= n; a sane
    // upper bound also stops a hostile n from a giant from_raw_parts.
    if entries.is_null() || out_ids.is_null() || out_cap < n || n > 1_000_000 {
        return -1;
    }
    let slice = std::slice::from_raw_parts(entries, n);
    let mapped: Vec<ruleset::InitiativeEntry> = slice
        .iter()
        .map(|e| ruleset::InitiativeEntry {
            id: e.id.to_string(),
            total: e.total,
            modifier: e.modifier,
            d20: e.d20,
        })
        .collect();
    let ordered = ruleset::initiative_order(mapped);
    let out = std::slice::from_raw_parts_mut(out_ids, n);
    for (i, e) in ordered.iter().enumerate() {
        out[i] = e.id.parse::<i64>().unwrap_or(0);
    }
    0
}

// Copy a 64-char hex sig + NUL into a caller buffer (cap >= 65). Returns 64.
unsafe fn write_hex64(hex: &str, out: *mut c_char, out_cap: usize) -> c_int {
    if out.is_null() || out_cap < 65 || hex.len() != 64 {
        return -1;
    }
    std::ptr::copy_nonoverlapping(hex.as_ptr(), out as *mut u8, 64);
    *out.add(64) = 0;
    64
}

/// HMAC-SHA256 of `message` under `key` -> 64-char lowercase hex written to `out`
/// (cap >= 65, includes the NUL). Returns 64, or -1 on a bad arg / non-UTF-8
/// message. Byte-identical to the TS + Python + native chains.
///
/// # Safety
/// `key` must point to `key_len` bytes; `message` must be a NUL-terminated C
/// string; `out` must be writable for `out_cap` bytes.
#[no_mangle]
pub unsafe extern "C" fn loom_hmac_sha256_hex(
    key: *const u8,
    key_len: usize,
    message: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if key.is_null() || message.is_null() {
        return -1;
    }
    let key_slice = std::slice::from_raw_parts(key, key_len);
    let msg = match CStr::from_ptr(message).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let hex = events::hmac_sha256_hex(key_slice, msg);
    write_hex64(&hex, out, out_cap)
}

/// HMAC-SHA256 over RAW message bytes (ptr + len) -> 64-char hex into `out` (cap
/// >= 65). Unlike the C-string form above, this hashes interior NUL and non-UTF-8
/// bytes faithfully (Codex P2). Returns 64, or -1 on a bad arg.
///
/// # Safety
/// `key` points to `key_len` bytes; `message` points to `message_len` bytes (may
/// be null only if message_len == 0); `out` is writable for `out_cap` bytes.
#[no_mangle]
pub unsafe extern "C" fn loom_hmac_sha256_hex_raw(
    key: *const u8,
    key_len: usize,
    message: *const u8,
    message_len: usize,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if key.is_null() || (message.is_null() && message_len != 0) {
        return -1;
    }
    let key_slice = std::slice::from_raw_parts(key, key_len);
    let msg: &[u8] = if message_len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(message, message_len)
    };
    let hex = events::hmac_sha256_hex_bytes(key_slice, msg);
    write_hex64(&hex, out, out_cap)
}

/// Sign one event record -> 64-char hex into `out` (cap >= 65). `payload_json` is
/// a JSON string. Returns 64; -1 bad arg / non-UTF-8; -2 invalid JSON; -3
/// non-canonicalizable payload (e.g. a fractional number).
///
/// # Safety
/// `key` points to `key_len` bytes; `type_`, `payload_json`, `prev_sig` are
/// NUL-terminated C strings; `out` is writable for `out_cap` bytes.
#[no_mangle]
pub unsafe extern "C" fn loom_sign_record(
    key: *const u8,
    key_len: usize,
    seq: u64,
    type_: *const c_char,
    payload_json: *const c_char,
    prev_sig: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if key.is_null() || type_.is_null() || payload_json.is_null() || prev_sig.is_null() {
        return -1;
    }
    let key_slice = std::slice::from_raw_parts(key, key_len);
    let t = match CStr::from_ptr(type_).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let pj = match CStr::from_ptr(payload_json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let ps = match CStr::from_ptr(prev_sig).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let payload: serde_json::Value = match serde_json::from_str(pj) {
        Ok(v) => v,
        Err(_) => return -2,
    };
    match events::sign_record(key_slice, seq, t, &payload, ps) {
        Ok(sig) => write_hex64(&sig, out, out_cap),
        Err(_) => -3,
    }
}

// ---- v3.0 surface (JSON-in / JSON-out over the C ABI) -----------------------
//
// Variable-length JSON results use the standard two-call buffer protocol: the
// function returns the JSON byte length N (excluding NUL). If out_cap >= N + 1 it
// wrote N bytes + a NUL into `out` (success); otherwise it wrote nothing and the
// caller should allocate >= N + 1 and call again. Negative returns are errors. The
// library never allocates memory the caller must free.

// Write `s` + NUL into a caller buffer using the two-call protocol above.
unsafe fn write_str_out(s: &str, out: *mut c_char, out_cap: usize) -> c_int {
    let needed = s.len();
    if needed > (c_int::MAX as usize) - 1 {
        return -10; // absurdly large result
    }
    if out.is_null() || out_cap < needed + 1 {
        return needed as c_int; // length query / buffer too small - no write
    }
    std::ptr::copy_nonoverlapping(s.as_ptr(), out as *mut u8, needed);
    *out.add(needed) = 0;
    needed as c_int
}

/// HMAC-SHA-256 of the canonical world state -> 64-char hex into `out` (cap >= 65).
/// Returns 64; -1 bad arg / non-UTF-8; -2 invalid JSON; -3 non-canonicalizable state.
///
/// # Safety
/// `key` points to `key_len` bytes; `state_json` is a NUL-terminated C string;
/// `out` is writable for `out_cap` bytes.
#[no_mangle]
pub unsafe extern "C" fn loom_world_state_hash(
    key: *const u8,
    key_len: usize,
    state_json: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if key.is_null() || state_json.is_null() {
        return -1;
    }
    let key_slice = std::slice::from_raw_parts(key, key_len);
    let sj = match CStr::from_ptr(state_json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let state: serde_json::Value = match serde_json::from_str(sj) {
        Ok(v) => v,
        Err(_) => return -2,
    };
    match loom_snapshot::world_state_hash(key_slice, &state) {
        Ok(hex) => write_hex64(&hex, out, out_cap),
        Err(_) => -3,
    }
}

/// Resolve one offline epoch. `input_json` = {worldId, state, epochNumber, proposals,
/// ruleset, actorTags?, maxActions?}. Writes {state, event, resolved, rejected} JSON
/// to `out` (two-call protocol). Returns the length; -1 bad arg / non-UTF-8; -2 on a
/// rejected/invalid input (e.g. unsafe epoch, invalid cap).
///
/// # Safety
/// `input_json` is a NUL-terminated C string; `out` is writable for `out_cap` bytes
/// (or null for a length query).
#[no_mangle]
pub unsafe extern "C" fn loom_tick_epoch(
    input_json: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if input_json.is_null() {
        return -1;
    }
    let ij = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    match loom_epoch::tick_epoch_from_json(ij) {
        Ok(s) => write_str_out(&s, out, out_cap),
        Err(_) => -2,
    }
}

/// Replay offline epochs (bounded). `input_json` = {worldId, state, currentEpoch,
/// maxCatchup, ruleset, proposalsByEpoch?, actorTags?, maxActions?}. Writes {state,
/// events, epochsResolved, epochsVoided} JSON. Returns the length; -1/-2 as above.
///
/// # Safety
/// As `loom_tick_epoch`.
#[no_mangle]
pub unsafe extern "C" fn loom_catch_up_epochs(
    input_json: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if input_json.is_null() {
        return -1;
    }
    let ij = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    match loom_epoch::catch_up_epochs_from_json(ij) {
        Ok(s) => write_str_out(&s, out, out_cap),
        Err(_) => -2,
    }
}

/// Resume a WorldSession (fail-closed). `input_json` = {key, bundle, currentEpoch,
/// maxCatchup, ruleset, proposalsByEpoch?, actorTags?, maxActions?}. Writes {worldId,
/// state, newEvents, epochsResolved, epochsVoided} JSON. Returns the length; -1 bad
/// arg / non-UTF-8; -2 on a corrupted snapshot, tampered chain tail, time-travel, or
/// invalid input.
///
/// # Safety
/// As `loom_tick_epoch`.
#[no_mangle]
pub unsafe extern "C" fn loom_resume_session(
    input_json: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if input_json.is_null() {
        return -1;
    }
    let ij = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    match loom_session::resume_from_json(ij) {
        Ok(s) => write_str_out(&s, out, out_cap),
        Err(_) => -2,
    }
}

/// Resolve one server frame (real-time multiplayer). `input_json` = {worldId, state,
/// frameNumber, commands, ruleset, playerEntities, maxCommandsPerPlayer?,
/// maxCommands?}. Writes {state, event, resolved, rejected} JSON. Returns the length;
/// -1 bad arg / non-UTF-8; -2 on an unsafe frameNumber / invalid cap.
///
/// # Safety
/// As `loom_tick_epoch`.
#[no_mangle]
pub unsafe extern "C" fn loom_tick_frame(
    input_json: *const c_char,
    out: *mut c_char,
    out_cap: usize,
) -> c_int {
    if input_json.is_null() {
        return -1;
    }
    let ij = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    match loom_frame::tick_frame_from_json(ij) {
        Ok(s) => write_str_out(&s, out, out_cap),
        Err(_) => -2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn bands_match_core() {
        assert_eq!(loom_band_from_distance_ft(0), LOOM_BAND_ENGAGED);
        assert_eq!(loom_band_from_distance_ft(6), LOOM_BAND_NEAR);
        assert_eq!(loom_band_from_distance_ft(31), LOOM_BAND_FAR);
        assert_eq!(loom_band_from_distance_ft(-10), LOOM_BAND_NEAR);
        assert_eq!(loom_band_within(LOOM_BAND_ENGAGED, LOOM_BAND_NEAR), 1);
        assert_eq!(loom_band_within(LOOM_BAND_FAR, LOOM_BAND_NEAR), 0);
        assert_eq!(loom_band_within(99, 0), 0);
    }

    #[test]
    fn dice_deterministic() {
        assert_eq!(loom_roll_die(12345, 20), loom_roll_die(12345, 20));
        assert_eq!(loom_roll_dice(7, 3, 6), loom_roll_dice(7, 3, 6));
    }

    #[test]
    fn floor_div_out_param() {
        let mut out: i64 = 0;
        unsafe {
            assert_eq!(loom_floor_div(-7, 2, &mut out), 0);
        }
        assert_eq!(out, -4);
        unsafe {
            assert_eq!(loom_floor_div(1, 0, &mut out), -1); // div by zero
            assert_eq!(loom_floor_div(1, 2, std::ptr::null_mut()), -1); // null out
        }
    }

    #[test]
    fn initiative_order_writes_ids() {
        let entries = [
            LoomInitiativeEntry { id: 7, total: 18, modifier: 2, d20: 16 },
            LoomInitiativeEntry { id: 3, total: 18, modifier: 5, d20: 13 },
            LoomInitiativeEntry { id: 4, total: 21, modifier: 3, d20: 18 },
        ];
        let mut out = [0i64; 3];
        unsafe {
            assert_eq!(
                loom_initiative_order(entries.as_ptr(), 3, out.as_mut_ptr(), 3),
                0
            );
        }
        // 4 (total 21) first, then 3 (mod 5 > 2), then 7.
        assert_eq!(out, [4, 3, 7]);

        // Codex P0: out_cap < n must be refused, never write past the buffer.
        let mut small = [0i64; 1];
        unsafe {
            assert_eq!(
                loom_initiative_order(entries.as_ptr(), 3, small.as_mut_ptr(), 1),
                -1
            );
        }
        assert_eq!(small, [0]); // untouched
    }

    #[test]
    fn hmac_matches_rfc4231() {
        let msg = CString::new("what do ya want for nothing?").unwrap();
        let mut buf = [0i8; 65];
        let n = unsafe {
            loom_hmac_sha256_hex(b"Jefe".as_ptr(), 4, msg.as_ptr(), buf.as_mut_ptr(), 65)
        };
        assert_eq!(n, 64);
        let got = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_str().unwrap();
        assert_eq!(
            got,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn sign_record_round_trips_and_rejects_fraction() {
        let key = b"runtime-secret";
        let typ = CString::new("combat.hit").unwrap();
        let payload = CString::new("{\"dmg\":7}").unwrap();
        let prev = CString::new("").unwrap();
        let mut buf = [0i8; 65];
        let n = unsafe {
            loom_sign_record(
                key.as_ptr(), key.len(), 1, typ.as_ptr(), payload.as_ptr(),
                prev.as_ptr(), buf.as_mut_ptr(), 65,
            )
        };
        assert_eq!(n, 64);
        // a fractional payload is rejected (-3).
        let frac = CString::new("{\"dmg\":7.5}").unwrap();
        let bad = unsafe {
            loom_sign_record(
                key.as_ptr(), key.len(), 1, typ.as_ptr(), frac.as_ptr(),
                prev.as_ptr(), buf.as_mut_ptr(), 65,
            )
        };
        assert_eq!(bad, -3);
    }

    // Drive a JSON-in/JSON-out FFI fn through the two-call buffer protocol.
    fn call_json(
        f: unsafe extern "C" fn(*const c_char, *mut c_char, usize) -> c_int,
        input: &str,
    ) -> Result<String, c_int> {
        let cin = CString::new(input).unwrap();
        let needed = unsafe { f(cin.as_ptr(), std::ptr::null_mut(), 0) };
        if needed < 0 {
            return Err(needed);
        }
        let cap = needed as usize + 1;
        let mut buf = vec![0 as c_char; cap];
        let n = unsafe { f(cin.as_ptr(), buf.as_mut_ptr(), cap) };
        if n < 0 {
            return Err(n);
        }
        Ok(unsafe { CStr::from_ptr(buf.as_ptr()) }.to_str().unwrap().to_string())
    }

    fn read_vec(name: &str) -> serde_json::Value {
        let path = format!("{}/../../test_vectors/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn v3_surface_matches_golden() {
        // Epoch tick through the C ABI reproduces the golden state hash.
        let ev = read_vec("v3_3_epoch_tick.json");
        let tick = ev["cases"].as_array().unwrap().iter().find(|c| c["kind"] == "tick").unwrap();
        let out = call_json(loom_tick_epoch, &tick.to_string()).unwrap();
        let r: serde_json::Value = serde_json::from_str(&out).unwrap();
        let h = loom_snapshot::world_state_hash(tick["key"].as_str().unwrap().as_bytes(), &r["state"]).unwrap();
        assert_eq!(h, tick["expect"]["state_hash"].as_str().unwrap());

        // WorldSession resume through the C ABI reproduces the golden final hash.
        let sv = read_vec("v3_4_world_session.json");
        let inputs = &sv["inputs"];
        let out2 = call_json(loom_resume_session, &inputs.to_string()).unwrap();
        let r2: serde_json::Value = serde_json::from_str(&out2).unwrap();
        let sh = loom_snapshot::world_state_hash(inputs["key"].as_str().unwrap().as_bytes(), &r2["state"]).unwrap();
        assert_eq!(sh, sv["expect"]["final_state_hash"].as_str().unwrap());

        // Command-frame tick through the C ABI reproduces the golden state hash.
        let fv = read_vec("v5_1_command_frame.json");
        let fc = &fv["cases"][0];
        let out3 = call_json(loom_tick_frame, &fc.to_string()).unwrap();
        let r3: serde_json::Value = serde_json::from_str(&out3).unwrap();
        let fh = loom_snapshot::world_state_hash(fc["key"].as_str().unwrap().as_bytes(), &r3["state"]).unwrap();
        assert_eq!(fh, fc["expect"]["state_hash"].as_str().unwrap());
    }

    #[test]
    fn v3_surface_is_fail_closed() {
        // an unsafe epoch is rejected (-2), matching every other surface.
        let bad = serde_json::json!({"worldId":"w","epochNumber":9007199254740992i64,"state":{"epoch":0,"worldSeed":0,"entities":{}},"proposals":{},"ruleset":{}});
        assert_eq!(call_json(loom_tick_epoch, &bad.to_string()).unwrap_err(), -2);
    }
}
