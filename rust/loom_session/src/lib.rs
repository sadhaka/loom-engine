//! loom_session - the WorldSession suspend/resume lifecycle (Rust core, Phase 4).
//!
//! The native sibling of the TS `src/runtime/world-session.ts`. On resume it is
//! fail-closed in strict order: (1) verify the snapshot hash; (2) load; (3) verify
//! the HMAC chain tail; (4) replay the tail via a RECORDED-MUTATION reducer (NOT
//! the AST - the chain records what happened, so a later ruleset re-balance cannot
//! rewrite history); (5) reject time-travel; (6) run bounded Epoch catch-up.
//!
//! Built on loom_events (verify_records), loom_snapshot (world_state_hash +
//! normalize_tags), and loom_epoch (catch_up_epochs), so it reproduces the TS
//! reference byte-for-byte. Pinned by test_vectors/v3_4_world_session.json. The
//! WASM (loom_wasm) and Python (loom_py) surfaces bind `resume_from_json` - Phase 4
//! is the first primitive consumed from the one Rust core on every non-TS surface.

use loom_events::{ChainedRecord, EventChain};
use loom_snapshot::{normalize_tags, world_state_hash};
use serde_json::{json, Map, Value};

// ---- the reducer: replay a recorded EpochResolved event --------------------

// Returns None (instead of panicking) if the state / entities value is not a JSON
// object. A hostile bundle whose snapshot hash matches but whose state shape is
// malformed (e.g. "entities": 0) must NOT panic - a panic across the C ABI is UB
// (Codex P0). A malformed state simply receives no mutation, deterministically.
fn ensure_entity<'a>(state: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    let obj = state.as_object_mut()?;
    let entities = obj
        .entry("entities")
        .or_insert_with(|| Value::Object(Map::new()));
    let emap = entities.as_object_mut()?;
    Some(
        emap.entry(id.to_string())
            .or_insert_with(|| json!({ "properties": {}, "tags": [] })),
    )
}

// Apply ONE recorded mutation. Mirrors the AST's applyMutation EXACTLY: a prop op
// stores the recorded `next`; a tag op uses the SAME normalize_tags(concat) /
// filter the AST used (so the resulting tags array order - which the hash depends
// on - is reproduced byte-for-byte).
fn apply_serialized_mutation(state: &mut Value, m: &Value) {
    let target = match m.get("target").and_then(|x| x.as_str()) {
        Some(t) => t.to_string(),
        None => return,
    };
    let op = m.get("op").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let ent = match ensure_entity(state, &target) {
        Some(e) => e,
        None => return,
    };
    let emap = match ent.as_object_mut() {
        Some(e) => e,
        None => return,
    };
    if op == "add_tag" {
        if let Some(tag) = m.get("tag").and_then(|x| x.as_str()) {
            let tags_val = emap.entry("tags").or_insert_with(|| Value::Array(Vec::new()));
            let mut cur: Vec<String> = tags_val
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            cur.push(tag.to_string());
            let normed = normalize_tags(&cur);
            *tags_val = Value::Array(normed.into_iter().map(Value::from).collect());
        }
    } else if op == "remove_tag" {
        if let Some(tag) = m.get("tag").and_then(|x| x.as_str()) {
            if let Some(arr) = emap.get_mut("tags").and_then(|t| t.as_array_mut()) {
                arr.retain(|x| x.as_str() != Some(tag));
            }
        }
    } else if let (Some(prop), Some(next)) =
        (m.get("property").and_then(|x| x.as_str()), m.get("next"))
    {
        // set_prop / add_prop / sub_prop - the recorded `next` IS the post-value.
        let props = emap.entry("properties").or_insert_with(|| Value::Object(Map::new()));
        if let Some(pmap) = props.as_object_mut() {
            pmap.insert(prop.to_string(), next.clone());
        }
    }
}

/// Replay one EpochResolved event onto a state (the reducer). Pure: returns a new
/// state with epoch = the event's epoch_number.
pub fn replay_epoch_event(state: &Value, event: &Value) -> Value {
    let mut work = state.clone();
    if let Some(entries) = event.get("actions_processed").and_then(|x| x.as_array()) {
        for entry in entries {
            if let Some(muts) = entry.get("mutations_applied").and_then(|x| x.as_array()) {
                for m in muts {
                    apply_serialized_mutation(&mut work, m);
                }
            }
        }
    }
    if let (Some(en), Some(obj)) = (event.get("epoch_number"), work.as_object_mut()) {
        obj.insert("epoch".to_string(), en.clone());
    }
    work
}

// ---- resume ----------------------------------------------------------------

pub struct ResumeOutput {
    pub world_id: String,
    pub state: Value,
    pub new_events: Vec<Value>,
    pub epochs_resolved: i64,
    pub epochs_voided: i64,
}

fn parse_record(v: &Value) -> Result<ChainedRecord, String> {
    Ok(ChainedRecord {
        seq: v.get("seq").and_then(|x| x.as_u64()).ok_or("record missing seq")?,
        type_: v.get("type").and_then(|x| x.as_str()).ok_or("record missing type")?.to_string(),
        payload: v.get("payload").cloned().ok_or("record missing payload")?,
        prev_sig: v.get("prevSig").and_then(|x| x.as_str()).ok_or("record missing prevSig")?.to_string(),
        sig: v.get("sig").and_then(|x| x.as_str()).ok_or("record missing sig")?.to_string(),
    })
}

