"""Plaza-persistent parity - v6.1 (persistence + partial sync, end to end, Python).

Re-drives the ENTIRE demo/plaza-persistent scenario headlessly from the
canonical vector (test_vectors/v6_1_plaza_persistent.json) against the
pure-Python core, mirroring tests/plaza-persistent.test.ts: build, live epochs
on the HMAC chain, suspend (the bundle carries its STRUCTURAL seal, bundle
format v2), resume (verify + replay + 12 offline epochs), partition, leaves,
diff_region_leaves, apply_partial_sync - and asserts every pinned stage hash.

Also asserts the whole run is deterministic (driven twice in-process,
byte-identical) and the fail-closed negative paths: corrupted snapshot,
tampered tail, TRUNCATED tail caught by the seal (a bare hash chain cannot see
truncation), the end-truncated / seal-less bundle rejections on resume, a
tampered seal, a tampered pulled region, and a stale cached region caught by
the root recompute."""

import copy
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.event_chain import (  # noqa: E402
    EventChain, canonical_json, verify_records, verify_seal,
)
from loom_engine.world_epoch import tick_epoch  # noqa: E402
from loom_engine.world_session import resume, suspend, replay_epoch_event  # noqa: E402
from loom_engine.world_snapshot import world_state_hash  # noqa: E402
from loom_engine.region_hash import region_leaves, global_region_hash  # noqa: E402
from loom_engine.region_sync import (  # noqa: E402
    partition_regions, diff_region_leaves, apply_partial_sync,
)

_VECTOR = os.path.join(
    os.path.dirname(__file__), "..", "..", "test_vectors", "v6_1_plaza_persistent.json"
)

with open(_VECTOR, encoding="utf-8") as _f:
    VEC = json.load(_f)


def _utf8_bytes(s):
    return len(s.encode("utf-8"))


def run_scenario():
    """Drive the full scenario once from the vector's literal inputs. Returns
    every stage product so the tests can pin each one."""
    i = VEC["inputs"]

    # (1) BUILD
    s0 = json.loads(json.dumps(i["s0"]))

    # (2) LIVE PLAY - epochs 1..2 onto the HMAC chain.
    t1 = tick_epoch(i["worldId"], s0, 1, i["liveProposalsByEpoch"]["1"],
                    i["ruleset"], actor_tags=i["actorTags"])
    t2 = tick_epoch(i["worldId"], t1["state"], 2, i["liveProposalsByEpoch"]["2"],
                    i["ruleset"], actor_tags=i["actorTags"])
    chain = EventChain.create(key=i["key"], genesis=i["genesis"])
    rec1 = chain.append("EpochResolved", t1["event"])
    rec2 = chain.append("EpochResolved", t2["event"])

    # (3) SUSPEND - bundle format v2: the bundle CARRIES its seal structurally.
    bundle = suspend(i["key"], i["worldId"], s0, i["snapshotEventIndex"], chain)
    seal = bundle["seal"]

    # (4) RESUME.
    post_tail = replay_epoch_event(replay_epoch_event(s0, t1["event"]), t2["event"])
    r = resume(i["key"], bundle, i["currentEpoch"], i["ruleset"], i["maxCatchup"],
               proposals_by_epoch=i["offlineProposalsByEpoch"], actor_tags=i["actorTags"])

    # (5) PARTIAL SYNC - server = resumed state, client cache = pre-suspend state.
    server_regions = partition_regions(r["state"], i["regionTagPrefix"])
    client_regions = partition_regions(t2["state"], i["regionTagPrefix"])
    server_leaves = region_leaves(i["key"], server_regions)
    server_root = global_region_hash(i["key"], server_regions)
    client_leaves = region_leaves(i["key"], client_regions)
    diff = diff_region_leaves(client_leaves, server_leaves)
    pulled_regions = {}
    for rid in diff["changed"]:
        pulled_regions[rid] = server_regions[rid]
    synced = apply_partial_sync(i["key"], client_regions, pulled_regions,
                                server_leaves, server_root)

    return {
        "s0": s0, "t1": t1, "t2": t2, "rec1": rec1, "rec2": rec2,
        "chain_head": chain.head(), "bundle": bundle, "seal": seal,
        "post_tail": post_tail, "r": r,
        "server_regions": server_regions, "client_regions": client_regions,
        "server_leaves": server_leaves, "server_root": server_root,
        "client_leaves": client_leaves, "diff": diff,
        "pulled_regions": pulled_regions, "synced": synced,
    }


