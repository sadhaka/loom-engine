# Loom Engine

Browser-first 2D / 2.5D game engine for [TheWorldTable.ai](https://theworldtable.ai).
Canvas2D primary backend, ECS, render-graph stages, Director-bridge
SSE integration. No external engine reuse - built from scratch in
TypeScript.

Repo: [sadhaka/loom-engine](https://github.com/sadhaka/loom-engine).
API docs: [loom-engine.pages.dev](https://loom-engine.pages.dev/).
The design spec (`LOOM-ENGINE-SPEC.md`) lives in the consuming
TheWorldTable.ai repo and is the canonical source for phase
plans and architectural decisions.

## Install

```sh
npm install @sadhaka/loom-engine
```

Pre-alpha. ESM-only, browser-first. TypeScript types ship in the
package (`dist/index.d.ts`). Node 18+ for the build toolchain;
the runtime targets evergreen browsers (Canvas2D + Web Audio +
EventSource).

## Documentation

API reference (TypeDoc) - generated from the public surface in
[`src/index.ts`](./src/index.ts) on every push to `main`:
**https://loom-engine.pages.dev/**

Build it locally with `npm run docs` (writes to `./docs/`).

See [Docs deploy](#docs-deploy) for the hosting chain and one-time
activation steps (Cloudflare Pages, since GitHub Pages is unavailable
on private repos for free user plans).

## Quickstart

```ts
// 1. Install
//    npm install @sadhaka/loom-engine
import {
  Engine,
  SpriteRenderSystem,
  InputSystem,
  VeilBudgetSystem,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_RENDER,
} from '@sadhaka/loom-engine';

// 2. Attach to a canvas. Engine.create wires Canvas2DDevice, World,
//    TransformPool, SpritePool, Time + Camera resources, and the
//    default SpriteRenderSystem in SYSTEM_PHASE_RENDER.
var canvas = document.querySelector('canvas');
var engine = Engine.create({ canvas: canvas });

// 3. Register the systems your game needs. Order within a phase is
//    deterministic; phases run INPUT -> LOGIC -> PHYSICS -> ANIMATION
//    -> RENDER -> POST_RENDER per frame.
engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
engine.world.addSystem(new VeilBudgetSystem(), SYSTEM_PHASE_INPUT);

// 4. Drive the frame loop. engine.tick advances Time, beginFrame on
//    the device, world.update across all phases, endFrame.
function tick(now) {
  engine.tick(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

## Configuration

### Director-bridge credentials (security note)

`SSEDirectorBridge` and `SnapshotRecoveryHelper` send credentials with
their network requests by default. The default `eventSourceFactory`
constructs `new EventSource(url, { withCredentials: true })` and
`SnapshotRecoveryHelper` calls `fetch(url, { credentials: 'include' })`.
This is the right default for the embedded TheWorldTable.ai
same-origin use case (cookies + auth headers flow with the request
to the same origin), but **a third-party consumer pointing the bridge
at a URL configured from user input could end up sending their own
site's credentials cross-origin** (the browser still requires the
target server to opt in via `Access-Control-Allow-Credentials: true`
plus a specific `Access-Control-Allow-Origin`, so this is not a
one-sided SSRF; it requires attacker control of the target server's
CORS policy).

If you do not want credentials to flow with director-bridge requests,
override the seams the engine already exposes - no engine code change
needed:

```ts
import {
  SSEDirectorBridge,
  SnapshotRecoveryHelper,
} from '@sadhaka/loom-engine';

// Credential-free SSE subscription.
var bridge = new SSEDirectorBridge({
  baseUrl: directorUrl,
  characterId: characterId,
  eventSourceFactory: function(u) {
    return new EventSource(u, { withCredentials: false });
  },
});

// Credential-free snapshot recovery.
var recovery = new SnapshotRecoveryHelper({
  baseUrl: snapshotUrl,
  characterId: characterId,
  fetchImpl: function(input, init) {
    var safeInit = Object.assign({}, init, { credentials: 'omit' });
    return fetch(input, safeInit);
  },
});
```

The override hooks have always existed; 0.10.1 documents them.
Internal security audit references are kept in the repository, not
shipped with the npm package.

## Status

**Pre-alpha, productized as of 0.10.0** (Phase 11B.3 - npm publish
under MIT). Phases 0 through 9.3 + 11A.2 are shipped; the engine
runs the public TheWorldTable.ai pre-alpha. Productization is a
fund-raising and distribution decision, not a stability claim - the
public API surface will evolve until 1.0.

| Phase | Status | Surface |
|---|---|---|
| 0 | shipped | scaffolding, package.json, tsconfig, PRIOR-ART log |
| 1 | shipped | Canvas2D iso renderer, camera, transform pool (SoA) |
| 2 | shipped | ECS World, system scheduler, resource registry, Engine facade, asset pipeline |
| 3 | shipped | clip-aware sprite-sheet manifests, AnimationStatePool, AnimationSystem |
| 4 | shipped | particle pool, emitter component, three-system VFX pipeline, additive blend |
| 5 | shipped | Web Audio bus mixer with VE-budget gating, unified keyboard / mouse / touch input |
| 6 | shipped | Director-bridge: SSE event-stream subscription, eventSourceFactory hook, snapshot-recovery |
| 7 | shipped | Survivor combat layer (projectile pool, hit resolution, damage application) ported onto Loom Engine |
| 8 | shipped | 2.5D ARPG hub-and-spoke per LOOM-CLASS-SYSTEM-SPEC, plaza narrator, mobile + touch input (virtual D-pad, tap-to-walk) |
| 9.1 | shipped | perf pass: alloc-churn fixes + bench harness |
| 9.3 | shipped | TypeDoc public-API site with auto-deploy |
| 11A.2 | shipped | docs hosting migrated to Cloudflare Pages |
| 11B.3 | shipped | MIT license + npm publish posture (this release) |

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

## Run the demos

```sh
npm run build:all
python -m http.server 8765
# browse http://localhost:8765/demo/
```

`http://localhost:8765/demo/` is the gallery index. The same tree is
published to [loom-engine.pages.dev/demo/](https://loom-engine.pages.dev/demo/)
on every push to `main`.

## Examples

Three minimal, copy-paste-ready starters live under `demo/`. Each is
roughly 150 lines of TypeScript, imports from `@sadhaka/loom-engine`
(resolved via `importmap` to the local engine bundle), and runs in
the browser without a build step on the consumer side.

- **[Survivor Mini](./demo/survivor-mini/)** - 100-line autobattler.
  Player at center auto-fires at the nearest mob; mobs spawn from
  random screen edges and pursue. Showcases ECS pools (Transform /
  Sprite / Health / Pursue / RangedAttack), `MOB_CATALOG`, projectile
  physics, system-phase ordering.
- **[Plaza Mini](./demo/plaza-mini/)** - walkable iso plaza wired to
  a mock Director bridge. WASD to walk; the narrator overlay below
  the canvas pulses every five seconds with a synthetic
  `narrator.line` event drained from `MockDirectorBridge`. Demonstrates
  iso projection, input snapshot, the bridge / event-log / DOM-overlay
  boundary.
- **[Dialogue Mini](./demo/dialogue-mini/)** - branching dialogue
  tree, no movement, no combat. Click a choice or press 1 / 2 / 3.
  Demonstrates that the same ECS / resource model that runs the action
  demos also fits a UI-only game: custom `Resource`, custom `System`
  reading both `InputSnapshot` and DOM events, DOM as the primary UI.

The legacy reference demos (Phase 6 director, Phase 7 combat, Phase 8
ARPG slice) stay accessible from the gallery index.

Controls in the legacy director demo (`demo/director.html`):
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
} from '@sadhaka/loom-engine';

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

208 / 208 tests pass on Node 24 via `tsx --test`. Coverage spans
all twelve test files in `tests/`:

- `smoke.test.ts` - public API barrel, version stamp
- `world.test.ts` - ECS world, system scheduling, sprite pool, sprite render, time
- `asset-loader.test.ts` - sprite-sheet manifest, frame stepper, error discriminator
- `animation.test.ts` - animation clip math, state pool, AnimationSystem end-to-end
- `vfx.test.ts` - particle pool, emitter pool, simulation, emitter system, veil budget
- `audio-input.test.ts` - audio bus + ducking, input manager, input system, budget propagation
- `director.test.ts` - SSE bridge, eventSourceFactory hook, scene-state derivation
- `combat.test.ts` - hit resolution, damage application, knockback
- `projectile.test.ts` - projectile pool, lifetime, collision
- `arpg.test.ts` - ARPG hub-and-spoke, plaza narrator, encounter scheduling
- `snapshot-recovery.test.ts` - SnapshotRecoveryHelper for Director reconnect
- `touch-input.test.ts` - virtual D-pad, tap-to-walk, multi-touch arbitration

Run via `npm test`. Each suite is fully node-based; no DOM dependency.
Browser-only paths (Canvas2DDevice rasterization, AudioContext
unlock, DOM event listeners) are exercised via the demo's preview
verification, not unit tests.

## Docs deploy

The TypeDoc site at **https://loom-engine.pages.dev/** is served by
Cloudflare Pages from the `gh-pages` branch of this repo. The chain:

1. Push to `main` triggers `.github/workflows/docs.yml`
2. Workflow runs `npm ci`, `npm test`, `npm run docs:ci`, then publishes
   `./docs-build/` to the `gh-pages` branch via `peaceiris/actions-gh-pages`
3. Cloudflare Pages watches the `gh-pages` branch and auto-deploys on
   every push, typically within 1-2 min

GitHub Pages itself is **not** used: the repo is private and free user
plans do not include Pages on private repos. The 422 error from the
Pages create API is the canonical signal: `"Your current plan does not
support GitHub Pages for this repository."`

### Re-creating the deploy from scratch

If the Cloudflare Pages project is ever deleted or the repo is forked
to a new owner, re-activate as follows:

1. Cloudflare dashboard -> **Workers & Pages** -> **Create** -> **Pages** ->
   **Connect to Git**
2. Authorize Cloudflare on the GitHub account that owns the repo
   (only the engine repo needs to be granted access)
3. Select `loom-engine`, name the project `loom-engine` (default URL
   becomes `loom-engine.pages.dev`)
4. **Production branch**: `gh-pages`
5. **Build command**: leave empty (the gh-pages branch is already a
   built static site)
6. **Build output directory**: `/` (root)
7. Save and deploy. First deploy reads whatever is currently on
   `gh-pages`; subsequent deploys auto-trigger on push to that branch
8. Optional: assign a custom domain (e.g. `engine.theworldtable.ai`)
   under the project's **Custom domains** tab. CF DNS for
   `theworldtable.ai` is already on the same account, so this is a
   one-click CNAME add

If the workflow ever stops updating `gh-pages` (CF Pages will keep
serving the last successful build but go stale), check
`gh run list --repo sadhaka/loom-engine --workflow=docs.yml`.

## License

Versions 0.11.0 and later are licensed under the
[Business Source License 1.1](./LICENSE) ("BUSL-1.1").
Copyright (c) 2026 Misha Mitiev.

- **Free for use** below USD $1,000,000 annual gross revenue from any
  product, game, or service that incorporates this engine. Personal
  projects, learning, prototyping, and indie games well under that
  threshold all qualify.
- **Commercial license required** above the threshold. Contact
  `licensor@theworldtable.ai`. Standard terms include a 5% royalty on
  excess revenue; lump-sum buyouts and equity-for-license arrangements
  are negotiable. See
  [COMMERCIAL_LICENSE_TERMS.md](./COMMERCIAL_LICENSE_TERMS.md).
- **Auto-converts to Apache 2.0** on **2030-05-08** (4-year window per
  BUSL spec). After that date, all 0.11.0+ versions become permissive.
- **Patent strategy**: novelty claims documented in PRIOR-ART.md are
  independent of the source-code license and apply to all versions
  regardless of license phase.

Version 0.10.0 (the only previously-published release) remains
permanently licensed under MIT for backwards compatibility. Projects
pinned to `0.10.0` are unaffected by the license change but will not
receive future updates without accepting BUSL-1.1.

## Publishing

Tagged releases publish to npm via
[`.github/workflows/npm-publish.yml`](./.github/workflows/npm-publish.yml).
The workflow runs `npm test` and `npm run build`, then
`npm publish --access public`, when a tag matching `v*` is pushed to
`main`. It needs the `NPM_TOKEN` repo secret to authenticate.

Manual publish from a local checkout:

```sh
npm login                       # one-time, npm account named sadhaka
npm test                        # 208/208 must pass
npm run build                   # tsc -> dist/
npm publish --dry-run           # inspect tarball contents first
npm publish --access public     # scoped packages default to private; flag is required
```

`prepublishOnly` in `package.json` re-runs `npm test && npm run build`
before any publish, so the dry-run and the final publish always rebuild
from a clean source tree.

## Contributing

This is a single-author project (Misha Mitiev) for TheWorldTable.ai.
The MIT license permits forking and modification; pull requests are
welcome but not actively triaged - the canonical roadmap is the spec
file (`LOOM-ENGINE-SPEC.md` in the parent repo) and capacity is
limited. For bug reports, file an issue with a minimal repro.
