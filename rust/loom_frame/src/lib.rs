//! loom_frame - the deterministic command-frame tick (Rust core, v5 Phase 1).
//!
//! The native sibling of the TS `src/runtime/world-frame.ts` and the server-
//! authoritative core of shared-world multiplayer. Each frame, the players' commands
//! are sorted into a canonical (compare_ids(playerId), then seq, stable) order and
//! resolved through the ruleset AST as each player's controlled entity, against a
//! frame PRNG domain-separated from the offline Epoch PRNG - byte-identical to the
//! TS reference. Pinned by test_vectors/v5_1_command_frame.json. The WASM, PyO3, and
//! C-ABI surfaces bind `tick_frame_from_json`.

use loom_events::field;
use loom_math::Pcg32;
use loom_ruleset::{
    apply_triggered_mutations_with_rng, compare_ids, evaluate_action_with_rng, validate_check,
    validate_triggered_mutations, AppliedMutation,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
// BTreeMap, never HashMap, in a deterministic path (Codex hardening audit
// 2026-06-07): per_player below is only a counter (get/insert, never iterated or
// serialized), so the iteration order does not currently affect output - but the
// hardened cross-language spec bans HashMap from deterministic code outright, so
// a future serialize/debug/order change cannot silently fork byte-parity.
use std::collections::BTreeMap;

// Structured domain label for the frame PRNG (length-prefixed via field(), NOT raw-
// concatenated onto the world id - the old `worldId + "|loom.frame/1"` form let an
// Epoch of a crafted world id collide with a frame stream). Mirrors TS
// world-frame.deriveFramePrng. Codex P2.
const FRAME_PRNG_DOMAIN: &str = "loom.frame/1";
// Anti-DoS bound on the rollback-replay window (mirrors TS MAX_RECONCILE_WINDOW).
const MAX_RECONCILE_WINDOW: i64 = 4096;
const REASON_UNKNOWN_PLAYER: &str = "unknown_player";
const REASON_MALFORMED_COMMAND: &str = "malformed_command";
const REASON_UNKNOWN_ACTION: &str = "unknown_action";
const REASON_INVALID_ACTION: &str = "invalid_action";
const REASON_EVAL_ERROR: &str = "eval_error";
const REASON_RATE_LIMITED: &str = "rate_limited";

// ---- action kinds (mirror loom_epoch) --------------------------------------

enum ActionKind<'a> {
    Check(&'a Value),
    Mutations(&'a Value),
}

fn classify_action(action: &Value) -> Result<ActionKind<'_>, ()> {
    match action.get("kind").and_then(|k| k.as_str()) {
        Some("check") => action.get("check").map(ActionKind::Check).ok_or(()),
        Some("mutations") => action.get("mutations").map(ActionKind::Mutations).ok_or(()),
        _ => Err(()),
    }
}

fn serialize_mutation(m: &AppliedMutation) -> Value {
    let mut o = Map::new();
    o.insert("op".to_string(), Value::from(m.op.clone()));
    o.insert("target".to_string(), Value::from(m.target.clone()));
    if let Some(ref p) = m.property {
        o.insert("property".to_string(), Value::from(p.clone()));
    }
    if let Some(ref t) = m.tag {
        o.insert("tag".to_string(), Value::from(t.clone()));
    }
    if let Some(prev) = m.previous {
        o.insert("previous".to_string(), Value::from(prev));
    }
    if let Some(next) = m.next {
        o.insert("next".to_string(), Value::from(next));
    }
    Value::Object(o)
}

fn serialize_mutations(applied: &[AppliedMutation]) -> Value {
    Value::Array(applied.iter().map(serialize_mutation).collect())
}

fn with_frame(state: &Value, frame_number: i64) -> Value {
    let mut out = match state.as_object() {
        Some(m) => m.clone(),
        None => Map::new(),
    };
    out.insert("frame".to_string(), Value::from(frame_number));
    Value::Object(out)
}

/// Derive the frame PRNG for (world_id, frame_number). Structured + length-prefixed
/// (mirrors TS deriveFramePrng): message = UTF8( field("loom.frame/1") ++
/// field(world_id) ) ++ LE64(frame_number), then SHA-256; bytes 0-7 (LE) = PCG
/// state, 8-15 (LE, forced odd) = increment. Injective across world ids + domain-
/// separated from the Epoch seed. Codex P2.
pub fn derive_frame_prng(world_id: &str, frame_number: i64) -> Result<Pcg32, String> {
    // Round-6 audit HIGH: TS deriveFramePrng (assertCleanString) rejects a
    // non-NFC worldId; Rust hashed the decomposed bytes and derived a
    // DIFFERENT seed - a cross-surface determinism fork. Reject identically.
    if !unicode_normalization::is_nfc(world_id) {
        return Err("world-frame: non-NFC world_id (normalize to NFC first)".to_string());
    }
    let prefix = format!("{}{}", field(FRAME_PRNG_DOMAIN), field(world_id));
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    hasher.update(frame_number.to_le_bytes()); // i64 LE, two's complement for negatives
    let digest = hasher.finalize();
    let mut state_b = [0u8; 8];
    state_b.copy_from_slice(&digest[0..8]);
    let mut inc_b = [0u8; 8];
    inc_b.copy_from_slice(&digest[8..16]);
    let state = u64::from_le_bytes(state_b);
    let inc = u64::from_le_bytes(inc_b) | 1;
    Ok(Pcg32::from_raw(state, inc))
}

/// Structural pre-sort validation of the command list (mirrors the TS fail-closed
/// check). Every command MUST carry a string playerId + a JS-safe-integer seq, so
/// the (compare_ids, seq) ordering is byte-identical on every surface - never
/// coerce a bad seq to 0 (that diverged from JS numeric coercion). Codex P1.
fn validate_commands(commands: &Value) -> Result<(), String> {
    let empty: Vec<Value> = Vec::new();
    let cmds = commands.as_array().unwrap_or(&empty);
    for c in cmds {
        if c.get("playerId").and_then(|x| x.as_str()).is_none() {
            return Err("world-frame: every command needs a string playerId".to_string());
        }
        let seq_ok = c.get("seq").and_then(|x| x.as_i64()).map(loom_epoch::is_safe_epoch).unwrap_or(false);
        if !seq_ok {
            return Err("world-frame: every command needs a JS-safe-integer seq".to_string());
        }
    }
    Ok(())
}

// ---- tick_frame ------------------------------------------------------------

pub struct TickFrameResult {
    pub state: Value,
    pub event: Value,
    pub resolved: u64,
    pub rejected: u64,
}

/// Resolve one server frame. Pure: does not mutate `state`. Returns the new state
/// (frame advanced) + the canonical FrameResolved event.
/// Errs (never panics) on a non-NFC world_id - the same inputs TS throws on
/// (round-6 audit HIGH).
#[allow(clippy::too_many_arguments)]
pub fn tick_frame(
    world_id: &str,
    state: &Value,
    frame_number: i64,
    commands: &Value,
    ruleset: &Value,
    player_entities: &Value,
    max_per_player: Option<u64>,
    max_commands: Option<u64>,
) -> Result<TickFrameResult, String> {
    let max_per_player = max_per_player.unwrap_or(u64::MAX);
    let max_commands = max_commands.unwrap_or(u64::MAX);

    let mut prng: Pcg32 = derive_frame_prng(world_id, frame_number)?;

    // Stable sort a COPY of the command refs by (compare_ids(playerId), seq).
    let empty: Vec<Value> = Vec::new();
    let cmds = commands.as_array().unwrap_or(&empty);
    let mut ordered: Vec<&Value> = cmds.iter().collect();
    ordered.sort_by(|a, b| {
        let pa = a.get("playerId").and_then(|x| x.as_str()).unwrap_or("");
        let pb = b.get("playerId").and_then(|x| x.as_str()).unwrap_or("");
        let c = compare_ids(pa, pb);
        if c != std::cmp::Ordering::Equal {
            return c;
        }
        let sa = a.get("seq").and_then(|x| x.as_i64()).unwrap_or(0);
        let sb = b.get("seq").and_then(|x| x.as_i64()).unwrap_or(0);
        sa.cmp(&sb)
    });

    let mut work = state.clone();
    let mut entries: Vec<Value> = Vec::new();
    let mut resolved: u64 = 0;
    let mut rejected: u64 = 0;
    let mut per_player: BTreeMap<String, u64> = BTreeMap::new();

    for cmd in ordered {
        if resolved >= max_commands {
            break;
        }
        let player_id = cmd.get("playerId").and_then(|x| x.as_str()).unwrap_or("");

        // (0) the player must control an entity.
        let actor_id = player_entities.get(player_id).and_then(|x| x.as_str());
        let actor_id = match actor_id {
            Some(a) if !a.is_empty() => a.to_string(),
            _ => {
                entries.push(json!({ "player_id": player_id, "action_id": "", "reason": REASON_UNKNOWN_PLAYER }));
                rejected += 1;
                continue;
            }
        };

        // (1) per-player rate cap.
        let used = *per_player.get(player_id).unwrap_or(&0);
        if used >= max_per_player {
            let aid = cmd.get("actionId").and_then(|x| x.as_str()).unwrap_or("");
            entries.push(json!({ "player_id": player_id, "action_id": aid, "reason": REASON_RATE_LIMITED }));
            rejected += 1;
            continue;
        }

        // (2) malformed command.
        let action_id = match cmd.get("actionId").and_then(|x| x.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => {
                entries.push(json!({ "player_id": player_id, "action_id": "", "reason": REASON_MALFORMED_COMMAND }));
                rejected += 1;
                per_player.insert(player_id.to_string(), used + 1);
                continue;
            }
        };

        let action = match ruleset.get(&action_id) {
            Some(a) => a,
            None => {
                entries.push(json!({ "player_id": player_id, "action_id": action_id, "reason": REASON_UNKNOWN_ACTION }));
                rejected += 1;
                per_player.insert(player_id.to_string(), used + 1);
                continue;
            }
        };

        // (3) classify kind (unknown kind -> invalid_action).
        let kind = match classify_action(action) {
            Ok(k) => k,
            Err(_) => {
                entries.push(json!({ "player_id": player_id, "action_id": action_id, "reason": REASON_INVALID_ACTION }));
                rejected += 1;
                per_player.insert(player_id.to_string(), used + 1);
                continue;
            }
        };

        // (4) fail-closed validation BEFORE any prng draw.
        let valid = match &kind {
            ActionKind::Check(node) => validate_check(node),
            ActionKind::Mutations(muts) => validate_triggered_mutations(muts),
        };
        if valid.is_err() {
            entries.push(json!({ "player_id": player_id, "action_id": action_id, "reason": REASON_INVALID_ACTION }));
            rejected += 1;
            per_player.insert(player_id.to_string(), used + 1);
            continue;
        }

        // (5) resolve. Snapshot prng; on ANY error roll back to zero draws.
        let target = cmd.get("targetId").and_then(|x| x.as_str());
        let snap = prng.snapshot();
        let outcome: Result<(String, Vec<AppliedMutation>, Value), String> = match &kind {
            ActionKind::Check(node) => evaluate_action_with_rng(&work, node, &actor_id, target, &mut prng)
                .map(|r| (r.degree, r.mutations, r.state)),
            ActionKind::Mutations(muts) => {
                apply_triggered_mutations_with_rng(&work, muts, &actor_id, target, &mut prng)
                    .map(|r| ("none".to_string(), r.mutations, r.state))
            }
        };

        match outcome {
            Ok((degree, applied, new_state)) => {
                work = new_state;
                entries.push(json!({
                    "player_id": player_id,
                    "actor_id": actor_id,
                    "action_id": action_id,
                    "degree": degree,
                    "mutations_applied": serialize_mutations(&applied),
                }));
                resolved += 1;
                per_player.insert(player_id.to_string(), used + 1);
            }
            Err(_) => {
                prng.restore(snap);
                entries.push(json!({ "player_id": player_id, "action_id": action_id, "reason": REASON_EVAL_ERROR }));
                rejected += 1;
                per_player.insert(player_id.to_string(), used + 1);
            }
        }
    }

    let out_state = with_frame(&work, frame_number);
    let event = json!({
        "event_type": "FrameResolved",
        "frame_number": frame_number,
        "commands_processed": Value::Array(entries),
        "pcg_steps_consumed": prng.get_draws(),
    });
    Ok(TickFrameResult { state: out_state, event, resolved, rejected })
}

// ---- validating JSON boundary (WASM / PyO3 / C-ABI bind THIS) ----------------

fn parse_cap(v: &Value, key: &str) -> Result<Option<u64>, String> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(m) => {
            let n = m
                .as_u64()
                .filter(|n| *n <= loom_epoch::MAX_SAFE_INT as u64)
                .ok_or_else(|| format!("world-frame: {} must be a non-negative JS-safe integer", key))?;
            Ok(Some(n))
        }
    }
}

