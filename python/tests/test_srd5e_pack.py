"""Parity tests for loom_engine.srd5e_pack - assertions mirror the TypeScript
tests/srd5e-pack.test.ts so the two implementations stay byte-identical.

Two gates here (the golden vectors are test_srd5e_pack_vectors.py):
  1. BUDGET CONFORMANCE: every document every builder can emit (all cantrips
     x tiers, all leveled spells x legal slot levels, weapon variants, the
     worst-case multi-target limit) passes validate_check /
     validate_triggered_mutations - the ~256-node / dice / multiplicity
     budgets are a test gate, not a hope.
  2. The generated pack JSON (packs/srd5e/srd5e_actions_v1.json): every
     embedded document re-validates from the file (what Python hosts consume).
Plus plan_leveled_cast economy semantics and catalog structural invariants.

Run: python python/tests/test_srd5e_pack.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from loom_engine.ruleset_ast import validate_check, validate_triggered_mutations  # noqa: E402
from loom_engine.srd5e_pack import (  # noqa: E402
    CANTRIPS, CLASS_CANTRIPS, LEVELED_SPELLS, CLASS_LEVELED_SPELLS,
    class_can_cast, cantrip_dice_count, eldritch_blast_beams, scaled_cantrip_dice,
    build_weapon_attack_check, build_attack_cantrip_check, build_save_cantrip_check,
    build_attack_spell_check, build_save_spell_check, build_multi_target_save_trigger,
    build_magic_missile_trigger, build_heal_trigger, build_condition_spell_check,
    plan_leveled_cast,
)
from loom_engine.srd5e_spell_slots import MAX_SLOT_LEVEL, spell_slots_for  # noqa: E402

_PACK = os.path.join(HERE, "..", "..", "packs", "srd5e", "srd5e_actions_v1.json")

PASS = 0
FAIL = 0


def ck(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("  FAIL " + label)


def _raises_srd5e(fn):
    try:
        fn()
    except Exception as e:
        return "SRD5E" in str(e)
    return False


TIERS = [1, 5, 11, 17]

# ---- Gate 1: every builder output validates (budget conformance) -------------

_count = 0
for _id in CANTRIPS:
    _cdef = CANTRIPS[_id]
    for _t in TIERS:
        if _cdef["kind"] == "spell_attack":
            validate_check(build_attack_cantrip_check(_id, _t))
            _count += 1
            if _id == "eldritch_blast":
                validate_check(build_attack_cantrip_check(_id, _t, {"agonizing": True}))
                _count += 1
        else:
            validate_check(build_save_cantrip_check(_id, _t))
            _count += 1
for _id in LEVELED_SPELLS:
    _ldef = LEVELED_SPELLS[_id]
    for _L in range(_ldef["base_level"], MAX_SLOT_LEVEL + 1):
        if _ldef["kind"] == "auto":
            validate_triggered_mutations(build_magic_missile_trigger(_L))
            _count += 1
        elif _ldef["kind"] == "heal":
            validate_triggered_mutations(build_heal_trigger(_id, _L))
            _count += 1
        elif _ldef["kind"] == "spell_attack":
            validate_check(build_attack_spell_check(_id, _L))
            _count += 1
        elif _ldef["kind"] == "save":
            validate_check(build_save_spell_check(_id, _L))
            _count += 1
            if _ldef.get("area"):
                validate_triggered_mutations(build_multi_target_save_trigger(_id, _L))
                _count += 1
                # Worst case: limit 32 at the top slot - must still clear the
                # dice (1000) and applied (1024) budgets.
                validate_triggered_mutations(
                    build_multi_target_save_trigger(_id, MAX_SLOT_LEVEL, {"maxTargets": 32}))
                _count += 1
        elif _ldef["kind"] == "save_utility":
            validate_check(build_condition_spell_check(_id, _L))
            _count += 1
for _mod in ["str_mod", "dex_mod"]:
    for _dice in ["1d4", "1d6", "1d8", "1d10", "1d12", "2d6"]:
        validate_check(build_weapon_attack_check({"modProp": _mod, "damageDice": _dice, "addModToDamage": True}))
        validate_check(build_weapon_attack_check({"modProp": _mod, "damageDice": _dice, "addModToDamage": False}))
        _count += 2
ck("validated >= 200 built documents (got %d)" % _count, _count >= 200)

# ---- builders reject unknown ids and bad options ------------------------------

ck("unknown attack cantrip rejects", _raises_srd5e(lambda: build_attack_cantrip_check("nonsense", 1)))
ck("save cantrip via the attack builder rejects", _raises_srd5e(lambda: build_attack_cantrip_check("sacred_flame", 1)))
ck("attack cantrip via the save builder rejects", _raises_srd5e(lambda: build_save_cantrip_check("fire_bolt", 1)))
ck("save spell via the attack builder rejects", _raises_srd5e(lambda: build_attack_spell_check("fireball", 3)))
ck("attack spell via the save builder rejects", _raises_srd5e(lambda: build_save_spell_check("guiding_bolt", 1)))
ck("no area -> not multi-target", _raises_srd5e(lambda: build_multi_target_save_trigger("hellish_rebuke", 1)))
ck("maxTargets 0 rejects", _raises_srd5e(lambda: build_multi_target_save_trigger("fireball", 3, {"maxTargets": 0})))
ck("maxTargets 33 rejects", _raises_srd5e(lambda: build_multi_target_save_trigger("fireball", 3, {"maxTargets": 33})))
ck("non-heal via the heal builder rejects", _raises_srd5e(lambda: build_heal_trigger("fireball", 3)))
ck("non-condition via the condition builder rejects", _raises_srd5e(lambda: build_condition_spell_check("fireball", 3)))
ck("weapon modProp cha_mod rejects",
   _raises_srd5e(lambda: build_weapon_attack_check({"modProp": "cha_mod", "damageDice": "1d8", "addModToDamage": True})))
ck("weapon bad dice rejects",
   _raises_srd5e(lambda: build_weapon_attack_check({"modProp": "str_mod", "damageDice": "1d8.5", "addModToDamage": True})))

# ---- catalog structural invariants --------------------------------------------

for _cls in CLASS_CANTRIPS:
    for _cid in CLASS_CANTRIPS[_cls]:
        ck(_cls + " cantrip " + _cid + " exists in CANTRIPS", _cid in CANTRIPS)
for _cls in CLASS_LEVELED_SPELLS:
    for _sid in CLASS_LEVELED_SPELLS[_cls]:
        ck(_cls + " spell " + _sid + " exists in LEVELED_SPELLS", _sid in LEVELED_SPELLS)
for _id in CANTRIPS:
    _c = CANTRIPS[_id]
    ck("cantrip id matches its key: " + _id, _c["id"] == _id)
    if _c["kind"] == "save":
        ck(_id + " save cantrip declares its save", bool(_c.get("save_ability")))
for _id in LEVELED_SPELLS:
    _l = LEVELED_SPELLS[_id]
    ck("spell id matches its key: " + _id, _l["id"] == _id)
    ck(_id + " base level sane", 1 <= _l["base_level"] <= 9)
    if _l["kind"] == "save":
        ck(_id + " save spell declares save + half rule",
           bool(_l.get("save_ability")) and "half_on_save" in _l)
    if _l["kind"] == "save_utility":
        ck(_id + " condition spell declares save + tag",
           bool(_l.get("save_ability")) and bool(_l.get("applies_tag")))
ck("wizard knows fire_bolt", class_can_cast("wizard", "fire_bolt") is True)
ck("wizard knows fireball", class_can_cast("wizard", "fireball") is True)
ck("cleric does not know fireball", class_can_cast("cleric", "fireball") is False)
ck("warlock knows eldritch_blast", class_can_cast("warlock", "eldritch_blast") is True)
ck("fighter knows nothing", class_can_cast("fighter", "fireball") is False)
ck("unknown spell unknown", class_can_cast("wizard", "nonsense") is False)

# ---- tier scaling helpers ------------------------------------------------------

ck("dice count 1 at 1", cantrip_dice_count(1) == 1)
ck("dice count 1 at 4", cantrip_dice_count(4) == 1)
ck("dice count 2 at 5", cantrip_dice_count(5) == 2)
ck("dice count 2 at 10", cantrip_dice_count(10) == 2)
ck("dice count 3 at 11", cantrip_dice_count(11) == 3)
ck("dice count 3 at 16", cantrip_dice_count(16) == 3)
ck("dice count 4 at 17", cantrip_dice_count(17) == 4)
ck("dice count 4 at 20", cantrip_dice_count(20) == 4)
ck("beams 1 at 1", eldritch_blast_beams(1) == 1)
ck("beams 2 at 5", eldritch_blast_beams(5) == 2)
ck("beams 3 at 11", eldritch_blast_beams(11) == 3)
ck("beams 4 at 17", eldritch_blast_beams(17) == 4)
ck("1d10 at 11 -> 3d10", scaled_cantrip_dice("1d10", 11) == "3d10")
ck("1d8 at 1 -> 1d8", scaled_cantrip_dice("1d8", 1) == "1d8")
ck("flat mod preserved once", scaled_cantrip_dice("1d4+1", 5) == "2d4+1")
ck("non-dice pass through", scaled_cantrip_dice("junk", 5) == "junk")

# ---- plan_leveled_cast - the dice-free economy half ----------------------------

_pool = spell_slots_for("wizard", 7)  # 4/3/3/1
_pre = json.dumps(_pool, sort_keys=True)
_plan = plan_leveled_cast(_pool, "fireball", "wizard")
ck("plan ok", _plan["ok"] is True and _plan["reason"] == "ok")
ck("plan slot_level 3", _plan["slot_level"] == 3)
ck("plan no concentration", _plan["concentration_spell"] is None)
ck("plan spell_name", _plan["spell_name"] == "Fireball")
ck("plan spent the slot", _plan["slots"]["3"]["used"] == 1)
ck("input pool never mutated", json.dumps(_pool, sort_keys=True) == _pre)
# Auto-upcast: base tier dry -> the next available slot is spent.
_dry = {"3": {"max": 3, "used": 3}, "4": {"max": 1, "used": 0}}
ck("auto-upcast to 4", plan_leveled_cast(_dry, "fireball", "wizard")["slot_level"] == 4)
# Requested level clamps into base..9.
ck("a sub-base request casts at base",
   plan_leveled_cast(_pool, "fireball", "wizard", 1)["slot_level"] == 3)
ck("an over-9 request clamps to 9",
   plan_leveled_cast(spell_slots_for("wizard", 20), "fireball", "wizard", 99)["slot_level"] == 9)
# Concentration flag fires from the upcast ladder.
ck("witch_bolt flags concentration",
   plan_leveled_cast(spell_slots_for("wizard", 3), "witch_bolt", "wizard")["concentration_spell"] == "witch_bolt")
# Gates: unknown spell / wrong class / non-caster / dry pool.
ck("unknown spell is not_known", plan_leveled_cast(_pool, "nonsense", "wizard")["reason"] == "not_known")
ck("wrong class is not_known", plan_leveled_cast(_pool, "fireball", "cleric")["reason"] == "not_known")
ck("non-caster is not_a_caster", plan_leveled_cast(_pool, "fireball", "fighter")["reason"] == "not_a_caster")
_empty = plan_leveled_cast({"3": {"max": 3, "used": 3}}, "fireball", "wizard")
ck("dry pool is no_slot", _empty["ok"] is False and _empty["reason"] == "no_slot"
   and _empty["slot_level"] is None)
# Warlock pact casting.
_lock = plan_leveled_cast(spell_slots_for("warlock", 5), "hellish_rebuke", "warlock")
ck("pact slots cast at the pact level", _lock["ok"] is True and _lock["slot_level"] == 3)

# ---- Gate 2: the generated pack JSON re-validates from disk --------------------

with open(_PACK, encoding="utf-8") as _f:
    _pack = json.load(_f)
ck("pack has meta provenance", isinstance(_pack.get("meta", {}).get("generator"), str))
ck("pack has an actions array", isinstance(_pack.get("actions"), list))
ck("expected exactly 245 enumerated actions", len(_pack["actions"]) == 245)
_ids = {}
for _i, _a in enumerate(_pack["actions"]):
    if not (isinstance(_a.get("id"), str) and len(_a["id"]) > 0):
        ck("action %d has an id" % _i, False)
        continue
    if _a["id"] in _ids:
        ck("duplicate action id: " + _a["id"], False)
        continue
    _ids[_a["id"]] = True
    if _a["action_type"] == "check":
        validate_check(_a["document"])
    elif _a["action_type"] == "trigger":
        validate_triggered_mutations(_a["document"])
    else:
        ck("unknown action_type on " + _a["id"], False)
ck("every pack action validated with a unique id", len(_ids) == len(_pack["actions"]))
# The headline shapes are present.
for _need in ["fireball_blast_l3", "fireball_single_l3", "magic_missile_l9",
              "eldritch_blast_beam_agonizing", "weapon_attack_str_1d8",
              "toll_the_dead_t17", "hold_person", "thunderclap_burst_t5"]:
    ck("pack carries " + _need, _need in _ids)

print("\npassed=%d failed=%d" % (PASS, FAIL))


def test_all_module_checks_passed():
    """pytest entry: the ck() checks above run at import; assert none failed.
    (The module-level sys.exit is __main__-guarded so pytest collection of
    the directory does not abort with SystemExit.)"""
    assert FAIL == 0, "%d srd5e-pack check(s) failed - see captured stdout" % FAIL


if __name__ == "__main__":
    sys.exit(1 if FAIL else 0)
