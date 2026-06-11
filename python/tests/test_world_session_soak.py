"""WorldSession SOAK parity - v3.5 (persistence + partial sync PROVEN, Python).

Re-executes the five long-horizon golden cases from
test_vectors/v3_5_session_soak.json against the pure-Python core, mirroring
tests/world-session-soak.test.ts one-for-one (16 tests):

  S1 - 120-epoch catch-up, run BOTH single-shot and in four 30-epoch chunks,
       pinned byte-identical (catch-up COMPOSABILITY) with 30/60/90 checkpoint
       hashes - long-horizon PRNG/order/accumulation stability.
  S2 - the zero-catch-up resume boundary (currentEpoch == post-tail epoch),
       one epoch across the boundary, MID-CHAIN suspend (snapshotEventIndex 2)
       snapshot-position independence, plus the time-travel rejection.
  S3 - three suspend -> resume -> append-newEvents-to-the-ONE-chain ->
       re-suspend cycles, pinned per cycle (incl. the chain HEAD SIGNATURE -
       the strongest cross-language HMAC-framing pin), equal to one 21-epoch
       resume.
  S4 - the accumulated 21-record chain sealed + verified across the whole gap,
       AND the negative space: bare verify_records (no seal) still cannot see
       tail truncation - the EventChain-level fact that motivated bundle
       format v2, where the WorldBundle CARRIES its ChainSeal and resume()
       verifies it structurally (the old documented hole is CLOSED: an
       end-truncated bundle is now rejected, pinned below against bundleA) -
       WITH the seal truncation is caught (seal_mismatch), and a flipped
       recorded mutation is a sig_mismatch.
  S5 - void-at-scale (100 of 500 resolved, 400 voided) and a deterministic
       SECOND resume across the void boundary.
"""

import copy
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.event_chain import EventChain, verify_records, verify_seal  # noqa: E402
from loom_engine.world_epoch import catch_up_epochs  # noqa: E402
from loom_engine.world_session import resume, suspend  # noqa: E402
from loom_engine.world_snapshot import world_state_hash  # noqa: E402

_VECTOR = os.path.join(
    os.path.dirname(__file__), "..", "..", "test_vectors", "v3_5_session_soak.json"
)


def _vec():
    with open(_VECTOR, encoding="utf-8") as f:
        return json.load(f)


def _by_kind(v, kind):
    for c in v["cases"]:
        if c["kind"] == kind:
            return c
    raise AssertionError("soak vector case missing: " + kind)


# ---- S1 ----------------------------------------------------------------------

def test_s1_single_shot_catchup():
    c = _by_kind(_vec(), "soak_catchup")
    r = catch_up_epochs(c["worldId"], c["state"], c["currentEpoch"], c["maxCatchup"],
                        c["ruleset"], proposals_by_epoch=c["proposalsByEpoch"],
                        actor_tags=c["actorTags"])
    exp = c["expect"]
    assert r["epochs_resolved"] == exp["epochsResolved"], "epochsResolved"
    assert r["epochs_voided"] == exp["epochsVoided"], "epochsVoided"
    assert r["state"]["epoch"] == exp["final_epoch"], "final epoch"
    assert len(r["events"]) == exp["newEvents_count"], "event count"
    assert world_state_hash(c["key"], r["events"]) == exp["events_hash"], "events hash"
    assert world_state_hash(c["key"], r["state"]) == exp["final_state_hash"], "final state hash"


def test_s1_chunked_catchup_equals_single_shot():
    c = _by_kind(_vec(), "soak_catchup")
    exp = c["expect"]
    assert exp["chunked_equals_single"] is True, "generator pinned composability"
    work = c["state"]
    all_events = []
    for stop in c["chunk_stops"]:
        r = catch_up_epochs(c["worldId"], work, stop, c["maxCatchup"], c["ruleset"],
                            proposals_by_epoch=c["proposalsByEpoch"],
                            actor_tags=c["actorTags"])
        work = r["state"]
        all_events.extend(r["events"])
        assert world_state_hash(c["key"], work) == \
            exp["checkpoint_state_hashes"][str(stop)], "checkpoint hash @ epoch %s" % stop
    assert world_state_hash(c["key"], work) == exp["final_state_hash"], \
        "chunked final == single-shot final"
    assert world_state_hash(c["key"], all_events) == exp["events_hash"], \
        "chunked events == single-shot events"
    assert len(all_events) == exp["newEvents_count"], "chunked event count"


# ---- S2 ----------------------------------------------------------------------

