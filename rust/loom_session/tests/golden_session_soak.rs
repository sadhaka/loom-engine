//! Cross-language parity: the Rust core must reproduce the TS-generated v3.5
//! SOAK golden vector (test_vectors/v3_5_session_soak.json) byte-for-byte - the
//! persistence + partial-sync PROOF. Five composed long-horizon cases:
//!
//!   S1 - 120-epoch catch-up, BOTH single-shot and in four 30-epoch chunks,
//!        pinned byte-identical (catch-up COMPOSABILITY) with 30/60/90
//!        checkpoint hashes.
//!   S2 - the zero-catch-up resume boundary, one epoch across the boundary,
//!        MID-CHAIN suspend (snapshotEventIndex 2) snapshot-position
//!        independence, plus the time-travel rejection.
//!   S3 - three suspend -> resume -> append-newEvents-to-the-ONE-chain ->
//!        re-suspend cycles, pinned per cycle (including the TS chain head sig -
//!        a real cross-language CHAIN parity proof), equal to one 21-epoch resume.
//!   S4 - the accumulated 21-record chain sealed + verified across the whole gap,
//!        AND the negative space: bare verify_records (no seal) still cannot see
//!        tail truncation - the EventChain-level fact that motivated bundle
//!        format v2, where the WorldBundle CARRIES its ChainSeal and resume()
//!        verifies it structurally (the old documented hole is CLOSED: an
//!        end-truncated bundle is now rejected, pinned below against bundleA) -
//!        WITH the seal truncation is caught (seal_mismatch), and a flipped
//!        recorded mutation is a sig_mismatch at seq 10.
//!   S5 - void-at-scale (100 of 500 resolved, 400 voided) and a deterministic
//!        SECOND resume across the void boundary.
//!
//! Mirrors tests/world-session-soak.test.ts test-for-test (16 each).

use loom_epoch::{catch_up_epochs, CatchUpInput};
use loom_events::{ChainSeal, ChainedRecord, EventChain, MismatchReason};
use loom_session::resume;
use loom_snapshot::world_state_hash;
use serde_json::{json, Value};
use std::fs;

fn load_case(kind: &str) -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v3_5_session_soak.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read soak vector"))
        .expect("parse soak vector");
    for c in v["cases"].as_array().expect("cases array") {
        if c["kind"].as_str() == Some(kind) {
            return c.clone();
        }
    }
    panic!("soak vector case missing: {}", kind);
}

fn tags(c: &Value) -> Vec<String> {
    c["actorTags"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_string())
        .collect()
}

fn hash(key: &str, v: &Value) -> String {
    world_state_hash(key.as_bytes(), v).expect("world_state_hash")
}

fn parse_records(v: &Value) -> Vec<ChainedRecord> {
    v.as_array()
        .expect("records array")
        .iter()
        .map(|r| ChainedRecord {
            seq: r["seq"].as_u64().expect("seq"),
            type_: r["type"].as_str().expect("type").to_string(),
            payload: r["payload"].clone(),
            prev_sig: r["prevSig"].as_str().expect("prevSig").to_string(),
            sig: r["sig"].as_str().expect("sig").to_string(),
        })
        .collect()
}

// The CORE suspend() (bundle format v2: the bundle embeds chain.seal()) with the
// case's string key - the same call the TS soak tests make. The hand-rolled
// bundle builder this helper used to be is gone: Rust now has suspend in the
// core, and the sealed bundle shape is byte-for-byte the TS one.
fn suspend_bundle(
    key: &str,
    world_id: &str,
    state: &Value,
    snapshot_event_index: u64,
    chain: &EventChain,
) -> Value {
    loom_session::suspend(key.as_bytes(), world_id, state, snapshot_event_index as i64, chain)
        .expect("suspend packs a sealed bundle")
}

// resume() with the case's shared ruleset/tags; per-call clock + cap + proposals.
fn resume_case(
    c: &Value,
    bundle: &Value,
    current_epoch: i64,
    max_catchup: i64,
    proposals: &Value,
) -> Result<loom_session::ResumeOutput, String> {
    resume(
        c["key"].as_str().unwrap().as_bytes(),
        bundle,
        current_epoch,
        max_catchup,
        &c["ruleset"],
        proposals,
        tags(c),
        None,
    )
}

