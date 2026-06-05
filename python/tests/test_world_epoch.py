"""Cross-language parity: the Python Epoch world-tick must reproduce the
TS-generated golden vector (test_vectors/v3_3_epoch_tick.json) byte-for-byte -
the epoch seed (state/inc), the listed actors, pcg_steps_consumed, resolved/
rejected counts, the EpochResolved event(s) and the resulting world-state +
events hashes, across all 7 cases (single-tick, reject-mid-list zero-prng, the
invalid check action, the max-actions Veil-Ceiling cap, numeric-id ordering,
catch-up resolve-all, and catch-up void)."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.world_epoch import (  # noqa: E402
    tick_epoch, catch_up_epochs, derive_epoch_prng,
)
from loom_engine.world_snapshot import world_state_hash  # noqa: E402

_VECTOR = os.path.join(
    os.path.dirname(__file__), "..", "..", "test_vectors", "v3_3_epoch_tick.json"
)


def _vec():
    with open(_VECTOR, encoding="utf-8") as f:
        return json.load(f)


def _listed_actors(event):
    return [e["actor_id"] for e in event["actions_processed"]]


def _assert_seed(c, label):
    # The epoch PRNG state/inc must match SHA-256(world_id || LE64(epoch)) exactly.
    prng = derive_epoch_prng(c["worldId"], c["epochNumber"])
    snap = prng.snapshot()  # (state, inc, draws)
    assert format(snap[0], "016x") == c["expect"]["seed_state_hex"], label + " seed_state"
    assert format(snap[1], "016x") == c["expect"]["seed_inc_hex"], label + " seed_inc"


def test_golden_vector_byte_parity():
    v = _vec()
    cases = v["cases"]
    assert len(cases) == 7, "expected exactly 7 golden cases, got %d" % len(cases)
    passed = 0
    for c in cases:
        label = c["label"]
        key = c["key"]
        exp = c["expect"]
        if c["kind"] == "tick":
            _assert_seed(c, label)
            r = tick_epoch(
                c["worldId"], c["state"], c["epochNumber"], c["proposals"],
                c["ruleset"], actor_tags=c.get("actorTags"),
                max_actions=c.get("maxActions"),
            )
            event = r["event"]
            assert _listed_actors(event) == exp["listed_actors"], label + " listed_actors"
            assert event["pcg_steps_consumed"] == exp["pcg_steps_consumed"], label + " pcg_steps"
            assert r["resolved"] == exp["resolved"], label + " resolved"
            assert r["rejected"] == exp["rejected"], label + " rejected"
            assert world_state_hash(key, r["state"]) == exp["state_hash"], label + " state_hash"
            # events hash for a tick = hash of the single-event list [event].
            assert world_state_hash(key, [event]) == exp["events_hash"], label + " events_hash"
        else:  # catchup
            r = catch_up_epochs(
                c["worldId"], c["state"], c["currentEpoch"], c["maxCatchup"],
                c["ruleset"], proposals_by_epoch=c.get("proposalsByEpoch"),
                actor_tags=c.get("actorTags"), max_actions=c.get("maxActions"),
            )
            assert r["epochs_resolved"] == exp["epochsResolved"], label + " epochsResolved"
            assert r["epochs_voided"] == exp["epochsVoided"], label + " epochsVoided"
            assert r["state"]["epoch"] == exp["final_epoch"], label + " final_epoch"
            assert world_state_hash(key, r["state"]) == exp["state_hash"], label + " state_hash"
            assert world_state_hash(key, r["events"]) == exp["events_hash"], label + " events_hash"
        passed += 1
    assert passed == 7


if __name__ == "__main__":
    test_golden_vector_byte_parity()
    print("world_epoch Python parity: all 7 cases pass")
