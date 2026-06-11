"""Cross-language parity: the Python WorldSession suspend/resume lifecycle must
reproduce the TS-generated golden vector (test_vectors/v3_4_world_session.json)
byte-for-byte - the verified-snapshot load, the HMAC tail verify, the
recorded-mutation reducer (pinned via the intermediate post-tail hash), the
bounded catch-up, and the final state/events hashes - AND fail closed on a
corrupted snapshot, a tampered tail, and time travel."""

import copy
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.event_chain import EventChain  # noqa: E402
from loom_engine.world_session import resume, suspend, replay_epoch_event  # noqa: E402
from loom_engine.world_snapshot import world_state_hash  # noqa: E402

_VECTOR = os.path.join(
    os.path.dirname(__file__), "..", "..", "test_vectors", "v3_4_world_session.json"
)


def _vec():
    with open(_VECTOR, encoding="utf-8") as f:
        return json.load(f)


def _do_resume(v, bundle, current_epoch):
    i = v["inputs"]
    return resume(i["key"], bundle, current_epoch, i["ruleset"], i["maxCatchup"],
                  proposals_by_epoch=i["proposalsByEpoch"], actor_tags=i["actorTags"])


def test_golden_vector_resume_pipeline():
    v = _vec()
    i = v["inputs"]
    exp = v["expect"]
    r = _do_resume(v, i["bundle"], i["currentEpoch"])
    assert r["state"]["epoch"] == exp["final_epoch"], "final epoch"
    assert r["epochs_resolved"] == exp["epochsResolved"], "epochsResolved"
    assert r["epochs_voided"] == exp["epochsVoided"], "epochsVoided"
    assert len(r["new_events"]) == exp["newEvents_count"], "newEvents count"
    assert world_state_hash(i["key"], r["state"]) == exp["final_state_hash"], "final state hash"
    assert world_state_hash(i["key"], r["new_events"]) == exp["newEvents_hash"], "newEvents hash"
    assert exp["tail_reducer_equals_tick"] is True, "reducer reconstructs tick_epoch output"


def test_reducer_reproduces_post_tail_hash():
    # Replay the bundle's tail with the reducer alone and pin the INTERMEDIATE
    # (post-tail, pre-catch-up) state hash the generator recorded.
    v = _vec()
    i = v["inputs"]
    work = json.loads(json.dumps(i["bundle"]["snapshot"]["state"]))
    for rec in i["bundle"]["chainTail"]:
        work = replay_epoch_event(work, rec["payload"])
    assert world_state_hash(i["key"], work) == v["expect"]["intermediate_state_hash_post_tail"], \
        "post-tail reducer hash"


def _expect_raises(fn, needle, label):
    raised = None
    try:
        fn()
    except ValueError as e:
        raised = str(e)
    assert raised is not None, label + ": expected ValueError"
    assert needle in raised, label + ": message %r lacks %r" % (raised, needle)


def test_fail_closed_corrupted_snapshot():
    v = _vec()
    tampered = copy.deepcopy(v["inputs"]["bundle"])
    tampered["snapshot"]["state"]["entities"]["faction_1"]["properties"]["power"] = 999
    _expect_raises(lambda: _do_resume(v, tampered, v["inputs"]["currentEpoch"]),
                   "corrupted snapshot", "corrupted snapshot")


def test_fail_closed_tampered_tail():
    v = _vec()
    tampered = copy.deepcopy(v["inputs"]["bundle"])
    # mutate the signed event payload without re-signing -> sig mismatch
    tampered["chainTail"][0]["payload"]["epoch_number"] = 999
    _expect_raises(lambda: _do_resume(v, tampered, v["inputs"]["currentEpoch"]),
                   "chain tamper", "tampered tail")


def test_fail_closed_time_travel():
    v = _vec()
    # after replaying the tail the world is past epoch 0; a clock at 0 is time-travel
    _expect_raises(lambda: _do_resume(v, v["inputs"]["bundle"], 0),
                   "time travel", "time travel")


def test_no_tail_resume_catches_up():
    v = _vec()
    i = v["inputs"]
    state = {"epoch": 2, "worldSeed": 0,
             "entities": {"faction_1": {"properties": {"power": 0}, "tags": ["faction"]}}}
    chain = EventChain.create(key=i["key"], genesis="g")  # empty chain -> empty tail
    bundle = suspend(i["key"], "w", state, 0, chain)
    assert len(bundle["chainTail"]) == 0, "no tail"
    r = resume(i["key"], bundle, 4, i["ruleset"], 10,
               proposals_by_epoch={"3": {"faction_1": {"actionId": "rest"}},
                                   "4": {"faction_1": {"actionId": "rest"}}},
               actor_tags=["faction"])
    assert r["epochs_resolved"] == 2, "caught up 2 epochs"
    assert r["epochs_voided"] == 0, "none voided"
    assert r["state"]["epoch"] == 4, "advanced to clock"


if __name__ == "__main__":
    test_golden_vector_resume_pipeline()
    test_reducer_reproduces_post_tail_hash()
    test_fail_closed_corrupted_snapshot()
    test_fail_closed_tampered_tail()
    test_fail_closed_time_travel()
    test_no_tail_resume_catches_up()
    print("world_session Python parity: all 6 tests pass")