// ---- S1 ----------------------------------------------------------------------

#[test]
fn s1_single_shot_120_epoch_catchup_reproduces_pinned_hashes() {
    let c = load_case("soak_catchup");
    let key = c["key"].as_str().unwrap();
    let expect = &c["expect"];
    let r = catch_up_epochs(CatchUpInput {
        world_id: c["worldId"].as_str().unwrap(),
        state: &c["state"],
        current_epoch: c["currentEpoch"].as_i64().unwrap(),
        max_catchup: c["maxCatchup"].as_i64().unwrap(),
        ruleset: &c["ruleset"],
        proposals_by_epoch: &c["proposalsByEpoch"],
        actor_tags: tags(&c),
        max_actions: None,
    });
    assert_eq!(r.epochs_resolved, expect["epochsResolved"].as_i64().unwrap(), "epochsResolved");
    assert_eq!(r.epochs_voided, expect["epochsVoided"].as_i64().unwrap(), "epochsVoided");
    assert_eq!(r.state["epoch"].as_i64().unwrap(), expect["final_epoch"].as_i64().unwrap(), "final epoch");
    assert_eq!(r.events.len() as i64, expect["newEvents_count"].as_i64().unwrap(), "event count");
    assert_eq!(hash(key, &Value::Array(r.events.clone())), expect["events_hash"].as_str().unwrap(), "events hash");
    assert_eq!(hash(key, &r.state), expect["final_state_hash"].as_str().unwrap(), "final state hash");
}

#[test]
fn s1_chunked_catchup_equals_single_shot_checkpoint_pinned() {
    let c = load_case("soak_catchup");
    let key = c["key"].as_str().unwrap();
    let expect = &c["expect"];
    assert_eq!(expect["chunked_equals_single"].as_bool(), Some(true), "generator pinned composability");
    let mut work = c["state"].clone();
    let mut all_events: Vec<Value> = Vec::new();
    for stop_v in c["chunk_stops"].as_array().unwrap() {
        let stop = stop_v.as_i64().unwrap();
        let r = catch_up_epochs(CatchUpInput {
            world_id: c["worldId"].as_str().unwrap(),
            state: &work,
            current_epoch: stop,
            max_catchup: c["maxCatchup"].as_i64().unwrap(),
            ruleset: &c["ruleset"],
            proposals_by_epoch: &c["proposalsByEpoch"],
            actor_tags: tags(&c),
            max_actions: None,
        });
        work = r.state;
        all_events.extend(r.events);
        assert_eq!(
            hash(key, &work),
            expect["checkpoint_state_hashes"][stop.to_string()].as_str().unwrap(),
            "checkpoint hash @ epoch {}",
            stop
        );
    }
    assert_eq!(hash(key, &work), expect["final_state_hash"].as_str().unwrap(), "chunked final == single-shot final");
    assert_eq!(all_events.len() as i64, expect["newEvents_count"].as_i64().unwrap(), "chunked event count");
    assert_eq!(hash(key, &Value::Array(all_events)), expect["events_hash"].as_str().unwrap(), "chunked events == single-shot events");
}

// ---- S2 ----------------------------------------------------------------------

#[test]
fn s2_resume_at_post_tail_epoch_is_zero_catchup_noop() {
    let c = load_case("boundary");
    let key = c["key"].as_str().unwrap();
    let a = &c["expect"]["a"];
    let r = resume_case(&c, &c["bundleA"], a["currentEpoch"].as_i64().unwrap(), c["maxCatchup"].as_i64().unwrap(), &c["proposalsByEpoch"]).expect("resume A");
    assert_eq!(r.epochs_resolved, a["epochsResolved"].as_i64().unwrap(), "epochsResolved");
    assert_eq!(r.epochs_voided, a["epochsVoided"].as_i64().unwrap(), "epochsVoided");
    assert_eq!(r.new_events.len() as i64, a["newEvents_count"].as_i64().unwrap(), "no new events");
    assert_eq!(hash(key, &r.state), a["resumed_state_hash"].as_str().unwrap(), "resumed hash");
    // The tail-replayed resume lands EXACTLY on the live epoch-13 state hash.
    assert_eq!(
        a["resumed_state_hash"].as_str().unwrap(),
        c["expect"]["live_epoch13_state_hash"].as_str().unwrap(),
        "resumed == live"
    );
}

