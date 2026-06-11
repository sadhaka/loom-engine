//! SRD 5e action-pack golden-vector harness - the Rust port of the
//! tests/srd5e-pack vector consumption (test_vectors/srd5e_pack_v1.json).
//!
//! Three case kinds, one shared file with the TS harness:
//!   - kind "action": the pack builders' embedded AST v2 documents run through
//!     THIS crate's executor with the spec 1.3 scripted roller (the same
//!     harness rules as golden_ast_v2.rs - accept vectors consume the dice
//!     stream fully; entities not listed in a *_after field are asserted
//!     unchanged).
//!   - kind "slots": pure slot-economy ops (tables, spend/restore, rests, THE
//!     P0 widen-merge, the upcast ladder) against loom_combat::srd5e_slots.
//!   - kind "concentration": the concentration state machine against
//!     loom_combat::srd5e_concentration. Deep-equality on the full expectation.
//!
//! Scope note: the vector meta's builder-drift pin (rebuilding each action's
//! document via build.fn/build.args and deep-comparing) is the TS harness's
//! job - the document BUILDERS are TS-side content tooling and are not part of
//! the Rust port (which covers the PURE modules: slots, concentration,
//! conditions). Here the embedded documents pin the EXECUTOR's parity; the
//! builders are pinned upstream where they live. Op inputs are passed by
//! reference into pure functions, so input mutation is impossible by
//! construction (the TS "never mutated" pin).

use loom_combat::srd5e_concentration as conc;
use loom_combat::srd5e_slots as slots;
use loom_ruleset::{
    apply_triggered_mutations_with_roller, evaluate_action_with_roller, AppliedMutation, DieRoller,
};
use serde_json::{json, Value};
use std::fs;

fn load_vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/srd5e_pack_v1.json");
    let raw = fs::read_to_string(path).expect("read srd5e_pack_v1.json");
    serde_json::from_str(&raw).expect("parse vector file")
}

// ---- kind "action" (the golden_ast_v2.rs harness rules) ---------------------

// Scripted test roller (spec 1.3): entry k is the k-th STREAM-CONSUMING
// roll_die call; zero-sides dice are CALLED but pop nothing; out-of-range
// entries and an exhausted stream are harness failures (panics are fine in a
// test harness - they never cross an FFI boundary here).
struct Scripted {
    stream: Vec<i64>,
    i: usize,
    label: String,
}

impl DieRoller for Scripted {
    fn roll_die(&mut self, sides: u32) -> u32 {
        if sides == 0 {
            return 0;
        }
        assert!(
            self.i < self.stream.len(),
            "{}: dice stream exhausted (implementation over-draws)",
            self.label
        );
        let v = self.stream[self.i];
        self.i += 1;
        assert!(
            v >= 1 && v <= sides as i64,
            "{}: stream entry {} out of range for d{}",
            self.label,
            v,
            sides
        );
        v as u32
    }
}

// Encode the applied list exactly as the TS AppliedMutation records (present
// fields only), so it compares 1:1 against the vector's `applied` array.
fn applied_json(ms: &[AppliedMutation]) -> Value {
    Value::Array(
        ms.iter()
            .map(|m| {
                let mut o = serde_json::Map::new();
                o.insert("target".to_string(), Value::from(m.target.clone()));
                if let Some(p) = &m.property {
                    o.insert("property".to_string(), Value::from(p.clone()));
                }
                if let Some(t) = &m.tag {
                    o.insert("tag".to_string(), Value::from(t.clone()));
                }
                o.insert("op".to_string(), Value::from(m.op.clone()));
                if let Some(p) = m.previous {
                    o.insert("previous".to_string(), Value::from(p));
                }
                if let Some(n) = m.next {
                    o.insert("next".to_string(), Value::from(n));
                }
                Value::Object(o)
            })
            .collect(),
    )
}