/// Reconstruct + verify + fast-forward a world from a bundle. Fail-closed at every
/// integrity gate. Deterministic across surfaces.
#[allow(clippy::too_many_arguments)]
pub fn resume(
    key: &[u8],
    bundle: &Value,
    current_epoch: i64,
    max_catchup: i64,
    ruleset: &Value,
    proposals_by_epoch: &Value,
    actor_tags: Vec<String>,
    max_actions: Option<u64>,
) -> Result<ResumeOutput, String> {
    let snapshot = bundle.get("snapshot").ok_or("world-session: bundle missing snapshot")?;
    let snap_state = snapshot.get("state").ok_or("world-session: snapshot missing state")?;
    let expected = snapshot.get("stateHash").and_then(|x| x.as_str()).ok_or("world-session: snapshot missing stateHash")?;

    // (1) snapshot integrity.
    let actual = world_state_hash(key, snap_state).map_err(|e| format!("world-session: hash: {:?}", e))?;
    if actual != expected {
        return Err("world-session: corrupted snapshot (state hash mismatch)".to_string());
    }

    // (2) load.
    let mut work = snap_state.clone();
    let world_id = bundle.get("worldId").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let tail_genesis = bundle.get("tailGenesis").and_then(|x| x.as_str()).unwrap_or("");
    let empty: Vec<Value> = Vec::new();
    let tail = bundle.get("chainTail").and_then(|x| x.as_array()).unwrap_or(&empty);

    // (3) tail chain integrity.
    if !tail.is_empty() {
        let records: Vec<ChainedRecord> = tail.iter().map(parse_record).collect::<Result<_, _>>()?;
        if !EventChain::verify_records(key, &records, tail_genesis) {
            return Err("world-session: chain tamper detected in tail".to_string());
        }
    }

    // (4) reducer replay.
    for rv in tail {
        let event = rv.get("payload").ok_or("world-session: tail record missing payload")?;
        work = replay_epoch_event(&work, event);
    }

    // (5) time-travel guard.
    let work_epoch = work.get("epoch").and_then(|x| x.as_i64()).unwrap_or(0);
    if current_epoch < work_epoch {
        return Err("world-session: time travel detected (currentEpoch < state.epoch)".to_string());
    }

    // (6) bounded catch-up.
    let r = loom_epoch::catch_up_epochs(loom_epoch::CatchUpInput {
        world_id: world_id.as_str(),
        state: &work,
        current_epoch,
        max_catchup,
        ruleset,
        proposals_by_epoch,
        actor_tags,
        max_actions,
    });

    Ok(ResumeOutput {
        world_id,
        state: r.state,
        new_events: r.events,
        epochs_resolved: r.epochs_resolved,
        epochs_voided: r.epochs_voided,
    })
}

/// JSON-in / JSON-out resume for the WASM + PyO3 surfaces. Input:
/// {key, bundle, currentEpoch, maxCatchup, ruleset, proposalsByEpoch?, actorTags?,
/// maxActions?}. Returns {worldId, state, newEvents, epochsResolved, epochsVoided}.
pub fn resume_from_json(input_json: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(input_json).map_err(|e| format!("world-session: bad input json: {}", e))?;
    let key = v.get("key").and_then(|x| x.as_str()).ok_or("world-session: missing key")?;
    let bundle = v.get("bundle").ok_or("world-session: missing bundle")?;
    let current_epoch = v.get("currentEpoch").and_then(|x| x.as_i64()).ok_or("world-session: missing currentEpoch")?;
    if !loom_epoch::is_safe_epoch(current_epoch) {
        return Err("world-session: currentEpoch must be a JS-safe integer".to_string());
    }
    let max_catchup = v.get("maxCatchup").and_then(|x| x.as_i64()).ok_or("world-session: missing maxCatchup")?;
    if max_catchup < 0 || !loom_epoch::is_safe_epoch(max_catchup) {
        return Err("world-session: maxCatchup must be a non-negative JS-safe integer".to_string());
    }
    let ruleset = v.get("ruleset").cloned().unwrap_or_else(|| json!({}));
    let proposals_by_epoch = v.get("proposalsByEpoch").cloned().unwrap_or_else(|| json!({}));
    let actor_tags: Vec<String> = v
        .get("actorTags")
        .and_then(|t| t.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    // maxActions: absent/null -> no cap; present -> must be a non-negative JS-safe integer.
    let max_actions = match v.get("maxActions") {
        None | Some(Value::Null) => None,
        Some(m) => Some(
            m.as_u64()
                .filter(|n| *n <= loom_epoch::MAX_SAFE_INT as u64)
                .ok_or("world-session: maxActions must be a non-negative JS-safe integer")?,
        ),
    };

    let out = resume(key.as_bytes(), bundle, current_epoch, max_catchup, &ruleset, &proposals_by_epoch, actor_tags, max_actions)?;
    let j = json!({
        "worldId": out.world_id,
        "state": out.state,
        "newEvents": out.new_events,
        "epochsResolved": out.epochs_resolved,
        "epochsVoided": out.epochs_voided,
    });
    serde_json::to_string(&j).map_err(|e| format!("world-session: serialize: {}", e))
}

/// Resource key for the world's resource registry (matches the TS constant).
pub const RESOURCE_WORLD_SESSION: &str = "world_session";