#[test]
fn s2_one_epoch_across_the_suspend_boundary() {
    let c = load_case("boundary");
    let key = c["key"].as_str().unwrap();
    let b = &c["expect"]["b"];
    let r = resume_case(&c, &c["bundleA"], b["currentEpoch"].as_i64().unwrap(), c["maxCatchup"].as_i64().unwrap(), &c["proposalsByEpoch"]).expect("resume B");
    assert_eq!(r.epochs_resolved, b["epochsResolved"].as_i64().unwrap(), "epochsResolved");
    assert_eq!(r.state["epoch"].as_i64().unwrap(), b["final_epoch"].as_i64().unwrap(), "final epoch");
    assert_eq!(hash(key, &r.state), b["final_state_hash"].as_str().unwrap(), "final hash");
}

#[test]
fn s2_mid_chain_suspend_is_snapshot_position_independent() {
    let c = load_case("boundary");
    let key = c["key"].as_str().unwrap();
    let cc = &c["expect"]["c"];
    assert_eq!(
        c["bundleC"]["chainTail"].as_array().unwrap().len() as i64,
        cc["tail_length"].as_i64().unwrap(),
        "mid-chain tail length"
    );
    assert_eq!(c["bundleC"]["snapshot"]["eventIndex"].as_i64(), Some(2), "snapshot taken mid-chain");
    let r = resume_case(&c, &c["bundleC"], cc["currentEpoch"].as_i64().unwrap(), c["maxCatchup"].as_i64().unwrap(), &c["proposalsByEpoch"]).expect("resume C");
    assert_eq!(hash(key, &r.state), cc["final_state_hash"].as_str().unwrap(), "mid-chain resume hash");
    // The SAME final hash as bundle A (suspend at index 0): where the snapshot was
    // taken along the chain does not change the resumed world.
    assert_eq!(
        cc["final_state_hash"].as_str().unwrap(),
        c["expect"]["b"]["final_state_hash"].as_str().unwrap(),
        "C == B"
    );
    assert_eq!(cc["snapshot_position_independent"].as_bool(), Some(true), "pinned independence");
}

#[test]
fn s2_clock_behind_replayed_tail_is_time_travel() {
    let c = load_case("boundary");
    // After replaying bundle A's 3-event tail the world is at epoch 13; a clock at
    // 12 must fail AFTER tail replay (the guard runs post-reduce).
    match resume_case(&c, &c["bundleA"], 12, c["maxCatchup"].as_i64().unwrap(), &c["proposalsByEpoch"]) {
        Ok(_) => panic!("time travel must be rejected"),
        Err(e) => assert!(e.contains("time travel"), "reason is time travel, got: {}", e),
    }
}

// ---- S3 ----------------------------------------------------------------------

