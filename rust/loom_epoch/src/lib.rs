//! loom_epoch - the deterministic between-session Epoch world-tick (Rust core).
//!
//! v3.0 Phase 3 (Living Persistent World). The native sibling of the TS
//! `src/runtime/world-epoch.ts`. While a player is offline the world must keep
//! moving - factions act, regions shift - WITHOUT the session/combat PRNG and
//! WITHOUT any non-determinism, so the browser client and the authoritative
//! server arrive at the BYTE-IDENTICAL world-state hash for the same epoch.
//!
//! THE THREE GUARANTEES (all cross-language byte-parity, pinned by
//! test_vectors/v3_3_epoch_tick.json):
//!
//!   1. PRNG ISOLATION. The Epoch PRNG is seeded from SHA-256(UTF8(world_id) ||
//!      LE64(epoch_number)) - a fresh, PUBLIC derivation that never touches the
//!      session PRNG. digest[0..8] LE -> state, digest[8..16] LE |1 -> inc, built
//!      straight into `Pcg32::from_raw` with NO seeding steps.
//!
//!   2. DETERMINISTIC ORDER + FAIL-CLOSED RESOLUTION. Offline actors are the
//!      entities carrying an actor tag; they resolve in `compare_ids` order. A
//!      proposal naming an unknown action, or failing AST validation, or erroring
//!      mid-eval is REJECTED and consumes ZERO prng + ZERO state change (prng
//!      snapshot/restore + the AST's clone-not-mutate contract). Reason codes are
//!      assigned HERE at fixed decision points - never parsed from error text -
//!      so they are identical on every surface.
//!
//!   3. BOUNDED COST. `tick_epoch` caps SUCCESSFUL resolutions at `max_actions`;
//!      `catch_up_epochs` caps replayed epochs at `max_catchup`. Both are
//!      PARAMETERS, never hardcoded.

use loom_math::Pcg32;
use loom_ruleset::{
    apply_triggered_mutations_with_rng, compare_ids, evaluate_action_with_rng, validate_check,
    validate_triggered_mutations, AppliedMutation,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// The default tag marking an entity that acts while the owner is offline.
pub const DEFAULT_ACTOR_TAG: &str = "acts_offline";

// Fixed reason vocabulary - assigned by THIS code (never from error text), so
// every surface emits the same string for the same input.
const REASON_UNKNOWN_ACTION: &str = "unknown_action";
const REASON_INVALID_ACTION: &str = "invalid_action";
const REASON_EVAL_ERROR: &str = "eval_error";

// ---- Epoch PRNG derivation -------------------------------------------------

/// Derive the Epoch PRNG for `(world_id, epoch_number)`. PUBLIC + deterministic:
/// any surface computes the same PRNG from these two inputs.
///
///   msg    = utf8(world_id) || i64_le(epoch_number)   (8 bytes, two's complement)
///   digest = SHA-256(msg)
///   state  = u64 from digest[0..8]  little-endian
///   inc    = u64 from digest[8..16] little-endian, |1 (forced odd)
///   prng   = Pcg32::from_raw(state, inc)
pub fn derive_epoch_prng(world_id: &str, epoch_number: i64) -> Pcg32 {
    let id_bytes = world_id.as_bytes();
    let epoch_bytes = epoch_number.to_le_bytes(); // i64 LE, two's complement for negatives
    let mut hasher = Sha256::new();
    hasher.update(id_bytes);
    hasher.update(epoch_bytes);
    let digest = hasher.finalize(); // 32 bytes

    let mut state_b = [0u8; 8];
    state_b.copy_from_slice(&digest[0..8]);
    let mut inc_b = [0u8; 8];
    inc_b.copy_from_slice(&digest[8..16]);
    let state = u64::from_le_bytes(state_b);
    let inc = u64::from_le_bytes(inc_b) | 1;
    Pcg32::from_raw(state, inc)
}

// ---- Action AST kinds ------------------------------------------------------

// A WorldAction is a JSON object: { "kind": "check", "check"|inline check fields }
// or { "kind": "mutations", "mutations": [...] }. The TS vector stores a check
// action with the check fields (roll/dc/degrees) INLINE alongside "kind", and a
// mutations action with a "mutations" array. We read the kind, then build the
// AST shape the loom_ruleset AST expects.

enum ActionKind<'a> {
    Check(Value),
    Mutations(&'a Value),
}

fn classify_action(action: &Value) -> Result<ActionKind<'_>, String> {
    match action.get("kind").and_then(|k| k.as_str()) {
        Some("check") => {
            // A check action nests its CheckNode under "check" (the TS WorldAction
            // shape { kind:"check", check: CheckNode }). Read it nested - NOT inline -
            // so validate_check / evaluate_action see the same node TS does.
            let check = action.get("check").ok_or("world-epoch: check action missing check")?;
            Ok(ActionKind::Check(check.clone()))
        }
        Some("mutations") => {
            let m = action.get("mutations").ok_or("world-epoch: mutations action missing mutations")?;
            Ok(ActionKind::Mutations(m))
        }
        _ => Err("world-epoch: action has unknown kind".to_string()),
    }
}