def test_s2_zero_catchup_boundary():
    c = _by_kind(_vec(), "boundary")
    a = c["expect"]["a"]
    r = resume(c["key"], c["bundleA"], a["currentEpoch"], c["ruleset"], c["maxCatchup"],
               proposals_by_epoch=c["proposalsByEpoch"], actor_tags=c["actorTags"])
    assert r["epochs_resolved"] == a["epochsResolved"], "epochsResolved"
    assert r["epochs_voided"] == a["epochsVoided"], "epochsVoided"
    assert len(r["new_events"]) == a["newEvents_count"], "no new events"
    assert world_state_hash(c["key"], r["state"]) == a["resumed_state_hash"], "resumed hash"
    # The tail-replayed resume lands EXACTLY on the live epoch-13 state hash.
    assert a["resumed_state_hash"] == c["expect"]["live_epoch13_state_hash"], "resumed == live"


def test_s2_one_epoch_across_boundary():
    c = _by_kind(_vec(), "boundary")
    b = c["expect"]["b"]
    r = resume(c["key"], c["bundleA"], b["currentEpoch"], c["ruleset"], c["maxCatchup"],
               proposals_by_epoch=c["proposalsByEpoch"], actor_tags=c["actorTags"])
    assert r["epochs_resolved"] == b["epochsResolved"], "epochsResolved"
    assert r["state"]["epoch"] == b["final_epoch"], "final epoch"
    assert world_state_hash(c["key"], r["state"]) == b["final_state_hash"], "final hash"


def test_s2_mid_chain_suspend_position_independent():
    c = _by_kind(_vec(), "boundary")
    ec = c["expect"]["c"]
    assert len(c["bundleC"]["chainTail"]) == ec["tail_length"], "mid-chain tail length"
    assert c["bundleC"]["snapshot"]["eventIndex"] == 2, "snapshot taken mid-chain"
    r = resume(c["key"], c["bundleC"], ec["currentEpoch"], c["ruleset"], c["maxCatchup"],
               proposals_by_epoch=c["proposalsByEpoch"], actor_tags=c["actorTags"])
    assert world_state_hash(c["key"], r["state"]) == ec["final_state_hash"], \
        "mid-chain resume hash"
    # The SAME final hash as bundle A (suspend at index 0): where the snapshot
    # was taken along the chain does not change the resumed world.
    assert ec["final_state_hash"] == c["expect"]["b"]["final_state_hash"], "C == B"
    assert ec["snapshot_position_independent"] is True, "pinned independence"


def test_s2_time_travel_rejected():
    c = _by_kind(_vec(), "boundary")
    # After replaying bundle A's 3-event tail the world is at epoch 13; a clock
    # at 12 must raise AFTER tail replay (the guard runs post-reduce).
    raised = None
    try:
        resume(c["key"], c["bundleA"], 12, c["ruleset"], c["maxCatchup"],
               proposals_by_epoch=c["proposalsByEpoch"], actor_tags=c["actorTags"])
    except ValueError as e:
        raised = str(e)
    assert raised is not None and "time travel" in raised, "expected time-travel rejection"


# ---- S3 ----------------------------------------------------------------------

def test_s3_three_cycles_on_one_chain():
    c = _by_kind(_vec(), "cycles")
    chain = EventChain.create(key=c["key"], genesis=c["genesis"])
    bundle = c["bundle0"]
    for k in range(c["cycle_count"]):
        exp = c["expect"]["cycles"][k]
        r = resume(c["key"], bundle, exp["currentEpoch"], c["ruleset"], c["maxCatchup"],
                   proposals_by_epoch=c["proposalsByEpoch"], actor_tags=c["actorTags"])
        assert r["epochs_resolved"] == exp["epochsResolved"], "cycle %d resolved" % k
        assert r["epochs_voided"] == exp["epochsVoided"], "cycle %d voided" % k
        # The composed flow the audit flagged: every resume new_event goes BACK
        # onto the persistent chain before the world re-suspends.
        for e, ev in enumerate(r["new_events"]):
            rec = chain.append("EpochResolved", ev)
            assert rec is not None, "cycle %d event %d appended" % (k, e)
        assert world_state_hash(c["key"], r["state"]) == exp["state_hash"], \
            "cycle %d state hash" % k
        assert chain.size() == exp["chain_record_count"], "cycle %d chain count" % k
        assert chain.head() == exp["chain_head_sig"], "cycle %d chain head" % k
        bundle = suspend(c["key"], c["worldId"], r["state"], chain.size(), chain)
        assert len(bundle["chainTail"]) == 0, "cycle %d re-suspend has a current snapshot" % k
    assert c["expect"]["cycles"][c["cycle_count"] - 1]["state_hash"] == \
        c["expect"]["final_state_hash"], "last cycle == final"