/// JSON-in / JSON-out tick_frame WITH input validation. Input: {worldId, state,
/// frameNumber, commands, ruleset, playerEntities, maxCommandsPerPlayer?, maxCommands?}.
/// Returns {state, event, resolved, rejected}.
pub fn tick_frame_from_json(input_json: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(input_json).map_err(|e| format!("world-frame: bad input json: {}", e))?;
    let world_id = v.get("worldId").and_then(|x| x.as_str()).ok_or("world-frame: worldId must be a string")?;
    let frame_number = v.get("frameNumber").and_then(|x| x.as_i64()).ok_or("world-frame: frameNumber must be an integer")?;
    if !loom_epoch::is_safe_epoch(frame_number) || frame_number < 0 {
        return Err("world-frame: frameNumber must be a non-negative JS-safe integer".to_string());
    }
    validate_commands(&v["commands"])?;
    let max_per_player = parse_cap(&v, "maxCommandsPerPlayer")?;
    let max_commands = parse_cap(&v, "maxCommands")?;
    let r = tick_frame(
        world_id,
        &v["state"],
        frame_number,
        &v["commands"],
        &v["ruleset"],
        &v["playerEntities"],
        max_per_player,
        max_commands,
    )?;
    let out = json!({ "state": r.state, "event": r.event, "resolved": r.resolved, "rejected": r.rejected });
    serde_json::to_string(&out).map_err(|e| format!("world-frame: serialize: {}", e))
}