// ---- Helpers ---------------------------------------------------------------

/// Serialize an AppliedMutation as a canonical JSON object with ONLY the present
/// fields (omit absent ones; never emit nulls) - mirrors the TS
/// `serializeMutations`, so canonical_json encodes the same key set everywhere.
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

// Shallow top-level clone of the state with epoch replaced (never mutates input).
fn with_epoch(state: &Value, epoch_number: i64) -> Value {
    let mut out = match state.as_object() {
        Some(m) => m.clone(),
        None => Map::new(),
    };
    out.insert("epoch".to_string(), Value::from(epoch_number));
    Value::Object(out)
}

fn entity_has_actor_tag(tags: &Value, actor_tags: &[String]) -> bool {
    let arr = match tags.as_array() {
        Some(a) => a,
        None => return false,
    };
    for t in arr {
        if let Some(s) = t.as_str() {
            if actor_tags.iter().any(|a| a == s) {
                return true;
            }
        }
    }
    false
}

// ---- tick_epoch ------------------------------------------------------------

pub struct TickEpochInput<'a> {
    pub world_id: &'a str,
    pub state: &'a Value,
    pub epoch_number: i64,
    /// actor_id -> proposal { "actionId": str, optional "targetId": str }.
    pub proposals: &'a Value,
    /// action_id -> WorldAction. Caller-owned content.
    pub ruleset: &'a Value,
    /// Tags marking offline actors. Empty -> [DEFAULT_ACTOR_TAG].
    pub actor_tags: Vec<String>,
    /// Cap on SUCCESSFUL resolutions (Veil-Ceiling guard). None -> no cap.
    pub max_actions: Option<u64>,
}

pub struct TickEpochResult {
    pub state: Value,
    /// The canonical EpochResolved event as a JSON Value (hashable identically to TS).
    pub event: Value,
    pub resolved: u64,
    pub rejected: u64,
}

/// Resolve one offline epoch. Pure: does not mutate `input.state`. Returns the
/// new state (epoch advanced) + the canonical EpochResolved event.
pub fn tick_epoch(input: TickEpochInput) -> TickEpochResult {
    let actor_tags: Vec<String> = if input.actor_tags.is_empty() {
        vec![DEFAULT_ACTOR_TAG.to_string()]
    } else {
        input.actor_tags.clone()
    };
    let max_actions = input.max_actions.unwrap_or(u64::MAX);

    let mut prng = derive_epoch_prng(input.world_id, input.epoch_number);

    // Identify offline actors, then sort by the numeric-aware id comparator so the
    // resolution (and PRNG draw) order is byte-identical everywhere.
    let mut actors: Vec<String> = Vec::new();
    if let Some(entities) = input.state.get("entities").and_then(|e| e.as_object()) {
        for (id, ent) in entities {
            let tags = ent.get("tags").cloned().unwrap_or(Value::Null);
            if entity_has_actor_tag(&tags, &actor_tags) {
                actors.push(id.clone());
            }
        }
    }
    actors.sort_by(|a, b| compare_ids(a, b));

    let mut work = input.state.clone();
    let mut entries: Vec<Value> = Vec::new();
    let mut resolved: u64 = 0;
    let mut rejected: u64 = 0;

    for actor_id in &actors {
        if resolved >= max_actions {
            break; // Veil-Ceiling guard - stop after the cap
        }
        let proposal = match input.proposals.get(actor_id) {
            Some(p) if p.is_object() => p,
            _ => continue, // no proposal -> the actor idles (not counted, not listed)
        };
        let action_id = match proposal.get("actionId").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => continue, // malformed proposal w/o an action id idles
        };
        let target_id = proposal.get("targetId").and_then(|x| x.as_str());

        let action = match input.ruleset.get(&action_id) {
            Some(a) => a,
            None => {
                // (1) unknown action - no prng, no state change.
                entries.push(json!({
                    "action_id": action_id,
                    "actor_id": actor_id,
                    "reason": REASON_UNKNOWN_ACTION,
                }));
                rejected += 1;
                continue;
            }
        };

        let kind = match classify_action(action) {
            Ok(k) => k,
            Err(_) => {
                entries.push(json!({
                    "action_id": action_id,
                    "actor_id": actor_id,
                    "reason": REASON_INVALID_ACTION,
                }));
                rejected += 1;
                continue;
            }
        };

        // (2) fail-closed validation BEFORE any prng draw. Reason assigned here.
        let valid = match &kind {
            ActionKind::Check(node) => validate_check(node),
            ActionKind::Mutations(muts) => validate_triggered_mutations(muts),
        };
        if valid.is_err() {
            entries.push(json!({
                "action_id": action_id,
                "actor_id": actor_id,
                "reason": REASON_INVALID_ACTION,
            }));
            rejected += 1;
            continue;
        }

        // (3) resolve. Snapshot prng first; on ANY error roll it back to zero draws
        // (the AST clones state, so a failed resolve never mutated `work`).
        let snap = prng.snapshot();
        let outcome: Result<(String, Vec<AppliedMutation>, Value), String> = match &kind {
            ActionKind::Check(node) => {
                evaluate_action_with_rng(&work, node, actor_id, target_id, &mut prng)
                    .map(|r| (r.degree, r.mutations, r.state))
            }
            ActionKind::Mutations(muts) => {
                apply_triggered_mutations_with_rng(&work, muts, actor_id, target_id, &mut prng)
                    .map(|r| ("none".to_string(), r.mutations, r.state))
            }
        };

        match outcome {
            Ok((degree, applied, new_state)) => {
                work = new_state;
                entries.push(json!({
                    "action_id": action_id,
                    "actor_id": actor_id,
                    "degree": degree,
                    "mutations_applied": serialize_mutations(&applied),
                }));
                resolved += 1;
            }
            Err(_) => {
                prng.restore(snap); // zero prng consumed for a rejected proposal
                entries.push(json!({
                    "action_id": action_id,
                    "actor_id": actor_id,
                    "reason": REASON_EVAL_ERROR,
                }));
                rejected += 1;
            }
        }
    }

    let out_state = with_epoch(&work, input.epoch_number);
    let event = json!({
        "event_type": "EpochResolved",
        "epoch_number": input.epoch_number,
        "actions_processed": Value::Array(entries),
        "pcg_steps_consumed": prng.get_draws(),
    });
    TickEpochResult {
        state: out_state,
        event,
        resolved,
        rejected,
    }
}