def test_s3_one_shot_resume_equals_cycles():
    c = _by_kind(_vec(), "cycles")
    assert c["expect"]["one_shot_equals_cycles"] is True, "generator pinned equivalence"
    r = resume(c["key"], c["bundle0"], c["expect"]["final_epoch"], c["ruleset"],
               c["one_shot_maxCatchup"], proposals_by_epoch=c["proposalsByEpoch"],
               actor_tags=c["actorTags"])
    assert r["epochs_resolved"] == 21, "all 21 resolved"
    assert r["state"]["epoch"] == c["expect"]["final_epoch"], "final epoch"
    assert world_state_hash(c["key"], r["state"]) == c["expect"]["final_state_hash"], \
        "one-shot final hash"


# ---- S4 ----------------------------------------------------------------------

def test_s4_sealed_chain_verifies_across_the_gap():
    c = _by_kind(_vec(), "chain_seal")
    exp = c["expect"]
    assert len(c["records"]) == exp["seal_count"], "record count"
    assert world_state_hash(c["key"], c["records"]) == exp["records_hash"], "records hash"
    seal = {"count": exp["seal_count"], "head": exp["seal_head"], "sig": exp["seal_sig"]}
    assert verify_seal(c["key"], seal) is True, "seal self-verifies"
    res = verify_records(c["key"], c["records"], c["genesis"], seal)
    assert res["ok"] == exp["full_chain_verify_ok"], "full chain + seal verify"
    assert res["total"] == exp["seal_count"], "verified total"
    # The seal head IS the last record's signature.
    assert exp["seal_head"] == c["records"][-1]["sig"], "seal head == chain head"


def test_s4_truncation_without_seal_verifies_clean():
    c = _by_kind(_vec(), "chain_seal")
    truncated = copy.deepcopy(c["records"])[:-1]
    # verify_records alone CANNOT see records dropped off the END - the
    # EventChain-level fact that motivated bundle format v2. The WorldBundle
    # now CARRIES a ChainSeal and resume() verifies it fail-closed, so the old
    # documented hole (resume() silently accepting a tail-truncated bundle and
    # replacing recorded history with re-simulated catch-up) is CLOSED - see
    # the structural-seal rejection test below.
    res = verify_records(c["key"], truncated, c["genesis"])
    assert res["ok"] is True, "truncated tail verifies clean without a seal"
    assert res["total"] == len(c["records"]) - 1, "one record silently gone"


def test_s4_end_truncated_bundle_rejected_by_structural_seal():
    # The hole is closed structurally: bundleA (3-record tail) loses its
    # trailing record; resume() must reject it via the bundle's embedded seal
    # instead of silently re-simulating the dropped epoch.
    c = _by_kind(_vec(), "boundary")
    truncated = copy.deepcopy(c["bundleA"])
    truncated["chainTail"] = truncated["chainTail"][:-1]
    raised = None
    try:
        resume(c["key"], truncated, c["expect"]["b"]["currentEpoch"], c["ruleset"],
               c["maxCatchup"], proposals_by_epoch=c["proposalsByEpoch"],
               actor_tags=c["actorTags"])
    except ValueError as e:
        raised = str(e)
    assert raised is not None and "does not match the seal" in raised, \
        "expected structural-seal rejection, got %r" % raised


def test_s4_sealless_pre_v2_bundle_rejected():
    c = _by_kind(_vec(), "boundary")
    sealless = copy.deepcopy(c["bundleA"])
    del sealless["seal"]
    raised = None
    try:
        resume(c["key"], sealless, c["expect"]["b"]["currentEpoch"], c["ruleset"],
               c["maxCatchup"], proposals_by_epoch=c["proposalsByEpoch"],
               actor_tags=c["actorTags"])
    except ValueError as e:
        raised = str(e)
    assert raised is not None and "carries no chain seal" in raised, \
        "expected pre-v2 format rejection, got %r" % raised


def test_s4_truncation_with_seal_is_caught():
    c = _by_kind(_vec(), "chain_seal")
    exp = c["expect"]
    truncated = copy.deepcopy(c["records"])[:-1]
    seal = {"count": exp["seal_count"], "head": exp["seal_head"], "sig": exp["seal_sig"]}
    res = verify_records(c["key"], truncated, c["genesis"], seal)
    assert res["ok"] is False, "seal catches the dropped tail"
    reasons = [m["reason"] for m in res["mismatches"]]
    assert "seal_mismatch" in reasons, "reason is seal_mismatch"