// ---- reconcile (client-side rollback + replay) -----------------------------

pub struct ReconcileResult {
    pub state: Value,
    pub events: Vec<Value>,
    pub frames_replayed: i64,
}

/// Replay frames (corrected_state.frame + 1) ..= to_frame over the corrected state,
/// applying each frame's local commands. Pure; checked arithmetic (Codex-style).
/// Errs (never panics) on a non-NFC world_id (round-6 audit HIGH).
#[allow(clippy::too_many_arguments)]
pub fn reconcile_frames(
    world_id: &str,
    corrected_state: &Value,
    commands_by_frame: &Value,
    to_frame: i64,
    ruleset: &Value,
    player_entities: &Value,
    max_per_player: Option<u64>,
    max_commands: Option<u64>,
) -> Result<ReconcileResult, String> {
    // Validate even the no-op path so a non-NFC id rejects regardless of
    // whether any frames need replaying (parity with the epoch twin).
    derive_frame_prng(world_id, 0)?;
    let from_frame = corrected_state.get("frame").and_then(|f| f.as_i64()).unwrap_or(0);
    let mut work = corrected_state.clone();
    let mut events: Vec<Value> = Vec::new();
    let mut replayed: i64 = 0;
    let mut f = match from_frame.checked_add(1) {
        Some(n) => n,
        None => return Ok(ReconcileResult { state: work, events, frames_replayed: 0 }),
    };
    while f <= to_frame {
        let empty = Value::Array(Vec::new());
        let cmds = commands_by_frame.get(f.to_string().as_str()).unwrap_or(&empty);
        let r = tick_frame(world_id, &work, f, cmds, ruleset, player_entities, max_per_player, max_commands)?;
        work = r.state;
        events.push(r.event);
        replayed += 1;
        f = match f.checked_add(1) {
            Some(n) => n,
            None => break,
        };
    }
    Ok(ReconcileResult { state: work, events, frames_replayed: replayed })
}