#[test]
fn s3_three_suspend_resume_cycles_on_one_chain_pinned_per_cycle() {
    let c = load_case("cycles");
    let key = c["key"].as_str().unwrap();
    let world_id = c["worldId"].as_str().unwrap();
    let mut chain = EventChain::create(key.as_bytes(), c["genesis"].as_str().unwrap());
    let mut bundle = c["bundle0"].clone();
    let cycle_count = c["cycle_count"].as_u64().unwrap() as usize;
    let cycles = c["expect"]["cycles"].as_array().unwrap();
    for (k, exp) in cycles.iter().enumerate().take(cycle_count) {
        let r = resume_case(&c, &bundle, exp["currentEpoch"].as_i64().unwrap(), c["maxCatchup"].as_i64().unwrap(), &c["proposalsByEpoch"])
            .unwrap_or_else(|e| panic!("cycle {} resume: {}", k, e));
        assert_eq!(r.epochs_resolved, exp["epochsResolved"].as_i64().unwrap(), "cycle {} resolved", k);
        assert_eq!(r.epochs_voided, exp["epochsVoided"].as_i64().unwrap(), "cycle {} voided", k);
        // The composed flow the audit flagged: every resume newEvent goes BACK onto
        // the persistent chain before the world re-suspends.
        for (e, ev) in r.new_events.iter().enumerate() {
            assert!(
                chain.append("EpochResolved", ev.clone()).is_some(),
                "cycle {} event {} appended",
                k,
                e
            );
        }
        assert_eq!(hash(key, &r.state), exp["state_hash"].as_str().unwrap(), "cycle {} state hash", k);
        assert_eq!(chain.size() as u64, exp["chain_record_count"].as_u64().unwrap(), "cycle {} chain count", k);
        // The chain head sig pinned by the TS generator: the Rust chain signed the
        // SAME bytes - a real cross-language chain parity proof.
        assert_eq!(chain.head(), exp["chain_head_sig"].as_str().unwrap(), "cycle {} chain head", k);
        let snapshot_index = chain.size() as u64;
        bundle = suspend_bundle(key, world_id, &r.state, snapshot_index, &chain);
        assert_eq!(
            bundle["chainTail"].as_array().unwrap().len(),
            0,
            "cycle {} re-suspend has a current snapshot",
            k
        );
    }
    assert_eq!(
        cycles[cycle_count - 1]["state_hash"].as_str().unwrap(),
        c["expect"]["final_state_hash"].as_str().unwrap(),
        "last cycle == final"
    );
}

#[test]
fn s3_one_21_epoch_resume_equals_the_three_cycles() {
    let c = load_case("cycles");
    let key = c["key"].as_str().unwrap();
    assert_eq!(c["expect"]["one_shot_equals_cycles"].as_bool(), Some(true), "generator pinned equivalence");
    let r = resume_case(
        &c,
        &c["bundle0"],
        c["expect"]["final_epoch"].as_i64().unwrap(),
        c["one_shot_maxCatchup"].as_i64().unwrap(),
        &c["proposalsByEpoch"],
    )
    .expect("one-shot resume");
    assert_eq!(r.epochs_resolved, 21, "all 21 resolved");
    assert_eq!(r.state["epoch"].as_i64().unwrap(), c["expect"]["final_epoch"].as_i64().unwrap(), "final epoch");
    assert_eq!(hash(key, &r.state), c["expect"]["final_state_hash"].as_str().unwrap(), "one-shot final hash");
}

// ---- S4 ----------------------------------------------------------------------

fn s4_seal(c: &Value) -> ChainSeal {
    ChainSeal {
        count: c["expect"]["seal_count"].as_u64().unwrap(),
        head: c["expect"]["seal_head"].as_str().unwrap().to_string(),
        sig: c["expect"]["seal_sig"].as_str().unwrap().to_string(),
    }
}

#[test]
fn s4_21_record_chain_seals_and_verifies_across_the_gap() {
    let c = load_case("chain_seal");
    let key = c["key"].as_str().unwrap();
    let genesis = c["genesis"].as_str().unwrap();
    let records = parse_records(&c["records"]);
    let seal_count = c["expect"]["seal_count"].as_u64().unwrap();
    assert_eq!(records.len() as u64, seal_count, "record count");
    assert_eq!(hash(key, &c["records"]), c["expect"]["records_hash"].as_str().unwrap(), "records hash");
    let seal = s4_seal(&c);
    assert!(EventChain::verify_seal(key.as_bytes(), &seal), "seal self-verifies");
    let res = EventChain::verify_records_detailed(key.as_bytes(), &records, genesis, Some(&seal));
    assert_eq!(res.ok, c["expect"]["full_chain_verify_ok"].as_bool().unwrap(), "full chain + seal verify");
    assert_eq!(res.total as u64, seal_count, "verified total");
    // The seal head IS the last record's signature.
    assert_eq!(seal.head, records[records.len() - 1].sig, "seal head == chain head");
}