fn run_action_case(c: &Value) {
    let label = c["label"].as_str().unwrap_or("?").to_string();
    let context = c["context"].as_str().expect("context");
    let actor = c["actor"].as_str().expect("actor");
    let target = c["target"].as_str();
    let state = &c["state"];
    let pre = state.clone();
    let doc: Value = if context == "check" { c["ast"].clone() } else { c["mutations"].clone() };
    let stream: Vec<i64> = c["dice_stream"]
        .as_array()
        .expect("dice_stream")
        .iter()
        .map(|v| v.as_i64().expect("dice_stream entry"))
        .collect();
    let stream_len = stream.len();
    let mut sr = Scripted { stream, i: 0, label: label.clone() };
    let ex = &c["expect"];

    if ex["reject"].as_bool() == Some(true) {
        let res: Result<(), String> = if context == "check" {
            evaluate_action_with_roller(state, &doc, actor, target, &mut sr).map(|_| ())
        } else {
            apply_triggered_mutations_with_roller(state, &doc, actor, target, &mut sr).map(|_| ())
        };
        assert!(res.is_err(), "{}: must reject", label);
        assert_eq!(sr.i, 0, "{}: reject consumes zero PRNG draws", label);
        assert_eq!(state, &pre, "{}: reject leaves state unchanged", label);
        return;
    }

    let (end_state, applied) = if context == "check" {
        let r = evaluate_action_with_roller(state, &doc, actor, target, &mut sr)
            .unwrap_or_else(|e| panic!("{}: {}", label, e));
        let want_degree = ex
            .get("degree")
            .and_then(|d| d.as_str())
            .unwrap_or_else(|| panic!("{}: check-context vectors require expect.degree", label));
        assert_eq!(r.degree, want_degree, "{}: degree", label);
        if let Some(v) = ex.get("roll") {
            assert_eq!(Some(r.roll), v.as_i64(), "{}: roll", label);
        }
        if let Some(v) = ex.get("dc") {
            assert_eq!(Some(r.dc), v.as_i64(), "{}: dc", label);
        }
        if let Some(v) = ex.get("delta") {
            assert_eq!(Some(r.delta), v.as_i64(), "{}: delta", label);
        }
        if let Some(v) = ex.get("natural") {
            assert_eq!(r.natural, v.as_i64(), "{}: natural", label);
        }
        (r.state, r.mutations)
    } else {
        let r = apply_triggered_mutations_with_roller(state, &doc, actor, target, &mut sr)
            .unwrap_or_else(|e| panic!("{}: {}", label, e));
        (r.state, r.mutations)
    };

    // Accept vectors MUST consume the stream fully (this is how the "untaken
    // branches consume zero RNG" pins work - spec 1.3).
    assert_eq!(sr.i, stream_len, "{}: dice stream fully consumed", label);
    assert_eq!(state, &pre, "{}: input state never mutated", label);

    let mut listed: Vec<String> = Vec::new();
    if let Some(pa) = ex.get("props_after").and_then(|x| x.as_object()) {
        for (id, want) in pa {
            listed.push(id.clone());
            let got = end_state["entities"][id].get("properties");
            assert_eq!(got, Some(want), "{}: props_after {}", label, id);
        }
    }
    if let Some(ta) = ex.get("tags_after").and_then(|x| x.as_object()) {
        for (id, want) in ta {
            listed.push(id.clone());
            let got = end_state["entities"][id].get("tags");
            assert_eq!(got, Some(want), "{}: tags_after {}", label, id);
        }
    }
    if let Some(ha) = ex.get("hp_after").and_then(|x| x.as_object()) {
        for (id, want) in ha {
            listed.push(id.clone());
            let got = &end_state["entities"][id]["properties"]["hp"];
            assert_eq!(got, want, "{}: hp_after {}", label, id);
        }
    }
    // Entities NOT listed in any *_after field are asserted UNCHANGED (spec 1.5).
    if let Some(input_ents) = pre.get("entities").and_then(|e| e.as_object()) {
        for (id, before) in input_ents {
            if !listed.iter().any(|l| l == id) {
                assert_eq!(
                    &end_state["entities"][id], before,
                    "{}: entity {} unchanged",
                    label, id
                );
            }
        }
    }
    if let Some(want) = ex.get("applied") {
        assert_eq!(&applied_json(&applied), want, "{}: applied list (exact order)", label);
    }
    if let Some(v) = ex.get("applied_count") {
        assert_eq!(Some(applied.len() as i64), v.as_i64(), "{}: applied_count", label);
    }
}

// ---- kind "slots" ------------------------------------------------------------

fn pool_from_json(v: &Value, label: &str) -> slots::SlotPool {
    let obj = v.as_object().unwrap_or_else(|| panic!("{}: pool must be an object", label));
    let mut pool = slots::SlotPool::default();
    for (k, e) in obj {
        if k == slots::PACT_KEY {
            pool.pact = Some(slots::PactEntry {
                slot_level: e["slot_level"].as_i64().unwrap_or_else(|| panic!("{}: pact.slot_level", label)),
                max: e["max"].as_i64().unwrap_or_else(|| panic!("{}: pact.max", label)),
                used: e["used"].as_i64().unwrap_or_else(|| panic!("{}: pact.used", label)),
            });
        } else {
            let level: i64 = k.parse().unwrap_or_else(|_| panic!("{}: non-numeric slot key {:?}", label, k));
            pool.levels.insert(
                level,
                slots::SlotEntry {
                    max: e["max"].as_i64().unwrap_or_else(|| panic!("{}: {}.max", label, k)),
                    used: e["used"].as_i64().unwrap_or_else(|| panic!("{}: {}.used", label, k)),
                },
            );
        }
    }
    pool
}

