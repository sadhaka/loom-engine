"""Cross-language parity: the Python ruleset AST must reproduce the TS-generated
golden vector (test_vectors/v3_ast_bleed.json) byte-for-byte - same degree, roll,
natural roll, mutations, and resulting world-state hash, across all 7 cases
(incl mul/-0 -> +0, the crit, the multi-die natural, the astral tag)."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.ruleset_ast import (  # noqa: E402
    apply_triggered_mutations, evaluate_action, make_context,
    validate_triggered_mutations,
)
from loom_engine.world_snapshot import world_state_hash  # noqa: E402
from loom_engine.pcg32 import Pcg32  # noqa: E402

_VECTOR = os.path.join(os.path.dirname(__file__), "..", "..", "test_vectors", "v3_ast_bleed.json")


def _vec():
    with open(_VECTOR, encoding="utf-8") as f:
        return json.load(f)


def test_golden_vector_byte_parity():
    v = _vec()
    assert len(v["cases"]) >= 7
    for c in v["cases"]:
        seed = int(c["seed"])
        if c["kind"] == "condition":
            r = apply_triggered_mutations(c["state"], c["mutations"], make_context(c["state"], c["actor"], seed, c.get("target")))
            assert world_state_hash(c["key"], r["state"]) == c["expect"]["state_hash"], c["label"]
        else:
            r = evaluate_action(c["state"], c["check"], make_context(c["state"], c["actor"], seed, c.get("target")))
            assert r["degree"] == c["expect"]["degree"], c["label"] + " degree"
            assert r["roll"] == c["expect"]["roll"], c["label"] + " roll"
            assert r["natural"] == c["expect"]["natural"], c["label"] + " natural"
            assert world_state_hash(c["key"], r["state"]) == c["expect"]["state_hash"], c["label"] + " hash"


def test_fail_closed_zero_rng_advance():
    state = {"epoch": 0, "worldSeed": 0, "entities": {
        "a": {"properties": {"ac": 1}, "tags": []},
        "b": {"properties": {"hp": 10, "ac": 1}, "tags": []}}}
    check = {"type": "check", "roll": {"type": "dice", "equation": "1d20"},
             "dc": {"type": "prop_ref", "target": "target", "property": "ac"},
             "degrees": {"success": {"condition": {"type": "delta_gte", "value": 0}, "mutations": [
                 {"type": "sub_prop", "target": "target", "property": "hp", "value": {"type": "dice", "equation": "1d8"}},
                 {"type": "frobnicate", "target": "target", "property": "hp", "value": {"type": "literal", "value": 1}}]}}}
    ctx = make_context(state, "a", 5, "b")
    raised = False
    try:
        evaluate_action(state, check, ctx)
    except ValueError:
        raised = True
    assert raised, "expected a validation error"
    # the rng must be untouched - validation ran before any roll
    assert ctx["rng"].next_u32() == Pcg32.seeded(5).next_u32()


def test_p1b_unsafe_dice_mod_rejected_before_rng():
    from loom_engine.ruleset_ast import parse_dice, validate_check
    # result (1 + 2^53) exceeds the JS-safe integer range; parse_dice must reject it,
    # and validate_check (which parses dice in its budget pass) too - before any roll.
    raised = False
    try:
        parse_dice("1d6+9007199254740992")
    except ValueError:
        raised = True
    assert raised, "parse_dice must reject an unsafe dice modifier"
    raised = False
    try:
        validate_check({"type": "check", "roll": {"type": "dice", "equation": "1d6+9007199254740992"},
                        "dc": {"type": "literal", "value": 0}, "degrees": {}})
    except ValueError:
        raised = True
    assert raised, "validate_check must reject an unsafe dice modifier"


if __name__ == "__main__":
    test_golden_vector_byte_parity()
    test_fail_closed_zero_rng_advance()
    test_p1b_unsafe_dice_mod_rejected_before_rng()
    print("ruleset_ast Python parity: all tests pass")

def test_round7_non_nfc_name_is_rejected():
    # Instance #5 NFC parity pin: the AST name guard borrowed a surrogate-only
    # check; it now rejects non-NFC like TS. validate_triggered_mutations is
    # the fail-closed guard apply_* runs before any rng/mutation.
    import pytest
    dirty_prop = [{'type': 'set_prop', 'target': 'actor', 'property': 'cafe\u0301', 'value': {'type': 'literal', 'value': 1}}]
    with pytest.raises(Exception):
        validate_triggered_mutations(dirty_prop)
    dirty_tag = [{'type': 'add_tag', 'target': 'actor', 'tag': 'cafe\u0301'}]
    with pytest.raises(Exception):
        validate_triggered_mutations(dirty_tag)
    # precomposed twin (same grapheme, NFC) is accepted
    clean = [{'type': 'set_prop', 'target': 'actor', 'property': 'caf\u00e9', 'value': {'type': 'literal', 'value': 1}}]
    validate_triggered_mutations(clean)
