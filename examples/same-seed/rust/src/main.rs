// same-seed demo (Rust / crates.io). Run: `cargo run`
// Prints the same 1d4 result + state hash as ts.mjs and py.py.
use serde_json::json;

fn main() {
    let input = json!({
        "worldId": "arena",
        "state": { "frame": 0, "epoch": 0, "worldSeed": 0,
                   "entities": { "e1": { "properties": { "x": 0 }, "tags": [] } } },
        "frameNumber": 1,
        "commands": [{ "playerId": "p1", "seq": 1, "actionId": "move" }],
        "ruleset": { "move": { "kind": "mutations", "mutations": [
            { "type": "add_prop", "target": "self", "property": "x",
              "value": { "type": "dice", "equation": "1d4" } }] } },
        "playerEntities": { "p1": "e1" }
    });

    let out_json = loom_frame::tick_frame_from_json(&input.to_string()).expect("tick");
    let out: serde_json::Value = serde_json::from_str(&out_json).unwrap();
    let x = &out["state"]["entities"]["e1"]["properties"]["x"];
    let hash = loom_snapshot::world_state_hash(b"demo-key", &out["state"]).unwrap();
    println!("Rust        x = {}  state_hash = {}", x, hash);
}
