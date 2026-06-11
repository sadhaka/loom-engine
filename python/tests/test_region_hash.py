"""Cross-language parity: the Python region-hash surface (v5 interest-management
Merkle) must reproduce the TS-generated golden vector
(test_vectors/v5_3_region_hash.json) byte-for-byte - the per-region leaf hashes,
the global root, the Merkle property (mutating one region touches only its leaf
+ the root), verify_region, and the diff_region_leaves consumer - mirroring
tests/region-hash.test.ts one-for-one."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.region_hash import (  # noqa: E402
    region_hash, region_leaves, global_region_hash, verify_region,
)
from loom_engine.region_sync import diff_region_leaves  # noqa: E402

_VECTOR = os.path.join(
    os.path.dirname(__file__), "..", "..", "test_vectors", "v5_3_region_hash.json"
)


def _vec():
    with open(_VECTOR, encoding="utf-8") as f:
        return json.load(f)


def test_golden_vector_leaves_and_root():
    v = _vec()
    i = v["inputs"]
    assert region_leaves(i["key"], i["regions"]) == v["expect"]["leaves_before"], \
        "leaves before"
    assert global_region_hash(i["key"], i["regions"]) == v["expect"]["global_before"], \
        "global before"
    assert region_leaves(i["key"], i["regions_after_south_mutation"]) == \
        v["expect"]["leaves_after"], "leaves after"
    assert global_region_hash(i["key"], i["regions_after_south_mutation"]) == \
        v["expect"]["global_after"], "global after"


def test_merkle_property_one_region_touches_only_its_leaf_and_root():
    v = _vec()
    i = v["inputs"]
    before = region_leaves(i["key"], i["regions"])
    after = region_leaves(i["key"], i["regions_after_south_mutation"])
    assert before["north"] == after["north"], "north leaf unchanged"
    assert before["east"] == after["east"], "east leaf unchanged"
    assert before["south"] != after["south"], "south leaf changed"
    assert global_region_hash(i["key"], i["regions"]) != \
        global_region_hash(i["key"], i["regions_after_south_mutation"]), "root changed"
    assert v["expect"]["north_leaf_unchanged"] is True, "pinned"
    assert v["expect"]["east_leaf_unchanged"] is True, "pinned"
    assert v["expect"]["south_leaf_changed"] is True, "pinned"


def test_verify_region_constant_time_leaf_gate():
    v = _vec()
    i = v["inputs"]
    south = i["regions"]["south"]
    leaf = region_hash(i["key"], south)
    assert verify_region(i["key"], south, leaf) is True, "correct leaf verifies"
    assert verify_region(i["key"], south, v["expect"]["leaves_after"]["south"]) is False, \
        "a stale/wrong leaf is rejected"


def test_golden_vector_diff_region_leaves_consumer():
    v = _vec()
    i = v["inputs"]
    diff = diff_region_leaves(region_leaves(i["key"], i["regions"]),
                              region_leaves(i["key"], i["regions_after_south_mutation"]))
    assert diff == v["expect"]["diff"], "pinned diff"
    assert diff == {"changed": ["south"], "added": [], "removed": []}, \
        "changed=[south] only"
    # added / removed: a region appearing or vanishing on the server is reported too
    with_extra = region_leaves(i["key"], i["regions"])
    with_extra["zenith"] = with_extra["south"]
    d2 = diff_region_leaves(region_leaves(i["key"], i["regions"]), with_extra)
    assert d2 == {"changed": [], "added": ["zenith"], "removed": []}, \
        "added region detected"
    d3 = diff_region_leaves(with_extra, region_leaves(i["key"], i["regions"]))
    assert d3 == {"changed": [], "added": [], "removed": ["zenith"]}, \
        "removed region detected"


if __name__ == "__main__":
    test_golden_vector_leaves_and_root()
    test_merkle_property_one_region_touches_only_its_leaf_and_root()
    test_verify_region_constant_time_leaf_gate()
    test_golden_vector_diff_region_leaves_consumer()
    print("region_hash Python parity: all 4 tests pass")
