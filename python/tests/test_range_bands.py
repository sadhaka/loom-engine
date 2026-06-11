"""Parity tests for loom_engine.range_bands - assertions mirror the TypeScript
tests/range-bands.test.ts so the two implementations stay byte-identical.

Run: python python/tests/test_range_bands.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.range_bands import (  # noqa: E402
    band_from_distance_ft,
    normalize_band,
    band_within,
    compare_bands,
    RangeBandField,
    RANGE_BAND_ENGAGED,
    RANGE_BAND_NEAR,
    RANGE_BAND_FAR,
    RESOURCE_RANGE_BANDS,
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


ck("RESOURCE key stable", RESOURCE_RANGE_BANDS == "rangeBands")

# integer-feet contract: fractions truncate toward zero (parity with TS / Rust)
ck("0 -> engaged", band_from_distance_ft(0) == RANGE_BAND_ENGAGED)
ck("5 -> engaged", band_from_distance_ft(5) == RANGE_BAND_ENGAGED)
ck("5.49 -> engaged (trunc 5)", band_from_distance_ft(5.49) == RANGE_BAND_ENGAGED)
ck("30 -> near", band_from_distance_ft(30) == RANGE_BAND_NEAR)
ck("30.49 -> near (trunc 30)", band_from_distance_ft(30.49) == RANGE_BAND_NEAR)
ck("31 -> far", band_from_distance_ft(31) == RANGE_BAND_FAR)
ck("inf -> far", band_from_distance_ft(float("inf")) == RANGE_BAND_FAR)
ck("-10 -> near (defensive)", band_from_distance_ft(-10) == RANGE_BAND_NEAR)
ck("nan -> near (defensive)", band_from_distance_ft(float("nan")) == RANGE_BAND_NEAR)
ck("junk -> near (defensive)", band_from_distance_ft("xyz") == RANGE_BAND_NEAR)

ck("normalize valid", normalize_band("engaged") == RANGE_BAND_ENGAGED)
ck("normalize junk -> None", normalize_band("sideways") is None)

ck("within engaged<=near", band_within("engaged", "near") is True)
ck("within far<=near False", band_within("far", "near") is False)
ck("within near<=engaged False", band_within("near", "engaged") is False)
ck("compare_bands engaged<near", compare_bands("engaged", "near") < 0)
ck("compare_bands far>near", compare_bands("far", "near") > 0)
ck("compare_bands near==near", compare_bands("near", "near") == 0)

# field: symmetric write + derive from distance
f = RangeBandField()
ck("set dist=5 -> engaged", f.set_pair("pc", "goblin", distance_feet=5) == RANGE_BAND_ENGAGED)
ck("get pc->goblin engaged", f.get_band("pc", "goblin") == RANGE_BAND_ENGAGED)
ck("get goblin->pc engaged (symmetric)", f.get_band("goblin", "pc") == RANGE_BAND_ENGAGED)
ck("is_engaged True", f.is_engaged("pc", "goblin") is True)

ck("explicit band wins", f.set_pair("pc", "g2", band=RANGE_BAND_FAR, distance_feet=5) == RANGE_BAND_FAR)
ck("no band/dist -> near", f.set_pair("pc", "g3") == RANGE_BAND_NEAR)

f2 = RangeBandField()
f2.set_pair("pc", "goblin", distance_feet=5)
f2.set_pair("pc", "archer", distance_feet=20)
f2.set_pair("pc", "sniper", distance_feet=60)
ck("targets_within near = engaged+near", sorted(f2.targets_within("pc", "near")) == ["archer", "goblin"])
ck("engaged_with = [goblin]", f2.engaged_with("pc") == ["goblin"])
ck("targets_within far = all 3", len(f2.targets_within("pc", "far")) == 3)

f3 = RangeBandField()
f3.set_pair("pc", "g", band=RANGE_BAND_ENGAGED, symmetric=False)
ck("asymmetric: pc->g set", f3.get_band("pc", "g") == RANGE_BAND_ENGAGED)
ck("asymmetric: g->pc not set", f3.get_band("g", "pc") is None)
ck("self-pair no-op", (f3.set_pair("x", "x", band=RANGE_BAND_ENGAGED) and f3.get_band("x", "x")) is None)
snap = f3.snapshot()
ck("snapshot shape", len(snap) == 1 and snap[0] == {"source": "pc", "target": "g", "band": RANGE_BAND_ENGAGED})

print("\npassed=%d failed=%d" % (PASS, FAIL))


def test_all_module_checks_passed():
    """pytest entry: the ck() checks above run at import; assert none failed.
    (The module-level sys.exit is __main__-guarded so pytest collection of
    the directory does not abort with SystemExit.)"""
    assert FAIL == 0, "%d golden check(s) failed - see captured stdout" % FAIL


if __name__ == "__main__":
    sys.exit(1 if FAIL else 0)
