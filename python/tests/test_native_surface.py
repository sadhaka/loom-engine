"""Parity: the native PyO3 surface (loom_engine_native) resolves the golden
vectors byte-identically to the pure-Python port AND the TS / Rust / WASM cores.

This proves the "one compiled Rust core, every surface" thesis on the Python side:
the same loom_snapshot / loom_ruleset / loom_epoch crates that the WASM surface
binds for the browser are bound here for the Python server. Build the module first:
    maturin develop -m rust/loom_py/Cargo.toml   (into the active venv)
If the module is not importable, the test SKIPS (so it never breaks a port-only CI)."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    import loom_engine_native as native
except ImportError:
    print("loom_engine_native not built (maturin develop -m rust/loom_py/Cargo.toml); SKIP")
    sys.exit(0)

from loom_engine.world_snapshot import world_state_hash  # noqa: E402

_DIR = os.path.dirname(__file__)


def _load(name):
    with open(os.path.join(_DIR, "..", "..", "test_vectors", name), encoding="utf-8") as f:
        return json.load(f)


def test_native_ast_surface_matches_golden():
    v = _load("v3_ast_bleed.json")
    for c in v["cases"]:
        seed = int(c["seed"])
        key = c["key"]
        if c["kind"] == "condition":
            out = json.loads(native.apply_triggered_mutations(
                json.dumps(c["state"]), json.dumps(c["mutations"]), c["actor"], c.get("target"), seed))
            assert world_state_hash(key, out) == c["expect"]["state_hash"], c["label"]
        else:
            out = json.loads(native.evaluate_action(
                json.dumps(c["state"]), json.dumps(c["check"]), c["actor"], c.get("target"), seed))
            assert out["degree"] == c["expect"]["degree"], c["label"] + " degree"
            assert world_state_hash(key, out["state"]) == c["expect"]["state_hash"], c["label"] + " hash"


def test_native_epoch_surface_matches_golden():
    v = _load("v3_3_epoch_tick.json")
    for c in v["cases"]:
        key = c["key"]
        if c["kind"] == "tick":
            r = json.loads(native.tick_epoch(json.dumps(c)))
            assert world_state_hash(key, r["state"]) == c["expect"]["state_hash"], c["label"] + " state"
            assert world_state_hash(key, [r["event"]]) == c["expect"]["events_hash"], c["label"] + " events"
        else:
            r = json.loads(native.catch_up_epochs(json.dumps(c)))
            assert world_state_hash(key, r["state"]) == c["expect"]["state_hash"], c["label"] + " state"
            assert world_state_hash(key, r["events"]) == c["expect"]["events_hash"], c["label"] + " events"


def test_native_session_surface_matches_golden():
    v = _load("v3_4_world_session.json")
    i = v["inputs"]
    out = json.loads(native.resume_session(json.dumps(i)))
    assert world_state_hash(i["key"], out["state"]) == v["expect"]["final_state_hash"], "final state"
    assert world_state_hash(i["key"], out["newEvents"]) == v["expect"]["newEvents_hash"], "newEvents"
    assert out["state"]["epoch"] == v["expect"]["final_epoch"], "final epoch"
    assert out["epochsResolved"] == v["expect"]["epochsResolved"], "resolved"
    assert out["epochsVoided"] == v["expect"]["epochsVoided"], "voided"


if __name__ == "__main__":
    test_native_ast_surface_matches_golden()
    test_native_epoch_surface_matches_golden()
    test_native_session_surface_matches_golden()
    print("loom_engine_native parity: all golden cases pass")
