# Delve Mini - a seeded roguelike run

One shareable seed drives a whole crawl. The same seed produces the **same
dungeon, the same fights, the same loot, the same death** - byte for byte, every
time, on every surface that runs the engine. No other JS/Python roguelike engine
can make that promise, because here the dice and the layout are seeded and
deterministic by construction.

## What it chains

Delve Mini takes seven engine primitives that already shipped in isolation and
runs them as one pipeline (`tests/delve-mini-run.ts`, `runDelve(seed)`):

| Step | Primitive | What it does |
|------|-----------|--------------|
| 1 | `DungeonGenerator` (BSP) | carves rooms + corridors from the seed |
| 2 | `bestiary` | one creature per room; the last room is the boss |
| 3 | `TileMap` | places the spawn + foe markers at room centres |
| 4 | `Pcg32` | seeded, surface-stable combat dice (the engine's PRNG) |
| 5 | `LootTable` | rolls drops on each kill |
| 6 | `InventoryGrid` | the satchel that holds them |
| 7 | `SaveSlots` + `Leaderboard` | persist a run and rank it (see the test) |

## The reference run

Seed `crypt-of-names` carves a **14-room** dungeon (528 floor tiles). The crawler
clears 10 rooms of the bone-host - Skeleton Archers, Warriors, Casters, a Bone
Reaver, the Choir - then falls in room 11, one short of the First Standing at the
heart of the crypt. Score 1172, loot value 172. Run fingerprint: **`23f71bf5`**.

Change the seed, get a different crypt and a different fate. Run the same seed
twice, get the identical 11-line combat log.

## The proof

`tests/delve-mini.test.ts` runs in `npm test`, so the demo logic can never rot.
It:

- runs the whole crawl **twice in-process and asserts the results are
  byte-identical** (same seed = same run),
- pins the run **fingerprint** as a regression (`23f71bf5`),
- proves **different seeds diverge**,
- exercises the **SaveSlots round-trip** (a run saved and loaded back unchanged)
  and the **Leaderboard ranking** of three runs.

```bash
npx tsx --test tests/delve-mini.test.ts
```

## Browser visual (follow-up)

`runDelve()` (in `tests/delve-mini-run.ts`) is pure and renders cleanly, but a browser page needs the demo
import map to resolve `@sadhaka/loom-engine` to the built bundle, which the
headless proof above deliberately does not depend on (it imports `src/` so it
tests the same engine the rest of `npm test` does). The interactive canvas page
is a follow-up; the determinism guarantee it would show is already proven here.