#[test]
fn s4_bare_verify_records_no_seal_still_cannot_see_tail_truncation() {
    let c = load_case("chain_seal");
    let key = c["key"].as_str().unwrap();
    let genesis = c["genesis"].as_str().unwrap();
    let records = parse_records(&c["records"]);
    let truncated = &records[..records.len() - 1];
    // verify_records alone CANNOT see records dropped off the END - the
    // EventChain-level fact that motivated bundle format v2. The WorldBundle now
    // CARRIES a ChainSeal and resume() verifies it fail-closed, so the old
    // documented hole (resume() silently accepting a tail-truncated bundle and
    // replacing recorded history with re-simulated catch-up) is CLOSED - see the
    // structural-seal rejection test below.
    let res = EventChain::verify_records_detailed(key.as_bytes(), truncated, genesis, None);
    assert!(res.ok, "truncated tail verifies clean without a seal");
    assert_eq!(res.total, records.len() - 1, "one record silently gone");
}

#[test]
fn s4_end_truncated_bundle_tail_is_rejected_by_the_structural_seal_on_resume() {
    // The hole is closed structurally: bundleA (3-record tail) loses its trailing
    // record; resume() must reject it via the bundle's embedded seal instead of
    // silently re-simulating the dropped epoch.
    let c = load_case("boundary");
    let mut truncated = c["bundleA"].clone();
    let tail = truncated["chainTail"].as_array().expect("tail").clone();
    assert!(!tail.is_empty(), "bundleA has a tail to truncate");
    truncated["chainTail"] = Value::Array(tail[..tail.len() - 1].to_vec());
    match resume_case(
        &c,
        &truncated,
        c["expect"]["b"]["currentEpoch"].as_i64().unwrap(),
        c["maxCatchup"].as_i64().unwrap(),
        &c["proposalsByEpoch"],
    ) {
        Ok(_) => panic!("end-truncated bundle tail must be rejected"),
        Err(e) => assert!(e.contains("does not match the seal"), "reason is the seal, got: {}", e),
    }
}

#[test]
fn s4_seal_less_pre_v2_bundle_is_rejected_on_resume() {
    let c = load_case("boundary");
    let mut sealless = c["bundleA"].clone();
    sealless.as_object_mut().expect("bundle object").remove("seal");
    match resume_case(
        &c,
        &sealless,
        c["expect"]["b"]["currentEpoch"].as_i64().unwrap(),
        c["maxCatchup"].as_i64().unwrap(),
        &c["proposalsByEpoch"],
    ) {
        Ok(_) => panic!("seal-less (pre-v2 format) bundle must be rejected"),
        Err(e) => assert!(e.contains("carries no chain seal"), "reason is the missing seal, got: {}", e),
    }
}

#[test]
fn s4_tail_truncation_with_seal_is_caught_seal_mismatch() {
    let c = load_case("chain_seal");
    let key = c["key"].as_str().unwrap();
    let genesis = c["genesis"].as_str().unwrap();
    let records = parse_records(&c["records"]);
    let truncated = &records[..records.len() - 1];
    let seal = s4_seal(&c);
    let res = EventChain::verify_records_detailed(key.as_bytes(), truncated, genesis, Some(&seal));
    assert!(!res.ok, "seal catches the dropped tail");
    assert!(
        res.mismatches.iter().any(|m| m.reason == MismatchReason::SealMismatch),
        "reason is seal_mismatch"
    );
}

#[test]
fn s4_flipped_recorded_mutation_in_middle_cycle_is_sig_mismatch() {
    let c = load_case("chain_seal");
    let key = c["key"].as_str().unwrap();
    let genesis = c["genesis"].as_str().unwrap();
    let mut tampered = parse_records(&c["records"]);
    // Record 10 (seq 10, epoch 10, second cycle) carries gain_power mutations -
    // flip one recorded `next` without re-signing.
    let entry = &mut tampered[9].payload["actions_processed"][0];
    let muts = entry["mutations_applied"].as_array().map(|a| a.len()).unwrap_or(0);
    assert!(muts > 0, "target record has mutations");
    let next = entry["mutations_applied"][0]["next"].as_i64().expect("recorded next");
    entry["mutations_applied"][0]["next"] = json!(next + 1);
    let res = EventChain::verify_records_detailed(key.as_bytes(), &tampered, genesis, None);
    assert!(!res.ok, "tamper detected");
    assert!(
        res.mismatches
            .iter()
            .any(|m| m.seq == 10 && m.reason == MismatchReason::SigMismatch),
        "sig_mismatch at seq 10"
    );
}

