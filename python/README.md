# loom-engine (Python)

The Python surface of [loom-engine](https://www.npmjs.com/package/loom-engine) - a
deterministic rules core for AI-run tabletop and RPG games.

```sh
pip install loom-engine-rpg   # the bare 'loom-engine' name is taken on PyPI
```
```python
import loom_engine            # the import name is loom_engine
```

The design principle: **the engine is truth.** Dice, action economy, initiative,
range, conditions, reactions, and validation are resolved by pure, replay-safe
code. An AI narrator can describe the outcome, but it never gets to invent the
roll, change the numbers, or rewrite what happened.

This package is a **byte-parity** port of the TypeScript engine: the same inputs
produce identical results in Python (your server/backend) and TypeScript (the
browser), so a server-authoritative resolution and a client one can never
disagree. That parity is enforced by a shared cross-language golden-vector suite.

## Modules (v2.3.0)

- `loom_engine.range_bands` - grid-free Engaged/Near/Far positioning.
- `loom_engine.reaction_economy` - the per-round "1 reaction per combatant" ceiling.
- `loom_engine.narration_contract` - `find_invented_number`: reject prose that
  states a mechanics number the engine never produced (numerals **and** number-words).
- `loom_engine.ruleset` - 5e + PF2e action economy, initiative ordering, conditions.

Pure stdlib, zero runtime dependencies. Compatible with the D&D 5e SRD (CC-BY-4.0)
and the Pathfinder 2e Remaster ruleset (ORC License); see `../NOTICE.md`. Not
affiliated with or endorsed by Wizards of the Coast or Paizo.

## Determinism

These modules use ordered dicts + explicit sorts for all logic (never `hash()`
ordering). For any cross-language hashing, serialize with
`json.dumps(obj, sort_keys=True, separators=(',', ':'))` and run with
`PYTHONHASHSEED=0`. Floats are banned in deterministic paths.
