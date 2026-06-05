"""Cross-language parity: the Python PCG32 + floor_div must reproduce the
authoritative Rust loom_math reference (test_vectors/v3_pcg32.json) bit-for-bit -
the same vector the TS port asserts."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from loom_engine.pcg32 import Pcg32, floor_div, floor_mod  # noqa: E402

_VECTOR = os.path.join(
    os.path.dirname(__file__), "..", "..", "test_vectors", "v3_pcg32.json"
)


def _vec():
    with open(_VECTOR, encoding="utf-8") as f:
        return json.load(f)


def test_pcg32_matches_rust_reference():
    v = _vec()["pcg32"]
    r = Pcg32.seeded(42)
    assert [r.next_u32() for _ in range(8)] == v["seed42_next8"]
    r = Pcg32.seeded(1)
    assert [r.next_u32() for _ in range(4)] == v["seed1_next4"]
    assert Pcg32.seeded(7).roll_dice(3, 6) == v["seed7_roll3d6"]
    r = Pcg32.seeded(7)
    assert [r.roll_die(20) for _ in range(5)] == v["seed7_die20x5"]


def test_floor_div_matches_rust():
    for c in _vec()["floor_div"]:
        assert floor_div(c["a"], c["b"]) == c["q"], (c["a"], c["b"])
    for a, b in [(7, 3), (-7, 3), (7, -3), (-7, -3), (10, 4)]:
        assert floor_div(a, b) * b + floor_mod(a, b) == a


if __name__ == "__main__":
    test_pcg32_matches_rust_reference()
    test_floor_div_matches_rust()
    print("pcg32 Python parity: all tests pass")