RUN = run_scenario()


def test_build_s0_hash_and_snapshot_commitment():
    assert world_state_hash(VEC["inputs"]["key"], RUN["s0"]) == VEC["expect"]["s0_hash"], \
        "s0 hash"
    assert RUN["bundle"]["snapshot"]["stateHash"] == \
        VEC["expect"]["suspend"]["snapshot_state_hash"], "bundle snapshot hash"
    assert RUN["bundle"]["snapshot"]["stateHash"] == VEC["expect"]["s0_hash"], \
        "snapshot commits to S0"


def test_live_play_events_and_chain_records():
    i = VEC["inputs"]
    assert RUN["rec1"] is not None and RUN["rec2"] is not None, \
        "both events accepted by the chain"
    assert [world_state_hash(i["key"], RUN["t1"]["event"]),
            world_state_hash(i["key"], RUN["t2"]["event"])] == \
        VEC["expect"]["live"]["event_hashes"], "event hashes"
    assert [RUN["rec1"]["sig"], RUN["rec2"]["sig"]] == \
        VEC["expect"]["live"]["record_sigs"], "record sigs"
    assert RUN["chain_head"] == VEC["expect"]["live"]["chain_head"], "chain head"
    assert RUN["t2"]["state"]["epoch"] == VEC["expect"]["live"]["post_live_epoch"], \
        "post-live epoch"
    assert world_state_hash(i["key"], RUN["t2"]["state"]) == \
        VEC["expect"]["live"]["post_live_state_hash"], "post-live state hash"


def test_suspend_tail_genesis_and_structural_seal():
    i = VEC["inputs"]
    exp = VEC["expect"]["suspend"]
    assert len(RUN["bundle"]["chainTail"]) == exp["tail_length"], "tail length"
    assert RUN["bundle"]["tailGenesis"] == exp["tail_genesis"], "tail genesis"
    assert RUN["bundle"]["tailGenesis"] == i["genesis"], \
        "snapshot @ 0 anchors the tail at the genesis"
    # Bundle format v2: the seal is INSIDE the bundle (suspend embeds chain.seal()).
    assert RUN["bundle"]["seal"] == exp["seal"], \
        "pinned structural seal (count, head, sig)"
    assert RUN["seal"] == RUN["bundle"]["seal"], \
        "the scenario uses the embedded seal, not an external one"
    res = verify_records(i["key"], RUN["bundle"]["chainTail"],
                         RUN["bundle"]["tailGenesis"], RUN["bundle"]["seal"])
    assert res["ok"] is True, "tail HMAC + linkage + seal commitment verify"
    assert exp["tail_verify_ok"] is True, "pinned"


def test_resume_replay_and_offline_catchup():
    i = VEC["inputs"]
    exp = VEC["expect"]["resume"]
    post_tail_hash = world_state_hash(i["key"], RUN["post_tail"])
    assert post_tail_hash == exp["post_tail_state_hash"], "post-tail hash"
    assert post_tail_hash == VEC["expect"]["live"]["post_live_state_hash"], \
        "reducer reconstructs the live state"
    assert exp["reducer_equals_live"] is True, "pinned"
    assert RUN["r"]["state"]["epoch"] == exp["final_epoch"], "final epoch 14"
    assert RUN["r"]["epochs_resolved"] == exp["epochs_resolved"], "12 resolved"
    assert RUN["r"]["epochs_voided"] == exp["epochs_voided"], "0 voided"
    assert len(RUN["r"]["new_events"]) == exp["new_events_count"], "12 new events"
    assert world_state_hash(i["key"], RUN["r"]["new_events"]) == \
        exp["new_events_hash"], "new events hash"
    assert world_state_hash(i["key"], RUN["r"]["state"]) == \
        exp["final_state_hash"], "final state hash"


