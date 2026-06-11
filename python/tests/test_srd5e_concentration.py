"""Parity tests for loom_engine.srd5e_concentration - assertions mirror the
TypeScript tests/srd5e-concentration.test.ts so the two implementations stay
byte-identical. RNG-free by design: the caller rolls the CON save and passes
the TOTAL in.

Run: python python/tests/test_srd5e_concentration.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.srd5e_concentration import (  # noqa: E402
    CONCENTRATION_MIN_DC, maintain_save_dc, is_concentrating,
    start_concentration, drop_concentration, maintain_save,
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


# ---- maintain_save_dc = max(10, floor(damage/2)) ----------------------------

ck("CONCENTRATION_MIN_DC is 10", CONCENTRATION_MIN_DC == 10)
ck("dc(0) = 10", maintain_save_dc(0) == 10)
ck("dc(1) = 10", maintain_save_dc(1) == 10)
ck("dc(19) = 10", maintain_save_dc(19) == 10)
ck("dc(20) = 10", maintain_save_dc(20) == 10)
ck("dc(21) = 10 (floor(21/2) = 10, still the floor)", maintain_save_dc(21) == 10)
ck("dc(22) = 11", maintain_save_dc(22) == 11)
ck("dc(23) = 11 (round DOWN, never up)", maintain_save_dc(23) == 11)
ck("dc(36) = 18", maintain_save_dc(36) == 18)
ck("dc(100) = 50", maintain_save_dc(100) == 50)

# ---- is_concentrating --------------------------------------------------------

ck("None is not concentrating", is_concentrating(None) is False)
ck("empty spell_id is not concentrating",
   is_concentrating({"spell_id": "", "spell_name": ""}) is False)
ck("web is concentrating", is_concentrating({"spell_id": "web", "spell_name": "Web"}) is True)

# ---- start drops the previous spell (one at a time) -------------------------

_first = start_concentration(None, "bless", "Bless", 1)
ck("first start", _first == {
    "concentration": {"spell_id": "bless", "spell_name": "Bless", "slot_level": 1},
    "dropped": None})
_second = start_concentration(_first["concentration"], "witch_bolt", "Witch Bolt", 2)
ck("second start concentration",
   _second["concentration"] == {"spell_id": "witch_bolt", "spell_name": "Witch Bolt", "slot_level": 2})
ck("second start drops the first",
   _second["dropped"] == {"spell_id": "bless", "spell_name": "Bless", "slot_level": 1})
# spell_name defaults to the id; slot_level only appears when supplied.
_bare = start_concentration(None, "hex")
ck("bare start defaults name to id",
   _bare["concentration"] == {"spell_id": "hex", "spell_name": "hex"})
ck("bare start has no slot_level key", "slot_level" not in _bare["concentration"])

# ---- drop --------------------------------------------------------------------

ck("drop while idle is a no-op", drop_concentration(None) == {"concentration": None, "dropped": None})
_c = {"spell_id": "web", "spell_name": "Web", "slot_level": 2}
_r = drop_concentration(_c)
ck("drop clears concentration", _r["concentration"] is None)
ck("drop returns the spell", _r["dropped"] == _c)
ck("dropped is a clone, not the caller object", _r["dropped"] is not _c)

# ---- maintain_save boundaries (keep iff total >= dc) ------------------------

_c = {"spell_id": "hold_person", "spell_name": "Hold Person", "slot_level": 2}
_pre = json.dumps(_c, sort_keys=True)
# Exactly the DC keeps.
_keep = maintain_save(_c, 22, 11)
ck("exactly the dc keeps", _keep == {
    "needed": True, "dc": 11, "total": 11, "success": True,
    "concentration": {"spell_id": "hold_person", "spell_name": "Hold Person", "slot_level": 2},
    "dropped": None})
# One under drops.
_fail = maintain_save(_c, 22, 10)
ck("one under fails", _fail["success"] is False)
ck("failure clears concentration", _fail["concentration"] is None)
ck("failure returns the dropped spell", _fail["dropped"] == _c)
# Small damage still floors the DC at 10.
_floor = maintain_save(_c, 3, 9)
ck("small damage floors dc at 10", _floor["dc"] == 10 and _floor["success"] is False)
# Not concentrating: nothing needed, nothing drops, success true.
_idle = maintain_save(None, 30, 1)
ck("idle maintain", _idle == {"needed": False, "dc": 15, "total": 1, "success": True,
                              "concentration": None, "dropped": None})
# Purity: the caller's state object is never mutated.
ck("maintain never mutates the input", json.dumps(_c, sort_keys=True) == _pre)

print("\npassed=%d failed=%d" % (PASS, FAIL))


def test_all_module_checks_passed():
    """pytest entry: the ck() checks above run at import; assert none failed.
    (The module-level sys.exit is __main__-guarded so pytest collection of
    the directory does not abort with SystemExit.)"""
    assert FAIL == 0, "%d srd5e-concentration check(s) failed - see captured stdout" % FAIL


if __name__ == "__main__":
    sys.exit(1 if FAIL else 0)
