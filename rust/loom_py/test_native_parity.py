"""Parity test for the native (PyO3) loom_engine_native module.

Proves the compiled Rust Python-extension produces byte-identical results to the
shared cross-language golden vectors - i.e. native-Rust == TS == pure-Python ==
core-Rust. Run after building/installing the wheel:

    maturin develop            # into the active venv
    python rust/loom_py/test_native_parity.py

Loads the SAME ../../test_vectors/*.json the TS/Python/Rust harnesses load.
"""
import json
import os
import sys

import loom_engine_native as ln

HERE = os.path.dirname(os.path.abspath(__file__))
VEC = os.path.join(HERE, "..", "..", "test_vectors")
PASS = 0


def ck(label, cond):
    global PASS
    if not cond:
        raise AssertionError("FAIL " + label)
    PASS += 1


def ref_initiative(entries):
    """The core's tiebreak: total/modifier/d20 DESC, then NUMERIC-aware id ASC.
    These ids are integers, so the id tiebreak is numeric (2 before 10)."""
    return [e[0] for e in sorted(
        entries, key=lambda e: (-e[1], -e[2], -e[3], e[0]))]


def main():
    ck("version", ln.version() == "0.1.0" and ln.__version__ == "0.1.0")

    prims = json.load(open(os.path.join(VEC, "v2_3_0_primitives.json"), encoding="utf-8"))
    for c in prims["range_bands.band_from_distance_ft"]:
        ck("band_from_distance_ft%s" % c["args"],
           ln.band_from_distance_ft(int(c["args"][0])) == c["expect"])
    for c in prims["range_bands.band_within"]:
        ck("band_within%s" % c["args"],
           ln.band_within(c["args"][0], c["args"][1]) == c["expect"])

    # initiative i64 API vs the core's numeric-aware tiebreak (2 before 10).
    for es in ([(7, 18, 2, 16), (3, 18, 5, 13), (9, 12, 1, 11), (4, 21, 3, 18)],
               [(10, 15, 2, 12), (2, 15, 2, 12)],
               [(1, 20, 0, 10), (2, 20, 0, 10), (3, 5, 9, 2)]):
        ck("initiative_order_ids %s" % es,
           ln.initiative_order_ids(es) == ref_initiative(es))

    # event chain: HMAC primitive + per-record signatures must match the
    # TS-generated golden sigs (the native Rust chain == the TS chain).
    ev = json.load(open(os.path.join(VEC, "event_chain_v1.json"), encoding="utf-8"))
    for h in ev["hmac"]:
        ck("hmac %r" % h["message"][:20],
           ln.hmac_sha256_hex(h["key"].encode("utf-8"), h["message"]) == h["expect"])
    for ch in ev["chains"]:
        key = ch["key"].encode("utf-8")
        prev = ch["genesis"]
        for i, rec in enumerate(ch["records"]):
            sig = ln.sign_record(key, i + 1, rec["type"],
                                 json.dumps(rec["payload"]), prev)
            ck("%s sig %d" % (ch["label"], i), sig == ch["expect_sigs"][i])
            prev = sig

    # determinism + Python-floor division semantics
    ck("dice deterministic", ln.roll_die(12345, 20) == ln.roll_die(12345, 20))
    ck("floor_div(-7,2)==-4", ln.floor_div(-7, 2) == -4)
    ck("floor_div(7,2)==3", ln.floor_div(7, 2) == 3)

    print("native parity: passed=%d" % PASS)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(str(e))
        sys.exit(1)