// ---- catch_up_epochs -------------------------------------------------------

pub struct CatchUpInput<'a> {
    pub world_id: &'a str,
    pub state: &'a Value,
    /// The current epoch from the caller's clock (read OUTSIDE the engine).
    pub current_epoch: i64,
    /// Bound on epochs replayed per reconnect (caller-supplied).
    pub max_catchup: i64,
    pub ruleset: &'a Value,
    /// Optional per-epoch proposals keyed by str(epoch_number). Missing -> {}.
    pub proposals_by_epoch: &'a Value,
    pub actor_tags: Vec<String>,
    pub max_actions: Option<u64>,
}

pub struct CatchUpResult {
    pub state: Value,
    pub events: Vec<Value>,
    pub epochs_resolved: i64,
    pub epochs_voided: i64,
}

/// Deterministically replay offline epochs from `state.epoch` up to
/// `current_epoch`, capped at `max_catchup`. Result depends only on
/// (state, capped, proposals) - never on the wall clock directly.
pub fn catch_up_epochs(input: CatchUpInput) -> CatchUpResult {
    let client_epoch = input.state.get("epoch").and_then(|e| e.as_i64()).unwrap_or(0);
    let target = input.current_epoch - client_epoch;
    if target <= 0 {
        return CatchUpResult {
            state: input.state.clone(),
            events: Vec::new(),
            epochs_resolved: 0,
            epochs_voided: 0,
        };
    }
    let capped = if target > input.max_catchup { input.max_catchup } else { target };

    let mut work = input.state.clone();
    let mut events: Vec<Value> = Vec::new();
    let empty = json!({});
    let mut i = 1;
    while i <= capped {
        let epoch_n = client_epoch + i;
        let proposals = input
            .proposals_by_epoch
            .get(epoch_n.to_string())
            .filter(|p| p.is_object())
            .unwrap_or(&empty);
        let r = tick_epoch(TickEpochInput {
            world_id: input.world_id,
            state: &work,
            epoch_number: epoch_n,
            proposals,
            ruleset: input.ruleset,
            actor_tags: input.actor_tags.clone(),
            max_actions: input.max_actions,
        });
        work = r.state;
        events.push(r.event);
        i += 1;
    }

    CatchUpResult {
        state: work,
        events,
        epochs_resolved: capped,
        epochs_voided: target - capped,
    }
}

/// Resource key for the world's resource registry (matches the TS constant).
pub const RESOURCE_WORLD_EPOCH: &str = "world_epoch";
