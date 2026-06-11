"""Parity tests for loom_engine.ruleset (mirror tests/ruleset.test.ts).

Run: python python/tests/test_ruleset.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.ruleset import (  # noqa: E402
    start_turn_budget, can_spend, spend, initiative_order,
    create_condition_track, apply_condition, remove_condition, has_condition,
    condition_remaining, tick_conditions, active_conditions,
    DURATION_UNTIL_REMOVED, RESOURCE_RULESET,
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


ck("RESOURCE key", RESOURCE_RULESET == "ruleset")

b5 = start_turn_budget("5e")
ck("5e budget", b5["resources"] == {"action": 1, "bonus": 1, "reaction": 1})
ck("5e spend action", spend(b5, "action") is True)
ck("5e action exhausted", spend(b5, "action") is False)
ck("5e bonus ok", spend(b5, "bonus") is True)

bp = start_turn_budget("pf2e")
ck("pf2e budget", bp["resources"] == {"action": 3, "reaction": 1})
ck("pf2e spend 1", spend(bp, "action") is True)
ck("pf2e spend 2 more", spend(bp, "action", 2) is True)
ck("pf2e 0 left", spend(bp, "action") is False)
ck("pf2e reaction", spend(bp, "reaction") is True and spend(bp, "reaction") is False)

order = initiative_order([
    {"id": "c", "total": 18, "modifier": 2, "d20": 16},
    {"id": "a", "total": 18, "modifier": 5, "d20": 13},
    {"id": "b", "total": 12, "modifier": 1, "d20": 11},
    {"id": "d", "total": 18, "modifier": 2, "d20": 16},
])
ck("initiative tiebreak total>mod>d20>id", [e["id"] for e in order] == ["a", "c", "d", "b"])
inp = [{"id": "x", "total": 5}, {"id": "y", "total": 9}]
out = initiative_order(inp)
ck("initiative no-mutate", inp[0]["id"] == "x" and [e["id"] for e in out] == ["y", "x"])

t = create_condition_track()
apply_condition(t, "frightened", 3)
apply_condition(t, "prone")
ck("has frightened", has_condition(t, "frightened") is True)
ck("remaining 3", condition_remaining(t, "frightened") == 3)
ck("prone until removed", condition_remaining(t, "prone") == DURATION_UNTIL_REMOVED)
ck("absent -> 0", condition_remaining(t, "poisoned") == 0)
ck("remove prone", remove_condition(t, "prone") is True and has_condition(t, "prone") is False)

t2 = create_condition_track()
apply_condition(t2, "frightened", 2)
apply_condition(t2, "slowed", 1)
apply_condition(t2, "doomed")
ck("tick expires slowed", tick_conditions(t2) == ["slowed"])
ck("frightened decremented", condition_remaining(t2, "frightened") == 1)
ck("active after tick", sorted(active_conditions(t2)) == ["doomed", "frightened"])
ck("tick expires frightened", tick_conditions(t2) == ["frightened"])
ck("until-removed survives", active_conditions(t2) == ["doomed"])

print("\npassed=%d failed=%d" % (PASS, FAIL))


def test_all_module_checks_passed():
    """pytest entry: the ck() checks above run at import; assert none failed.
    (The module-level sys.exit is __main__-guarded so pytest collection of
    the directory does not abort with SystemExit.)"""
    assert FAIL == 0, "%d golden check(s) failed - see captured stdout" % FAIL


if __name__ == "__main__":
    sys.exit(1 if FAIL else 0)