/// JSON-in / JSON-out reconcile. Input: {worldId, correctedState, commandsByFrame,
/// toFrame, ruleset, playerEntities, maxCommandsPerPlayer?, maxCommands?}. Returns
/// {state, events, framesReplayed}.
pub fn reconcile_frames_from_json(input_json: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(input_json).map_err(|e| format!("world-frame: bad reconcile input json: {}", e))?;
    let world_id = v.get("worldId").and_then(|x| x.as_str()).ok_or("world-frame: worldId must be a string")?;
    let to_frame = v.get("toFrame").and_then(|x| x.as_i64()).ok_or("world-frame: toFrame must be an integer")?;
    if !loom_epoch::is_safe_epoch(to_frame) || to_frame < 0 {
        return Err("world-frame: toFrame must be a non-negative JS-safe integer".to_string());
    }
    // correctedState.frame is the authoritative replay anchor: a non-negative safe
    // integer, no silent fallback to 0 (Codex P1/P2).
    let from_frame = v
        .get("correctedState")
        .and_then(|c| c.get("frame"))
        .and_then(|f| f.as_i64())
        .filter(|n| loom_epoch::is_safe_epoch(*n) && *n >= 0)
        .ok_or("world-frame: correctedState.frame must be a non-negative JS-safe integer")?;
    if to_frame < from_frame {
        return Err("world-frame: toFrame must be >= correctedState.frame".to_string());
    }
    if to_frame - from_frame > MAX_RECONCILE_WINDOW {
        return Err("world-frame: reconcile window exceeds the bound".to_string());
    }
    // Validate exactly the replayed frames' commands (mirrors TS, which validates
    // per replayed frame inside tickFrame). The window is already bounded above.
    let cbf = &v["commandsByFrame"];
    let mut f = from_frame + 1;
    while f <= to_frame {
        if let Some(cmds) = cbf.get(f.to_string().as_str()) {
            validate_commands(cmds)?;
        }
        f += 1;
    }
    let max_per_player = parse_cap(&v, "maxCommandsPerPlayer")?;
    let max_commands = parse_cap(&v, "maxCommands")?;
    let r = reconcile_frames(
        world_id,
        &v["correctedState"],
        &v["commandsByFrame"],
        to_frame,
        &v["ruleset"],
        &v["playerEntities"],
        max_per_player,
        max_commands,
    )?;
    let out = json!({ "state": r.state, "events": r.events, "framesReplayed": r.frames_replayed });
    serde_json::to_string(&out).map_err(|e| format!("world-frame: serialize: {}", e))
}

/// Resource key for the world's resource registry (matches the TS constant).
pub const RESOURCE_WORLD_FRAME: &str = "world_frame";