def test_partial_sync_leaves_root_diff_and_bytes():
    exp = VEC["expect"]["partial_sync"]
    assert RUN["client_leaves"] == exp["client_leaves"], "client leaves"
    assert RUN["server_leaves"] == exp["server_leaves"], "server leaves"
    assert RUN["server_root"] == exp["server_root"], "server root"
    assert RUN["diff"] == exp["diff"], "pinned diff"
    assert RUN["diff"]["changed"] == ["east", "south"], \
        "exactly the 2 offline-touched regions"
    assert RUN["synced"]["pulled"] == exp["pulled"], "pulled set"
    assert RUN["synced"]["kept"] == exp["kept"], "kept set"
    assert RUN["synced"]["root"] == RUN["server_root"], \
        "recombined root equals the server root"
    assert RUN["synced"]["regions"] == RUN["server_regions"], \
        "recombined regions ARE the server regions"
    assert exp["merged_root_equals_server_root"] is True, "pinned"
    bytes_pulled = 0
    bytes_full = 0
    for rid in RUN["server_regions"].keys():
        size = _utf8_bytes(canonical_json(RUN["server_regions"][rid]))
        bytes_full = bytes_full + size
        if rid in RUN["diff"]["changed"]:
            bytes_pulled = bytes_pulled + size
    assert bytes_pulled == exp["bytes_pulled"], "bytes pulled"
    assert bytes_full == exp["bytes_full"], "bytes full"
    assert bytes_pulled < bytes_full, "partial sync is cheaper than a full sync"


def test_determinism_run_twice_byte_identical():
    again = run_scenario()
    assert json.dumps(again, sort_keys=True) == json.dumps(RUN, sort_keys=True), \
        "run 2 == run 1, byte for byte"


def _expect_raises(fn, needle, label):
    raised = None
    try:
        fn()
    except ValueError as e:
        raised = str(e)
    assert raised is not None, label + ": expected ValueError"
    assert needle in raised, label + ": message %r lacks %r" % (raised, needle)


def _resume_bundle(bundle):
    i = VEC["inputs"]
    return resume(i["key"], bundle, i["currentEpoch"], i["ruleset"], i["maxCatchup"],
                  proposals_by_epoch=i["offlineProposalsByEpoch"],
                  actor_tags=i["actorTags"])


def test_fail_closed_corrupted_snapshot():
    tampered = copy.deepcopy(RUN["bundle"])
    tampered["snapshot"]["state"]["entities"]["trader_selm"]["properties"]["gold"] = 9999
    _expect_raises(lambda: _resume_bundle(tampered), "corrupted snapshot",
                   "corrupted snapshot")


def test_fail_closed_tampered_chain_tail():
    tampered = copy.deepcopy(RUN["bundle"])
    tampered["chainTail"][0]["payload"]["epoch_number"] = 999
    _expect_raises(lambda: _resume_bundle(tampered), "chain tamper", "tampered tail")


def test_fail_closed_truncated_tail_caught_by_seal_at_chain_level():
    i = VEC["inputs"]
    truncated = RUN["bundle"]["chainTail"][:1]
    bare = verify_records(i["key"], truncated, RUN["bundle"]["tailGenesis"])
    assert bare["ok"] is True, \
        "the truncation hole: a bare hash chain cannot see a cut tail"
    assert VEC["expect"]["suspend"]["truncated_tail_passes_without_seal"] is True, "pinned"
    sealed = verify_records(i["key"], truncated, RUN["bundle"]["tailGenesis"],
                            RUN["bundle"]["seal"])
    assert sealed["ok"] is False, "the seal closes it"
    assert any(m["reason"] == "seal_mismatch" for m in sealed["mismatches"]), \
        "seal_mismatch reported"
    assert VEC["expect"]["suspend"]["truncated_tail_fails_with_seal"] is True, "pinned"