fn pool_to_json(p: &slots::SlotPool) -> Value {
    let mut o = serde_json::Map::new();
    for (level, e) in &p.levels {
        o.insert(level.to_string(), json!({ "max": e.max, "used": e.used }));
    }
    if let Some(pa) = &p.pact {
        o.insert(
            slots::PACT_KEY.to_string(),
            json!({ "slot_level": pa.slot_level, "max": pa.max, "used": pa.used }),
        );
    }
    Value::Object(o)
}

fn spend_to_json(r: &slots::SpendResult) -> Value {
    json!({
        "ok": r.ok,
        "reason": r.reason.as_str(),
        "slot_level": r.slot_level,
        "pool": pool_to_json(&r.slots),
    })
}

fn upcast_to_json(i: &slots::UpcastInfo) -> Value {
    json!({
        "spell_id": i.spell_id,
        "base_level": i.base_level,
        "cast_level": i.cast_level,
        "levels_above": i.levels_above,
        "effect": i.effect,
        "concentration": i.concentration,
        "added_dice": i.added_dice,
        "extra_instances": i.extra_instances,
        "note": i.note,
    })
}

fn run_slots_case(c: &Value) {
    let label = c["label"].as_str().unwrap_or("?");
    let op = c["op"].as_str().unwrap_or_else(|| panic!("{}: op", label));
    let a = &c["args"];
    let ex = &c["expect"];
    let got: Value = match op {
        "spell_slots_for" | "long_rest" => {
            let class = a["class"].as_str().unwrap_or_else(|| panic!("{}: class", label));
            let level = a["level"].as_i64().unwrap_or_else(|| panic!("{}: level", label));
            let pool = if op == "long_rest" {
                slots::long_rest(class, level)
            } else {
                slots::spell_slots_for(class, level)
            };
            json!({ "pool": pool_to_json(&pool) })
        }
        "spend" => {
            let pool = pool_from_json(&a["pool"], label);
            let level = a["slot_level"].as_i64().unwrap_or_else(|| panic!("{}: slot_level", label));
            spend_to_json(&slots::spend_slot(&pool, level))
        }
        "spend_lowest" => {
            let pool = pool_from_json(&a["pool"], label);
            let min = a["min_level"].as_i64().unwrap_or_else(|| panic!("{}: min_level", label));
            spend_to_json(&slots::spend_lowest_available(&pool, min))
        }
        "restore" => {
            let pool = pool_from_json(&a["pool"], label);
            let level = a["slot_level"].as_i64().unwrap_or_else(|| panic!("{}: slot_level", label));
            let count = a.get("count").and_then(|v| v.as_i64()).unwrap_or(1);
            json!({ "pool": pool_to_json(&slots::restore_slot(&pool, level, count)) })
        }
        "widen" => {
            let stored = if a["stored"].is_null() { None } else { Some(pool_from_json(&a["stored"], label)) };
            let class = a["class"].as_str().unwrap_or_else(|| panic!("{}: class", label));
            let level = a["level"].as_i64().unwrap_or_else(|| panic!("{}: level", label));
            json!({ "pool": pool_to_json(&slots::widen_slots(stored.as_ref(), class, level)) })
        }
        "short_rest" => {
            let class = a["class"].as_str().unwrap_or_else(|| panic!("{}: class", label));
            let level = a["level"].as_i64().unwrap_or_else(|| panic!("{}: level", label));
            let pool = pool_from_json(&a["pool"], label);
            json!({ "pool": pool_to_json(&slots::short_rest(class, level, &pool)) })
        }
        "upcast" => {
            let spell = a["spell"].as_str().unwrap_or_else(|| panic!("{}: spell", label));
            let cast = a["cast_level"].as_i64().unwrap_or_else(|| panic!("{}: cast_level", label));
            match slots::upcast_effect(spell, cast) {
                Some(info) => json!({ "info": upcast_to_json(&info) }),
                None => json!({ "info": null }),
            }
        }
        "total_dice" => {
            let base = a["base"].as_str().unwrap_or_else(|| panic!("{}: base", label));
            let spell = a["spell"].as_str().unwrap_or_else(|| panic!("{}: spell", label));
            let cast = a["cast_level"].as_i64().unwrap_or_else(|| panic!("{}: cast_level", label));
            json!({ "dice": slots::total_dice_for_cast(base, spell, cast) })
        }
        other => panic!("{}: unknown slots op {:?}", label, other),
    };
    assert_eq!(&got, ex, "{}: slots op {}", label, op);
}

