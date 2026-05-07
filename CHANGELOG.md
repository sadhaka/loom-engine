# Changelog

Loom Engine - cumulative phase-by-phase log. Each version line links
to the spec phase in [LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md)
Section 7 and the GitHub commit. Format follows the spirit of
[Keep a Changelog](https://keepachangelog.com/) but is organized by
phase rather than calendar release - solo-dev project, no semver
contract yet.

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
