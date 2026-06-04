# Loom Engine - Rust Deterministic Core Extraction (Phase 3 / v3.0)

Status: BLUEPRINT (not started). Target: the MMORPG era. Authored from the
2026-06-05 architecture pass (Gemini blueprint, triaged by Claude). v2.3.0
shipped the deterministic combat primitives in TypeScript; this is the plan to
promote the deterministic CORE to a language-agnostic Rust workspace so the SAME
seed yields BYTE-IDENTICAL results across TypeScript (browser), Python (the
Director backend), and C#/C++/Godot (future MMORPG clients/servers).

Hard invariant: cross-language determinism. If a Python-server replay diverges
from a TS-client one by a single byte, the `engine-is-truth` / anti-cheat /
replay guarantee is dead. So the core is built ONCE in Rust and bound to every
surface - never hand-ported per language.

## 1. Crate layout & core scope

Workspace `loom-engine-rs`, segregated into pure logic + surface bindings:
- `loom_math` - integer / fixed-point math + the deterministic RNG.
- `loom_events` - the HMAC-chained ledger, signing, event payload definitions.
- `loom_ecs` - a minimal deterministic ECS (or a `hecs` wrapper with ORDERED iteration).
- `loom_combat` - ruleset resolvers (5e/PF2e), range bands, initiative, conditions, reaction bus.
- Binding crates: `loom_wasm`, `loom_py`, `loom_c_abi`.

RNG: a raw, standalone **PCG32** (or Xoshiro256++) struct in `loom_math`, bitwise
ops + wrapping arithmetic only - NEVER the default `rand` ecosystem (impls drift
across versions). Guarantees `next_u32()` yields the same byte on wasm32 and
x86_64.

Math invariants: ZERO floating point. Spatial (range bands) + percentages use
integer or fixed-point (`fixed` crate, e.g. `I16F16`). Enforce
`#![deny(clippy::float_arithmetic)]` at every crate root - an `f32`/`f64` fails
the build instantly.

## 2. Binding strategy

Core exposes a purely functional, stateless interface:
`State + Event(s) -> Result<(NewState, HMAC), Error>`.

- TypeScript (browser): `wasm-bindgen` (auto TS types; WASM loaded once at boot).
  Also runs on Cloudflare Workers/edge with no new language.
- Python (backend): `UniFFI` (or `PyO3`) generates a native Python module -
  replaces the heavy `apply_5e_rule` Python logic with the one true core.
- C# (Unity) & C++/Godot: a clean C ABI in `loom_c_abi` (`#[no_mangle] pub
  extern "C"`, raw pointers + byte-array lengths). UniFFI also covers Swift/Kotlin.

Core signature (pseudo-Rust):
```rust
pub fn resolve_turn(previous_state_json: &str, event_payload_json: &str, seed: u64)
    -> Result<String, EngineError> {
    // 1. Deserialize strictly-ordered state (BTreeMap)
    // 2. Init PCG32 with `seed`
    // 3. Execute event (combat / movement / condition tick)
    // 4. Compute the new HMAC chain link
    // 5. Return new state + outcome-frame JSON
}
```

## 3. Cross-language determinism CI

A root `test_vectors/` holds thousands of golden-master JSON files:
```json
{ "ruleset": "pf2e", "initial_state": { "turn_gen": 12, "entities": [] },
  "event": { "kind": "combat.attack", "payload": { "target": "mob_1" } },
  "seed": 883719472, "expected_outcome": { "roll": 18, "damage": 12 },
  "expected_state_hash": "a1b2c3d4..." }
```
CI runs each vector through Rust (native), Python (`loom_py`), and TS/Node
(`loom_wasm`); if any output deviates by one byte, CI fails.

## 4. TS engine consumption (no rewrite)

v2.2.x TS stays the browser orchestrator; render + audio remain TS. Only the
SIMULATION delegates to WASM:
```js
var outcomeJson = LoomCoreWasm.resolve_event(
  JSON.stringify(currentState), JSON.stringify(playerAction), ledgerSeed);
var outcome = JSON.parse(outcomeJson);   // UI reacts to the state diff as today
```

## 5. Migration phasing (strangler-fig)

1. **PRNG & math extract** - PCG32 in Rust -> WASM/Python; swap ONLY dice rolling; verify identical sequences.
2. **Shadow mode** - port 5e/PF2e resolvers to Rust; run old + new side-by-side in TS + Python backends; log discrepancies; do NOT use Rust output yet.
3. **Event-replay validation** - rebuild projection tables from the `loom_events` ledger with the Rust core OFFLINE; assert byte-identical to the Python projection builder's SQLite state.
4. **Cutover** - point Python + TS at the Rust execution fns; delete the legacy math/combat logic.

## 6. Determinism pitfalls & kill strategies

- **HashMap** (SipHash, random keys) -> use `BTreeMap`/`BTreeSet` universally for any iterated state.
- **JSON key order** (breaks HMAC) -> `serde_json` with `preserve_order` DISABLED + `BTreeMap` to force sorted keys before HMAC.
- **Endianness** -> explicit `to_le_bytes()` when serializing PRNG state / HMAC seeds.
- **Floating point** (`0.1 + 0.2 != 0.3`) -> `#![deny(clippy::float_arithmetic)]` at crate roots; fixed-point only.

## 7. v2.3.0 -> v3.0 mapping (what's already extracted, in TS)

The v2.3.0 TS modules are the reference semantics the Rust core must reproduce
byte-for-byte (they become the first golden vectors):
- `runtime/range-bands` -> `loom_combat::range_bands` (integer feet thresholds).
- `runtime/reaction-economy` -> `loom_combat::reactions` (per-round ceiling).
- `runtime/narration-contract` -> a host-side validator (stays per-surface; not in the deterministic core - it reads prose, which is non-deterministic input).
- `runtime/ruleset` -> `loom_combat::ruleset` (action economy / initiative / conditions).

Open question for kickoff: highest schedule risk is **Phase 2 (shadow mode)** -
running dual logic in the live Python backend without perturbing latency or
state. Drill into the `loom_combat` 5e/PF2e resolver module structure first.