// ---- kind "concentration" ------------------------------------------------------

fn conc_from_json(v: &Value, label: &str) -> Option<conc::ConcentrationState> {
    if v.is_null() {
        return None;
    }
    Some(conc::ConcentrationState {
        spell_id: v["spell_id"].as_str().unwrap_or_else(|| panic!("{}: spell_id", label)).to_string(),
        spell_name: v["spell_name"].as_str().unwrap_or_else(|| panic!("{}: spell_name", label)).to_string(),
        slot_level: v.get("slot_level").and_then(|x| x.as_i64()),
    })
}

fn conc_to_json(c: &Option<conc::ConcentrationState>) -> Value {
    match c {
        None => Value::Null,
        Some(s) => {
            let mut o = serde_json::Map::new();
            o.insert("spell_id".to_string(), Value::from(s.spell_id.clone()));
            o.insert("spell_name".to_string(), Value::from(s.spell_name.clone()));
            if let Some(lvl) = s.slot_level {
                o.insert("slot_level".to_string(), Value::from(lvl));
            }
            Value::Object(o)
        }
    }
}

fn run_concentration_case(c: &Value) {
    let label = c["label"].as_str().unwrap_or("?");
    let op = c["op"].as_str().unwrap_or_else(|| panic!("{}: op", label));
    let a = &c["args"];
    let ex = &c["expect"];
    let got: Value = match op {
        "maintain_dc" => {
            let damage = a["damage"].as_i64().unwrap_or_else(|| panic!("{}: damage", label));
            json!({ "dc": conc::maintain_save_dc(damage) })
        }
        "start" => {
            let current = conc_from_json(&a["current"], label);
            let spell_id = a["spell_id"].as_str().unwrap_or_else(|| panic!("{}: spell_id", label));
            let spell_name = a.get("spell_name").and_then(|x| x.as_str());
            let slot_level = a.get("slot_level").and_then(|x| x.as_i64());
            let r = conc::start_concentration(current.as_ref(), spell_id, spell_name, slot_level);
            json!({ "concentration": conc_to_json(&r.concentration), "dropped": conc_to_json(&r.dropped) })
        }
        "drop" => {
            let current = conc_from_json(&a["current"], label);
            let r = conc::drop_concentration(current.as_ref());
            json!({ "concentration": conc_to_json(&r.concentration), "dropped": conc_to_json(&r.dropped) })
        }
        "maintain" => {
            let current = conc_from_json(&a["current"], label);
            let damage = a["damage"].as_i64().unwrap_or_else(|| panic!("{}: damage", label));
            let total = a["con_save_total"].as_i64().unwrap_or_else(|| panic!("{}: con_save_total", label));
            let r = conc::maintain_save(current.as_ref(), damage, total);
            json!({
                "needed": r.needed,
                "dc": r.dc,
                "total": r.total,
                "success": r.success,
                "concentration": conc_to_json(&r.concentration),
                "dropped": conc_to_json(&r.dropped),
            })
        }
        other => panic!("{}: unknown concentration op {:?}", label, other),
    };
    assert_eq!(&got, ex, "{}: concentration op {}", label, op);
}

// ---- the harness -----------------------------------------------------------------

#[test]
fn golden_srd5e_pack_every_vector_case() {
    let vec = load_vectors();
    let cases = vec["cases"].as_array().expect("cases array");
    let (mut actions, mut slot_ops, mut conc_ops) = (0usize, 0usize, 0usize);
    for c in cases {
        match c["kind"].as_str() {
            Some("action") => {
                actions += 1;
                run_action_case(c);
            }
            Some("slots") => {
                slot_ops += 1;
                run_slots_case(c);
            }
            Some("concentration") => {
                conc_ops += 1;
                run_concentration_case(c);
            }
            other => panic!("{}: unknown case kind {:?}", c["label"].as_str().unwrap_or("?"), other),
        }
    }
    // Floor pins (the generator only ever ADDS cases).
    assert!(actions >= 27, "expected >= 27 action cases, got {}", actions);
    assert!(slot_ops >= 33, "expected >= 33 slots cases, got {}", slot_ops);
    assert!(conc_ops >= 12, "expected >= 12 concentration cases, got {}", conc_ops);
    println!(
        "srd5e pack golden vectors (Rust): action={} slots={} concentration={}",
        actions, slot_ops, conc_ops
    );
}
