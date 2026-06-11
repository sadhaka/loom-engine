"""Parity: the native PyO3 surface (loom_engine_native) resolves the golden
vectors byte-identically to the pure-Python port AND the TS / Rust / WASM cores.

This proves the "one compiled Rust core, every surface" thesis on the Python side:
the same loom_snapshot / loom_ruleset / loom_epoch crates that the WASM surface
binds for the browser are bound here for the Python server. Build the module first:
    maturin develop -m rust/loom_py/Cargo.toml   (into the active venv)
If the module is not importable, every test SKIPS with a clear reason - so a
port-only CI never breaks. Individual tests also SKIP (never error) when the
installed wheel predates the surface they exercise; rebuild to un-skip.

Run via pytest (discovered through python/pyproject.toml [tool.pytest.ini_options]):
    python -m pytest python/tests
or as a plain script:
    python python/tests/test_native_surface.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_BUILD_HINT = "build it into the active venv: maturin develop -m rust/loom_py/Cargo.toml"

try:
    import loom_engine_native as native
except ImportError:
    native = None

if native is None:
    _REASON = "loom_engine_native is not installed - " + _BUILD_HINT
    if "pytest" in sys.modules:
        import pytest

        pytest.skip(_REASON, allow_module_level=True)
    else:
        print("SKIP: " + _REASON)
        sys.exit(0)

from loom_engine.world_snapshot import world_state_hash  # noqa: E402

_DIR = os.path.dirname(__file__)


class _PlainSkip(Exception):
    """Plain-script stand-in for pytest.skip (used when pytest is not loaded)."""


def _skip(reason):
    if "pytest" in sys.modules:
        import pytest

        pytest.skip(reason)
    raise _PlainSkip(reason)


def _native_fn(name):
    """Resolve a native function or SKIP with the rebuild hint (stale wheel)."""
    fn = getattr(native, name, None)
    if fn is None:
        _skip(
            "installed loom_engine_native "
            + native.version()
            + " predates ."
            + name
            + "() - "
            + _BUILD_HINT
        )
    return fn


def _load(name):
    with open(os.path.join(_DIR, "..", "..", "test_vectors", name), encoding="utf-8") as f:
        return json.load(f)


def test_native_primitives_match_golden():
    band_from = _native_fn("band_from_distance_ft")
    band_within = _native_fn("band_within")
    v = _load("v2_3_0_primitives.json")
    for c in v["range_bands.band_from_distance_ft"]:
        assert band_from(int(c["args"][0])) == c["expect"], str(c["args"])
    for c in v["range_bands.band_within"]:
        assert band_within(c["args"][0], c["args"][1]) == c["expect"], str(c["args"])
    # ruleset.initiative_order_ids stays with the pure ports: the golden ids
    # are strings ("a", "b", ...) and the native API is i64-only.


def test_native_event_chain_matches_golden():
    hmac_hex = _native_fn("hmac_sha256_hex")
    sign = _native_fn("sign_record")
    v = _load("event_chain_v1.json")
    for h in v["hmac"]:
        assert hmac_hex(h["key"].encode("utf-8"), h["message"]) == h["expect"], h["message"][:24]
    for ch in v["chains"]:
        key = ch["key"].encode("utf-8")
        prev = ch["genesis"]
        for i, rec in enumerate(ch["records"]):
            # sign_record canonicalizes the payload JSON internally, so plain
            # json.dumps formatting is fine here.
            sig = sign(key, i + 1, rec["type"], json.dumps(rec["payload"]), prev)
            assert sig == ch["expect_sigs"][i], "%s sig %d" % (ch["label"], i)
            prev = sig
        assert prev == ch["expect_head"], ch["label"] + " head"


def test_native_pcg32_matches_golden():
    pcg32_next = _native_fn("pcg32_next")
    roll_die = _native_fn("roll_die")
    roll_dice = _native_fn("roll_dice")
    floor_div = _native_fn("floor_div")
    v = _load("v3_pcg32.json")
    # pcg32_next / roll_die are stateless first-draw helpers, so they pin the
    # first element of each golden sequence; the full sequences are asserted
    # by the pure-Python / TS / Rust harnesses.
    assert pcg32_next(42) == v["pcg32"]["seed42_next8"][0]
    assert pcg32_next(1) == v["pcg32"]["seed1_next4"][0]
    assert roll_dice(7, 3, 6) == v["pcg32"]["seed7_roll3d6"]
    assert roll_die(7, 20) == v["pcg32"]["seed7_die20x5"][0]
    for c in v["floor_div"]:
        if c["b"] == 0:
            # The pure ports pin floor_div(a, 0) == 0; the PyO3 surface
            # deliberately raises instead (Codex P1) - assert the raise.
            try:
                floor_div(c["a"], c["b"])
                raise AssertionError("floor_div(%d, 0) should raise ValueError" % c["a"])
            except ValueError:
                pass
        else:
            assert floor_div(c["a"], c["b"]) == c["q"], str(c)


def test_native_snapshot_surface_matches_golden():
    ws_hash = _native_fn("world_state_hash")
    v = _load("v3_0_snapshot_canonical.json")
    for c in v["cases"]:
        assert ws_hash(c["key"], json.dumps(c["input"])) == c["expect_hash"], c["label"]


def test_native_ast_surface_matches_golden():
    apply_mut = _native_fn("apply_triggered_mutations")
    eval_action = _native_fn("evaluate_action")
    v = _load("v3_ast_bleed.json")
    for c in v["cases"]:
        seed = int(c["seed"])
        key = c["key"]
        if c["kind"] == "condition":
            out = json.loads(apply_mut(
                json.dumps(c["state"]), json.dumps(c["mutations"]), c["actor"], c.get("target"), seed))
            assert world_state_hash(key, out) == c["expect"]["state_hash"], c["label"]
        else:
            out = json.loads(eval_action(
                json.dumps(c["state"]), json.dumps(c["check"]), c["actor"], c.get("target"), seed))
            assert out["degree"] == c["expect"]["degree"], c["label"] + " degree"
            assert world_state_hash(key, out["state"]) == c["expect"]["state_hash"], c["label"] + " hash"


def test_native_epoch_surface_matches_golden():
    tick_epoch = _native_fn("tick_epoch")
    catch_up = _native_fn("catch_up_epochs")
    v = _load("v3_3_epoch_tick.json")
    for c in v["cases"]:
        key = c["key"]
        if c["kind"] == "tick":
            r = json.loads(tick_epoch(json.dumps(c)))
            assert world_state_hash(key, r["state"]) == c["expect"]["state_hash"], c["label"] + " state"
            assert world_state_hash(key, [r["event"]]) == c["expect"]["events_hash"], c["label"] + " events"
        else:
            r = json.loads(catch_up(json.dumps(c)))
            assert world_state_hash(key, r["state"]) == c["expect"]["state_hash"], c["label"] + " state"
            assert world_state_hash(key, r["events"]) == c["expect"]["events_hash"], c["label"] + " events"


def test_native_session_surface_matches_golden():
    resume = _native_fn("resume_session")
    v = _load("v3_4_world_session.json")
    i = v["inputs"]
    out = json.loads(resume(json.dumps(i)))
    assert world_state_hash(i["key"], out["state"]) == v["expect"]["final_state_hash"], "final state"
    assert world_state_hash(i["key"], out["newEvents"]) == v["expect"]["newEvents_hash"], "newEvents"
    assert out["state"]["epoch"] == v["expect"]["final_epoch"], "final epoch"
    assert out["epochsResolved"] == v["expect"]["epochsResolved"], "resolved"
    assert out["epochsVoided"] == v["expect"]["epochsVoided"], "voided"


def test_native_frame_surface_matches_golden():
    tick_frame = _native_fn("tick_frame")
    v = _load("v5_1_command_frame.json")
    for c in v["cases"]:
        out = json.loads(tick_frame(json.dumps(c)))
        assert world_state_hash(c["key"], out["state"]) == c["expect"]["state_hash"], c["label"] + " state"
        assert world_state_hash(c["key"], [out["event"]]) == c["expect"]["event_hash"], c["label"] + " event"


def test_native_reconcile_surface_matches_golden():
    reconcile = _native_fn("reconcile_frames")
    v = _load("v5_2_reconciliation.json")
    i = v["inputs"]
    req = {"worldId": i["worldId"], "correctedState": i["server_corrected_state"],
           "commandsByFrame": i["reconcile_commands_by_frame"], "toFrame": i["to_frame"],
           "ruleset": i["ruleset"], "playerEntities": i["playerEntities"]}
    out = json.loads(reconcile(json.dumps(req)))
    assert world_state_hash(i["key"], out["state"]) == v["expect"]["reconciled_102_hash"], "reconciled state"
    assert out["framesReplayed"] == v["expect"]["frames_replayed"], "frames replayed"


def test_native_region_surface_matches_golden():
    grh = _native_fn("global_region_hash")
    v = _load("v5_3_region_hash.json")
    i = v["inputs"]
    g = grh(i["key"], json.dumps(i["regions"]))
    assert g == v["expect"]["global_before"], "global region hash (before)"
    g_after = grh(i["key"], json.dumps(i["regions_after_south_mutation"]))
    assert g_after == v["expect"]["global_after"], "global region hash (after south mutation)"
    assert g != g_after, "south mutation must change the global root"


if __name__ == "__main__":
    _TESTS = [
        test_native_primitives_match_golden,
        test_native_event_chain_matches_golden,
        test_native_pcg32_matches_golden,
        test_native_snapshot_surface_matches_golden,
        test_native_ast_surface_matches_golden,
        test_native_epoch_surface_matches_golden,
        test_native_session_surface_matches_golden,
        test_native_frame_surface_matches_golden,
        test_native_reconcile_surface_matches_golden,
        test_native_region_surface_matches_golden,
    ]
    passed = 0
    skipped = 0
    for t in _TESTS:
        try:
            t()
            passed += 1
        except _PlainSkip as e:
            skipped += 1
            print("SKIP " + t.__name__ + ": " + str(e))
    print("loom_engine_native parity: %d passed, %d skipped" % (passed, skipped))
