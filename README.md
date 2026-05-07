# Loom Engine

Custom 2D / 2.5D game engine for [TheWorldTable.ai](https://theworldtable.ai).
Canvas2D primary backend, ECS, render-graph stages, Director-bridge
integration. No external engine reuse - built from scratch in TypeScript.

This is a sibling repository to the main TheWorldTable.ai project at
`D:\Thailand Family\docker\`. It has its own git history and (eventually)
its own remote. The full design specification lives in the main repo at
[../docker/LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md).

## Status

**Phase 0 complete** (this initial commit). Spec locked, scaffolding
in place, no runtime behavior yet.

Phase 1 (Canvas2D iso renderer + sprite + camera + transform pool) is
the next milestone. See `LOOM-ENGINE-SPEC.md` Section 7 for the full
phase plan.

## Build

```sh
npm install
npm run build       # tsc emits ES modules into dist/
npm run watch       # rebuild on change
npm run test        # node --test tests/
```

## Layout

```
loom-engine/
  src/                # TypeScript source (tracked)
  tests/              # smoke tests, node-based, no DOM (tracked)
  PRIOR-ART.md        # cumulative inspirations log (tracked)
  package.json        # tsc as only dev dep (tracked)
  tsconfig.json       # ES2022 strict (tracked)
  dist/               # tsc output (gitignored)
  node_modules/       # npm install output (gitignored)
```

## Architecture quick-reference

- ECS over god-object scene graph
- IGraphicsDevice abstraction with Canvas2D primary backend (WebGL2 in
  Phase 2 if profiling demands)
- TransformPool with structure-of-arrays Float32Arrays for cache-friendly
  iteration
- Render graph: explicit named stage list, mutable per-encounter by the
  Director
- Frame loop: input -> director events -> systems -> animation -> vfx ->
  transform commit -> render -> audio

## Patent strategy

The engine's defensible novelty is in the **Loom integration layer**,
not the rasterizer. Director-driven scene state, Veil Essence economy
gating render budget, knot-aware encounter generation, event-sourced
rendering. The renderer underneath uses public-domain techniques
(sprite batching, isometric projection, ECS) implemented from scratch.

See [PRIOR-ART.md](./PRIOR-ART.md) for the full inspirations log
(public talks, papers, OSS architecture - took / declined per source).

## License

Private / unlicensed. Productization decision deferred to post-Phase 9
per spec Section 10 O7.
