// same-seed demo (TypeScript / npm). Run: `npm install loom-engine && node ts.mjs`
// Prints the same 1d4 result + state hash as py.py (and the Rust/WASM/C-ABI surfaces).
import { tickFrame, worldStateHash } from "loom-engine";

const input = {
  worldId: "arena",
  state: { frame: 0, epoch: 0, worldSeed: 0, entities: { e1: { properties: { x: 0 }, tags: [] } } },
  frameNumber: 1,
  commands: [{ playerId: "p1", seq: 1, actionId: "move" }],
  ruleset: { move: { kind: "mutations", mutations: [
    { type: "add_prop", target: "self", property: "x", value: { type: "dice", equation: "1d4" } } ] } },
  playerEntities: { p1: "e1" },
};

const r = tickFrame(input);
console.log("TypeScript  x =", r.state.entities.e1.properties.x,
            " state_hash =", worldStateHash("demo-key", r.state));
