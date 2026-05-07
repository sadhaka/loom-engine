# Loom Engine

Custom 2D / 2.5D game engine for [TheWorldTable.ai](https://theworldtable.ai).
Canvas2D primary backend, ECS, render-graph stages, Director-bridge
integration. No external engine reuse - built from scratch in TypeScript.

This is a sibling repository to the main TheWorldTable.ai project at
`D:\Thailand Family\docker\`. It has its own git history and remote
([sadhaka/loom-engine](https://github.com/sadhaka/loom-engine)). The
full design specification lives in the main repo at
[../docker/LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md).

## Status

**Phase 5 complete** (audio + input). Phases 0 through 5 of the
spec roadmap are in place; Phase 6 (Director-bridge) waits on
backend SSE endpoint per LOOM-DIRECTOR-PROTOCOL.md.

| Phase | Status | Surface |
|---|---|---|
| 0 | shipped | scaffolding, package.json, tsconfig, PRIOR-ART log |
| 1 | shipped | Canvas2D iso renderer, camera, transform pool (SoA) |
| 2 | shipped | ECS World, system scheduler, resource registry, Engine facade, asset pipeline |
| 3 | shipped | clip-aware sprite-sheet manifests, AnimationStatePool, AnimationSystem |
| 4 | shipped | particle pool, emitter component, three-system VFX pipeline, additive blend |
| 5 | shipped | Web Audio bus mixer with VE-budget gating, unified keyboard / mouse / touch input |
| 6 | pending | Director-bridge: SSE event-stream subscription, scene-state derivation |
| 7 | pending | port the existing Survivor combat layer onto Loom Engine |
| 8 | pending | 2.5D ARPG hub-and-spoke per LOOM-CLASS-SYSTEM-SPEC |
| 9+ | pending | polish, perf pass, post-funding 3D extension, productization |

See [LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md) Section 7
for the full phase plan with effort estimates.

## Build

```sh
npm install
npm run build         # tsc src/ -> dist/
npm run build:demo    # tsc demo/*.ts -> demo/*.js
npm run build:all     # both
npm run watch         # rebuild src on change
npm run test          # tsx tests/*.test.ts
npm run clean         # remove dist + compiled demo
```

## Run the demo

```sh
npm run build:all
python -m http.server 8765
# browse http://localhost:8765/demo/index.html
```

Controls:
- **Arrow keys / WASD**: pan camera
- **Click**: burst 24 particles + play SFX chirp (after first click, AudioContext unlocks)
- **Hover**: stats panel shows the iso tile under the cursor

## Layout

```
loom-engine/
  src/
    util/               math, color, typed-arrays
    components/         transform, sprite, particle-emitter
    renderer/           graphics-device, canvas2d-device, camera, iso-projection
    animation/          animation-clip, animation-state-pool
    asset/              sprite-sheet-loader
    audio/              audio-bus
    input/              input-manager
    systems/            sprite-render, animation, particle-{simulation,emitter,render}, input, veil-budget
    vfx/                particle-pool
    entity.ts           entity allocator (32-bit handle, generation guard)
    world.ts            ECS World class
    system.ts           System interface + phase constants
    resources.ts        ResourceRegistry + Time + VeilBudget
    engine.ts           Engine facade
    index.ts            public API barrel
  demo/                 browser demo (one tile + animated knight + sparkles + click-to-burst)
  tests/                node-based smoke tests (tsx --test)
  assets/               placeholder game assets (knight walk-cycle PNG + JSON)
  tools/                helper scripts (gen-knight.py - Pillow generator)
  PRIOR-ART.md          cumulative inspirations log (clean-room defense)
  package.json          tsc + tsx as only dev deps
  tsconfig.json         ES2022 strict + noUncheckedIndexedAccess
  dist/                 tsc output (gitignored)
  node_modules/         npm install output (gitignored)
```

## Architecture quick-reference

- **ECS** over god-object scene graph - entities are 32-bit handles,
  components live in pools indexed by entity index
- **Structure-of-arrays** for hot data (TransformPool, SpritePool,
  ParticlePool, ParticleEmitterPool, AnimationStatePool) - tight
  iteration over Float32Arrays, no per-entity object allocation
- **IGraphicsDevice** abstraction with Canvas2D primary backend
  (WebGL2 reserved for Phase 2+ if profiling demands)
- **6-phase scheduler** - INPUT -> LOGIC -> PHYSICS -> ANIMATION ->
  RENDER -> POST_RENDER, deterministic registration order within each
- **VeilBudgetResource** - the patent-defensible novelty hook. Single
  resource with `particleBudget`, `audioBudget`, `shaderBudget`,
  `eventBudget`. VeilBudgetSystem propagates updates to ParticlePool,
  AudioBus, etc. Director-bridge mutates the budget; subsystems read
- **Frame loop** - `engine.tick(now)` runs in this order:
  1. compute dt (clamped to 1/30s)
  2. advance Time resource
  3. device.beginFrame
  4. world.update (walks all phases)
  5. device.endFrame

## Public API surface (Phase 5)

```ts
import {
  Engine,
  // ECS
  POOL_TRANSFORM, POOL_SPRITE, POOL_ANIMATION, POOL_PARTICLE,
  POOL_EMITTER,
  TransformPool, SpritePool, AnimationStatePool, ParticlePool,
  ParticleEmitterPool,
  SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_PHYSICS,
  SYSTEM_PHASE_ANIMATION, SYSTEM_PHASE_RENDER, SYSTEM_PHASE_POST_RENDER,
  // Default systems
  AnimationSystem, SpriteRenderSystem,
  ParticleEmitterSystem, ParticleSimulationSystem, ParticleRenderSystem,
  InputSystem, VeilBudgetSystem,
  // Resources
  RESOURCE_TIME, RESOURCE_CAMERA, RESOURCE_DEVICE,
  RESOURCE_VEIL_BUDGET, RESOURCE_INPUT, RESOURCE_AUDIO_BUS,
  // Renderer
  Canvas2DDevice, ISO_TILE_WIDTH, ISO_TILE_HEIGHT,
  // Asset
  loadSpriteSheet, computeFrameIndex,
  // Audio
  AudioBus, AUDIO_BUDGET_AMBIENT_FLOOR, AUDIO_BUDGET_ESSENTIAL_FLOOR,
  // Input
  InputManager,
  // Math + color
  vec2, vec3, rect, clamp, lerp,
  hexToRgba, rgbaToCssString,
  COLOR_KNOT_STR, COLOR_KNOT_DEX, COLOR_KNOT_INT, COLOR_KNOT_CENTER,
  // Iso
  tileToIso, worldToIso, isoToTile, isoDepthKey,
} from '@theworldtable/loom-engine';

const engine = Engine.create({ canvas });
engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
engine.world.addSystem(new VeilBudgetSystem(), SYSTEM_PHASE_INPUT);
// ... game systems ...
engine.world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
function tick(now: number) {
  engine.tick(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

## Patent strategy

The engine's defensible novelty is in the **Loom integration layer**,
not the rasterizer. Director-driven scene state, Veil Essence economy
gating render budget, knot-aware encounter generation, event-sourced
rendering. The renderer underneath uses public-domain techniques
(sprite batching, isometric projection, ECS) implemented from scratch.

See [PRIOR-ART.md](./PRIOR-ART.md) for the cumulative inspirations
log (public talks, papers, OSS architecture - took / declined per
source).

Every architectural commit names its inspirations in plain text. No
copy-paste from any external engine source. PRIOR-ART.md is the
audit trail any future productization or patent dispute would lean on.

## Test coverage

102 / 102 tests pass on Node 24 via `tsx --test`. Coverage by area:

- math, color, entity, transform, iso, camera (Phase 1): 20 tests
- world, system scheduling, sprite pool, sprite render, time (Phase 2): 14 tests
- asset loader, sprite-sheet manifest, frame stepper (Phase 2 sibling): 15 tests
- animation clip math, state pool, animation system end-to-end (Phase 3): 16 tests
- particle pool, emitter pool, simulation, emitter system, veil budget (Phase 4): 19 tests
- audio bus + ducking, input manager, input system, veil budget propagation (Phase 5): 18 tests

Run via `npm test`. Each suite is fully node-based; no DOM dependency.
Browser-only paths (Canvas2DDevice rasterization, AudioContext
unlock, DOM event listeners) are exercised via the demo's preview
verification, not unit tests.

## License

Private / unlicensed. Productization decision deferred to post-Phase 9
per spec Section 10 O7.

## Contributing

This is a single-author project (Misha Mitiev) for TheWorldTable.ai.
Pull requests from outside contributors are not accepted at this stage.
External productization (open-source release, asset-store sale, or
SaaS offering) is a post-Phase 9 decision.