def test_s4_flipped_mutation_is_sig_mismatch():
    c = _by_kind(_vec(), "chain_seal")
    tampered = copy.deepcopy(c["records"])
    # Record 10 (seq 10, epoch 10, second cycle) carries gain_power mutations -
    # flip one recorded `next` without re-signing.
    entry = tampered[9]["payload"]["actions_processed"][0]
    muts = entry.get("mutations_applied")
    assert isinstance(muts, list) and len(muts) > 0, "target record has mutations"
    muts[0]["next"] = muts[0]["next"] + 1
    res = verify_records(c["key"], tampered, c["genesis"])
    assert res["ok"] is False, "tamper detected"
    hit = False
    for m in res["mismatches"]:
        if m["seq"] == 10 and m["reason"] == "sig_mismatch":
            hit = True
    assert hit, "sig_mismatch at seq 10"


# ---- S5 ----------------------------------------------------------------------

def test_s5_void_at_scale():
    c = _by_kind(_vec(), "void")
    exp = c["expect"]["first"]
    r = resume(c["key"], c["bundle1"], c["first"]["currentEpoch"], c["ruleset"],
               c["first"]["maxCatchup"], proposals_by_epoch=c["proposalsByEpoch1"],
               actor_tags=c["actorTags"])
    assert r["epochs_resolved"] == exp["epochsResolved"], "epochsResolved"
    assert r["epochs_voided"] == exp["epochsVoided"], "epochsVoided"
    assert r["state"]["epoch"] == exp["final_epoch"], "final epoch"
    assert len(r["new_events"]) == exp["newEvents_count"], "event count"
    assert world_state_hash(c["key"], r["new_events"]) == exp["events_hash"], "events hash"
    assert world_state_hash(c["key"], r["state"]) == exp["final_state_hash"], "final state hash"


def test_s5_second_resume_across_the_void():
    c = _by_kind(_vec(), "void")
    # Re-derive the post-void bundle from the first resume (the live flow), then
    # check it matches the vector's stored bundle2 before resuming across the void.
    r1 = resume(c["key"], c["bundle1"], c["first"]["currentEpoch"], c["ruleset"],
                c["first"]["maxCatchup"], proposals_by_epoch=c["proposalsByEpoch1"],
                actor_tags=c["actorTags"])
    chain = EventChain.create(key=c["key"], genesis=c["bundle2"]["tailGenesis"])
    rebuilt = suspend(c["key"], c["worldId"], r1["state"], 0, chain)
    assert rebuilt["snapshot"]["stateHash"] == c["bundle2"]["snapshot"]["stateHash"], \
        "rebuilt bundle matches the stored post-void bundle"

    exp = c["expect"]["second"]
    r2 = resume(c["key"], c["bundle2"], c["second"]["currentEpoch"], c["ruleset"],
                c["second"]["maxCatchup"], proposals_by_epoch=c["proposalsByEpoch2"],
                actor_tags=c["actorTags"])
    assert r2["epochs_resolved"] == exp["epochsResolved"], "epochsResolved"
    assert r2["epochs_voided"] == exp["epochsVoided"], "epochsVoided"
    assert r2["state"]["epoch"] == exp["final_epoch"], "final epoch"
    assert len(r2["new_events"]) == exp["newEvents_count"], "event count"
    assert world_state_hash(c["key"], r2["new_events"]) == exp["events_hash"], "events hash"
    assert world_state_hash(c["key"], r2["state"]) == exp["final_state_hash"], "final state hash"


if __name__ == "__main__":
    test_s1_single_shot_catchup()
    test_s1_chunked_catchup_equals_single_shot()
    test_s2_zero_catchup_boundary()
    test_s2_one_epoch_across_boundary()
    test_s2_mid_chain_suspend_position_independent()
    test_s2_time_travel_rejected()
    test_s3_three_cycles_on_one_chain()
    test_s3_one_shot_resume_equals_cycles()
    test_s4_sealed_chain_verifies_across_the_gap()
    test_s4_truncation_without_seal_verifies_clean()
    test_s4_end_truncated_bundle_rejected_by_structural_seal()
    test_s4_sealless_pre_v2_bundle_rejected()
    test_s4_truncation_with_seal_is_caught()
    test_s4_flipped_mutation_is_sig_mismatch()
    test_s5_void_at_scale()
    test_s5_second_resume_across_the_void()
    print("world_session SOAK Python parity: all 16 tests pass")
