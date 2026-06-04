"""Cross-language golden-vector runner (Python side).

Loads the SHARED test_vectors/*.json - the same files the TS (and future Rust)
harnesses load - and asserts the Python implementation produces the canonical
outputs. If TS and Python both pass against the same vectors, they are proven
byte-identical for those cases. This is the parity gate.

Run: python python/tests/test_golden_vectors.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
VECTOR_DIR = os.path.join(HERE, "..", "..", "test_vectors")

from loom_engine.range_bands import band_from_distance_ft, band_within  # noqa: E402
from loom_engine.narration_contract import find_invented_number  # noqa: E402
from loom_engine.ruleset import initiative_order  # noqa: E402
from loom_engine.reaction_economy import (  # noqa: E402
    create_reaction_ledger, can_react, spend_reaction, advance_reaction_round,
)

PASS = 0
FAIL = 0


def ck(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  OK   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label)


def run_reaction_script(ops):
    """Replay a scripted op list against a fresh ledger; return the result list."""
    ledger = create_reaction_ledger()
    out = []
    for op in ops:
        kind = op[0]
        if kind == "spend":
            out.append(spend_reaction(ledger, op[1]))
        elif kind == "can_react":
            out.append(can_react(ledger, op[1]))
        elif kind == "advance":
            out.append(advance_reaction_round(ledger))
    return out


def main():
    path = os.path.join(VECTOR_DIR, "v2_3_0_primitives.json")
    with open(path, "r", encoding="utf-8") as f:
        vectors = json.load(f)

    for case in vectors["range_bands.band_from_distance_ft"]:
        got = band_from_distance_ft(case["args"][0])
        ck("band_from_distance_ft%s -> %s" % (case["args"], case["expect"]),
           got == case["expect"])

    for case in vectors["range_bands.band_within"]:
        got = band_within(case["args"][0], case["args"][1])
        ck("band_within%s -> %s" % (case["args"], case["expect"]),
           got == case["expect"])

    for case in vectors["narration.find_invented_number"]:
        got = find_invented_number(case["args"][0], case["args"][1])
        ck("find_invented_number(%r,...) -> %s" % (case["args"][0][:24], case["expect"]),
           got == case["expect"])

    for case in vectors["ruleset.initiative_order_ids"]:
        got = [e["id"] for e in initiative_order(case["entries"])]
        ck("initiative_order_ids -> %s" % case["expect"], got == case["expect"])

    for case in vectors["reaction.scripted"]:
        got = run_reaction_script(case["ops"])
        ck("reaction.scripted -> %s" % case["expect"], got == case["expect"])

    print("\npassed=%d failed=%d" % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
