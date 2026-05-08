# Survivor Mini

Autobattler showcase. Player stands at world center; skeleton mobs spawn
from random screen edges and pursue; the player auto-fires projectiles at
the nearest live mob each tick.

## Run it

```sh
# from the repo root
npm run build:all
python -m http.server 8765
# browse http://localhost:8765/demo/survivor-mini/
```

`build:all` compiles both the engine (`tsc`) and every demo
(`tsc -p tsconfig.demo.json`). The demo's HTML uses an `importmap`
to resolve `@sadhaka/loom-engine` to the local `dist/index.js`, so the
TypeScript source reads identically to a real npm consumer.

## Engine concepts demonstrated

- **`Engine.create({ canvas })`** - builds the world, the Canvas2D
  device, and the default render system in a single call.
- **Component pools** - `TransformPool`, `SpritePool`, `HealthPool`,
  `PursuePool`, `RangedAttackPool` are SoA stores keyed by entity index,
  attached via `pool.attach(entity, ...)`.
- **`spawnMob`** - `MOB_CATALOG` factory that wires Transform + Sprite +
  Health + Pursue (and RangedAttack for archers/casters) per archetype.
- **System phases** - INPUT then LOGIC (auto-target, spawn, pursue, fire,
  death) then PHYSICS (projectile motion + hit-test) then ANIMATION then
  RENDER. Phase boundaries are explicit in the `addSystem` calls.
- **Auto-targeting** - `RangedAttackPool` stores a single `targetIndex`
  per firer. The custom `AutoTargetSystem` rewrites the player's slot
  each tick to the nearest live enemy; `RangedAttackSystem` reads the
  fresh value and fires in the same frame.

## Where to read next

- `src/components/ranged-attack.ts` - per-entity firing config.
- `src/systems/projectile-system.ts` - hit-test + lifetime.
- `src/combat/mob-catalog.ts` - the three baseline mob archetypes
  (warrior / archer / caster) and the `spawnMob` factory.
