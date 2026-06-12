"""Parity tests for loom_engine.srd5e_spell_slots - assertions mirror the
TypeScript tests/srd5e-spell-slots.test.ts so the two implementations stay
byte-identical.

Run: python python/tests/test_srd5e_spell_slots.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.srd5e_spell_slots import (  # noqa: E402
    MAX_SLOT_LEVEL, PACT_KEY, caster_kind, is_caster, spell_ability_for_class,
    spell_slots_for, highest_slot_level, slot_available, spend_slot,
    spend_lowest_available, restore_slot, slots_remaining, long_rest,
    short_rest, widen_slots, spell_requires_concentration, spell_base_level,
    upcast_effect, total_dice_for_cast, sanitize_slot_pool,
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


# ---- caster taxonomy + spellcasting ability ---------------------------------

ck("MAX_SLOT_LEVEL is 9", MAX_SLOT_LEVEL == 9)
ck("PACT_KEY is 'pact'", PACT_KEY == "pact")
ck("wizard is full", caster_kind("wizard") == "full")
ck("cleric is full", caster_kind("cleric") == "full")
ck("paladin is half", caster_kind("paladin") == "half")
ck("ranger is half", caster_kind("ranger") == "half")
ck("warlock is pact", caster_kind("warlock") == "pact")
ck("fighter is not a caster", caster_kind("fighter") is None)
ck("normalizes case + whitespace", caster_kind("  Wizard  ") == "full")
ck("is_caster druid", is_caster("druid") is True)
ck("is_caster rogue", is_caster("rogue") is False)
ck("wizard casts with int", spell_ability_for_class("wizard") == "int")
ck("cleric casts with wis", spell_ability_for_class("cleric") == "wis")
ck("warlock casts with cha", spell_ability_for_class("warlock") == "cha")
ck("paladin casts with cha", spell_ability_for_class("paladin") == "cha")
ck("barbarian has no ability", spell_ability_for_class("barbarian") is None)

# ---- SRD slot tables (full / half / pact) -----------------------------------

ck("wizard 1", spell_slots_for("wizard", 1) == {"1": {"max": 2, "used": 0}})
ck("wizard 5", spell_slots_for("wizard", 5) == {
    "1": {"max": 4, "used": 0}, "2": {"max": 3, "used": 0}, "3": {"max": 2, "used": 0}})
ck("wizard 20", spell_slots_for("wizard", 20) == {
    "1": {"max": 4, "used": 0}, "2": {"max": 3, "used": 0}, "3": {"max": 3, "used": 0},
    "4": {"max": 3, "used": 0}, "5": {"max": 3, "used": 0}, "6": {"max": 2, "used": 0},
    "7": {"max": 2, "used": 0}, "8": {"max": 1, "used": 0}, "9": {"max": 1, "used": 0}})
# Half casters lag: nothing at 1, 2 first-level slots at 2.
ck("paladin 1 empty", spell_slots_for("paladin", 1) == {})
ck("paladin 2", spell_slots_for("paladin", 2) == {"1": {"max": 2, "used": 0}})
ck("ranger 20", spell_slots_for("ranger", 20) == {
    "1": {"max": 4, "used": 0}, "2": {"max": 3, "used": 0}, "3": {"max": 3, "used": 0},
    "4": {"max": 3, "used": 0}, "5": {"max": 2, "used": 0}})
# Pact ladder: level/count milestones.
ck("warlock 1", spell_slots_for("warlock", 1) == {"pact": {"slot_level": 1, "max": 1, "used": 0}})
ck("warlock 2", spell_slots_for("warlock", 2) == {"pact": {"slot_level": 1, "max": 2, "used": 0}})
ck("warlock 5", spell_slots_for("warlock", 5) == {"pact": {"slot_level": 3, "max": 2, "used": 0}})
ck("warlock 9", spell_slots_for("warlock", 9) == {"pact": {"slot_level": 5, "max": 2, "used": 0}})
ck("warlock 11", spell_slots_for("warlock", 11) == {"pact": {"slot_level": 5, "max": 3, "used": 0}})
ck("warlock 17", spell_slots_for("warlock", 17) == {"pact": {"slot_level": 5, "max": 4, "used": 0}})
# Non-caster: empty. Level clamps into 1..20.
ck("fighter has no pool", spell_slots_for("fighter", 10) == {})
ck("level 0 clamps to 1", spell_slots_for("wizard", 0) == spell_slots_for("wizard", 1))
ck("level 25 clamps to 20", spell_slots_for("wizard", 25) == spell_slots_for("wizard", 20))

# ---- highest_slot_level + slot_available (pact included) --------------------

ck("highest wizard 5 is 3", highest_slot_level(spell_slots_for("wizard", 5)) == 3)
ck("highest warlock 9 is 5", highest_slot_level(spell_slots_for("warlock", 9)) == 5)
ck("highest of empty is 0", highest_slot_level({}) == 0)
_pool = {"3": {"max": 2, "used": 1}, "pact": {"slot_level": 3, "max": 2, "used": 0}}
ck("numeric remainder + matching pact remainder sum", slot_available(_pool, 3) == 3)
ck("nothing at level 2", slot_available(_pool, 2) == 0)

# ---- spend_slot: pure, exact-level, numeric before pact ---------------------

_pool = spell_slots_for("wizard", 5)
_pre = json.dumps(_pool, sort_keys=True)
_r = spend_slot(_pool, 3)
ck("spend ok", _r["ok"] is True)
ck("spend reason ok", _r["reason"] == "ok")
ck("spend slot_level 3", _r["slot_level"] == 3)
ck("spend used 1", _r["slots"]["3"]["used"] == 1)
ck("input pool never mutated", json.dumps(_pool, sort_keys=True) == _pre)
# Exact level only - a dry tier does NOT walk up.
_dry = {"1": {"max": 2, "used": 2}, "2": {"max": 3, "used": 0}}
_r2 = spend_slot(_dry, 1)
ck("dry spend not ok", _r2["ok"] is False)
ck("dry spend reason no_slot", _r2["reason"] == "no_slot")
ck("dry spend slot_level None", _r2["slot_level"] is None)
ck("failed spend returns the pool unchanged", _r2["slots"] == _dry)
# Numeric tier spends before a matching pact tier.
_mixed = {"3": {"max": 1, "used": 0}, "pact": {"slot_level": 3, "max": 2, "used": 0}}
_r3 = spend_slot(_mixed, 3)
ck("numeric tier spends first", _r3["slots"]["3"]["used"] == 1)
ck("pact untouched", _r3["slots"]["pact"]["used"] == 0)
# Reason taxonomy.
ck("slot 0 is not_a_slot", spend_slot(_pool, 0)["reason"] == "not_a_slot")
ck("slot 10 is bad_slot_level", spend_slot(_pool, 10)["reason"] == "bad_slot_level")
ck("slot 2.5 is bad_slot_level", spend_slot(_pool, 2.5)["reason"] == "bad_slot_level")
ck("slot -1 is bad_slot_level", spend_slot(_pool, -1)["reason"] == "bad_slot_level")

# ---- spend_lowest_available: auto-upcast walk -------------------------------

_pool = {"1": {"max": 2, "used": 2}, "2": {"max": 3, "used": 3}, "3": {"max": 2, "used": 0}}
_r = spend_lowest_available(_pool, 1)
ck("walks past two dry tiers", _r["ok"] is True and _r["slot_level"] == 3)
_all_dry = {"1": {"max": 2, "used": 2}}
_r2 = spend_lowest_available(_all_dry, 1)
ck("whole walk dry", _r2["ok"] is False and _r2["reason"] == "no_higher_slot")
# Pact tiers join the walk.
_pact = spell_slots_for("warlock", 5)
_r3 = spend_lowest_available(_pact, 1)
ck("pact joins the walk", _r3["slot_level"] == 3 and _r3["slots"]["pact"]["used"] == 1)
ck("lowest 0 is not_a_slot", spend_lowest_available(_pool, 0)["reason"] == "not_a_slot")
ck("lowest 11 is bad_slot_level", spend_lowest_available(_pool, 11)["reason"] == "bad_slot_level")

# ---- restore_slot floors at 0; slots_remaining merges pact ------------------

_pool = {"2": {"max": 3, "used": 2}}
ck("restore default 1", restore_slot(_pool, 2) == {"2": {"max": 3, "used": 1}})
ck("restore floors at 0", restore_slot(_pool, 2, 5) == {"2": {"max": 3, "used": 0}})
ck("unknown level is a no-op", restore_slot(_pool, 7) == _pool)
_pact = {"pact": {"slot_level": 3, "max": 2, "used": 2}}
ck("pact restores at its level", restore_slot(_pact, 3) == {"pact": {"slot_level": 3, "max": 2, "used": 1}})
_mixed = {"1": {"max": 4, "used": 1}, "3": {"max": 1, "used": 0}, "pact": {"slot_level": 3, "max": 2, "used": 1}}
ck("pact remainder merges into its slot level", slots_remaining(_mixed) == {1: 3, 3: 2})

# ---- rests: long refreshes all, short refreshes pact only -------------------

ck("long rest is the fresh pool", long_rest("wizard", 4) == spell_slots_for("wizard", 4))
_wiz = {"1": {"max": 4, "used": 3}}
ck("wizard short rest is a no-op", short_rest("wizard", 5, _wiz) == _wiz)
_lock = {"pact": {"slot_level": 3, "max": 2, "used": 2}}
ck("warlock short rest refreshes pact",
   short_rest("warlock", 5, _lock) == {"pact": {"slot_level": 3, "max": 2, "used": 0}})
_pre = json.dumps(_lock, sort_keys=True)
short_rest("warlock", 5, _lock)
ck("short rest never mutates the input", json.dumps(_lock, sort_keys=True) == _pre)

# ---- THE P0 widen-merge ------------------------------------------------------

_stored = {"1": {"max": 4, "used": 4}, "2": {"max": 3, "used": 1}}
ck("level-up: new tier appears, spent stays spent",
   widen_slots(_stored, "wizard", 5) == {
       "1": {"max": 4, "used": 4}, "2": {"max": 3, "used": 1}, "3": {"max": 2, "used": 0}})
ck("carried used caps at the NEW max",
   widen_slots({"1": {"max": 2, "used": 7}}, "wizard", 1) == {"1": {"max": 2, "used": 2}})
ck("stored tiers absent from the fresh shape drop",
   widen_slots({"9": {"max": 1, "used": 1}}, "wizard", 1) == {"1": {"max": 2, "used": 0}})
_nc = {"1": {"max": 4, "used": 2}}
ck("non-caster returns stored untouched", widen_slots(_nc, "fighter", 5) == _nc)
ck("None stored returns fresh", widen_slots(None, "wizard", 3) == spell_slots_for("wizard", 3))
ck("empty stored returns fresh", widen_slots({}, "wizard", 3) == spell_slots_for("wizard", 3))
ck("pact shape re-derives, pact used carries",
   widen_slots({"pact": {"slot_level": 1, "max": 2, "used": 1}}, "warlock", 5)
   == {"pact": {"slot_level": 3, "max": 2, "used": 1}})
ck("class-shape switch: stored numeric pool widened as a warlock is pure pact",
   widen_slots({"1": {"max": 2, "used": 1}}, "warlock", 5)
   == {"pact": {"slot_level": 3, "max": 2, "used": 0}})
_pre = json.dumps(_stored, sort_keys=True)
widen_slots(_stored, "wizard", 9)
ck("widen never mutates stored", json.dumps(_stored, sort_keys=True) == _pre)

# ---- SRD upcast ladder + total_dice_for_cast --------------------------------

ck("fireball base level 3", spell_base_level("fireball") == 3)
ck("unknown spell base level None", spell_base_level("nonsense") is None)
ck("witch_bolt concentrates", spell_requires_concentration("witch_bolt") is True)
ck("hold_person concentrates", spell_requires_concentration("hold_person") is True)
ck("fireball does not", spell_requires_concentration("fireball") is False)
ck("unknown does not", spell_requires_concentration("nonsense") is False)
# Clamping: under base casts at base; over 9 clamps to 9.
_low = upcast_effect("fireball", 1)
ck("under-level casts at base", _low is not None and _low["cast_level"] == 3
   and _low["levels_above"] == 0 and _low["added_dice"] == "")
_high = upcast_effect("fireball", 12)
ck("over 9 clamps to 9", _high is not None and _high["cast_level"] == 9
   and _high["added_dice"] == "6d6")
# Per-TWO-levels step (spiritual_weapon): odd levels do not step.
_sw3 = upcast_effect("spiritual_weapon", 3)
ck("slot 3 below the first even step", _sw3 is not None and _sw3["added_dice"] == "")
_sw4 = upcast_effect("spiritual_weapon", 4)
ck("slot 4 steps once", _sw4 is not None and _sw4["added_dice"] == "1d8")
# Instance scaling (darts / rays / targets).
_mm = upcast_effect("magic_missile", 5)
ck("magic_missile slot 5: 4 extra darts", _mm is not None and _mm["extra_instances"] == 4)
_sr = upcast_effect("scorching_ray", 4)
ck("scorching_ray slot 4: 2 extra rays", _sr is not None and _sr["extra_instances"] == 2)
# The no-document entries still carry ladder data.
_bless = upcast_effect("bless", 3)
ck("bless ladder data", _bless is not None and _bless["extra_instances"] == 2
   and _bless["concentration"] is True)
_sleep = upcast_effect("sleep", 2)
ck("sleep adds 2d8 per level", _sleep is not None and _sleep["added_dice"] == "2d8")
# total_dice_for_cast merges same-sided dice and preserves a flat mod once.
ck("fireball at 5 is 10d6", total_dice_for_cast("8d6", "fireball", 5) == "10d6")
ck("fireball at base stays 8d6", total_dice_for_cast("8d6", "fireball", 3) == "8d6")
ck("unknown spell returns base", total_dice_for_cast("8d6", "nonsense", 5) == "8d6")
ck("mismatched sides return base", total_dice_for_cast("2d10", "fireball", 5) == "2d10")
ck("non-dice base passes through", total_dice_for_cast("junk", "fireball", 5) == "junk")
ck("flat mod preserved once", total_dice_for_cast("1d8+3", "cure_wounds", 3) == "3d8+3")

# Codex audit P2 - malformed pools are clamped (no slot-minting).
_bad = {"1": {"max": 1, "used": -100}}
ck("negative used clamps availability", slot_available(_bad, 1) == 1)
ck("slots_remaining clamps", slots_remaining(_bad) == {1: 1})
_s1 = spend_slot(_bad, 1)
ck("one real slot spends", _s1["ok"] is True and slot_available(_s1["slots"], 1) == 0)
ck("no phantom slot remains", spend_slot(_s1["slots"], 1)["ok"] is False)
ck("used over max clamps down", slot_available({"2": {"max": 2, "used": 9}}, 2) == 0)
ck("sanitize valid pool unchanged", sanitize_slot_pool(spell_slots_for("wizard", 5)) == spell_slots_for("wizard", 5))
ck("sanitize clamps malformed", sanitize_slot_pool(_bad) == {"1": {"max": 1, "used": 0}})

print("\npassed=%d failed=%d" % (PASS, FAIL))


def test_all_module_checks_passed():
    """pytest entry: the ck() checks above run at import; assert none failed.
    (The module-level sys.exit is __main__-guarded so pytest collection of
    the directory does not abort with SystemExit.)"""
    assert FAIL == 0, "%d srd5e-spell-slots check(s) failed - see captured stdout" % FAIL


if __name__ == "__main__":
    sys.exit(1 if FAIL else 0)
