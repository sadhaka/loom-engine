# same-seed — byte-identical simulation across languages

Run the *same* one-frame simulation (a `move` that rolls 1d4) in TypeScript and Python,
from the published packages, and get the **same dice result and the same state hash**.
That is the whole claim of the engine, reproducible on your machine in under two minutes.

## TypeScript (npm)
```bash
npm install loom-engine
node ts.mjs
```

## Python (PyPI)
```bash
pip install loom-engine-native
python py.py
```

## Rust (crates.io)
```bash
cd rust && cargo run
```

## Expected output (identical on all three)
```
x = 4   state_hash = cea43ee25ad95f845260985846936bd81f2b6d1aa735102cfd001295654b0a54
```

Same seed in, same byte-for-byte result out — on npm, the PyPI native wheel, the Rust
crates (`cargo add loom_frame`), the WASM build, and the C ABI. The dice and the state are
the engine's; an AI layer only narrates what the engine already resolved.

> The `worldId`, the action, and the `worldSeed` fully determine the roll. Change any of
> them and *both* surfaces change together — never one without the other. That cross-
> language agreement is pinned by the repo's golden-vector suite, run in CI on every commit.
