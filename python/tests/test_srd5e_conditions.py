"""Parity tests for loom_engine.srd5e_conditions - assertions mirror the
TypeScript tests/srd5e-conditions.test.ts so the two implementations stay
byte-identical. This module computes the MODE only - the adv/dis second d20
is host-side (AST v2 has no max/min op).

Run: python python/tests/test_srd5e_conditions.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.srd5e_conditions import (  # noqa: E402
    ADV_AGAINST_TARGET, DISADV_ON_ATTACKER, AUTO_FAIL_STR_DEX,
    INCAPACITATED_NO_REACTION, coerce_conditions, attack_advantage_mode,
    condition_roll_note, auto_fail_save_condition, reaction_denied_by_conditions,
)

PASS = 0
FAIL = 0


def ck(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("  FAIL " + label)


# ---- the SRD tables ----------------------------------------------------------

ck("ADV_AGAINST_TARGET", ADV_AGAINST_TARGET == ["restrained", "stunned", "paralyzed", "unconscious"])
ck("DISADV_ON_ATTACKER", DISADV_ON_ATTACKER == ["poisoned", "frightened", "restrained", "prone"])
ck("AUTO_FAIL_STR_DEX", AUTO_FAIL_STR_DEX == ["paralyzed", "stunned", "unconscious"])
ck("INCAPACITATED_NO_REACTION",
   INCAPACITATED_NO_REACTION == ["paralyzed", "stunned", "unconscious", "incapacitated", "petrified"])

# ---- coerce_conditions is fail-soft and normalizing --------------------------

ck("lowercase, trim, dedupe (first-seen order)",
   coerce_conditions(["Prone", " STUNNED ", "prone"]) == ["prone", "stunned"])
ck("comma-separated string accepted",
   coerce_conditions("poisoned, frightened") == ["poisoned", "frightened"])
ck("non-strings and empties drop",
   coerce_conditions(["ok", 7, None, "", "fine"]) == ["ok", "fine"])
ck("number coerces to []", coerce_conditions(42) == [])
ck("None coerces to []", coerce_conditions(None) == [])
ck("dict coerces to []", coerce_conditions({}) == [])

# ---- attack_advantage_mode - adv / dis / cancel ------------------------------

_adv = attack_advantage_mode([], ["restrained"], True)
ck("restrained target grants adv", _adv["mode"] == "adv")
ck("adv detail", _adv["detail"] == {"adv_from": ["restrained"], "dis_from": [],
                                    "cancelled": False, "prone_skipped": False})
_dis = attack_advantage_mode(["poisoned"], [], True)
ck("poisoned attacker has dis", _dis["mode"] == "dis")
ck("dis detail", _dis["detail"]["dis_from"] == ["poisoned"])
# Both sides present: 5e RAW cancel to a straight roll (never stack).
_cancel = attack_advantage_mode(["frightened"], ["stunned", "paralyzed"], True)
ck("cancel mode is None", _cancel["mode"] is None)
ck("cancel flagged", _cancel["detail"]["cancelled"] is True)
ck("cancel adv_from", _cancel["detail"]["adv_from"] == ["stunned", "paralyzed"])
ck("cancel dis_from", _cancel["detail"]["dis_from"] == ["frightened"])
# No conditions at all.
_none = attack_advantage_mode([], [], None)
ck("no conditions: mode None", _none["mode"] is None)
ck("no conditions: not cancelled", _none["detail"]["cancelled"] is False)
# A restrained ATTACKER has disadvantage; a restrained TARGET grants advantage.
ck("restrained attacker is dis", attack_advantage_mode(["restrained"], [], True)["mode"] == "dis")
ck("restrained target is adv", attack_advantage_mode([], ["restrained"], None)["mode"] == "adv")

# ---- prone target splits by range; unknown range SKIPS prone -----------------

_melee = attack_advantage_mode([], ["prone"], True)
ck("melee vs prone: adv", _melee["mode"] == "adv" and _melee["detail"]["adv_from"] == ["prone"])
_ranged = attack_advantage_mode([], ["prone"], False)
ck("ranged vs prone: dis", _ranged["mode"] == "dis" and _ranged["detail"]["dis_from"] == ["prone"])
_unknown = attack_advantage_mode([], ["prone"], None)
ck("unknown range: prone skipped, decides nothing",
   _unknown["mode"] is None and _unknown["detail"]["prone_skipped"] is True
   and _unknown["detail"]["adv_from"] == [] and _unknown["detail"]["dis_from"] == [])
_mixed = attack_advantage_mode([], ["prone", "stunned"], None)
ck("skipped prone does not block other sources",
   _mixed["mode"] == "adv" and _mixed["detail"]["prone_skipped"] is True)
_own_prone = attack_advantage_mode(["prone"], [], None)
ck("a prone ATTACKER is unconditional dis",
   _own_prone["mode"] == "dis" and _own_prone["detail"]["prone_skipped"] is False)

# ---- condition_roll_note strings ----------------------------------------------

_adv = attack_advantage_mode([], ["restrained", "stunned"], True)
ck("adv note with pair",
   condition_roll_note(_adv["mode"], _adv["detail"], 17, "17/9")
   == "advantage (restrained, stunned): rolled 17/9, kept 17")
ck("adv note without pair",
   condition_roll_note(_adv["mode"], _adv["detail"], None, None)
   == "advantage (restrained, stunned)")
_dis = attack_advantage_mode(["poisoned"], [], True)
ck("dis note with pair",
   condition_roll_note(_dis["mode"], _dis["detail"], 4, "4/12")
   == "disadvantage (poisoned): rolled 4/12, kept 4")
_cancel = attack_advantage_mode(["frightened"], ["stunned"], True)
ck("cancel note",
   condition_roll_note(_cancel["mode"], _cancel["detail"], None, None)
   == "advantage (stunned) and disadvantage (frightened) cancel: straight roll")
_skipped = attack_advantage_mode([], ["prone"], None)
ck("skipped-prone note",
   condition_roll_note(_skipped["mode"], _skipped["detail"], None, None)
   == "[prone ignored: melee/ranged unknown]")
_plain = attack_advantage_mode([], [], True)
ck("plain roll: empty note",
   condition_roll_note(_plain["mode"], _plain["detail"], None, None) == "")

# ---- auto_fail_save_condition only fires on STR/DEX --------------------------

ck("dex + paralyzed", auto_fail_save_condition("dex", ["paralyzed"]) == "paralyzed")
ck("str + unconscious", auto_fail_save_condition("str", ["unconscious"]) == "unconscious")
ck("full ability names accepted (strength)", auto_fail_save_condition("strength", ["stunned"]) == "stunned")
ck("full ability names accepted (dexterity)", auto_fail_save_condition("dexterity", ["stunned"]) == "stunned")
# Table order decides which condition is named first.
ck("table order decides", auto_fail_save_condition("dex", ["unconscious", "paralyzed"]) == "paralyzed")
# WIS/CON/CHA/INT saves never auto-fail.
ck("wis never auto-fails", auto_fail_save_condition("wis", ["paralyzed"]) is None)
ck("con never auto-fails", auto_fail_save_condition("con", ["stunned", "unconscious"]) is None)
ck("cha never auto-fails", auto_fail_save_condition("cha", ["paralyzed"]) is None)
# Non-auto-fail conditions return None even on DEX.
ck("restrained/prone never auto-fail", auto_fail_save_condition("dex", ["restrained", "prone"]) is None)
ck("no conditions", auto_fail_save_condition("dex", []) is None)
ck("empty ability", auto_fail_save_condition("", ["paralyzed"]) is None)

# ---- reaction_denied_by_conditions (the incapacitated family) ----------------

ck("stunned denies", reaction_denied_by_conditions(["stunned"]) == "stunned")
ck("petrified denies", reaction_denied_by_conditions(["petrified"]) == "petrified")
ck("incapacitated denies", reaction_denied_by_conditions(["incapacitated"]) == "incapacitated")
ck("table order decides", reaction_denied_by_conditions(["paralyzed", "stunned"]) == "paralyzed")
ck("non-family conditions never deny",
   reaction_denied_by_conditions(["prone", "restrained", "poisoned"]) is None)
ck("no conditions", reaction_denied_by_conditions([]) is None)
ck("string input coerces", reaction_denied_by_conditions("Stunned") == "stunned")

print("\npassed=%d failed=%d" % (PASS, FAIL))


def test_all_module_checks_passed():
    """pytest entry: the ck() checks above run at import; assert none failed.
    (The module-level sys.exit is __main__-guarded so pytest collection of
    the directory does not abort with SystemExit.)"""
    assert FAIL == 0, "%d srd5e-conditions check(s) failed - see captured stdout" % FAIL


if __name__ == "__main__":
    sys.exit(1 if FAIL else 0)