// ---- S5 ----------------------------------------------------------------------

#[test]
fn s5_void_at_scale_resolve_100_of_500() {
    let c = load_case("void");
    let key = c["key"].as_str().unwrap();
    let first = &c["expect"]["first"];
    let r = resume_case(
        &c,
        &c["bundle1"],
        c["first"]["currentEpoch"].as_i64().unwrap(),
        c["first"]["maxCatchup"].as_i64().unwrap(),
        &c["proposalsByEpoch1"],
    )
    .expect("first resume");
    assert_eq!(r.epochs_resolved, first["epochsResolved"].as_i64().unwrap(), "epochsResolved");
    assert_eq!(r.epochs_voided, first["epochsVoided"].as_i64().unwrap(), "epochsVoided");
    assert_eq!(r.state["epoch"].as_i64().unwrap(), first["final_epoch"].as_i64().unwrap(), "final epoch");
    assert_eq!(r.new_events.len() as i64, first["newEvents_count"].as_i64().unwrap(), "event count");
    assert_eq!(hash(key, &Value::Array(r.new_events.clone())), first["events_hash"].as_str().unwrap(), "events hash");
    assert_eq!(hash(key, &r.state), first["final_state_hash"].as_str().unwrap(), "final state hash");
}

#[test]
fn s5_second_resume_across_the_void_boundary_is_deterministic() {
    let c = load_case("void");
    let key = c["key"].as_str().unwrap();
    let world_id = c["worldId"].as_str().unwrap();
    // Re-derive the post-void bundle from the first resume (the live flow), then
    // check it matches the vector's stored bundle2 before resuming across the void.
    let r1 = resume_case(
        &c,
        &c["bundle1"],
        c["first"]["currentEpoch"].as_i64().unwrap(),
        c["first"]["maxCatchup"].as_i64().unwrap(),
        &c["proposalsByEpoch1"],
    )
    .expect("first resume");
    let chain = EventChain::create(key.as_bytes(), c["bundle2"]["tailGenesis"].as_str().unwrap());
    let rebuilt = suspend_bundle(key, world_id, &r1.state, 0, &chain);
    assert_eq!(
        rebuilt["snapshot"]["stateHash"].as_str().unwrap(),
        c["bundle2"]["snapshot"]["stateHash"].as_str().unwrap(),
        "rebuilt bundle matches the stored post-void bundle"
    );
    // Bundle format v2: the Rust suspend's embedded seal byte-matches the seal
    // the TS generator packed into bundle2 - cross-language SEAL parity.
    assert_eq!(rebuilt["seal"], c["bundle2"]["seal"], "rebuilt seal == TS-generated seal");

    let second = &c["expect"]["second"];
    let r2 = resume_case(
        &c,
        &c["bundle2"],
        c["second"]["currentEpoch"].as_i64().unwrap(),
        c["second"]["maxCatchup"].as_i64().unwrap(),
        &c["proposalsByEpoch2"],
    )
    .expect("second resume");
    assert_eq!(r2.epochs_resolved, second["epochsResolved"].as_i64().unwrap(), "epochsResolved");
    assert_eq!(r2.epochs_voided, second["epochsVoided"].as_i64().unwrap(), "epochsVoided");
    assert_eq!(r2.state["epoch"].as_i64().unwrap(), second["final_epoch"].as_i64().unwrap(), "final epoch");
    assert_eq!(r2.new_events.len() as i64, second["newEvents_count"].as_i64().unwrap(), "event count");
    assert_eq!(hash(key, &Value::Array(r2.new_events.clone())), second["events_hash"].as_str().unwrap(), "events hash");
    assert_eq!(hash(key, &r2.state), second["final_state_hash"].as_str().unwrap(), "final state hash");
}
