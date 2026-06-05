"""same-seed demo (Python / PyPI). Run: `pip install loom-engine-native && python py.py`
Prints the same 1d4 result + state hash as ts.mjs (and the Rust/WASM/C-ABI surfaces)."""
import json
import loom_engine_native as native

INPUT = {
    "worldId": "arena",
    "state": {"frame": 0, "epoch": 0, "worldSeed": 0,
              "entities": {"e1": {"properties": {"x": 0}, "tags": []}}},
    "frameNumber": 1,
    "commands": [{"playerId": "p1", "seq": 1, "actionId": "move"}],
    "ruleset": {"move": {"kind": "mutations", "mutations": [
        {"type": "add_prop", "target": "self", "property": "x",
         "value": {"type": "dice", "equation": "1d4"}}]}},
    "playerEntities": {"p1": "e1"},
}

r = json.loads(native.tick_frame(json.dumps(INPUT)))
print("Python      x =", r["state"]["entities"]["e1"]["properties"]["x"],
      " state_hash =", native.world_state_hash("demo-key", json.dumps(r["state"])))
