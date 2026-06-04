"""Parity tests for loom_engine.reaction_economy (mirror tests/reaction-economy.test.ts).

Run: python python/tests/test_reaction_economy.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.reaction_economy import (  # noqa: E402
    REACTIONS_PER_ROUND, create_reaction_ledger, can_react, reactions_remaining,
    spend_reaction, advance_reaction_round, set_reaction_round,
    prune_stale_spends, clear_reactions, reaction_ledger_snapshot,
    RESOURCE_REACTION_ECONOMY,
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


ck("constants", REACTIONS_PER_ROUND == 1 and RESOURCE_REACTION_ECONOMY == "reactionEconomy")

l = create_reaction_ledger()
ck("fresh round 1", l.round == 1)
ck("fresh can_react", can_react(l, "pc") is True)
ck("reactions_remaining 1", reactions_remaining(l, "pc") == 1)
ck("spend once True", spend_reaction(l, "pc") is True)
ck("can_react False after spend", can_react(l, "pc") is False)
ck("reactions_remaining 0", reactions_remaining(l, "pc") == 0)
ck("spend twice False (ceiling)", spend_reaction(l, "pc") is False)
ck("foe independent", can_react(l, "goblin") is True)
ck("spend foe", spend_reaction(l, "goblin") is True)

ck("advance -> round 2", advance_reaction_round(l) == 2)
ck("refresh pc", can_react(l, "pc") is True)
ck("refresh goblin", can_react(l, "goblin") is True)
ck("spend again round 2", spend_reaction(l, "pc") is True)

l2 = create_reaction_ledger()
spend_reaction(l2, "pc")           # round 1
advance_reaction_round(l2)         # round 2; round-1 record stale
ck("stale record inert", can_react(l2, "pc") is True)

ck("empty id no-op", spend_reaction(l2, "") is False and can_react(l2, "") is False)

l3 = create_reaction_ledger()
spend_reaction(l3, "pc")
spend_reaction(l3, "goblin")
set_reaction_round(l3, 3)
set_reaction_round(l3, -5)         # ignored
ck("set_reaction_round", l3.round == 3)
ck("pc free after round set", can_react(l3, "pc") is True)
ck("prune removes 2 stale", prune_stale_spends(l3) == 2)
ck("snapshot empty after prune", len(reaction_ledger_snapshot(l3)["spent"]) == 0)
spend_reaction(l3, "pc")
snap = reaction_ledger_snapshot(l3)
ck("snapshot shape", snap["round"] == 3 and snap["spent"] == [{"entity_id": "pc", "round": 3}])
clear_reactions(l3)
ck("clear empties", len(reaction_ledger_snapshot(l3)["spent"]) == 0)

print("\npassed=%d failed=%d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