def test_fail_closed_end_truncated_bundle_rejected_by_structural_seal():
    # Bundle format v2: the seal travels INSIDE the bundle, so resume() itself
    # rejects the cut tail - no external seal bookkeeping required.
    tampered = copy.deepcopy(RUN["bundle"])
    tampered["chainTail"] = tampered["chainTail"][:1]
    _expect_raises(lambda: _resume_bundle(tampered), "does not match the seal",
                   "end-truncated bundle")


def test_fail_closed_sealless_pre_v2_bundle_rejected():
    sealless = copy.deepcopy(RUN["bundle"])
    del sealless["seal"]
    _expect_raises(lambda: _resume_bundle(sealless), "carries no chain seal",
                   "seal-less (pre-v2 format) bundle")


def test_fail_closed_tampered_seal():
    i = VEC["inputs"]
    sig = RUN["seal"]["sig"]
    forged_sig = {"count": RUN["seal"]["count"], "head": RUN["seal"]["head"],
                  "sig": sig[:-2] + ("11" if sig[-2:] == "00" else "00")}
    assert verify_seal(i["key"], forged_sig) is False, "forged sig fails verify_seal"
    forged_count = {"count": RUN["seal"]["count"] + 1, "head": RUN["seal"]["head"],
                    "sig": RUN["seal"]["sig"]}
    res = verify_records(i["key"], RUN["bundle"]["chainTail"],
                         RUN["bundle"]["tailGenesis"], forged_count)
    assert res["ok"] is False, \
        "a seal whose count was edited no longer carries a valid signature"


def test_fail_closed_tampered_pulled_region():
    i = VEC["inputs"]
    tampered_pull = copy.deepcopy(RUN["pulled_regions"])
    tampered_pull["east"]["entities"]["farmer_edda"]["properties"]["gold"] = 9999
    _expect_raises(
        lambda: apply_partial_sync(i["key"], RUN["client_regions"], tampered_pull,
                                   RUN["server_leaves"], RUN["server_root"]),
        "failed leaf verification", "tampered pulled region")


def test_fail_closed_stale_kept_cached_region_caught_by_root():
    i = VEC["inputs"]
    stale_cache = copy.deepcopy(RUN["client_regions"])
    stale_cache["north"]["entities"]["guard_norri"]["properties"]["gold"] = 777
    _expect_raises(
        lambda: apply_partial_sync(i["key"], stale_cache, RUN["pulled_regions"],
                                   RUN["server_leaves"], RUN["server_root"]),
        "root does not match", "stale kept cached region")


def test_fail_closed_region_neither_pulled_nor_cached():
    i = VEC["inputs"]
    partial_cache = copy.deepcopy(RUN["client_regions"])
    del partial_cache["west"]
    _expect_raises(
        lambda: apply_partial_sync(i["key"], partial_cache, RUN["pulled_regions"],
                                   RUN["server_leaves"], RUN["server_root"]),
        "neither pulled nor cached", "region neither pulled nor cached")


if __name__ == "__main__":
    test_build_s0_hash_and_snapshot_commitment()
    test_live_play_events_and_chain_records()
    test_suspend_tail_genesis_and_structural_seal()
    test_resume_replay_and_offline_catchup()
    test_partial_sync_leaves_root_diff_and_bytes()
    test_determinism_run_twice_byte_identical()
    test_fail_closed_corrupted_snapshot()
    test_fail_closed_tampered_chain_tail()
    test_fail_closed_truncated_tail_caught_by_seal_at_chain_level()
    test_fail_closed_end_truncated_bundle_rejected_by_structural_seal()
    test_fail_closed_sealless_pre_v2_bundle_rejected()
    test_fail_closed_tampered_seal()
    test_fail_closed_tampered_pulled_region()
    test_fail_closed_stale_kept_cached_region_caught_by_root()
    test_fail_closed_region_neither_pulled_nor_cached()
    print("plaza_persistent Python parity: all 15 tests pass")
