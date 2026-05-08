# Changelog

Loom Engine - cumulative phase-by-phase log. Each version line links
to the spec phase in [LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md)
Section 7 and the GitHub commit. Format follows the spirit of
[Keep a Changelog](https://keepachangelog.com/) but is organized by
phase rather than calendar release - solo-dev project, no semver
contract yet.

## 0.12.0 - 2026-05-08

**WebGL2 instanced sprite batcher backend** (Phase 14.1). Lifts the
Canvas2D ~2k-sprite ceiling to thousands+ via instanced rendering
with atlas-grouped batching. Canvas2D remains the default and
unchanged.

### Why

Canvas2D's `drawImage` is one driver call per sprite. At a few
thousand sprites per frame the device-side cost dominates frame
time. WebGL2's `drawArraysInstanced` issues one driver call for an
entire atlas's worth of sprites, with per-instance data uploaded
once per flush in a single `bufferSubData`. The `IGraphicsDevice`
abstraction was already in place from Phase 1 (per the Babylon.js
ThinEngine split documented in `PRIOR-ART.md`); this release fills
in the second backend.

### Added

- `WebGL2Device` (`src/renderer/webgl2-device.ts`) implementing
  `IGraphicsDevice` against a WebGL2 context. Same call-site
  contract as `Canvas2DDevice`; consumers swap backends without
  touching draw code.
- `SpriteBatcher` (`src/renderer/sprite-batcher.ts`) - per-frame
  CPU-side accumulator. Groups submitted instances by
  `(atlas, blendMode)` key; flushes on key change and at end of
  frame. 12 floats per instance: origin, size, uv-rect, tint.
- `TextureAtlas` (`src/renderer/texture-atlas.ts`) - GL texture
  wrapper plus pre-computed UV rect + frame size lookup tables.
  Uses `UNPACK_FLIP_Y_WEBGL` so atlas frame coords map to UVs
  without extra math at draw time.
- Inlined GLSL ES 3.00 shader sources
  (`src/renderer/shaders/sprite-shader-source.ts`) for the
  instanced quad path. Vertex shader maps the static unit quad onto
  per-instance origin + size; fragment shader samples the atlas and
  multiplies by tint.
- Backend registry on `Engine`: `registerBackend(name, factory)` +
  `isBackendRegistered(name)`. Devices self-register at module
  load. `Engine.create({ backend: 'webgl2' })` looks up the
  factory; throws a diagnostic error if the device module was
  never imported.
- `EngineOptions.backend?: 'canvas2d' | 'webgl2'` (defaults to
  `'canvas2d'`). New `EngineOptions.device?: IGraphicsDevice`
  injection seam for shared-context scenarios and tree-shaking.
- 21 new tests in `tests/webgl2-device.test.ts` covering backend
  registration, atlas UV computation, batcher flush/grow,
  drawArraysInstanced batching, atlas-swap flush behavior,
  blend-mode swap, submission-order preservation, particle
  additive blend, context-loss no-op, and dispose teardown.

### Changed

- `LOOM_ENGINE_VERSION` constant: `0.11.0` -> `0.12.0`.
- `package.json` `version`: `0.11.0` -> `0.12.0`.
- `package.json` `test` script appends `tests/webgl2-device.test.ts`.
- `src/index.ts` re-exports `WebGL2Device`, `TextureAtlas`,
  `SpriteBatcher`, `FLOATS_PER_INSTANCE`, `BlendMode`,
  `FlushHandler`, `SPRITE_VERT_SRC`, `SPRITE_FRAG_SRC`,
  `UNIT_QUAD_VERTICES`, `registerBackend`, `isBackendRegistered`,
  and `DeviceFactory`.
- `engine.ts` does **not** statically import `WebGL2Device`. The
  default (Canvas2D-only) bundle stays the same size as 0.11.0;
  WebGL2 code only enters the graph when a consumer imports
  `WebGL2Device`.

### Backwards compatibility

Fully compatible. `Engine.create({ canvas })` produces the same
`Canvas2DDevice` instance it did in 0.11.0. The 208 baseline tests
all stay green. No existing call site needs to change.

### Known limits

- `drawText` is implemented via per-string baked textures with a
  bounded LRU cache (256 entries). Fine for typical UI labels;
  text-heavy scenes pay one texture upload per unique label.
  Phase 14.4 will revisit with a glyph atlas if needed.
- Particle disc texture is a single 64x64 RGBA upload; the
  Canvas2DDevice's per-color tinting hack is replaced by proper
  per-instance tint in the fragment shader (visually closer to
  Phase 4 spec).
- Performance numbers (synthetic 5k+ sprite bench, frame-time
  histograms vs Canvas2D) are deferred to Phase 14.3.

## 0.11.0 - 2026-05-08

**License pivot to BUSL 1.1** (Phase 12.4). The engine moves from MIT
to the [Business Source License 1.1](./LICENSE) starting with this
version. 0.10.0 (the only previously-published release) remains
permanently MIT for backwards compatibility; pinned consumers are
unaffected.

### License terms

- **Free** for use below USD $1,000,000 annual gross revenue from any
  product, game, or service that incorporates the engine.
- **Commercial license** required above the threshold. Standard 5%
  royalty on excess revenue; lump-sum and equity-for-license
  alternatives negotiable. See
  [COMMERCIAL_LICENSE_TERMS.md](./COMMERCIAL_LICENSE_TERMS.md).
- **Auto-converts to Apache 2.0** on **2030-05-08** (4-year window per
  BUSL spec).
- **Contact**: `licensor@theworldtable.ai`

### Why

The engine is novel work product (see PRIOR-ART.md for the patent
strategy scope). MIT was chosen for the 0.10.0 productization
milestone to minimize friction for early evaluators; 0.11.0 captures
commercial value as the engine matures toward broader adoption while
keeping the threshold high enough that hobbyists, students, indies,
and prototypes pay nothing.

### Changed

- `LICENSE` replaced with BUSL 1.1 (parameters block + standard
  terms).
- `package.json` `license` field: `MIT` -> `BUSL-1.1` (recognized
  SPDX identifier).
- `package.json` `version`: `0.10.1` -> `0.11.0`.
- `LOOM_ENGINE_VERSION` constant in `src/index.ts`: `0.10.1` ->
  `0.11.0`.
- `README.md` License section rewritten with revenue threshold,
  conversion date, and commercial-contact details.

### Added

- `COMMERCIAL_LICENSE_TERMS.md` outlining standard royalty terms,
  negotiable alternatives (lump-sum, equity-for-license, OSS waivers),
  and the 0.10.0 MIT grandfathering clause.

### Carried forward from 0.10.1 polish (12.3, never published to npm)

- `exports` map in `package.json` includes `./package.json` for tools
  that introspect via `require('@sadhaka/loom-engine/package.json')`.
- Publish workflow uses `npm publish --access public --provenance`
  for free supply-chain attestation.
- README documents the `withCredentials: true` default in
  `SSEDirectorBridge` + `fetchImpl` override hooks for cross-origin
  consumers.

## 0.10.1 - 2026-05-08 (NEVER PUBLISHED)

**Audit polish** (Phase 12.3) - patch release closing the five
0.10.1-scoped findings from the 12.2 supply-chain audit. Source is
otherwise unchanged from 0.10.0; no public-API surface change. See
[`SECURITY-AUDIT-0.10.0.md`](./SECURITY-AUDIT-0.10.0.md) for the full
audit report.

### Fixed

- **L-01.** `LOOM_ENGINE_VERSION` constant in
  [`src/index.ts`](./src/index.ts) now agrees with `package.json`.
  The 0.10.0 release shipped with the lingering `-perf-9-1` dev
  suffix on the constant; consumers running
  `engine.LOOM_ENGINE_VERSION`-based diagnostics saw the drift.
  Manual pre-bump checklist for now: when bumping `package.json`,
  bump the constant in the same commit (gen-version automation
  deferred to keep this patch small).
- **L-04.** [`package.json`](./package.json) `exports` map now
  exposes `./package.json`. Consumers can do
  `require('@sadhaka/loom-engine/package.json')` for build
  introspection / version checks; previously this errored with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

### Added

- **L-02.** `README.md` Configuration section documents the
  `withCredentials: true` / `credentials: 'include'` defaults on
  `SSEDirectorBridge` and `SnapshotRecoveryHelper`, with a worked
  example showing the `eventSourceFactory` / `fetchImpl` overrides
  for credential-free deployments. Override seams already existed;
  0.10.1 documents them.

### Changed

- **L-05.** [`.github/workflows/npm-publish.yml`](./.github/workflows/npm-publish.yml)
  publish step now passes `--provenance`. The `id-token: write`
  permission was already granted; only the flag was missing. From
  this release on, the npm package page shows a build-provenance
  attestation linking the tarball to the exact GitHub workflow run
  that produced it.
- **L-07.** Tag flow exercised. The historical 0.10.0 commit
  (`b497d6d`) is tagged `v0.10.0` retroactively (workflow detects
  same-version-already-published and skips publish - documented
  expected behaviour). 0.10.1 is the first version published via the
  CI tag-trigger path instead of a manual `npm publish`.

### Deferred to 0.11.0

L-03 (snapshot envelope validation), L-06 (npm trusted-publishing
migration to drop the long-lived `NPM_TOKEN`), and I-01 (`#private`
field migration) are minor-bump material per the audit and ship in
the next pre-1.0 hardening pass.

## 0.10.0 - 2026-05-08

**Productization milestone** (Phase 11B.3) - first public npm
release under MIT. Package is `@sadhaka/loom-engine`. Pre-alpha:
no semver stability guarantee until 1.0.

This entry also backfills the changelog gap between 0.5.0-phase5
and 0.10.0 — the work shipped in commits but did not get its own
versioned entries.

### Changed

- License switched from `UNLICENSED` (private) to **MIT**. Copyright
  Misha Mitiev 2026. See [LICENSE](./LICENSE).
- Package name renamed from `@theworldtable/loom-engine` (private,
  internal) to `@sadhaka/loom-engine` (public, scoped).
- `package.json`: dropped `private: true`, added `files`, `keywords`,
  `repository`, `homepage`, `bugs`, `prepublishOnly`. Version
  suffix `-perf-9-1` dropped — productization releases ship clean
  semver.
- `.npmignore` added; only `dist/`, `LICENSE`, `README.md`, and
  `package.json` ship in the tarball.
- `README.md`: Install + License + Publishing sections, updated
  status table, refreshed test coverage breakdown.

### Added (productization scaffolding)

- [`.github/workflows/npm-publish.yml`](./.github/workflows/npm-publish.yml)
  - tag-triggered publish (`v*` on `main`). Runs tests + build,
  then `npm publish --access public` with `NPM_TOKEN` secret.

### Added (backfill since 0.5.0-phase5)

The following landed between 0.5.0-phase5 and this release:

- **Phase 6** - Director-bridge: SSE event-stream subscription with
  `eventSourceFactory` hook for testability, scene-state derivation
  from event projections, `SnapshotRecoveryHelper` for reconnect
  resync.
- **Phase 7** - Survivor combat layer ported onto Loom Engine:
  projectile pool, hit resolution, damage application, knockback.
- **Phase 8** - 2.5D ARPG hub-and-spoke per LOOM-CLASS-SYSTEM-SPEC:
  plaza narrator support, knot-agnostic spawn, encounter scheduling.
- **Phase 8.4** - mobile + touch input: virtual D-pad, tap-to-walk,
  multi-touch arbitration, pointer-coalescing for canvas DPR math.
- **Phase 9.1** - perf pass: alloc-churn fixes across hot paths
  (transform iteration, particle simulation, sprite sort buffer),
  bench harness in `tools/`.
- **Phase 9.3** - TypeDoc public-API site at
  [loom-engine.pages.dev](https://loom-engine.pages.dev/),
  auto-deployed from `gh-pages` branch via the docs workflow.
- **Phase 11A.2** - docs hosting migrated from GitHub Pages
  (unavailable on free plan for private repos) to Cloudflare Pages.

### Tests

- 208 / 208 pass via `tsx --test` on Node 24. Twelve test files
  covering smoke, world, asset-loader, animation, vfx,
  audio-input, director, combat, projectile, arpg,
  snapshot-recovery, touch-input.

### Manual final-gate to publish

`npm login` (account `sadhaka`) → `npm publish --dry-run` to verify
tarball contents → `npm publish --access public`. The `--access public`
flag is required because npm scopes default to private. From this
release forward, push a `v0.10.0`-style tag on `main` and the
GitHub Actions workflow handles publish automatically.

## 0.5.0-phase5 - 2026-05-07

[Spec phase 5](../docker/LOOM-ENGINE-SPEC.md) - audio bus + input
system. Commit
[0322221](https://github.com/sadhaka/loom-engine/commit/0322221).

### Added

- `AudioBus` (`src/audio/audio-bus.ts`) - Web Audio mixer with
  master GainNode, four default sub-buses (sfx + voice =
  essential, music + ui = ambient), lazy unlock for browser
  autoplay-policy, `setAudioBudget(0..1)` priority-tier ducking,
  convenience `playOneShot(bus, buffer)` and `playTone(bus, freq,
  durationMs)` methods.
- `InputManager` (`src/input/input-manager.ts`) - unified DOM
  listener for keyboard / mouse / touch / wheel. Frame-coherent
  snapshot model: `keysPressedThisFrame` /
  `pointerPressedThisFrame` / `wheelDeltaThisFrame` accumulate
  between calls to `beginFrame()`; held / position / buttons stay
  continuous. Canvas DPR baked into pointer math.
  `injectKey*` / `injectPointer*` helpers for headless tests.
- `InputSystem` (`src/systems/input-system.ts`) - PHASE_INPUT
  promoter that calls `manager.beginFrame()` and writes
  `manager.snapshot()` into the world's `RESOURCE_INPUT` each tick.
- `VeilBudgetSystem` (`src/systems/veil-budget-system.ts`) -
  PHASE_INPUT propagator that pushes `audioBudget` to AudioBus and
  `particleBudget` to ParticlePool each tick. Closes the loop
  between Phase 4's particle budget and Phase 5's audio gating;
  Phase 6 Director-bridge mutates the budget directly.
- `VeilBudgetResource.audioBudget` field, default `1.0`.
- `Engine.audio` (nullable) and `Engine.input` properties on the
  facade. `Engine.create()` now also constructs InputManager
  (attached to canvas + window) and AudioBus (unless
  `opts.skipAudio=true` or `AudioContext` unavailable).
- Demo: arrow keys / WASD pan camera, click bursts 24 particles +
  plays a SFX chirp (also unlocks AudioContext on first click),
  hover reports the iso tile under the cursor.

### Tests

- 18 new assertions in `tests/audio-input.test.ts`. Total: 102 / 102
  pass.

## 0.4.0-phase4 - 2026-05-07

[Spec phase 4](../docker/LOOM-ENGINE-SPEC.md) - VFX framework.
Commit [fb7060c](https://github.com/sadhaka/loom-engine/commit/fb7060c).

### Added

- `ParticlePool` (`src/vfx/particle-pool.ts`) - 21 parallel
  Float32Arrays + Uint8 flags. Free-list slot recycling.
  Configurable `maxParticles` cap; `spawn()` returns -1 on budget
  exhaustion.
- `ParticleEmitterPool` (`src/components/particle-emitter.ts`) -
  per-entity emitter config (rate, particleLife, speed range, cone
  direction + half-angle, acceleration, start/end size + color,
  additive flag). `burst(e, n)` schedules a one-shot for the next
  tick.
- `ParticleEmitterSystem` (`src/systems/particle-emitter-system.ts`)
  - PHASE_LOGIC. Reads Transform + ParticleEmitter, samples a cone
  direction via two perpendicular cross products, pushes spawns
  into the shared ParticlePool.
- `ParticleSimulationSystem` (`src/systems/particle-simulation-system.ts`)
  - PHASE_PHYSICS. Walks live pool, decreases life by dt, integrates
  velocity + acceleration with semi-implicit Euler, kills expired
  particles.
- `ParticleRenderSystem` (`src/systems/particle-render-system.ts`)
  - PHASE_RENDER. Walks pool, interpolates color + size by
  life/maxLife, submits drawParticle calls.
- `IGraphicsDevice.drawParticle()` + Canvas2D impl - iso-projects
  world coords, paints a radial-gradient disc; additive=true uses
  globalCompositeOperation = 'lighter'.
- `VeilBudgetResource` (`src/resources.ts`) - particle / shader /
  event / audio budgets. Patent-defensible novelty hook from spec
  Section 3.

### Tests

- 19 new assertions in `tests/vfx.test.ts`. Total: 84 / 84 pass.

## 0.3.0-phase3 - 2026-05-07

[Spec phase 3](../docker/LOOM-ENGINE-SPEC.md) - animation system.
Commit [1331d98](https://github.com/sadhaka/loom-engine/commit/1331d98).

### Added

- `AnimationClip` type and helpers (`src/animation/animation-clip.ts`)
  - named slice of a sheet's frames with optional per-frame
  `durations_ms[]`, optional clip-fps, `loop: boolean`.
  Helpers: `synthesizeDefaultClip`, `clipDurationMs`,
  `frameInClipAt`, `manifestFrameIndex`.
- `AnimationStatePool` (`src/animation/animation-state-pool.ts`)
  - per-entity animation state. `play(e, manifest, clipName)`
  resets elapsed and starts the clip; `stop(e)` clears.
  ACTIVE / FINISHED bitflags.
- `AnimationSystem` (`src/systems/animation-system.ts`) -
  PHASE_ANIMATION. Iterates active states, advances elapsedMs by
  dt, looks up the named clip on each entity's manifest, writes
  resolved frame to SpritePool.
- `SpriteSheetManifest.clips: AnimationClip[]` field. Loader
  synthesizes a `'default'` clip for manifests that omit it
  (Phase 2 backward compat preserved).

### Changed

- Demo: deleted ad-hoc WalkCycleSystem, replaced with one
  `animations.play(knight, manifest, 'default')` + the formal
  AnimationSystem.

### Tests

- 16 new assertions in `tests/animation.test.ts`. Total: 65 / 65 pass.

## 0.2.0-phase2 - 2026-05-07

[Spec phase 2](../docker/LOOM-ENGINE-SPEC.md) - ECS World + Engine
facade. Commit
[81808fc](https://github.com/sadhaka/loom-engine/commit/81808fc).
Includes the asset-pipeline session merged in from a parallel
worktree.

### Added

- `World` class (`src/world.ts`) - ECS container. EntityAllocator +
  ResourceRegistry + per-phase system list. `addSystem(sys, phase)`
  preserves registration order within a phase. `update(dt)` walks
  phases in fixed order.
- `System` interface + 6 phase constants
  (INPUT, LOGIC, PHYSICS, ANIMATION, RENDER, POST_RENDER).
- `ResourceRegistry` + `TimeResource` + RESOURCE_TIME / _CAMERA /
  _DEVICE constants.
- `SpritePool` (`src/components/sprite.ts`) - per-entity sprite
  appearance with split rgba arrays, ACTIVE / TINTED bitflags.
- `SpriteRenderSystem` (`src/systems/sprite-render-system.ts`) -
  iterates Transform + Sprite, builds per-frame sort buffer keyed
  on iso depth (`(x+y)*1000+z`), insertion sort, submits
  `drawSprite` in back-to-front order.
- `Engine` class (`src/engine.ts`) - high-level facade.
  `Engine.create({canvas})` wires Canvas2DDevice + camera + time +
  default pools (transform, sprite, animation - the latter added
  in Phase 3). `engine.tick(now)` runs the canonical frame loop.
- Asset pipeline (parallel session merged into this commit):
  - `loadSpriteSheet(url, options)` - fetches PNG + JSON manifest,
    validates, returns `{manifest, image, atlas}` ready for
    `device.registerAtlas`
  - `computeFrameIndex(manifest, now, start)` - frame stepper
    honoring per-frame `duration_ms` with fps fallback
  - `SpriteSheetLoadError` with `kind` discriminator for fetch /
    parse / validate / decode failures
  - Placeholder asset: `assets/knight/walk.png` + `walk.json`
    (4-frame Veil-weaver knight walk cycle), `tools/gen-knight.py`
    Pillow generator

### Tests

- 14 new ECS / SpritePool / SpriteRenderSystem / Time assertions
  + 15 asset-loader assertions. Total: 49 / 49 pass.

## 0.1.0-phase1 - 2026-05-07

[Spec phase 1](../docker/LOOM-ENGINE-SPEC.md) - Canvas2D iso
renderer + ECS foundations. Commit
[e9dc58c](https://github.com/sadhaka/loom-engine/commit/e9dc58c).

### Added

- Math primitives (`src/util/math.ts`) - Vec2 / Vec3 / Rect plain
  objects, free-function helpers (clamp, lerp, smoothstep,
  approxEq, rect ops).
- Color helpers (`src/util/color.ts`) - ColorRGBA type, hex<->rgba
  conversions, knot palette constants per
  [LOOM-CLASS-SYSTEM-SPEC.md](../docker/LOOM-CLASS-SYSTEM-SPEC.md)
  Section 4.
- Typed-array utilities (`src/util/typed-arrays.ts`) - pow-2 grow
  helpers for Float32 / Int32 / Uint32 / Uint8 pools.
- `EntityAllocator` (`src/entity.ts`) - 32-bit handles
  (8-bit generation + 24-bit index), free-list recycling,
  generation-bump invalidates stale handles.
- `TransformPool` (`src/components/transform.ts`) - structure-of-
  arrays for hot data (x/y/z/rotation/scaleX/scaleY) and Int32 /
  Uint8 cold data (parent / flags). Inspired by Mike Acton CppCon
  2014 (see PRIOR-ART.md).
- `IGraphicsDevice` interface and `Canvas2DDevice` impl - iso
  projection inside the device, `drawSprite` / `drawTile` /
  `drawText` surface, atlas registration.
- `CameraView` + worldToScreen / screenToWorld / view-rect helpers.
- Standard 2:1 dimetric projection (`src/renderer/iso-projection.ts`)
  - tileToIso, worldToIso, isoToTile, isoDepthKey.
- Browser demo: 5x5 iso tile diamond + iron-red knight at world
  origin, slow Z-hover. Procedural canvases, zero asset deps.

### Tests

- 20 assertions across math, color, entity, transform, iso, camera.

## 0.0.0-spec - 2026-05-07

[Spec phase 0](../docker/LOOM-ENGINE-SPEC.md) - scaffolding. Commit
[6071518](https://github.com/sadhaka/loom-engine/commit/6071518).

### Added

- `package.json` with tsc as only dev dep, ES module exports.
- `tsconfig.json` - ES2022 target/module, strict +
  noUncheckedIndexedAccess + exactOptionalPropertyTypes,
  declaration + sourcemaps on.
- `PRIOR-ART.md` - cumulative inspirations log
  (PlayCanvas / Babylon / Pixi / three.js avoid / Cocos avoid /
  Frostbite FrameGraph / Bevy ECS / Mike Acton SoA).
- `src/index.ts` - LOOM_ENGINE_VERSION = '0.0.0-spec' stub.
- `.gitignore` - dist/, node_modules/, *.tsbuildinfo, editor cruft.

---

## Notes on coordination history

The asset-pipeline work in 0.2.0-phase2 came from a parallel session
running on a different worktree. That session shipped the
sprite-sheet loader + placeholder knight assets + 15 tests under
`tests/asset-loader.test.ts`. My 0.2.0-phase2 commit accidentally
swept up their files via `git add -A` while my own work was being
committed. A follow-up commit
[5b49e7b](https://github.com/sadhaka/loom-engine/commit/5b49e7b)
dropped a redundant test file I'd written (theirs was more
comprehensive); commit
[486cb38](https://github.com/sadhaka/loom-engine/commit/486cb38)
added the parallel session's hidden-tab tick fallback for the demo's
preview RAF throttling.

Going forward, parallel sessions should commit their own work before
mine runs `git add -A`, or each session should use explicit file
lists. This is captured in the project's coordination memory.
