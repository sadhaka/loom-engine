# LOOM ENGINE - PRIOR ART LOG

Cumulative research log establishing prior-art independence for the
Loom Engine. Every architectural decision that draws on a public
talk, paper, or open-source project is logged here with what we
**learned** (took as inspiration) and what we **declined** (avoided
to maintain clean-room and patent hygiene).

This file is updated whenever a new inspiration enters the codebase.
Per LOOM-ENGINE-SPEC.md Section 3C, every architectural commit
message should also name its inspirations in plain text.

The novelty claims for the Loom Engine are NOT in the rasterizer.
They are in the Loom integration layer: Director-driven scene state,
Veil Essence economy gating render budget, knot-aware encounter
generation, event-sourced rendering. The renderer underneath uses
public-domain techniques (sprite batching, isometric projection,
ECS) implemented from scratch.

---

## Engine architecture inspirations

### PlayCanvas
- **Source**: https://github.com/playcanvas/engine (public OSS, MIT)
- **Date read**: 2026-05-07 (initial research brief, pre-spec)
- **Took**: ECS shape - component registration pattern, system pipeline
  iteration model, Resource injection by name. Their ECS is a
  textbook implementation; we re-derive it from first principles.
- **Declined**: Lightmapper specifics. Snap (PlayCanvas owner) has
  patent-adjacent IP in this area per the research brief. Loom
  Engine does dynamic lighting via shaders only, no lightmap baking.
- **Notes**: PlayCanvas is MIT-licensed. We do not copy code; we
  implement a similar shape because ECS is a generic pattern.

### Babylon.js
- **Source**: https://github.com/BabylonJS/Babylon.js (public OSS, Apache 2.0)
- **Date read**: 2026-05-07
- **Took**: `ThinEngine` split pattern - lean GPU core separated from
  the higher-level scene layer. Loom Engine mirrors this with
  `IGraphicsDevice` (lean) + Renderer (higher-level scene logic).
- **Declined**: Babylon's full scene graph and node system. We do
  ECS, not a node tree.
- **Notes**: Apache 2.0 license. No code copy. Architectural shape
  inspiration only.

### PixiJS
- **Source**: https://github.com/pixijs/pixijs (public OSS, MIT)
- **Date read**: 2026-05-07
- **Took**: System pipeline + Ticker pattern - RAF-driven update
  loop with explicit phases (input -> update -> render -> end).
  Loom Engine uses the same shape (Section 4F frame loop).
- **Declined**: PIXI's display object hierarchy. We do ECS.
- **Notes**: MIT license. Loom Engine is **not** a PIXI port. We
  build sprite batching from scratch.

### three.js
- **Source**: https://github.com/mrdoob/three.js (public OSS, MIT)
- **Date read**: 2026-05-07 (and earlier - we used three.js in the
  frozen `/arpg/` Plaza)
- **Took**: Nothing architectural. We've worked with three.js so we
  know what to avoid.
- **Declined**: `Object3D` god-class pattern - cited in the research
  brief as an anti-pattern. three.js's mutable parent-child node
  tree creates allocation churn and tight coupling. Loom Engine ECS
  has no parent class, no inheritance, no shared base.
- **Notes**: The frozen 3D `/arpg/` Plaza will continue using
  three.js until it is retired. Loom Engine has zero three.js code.

### Cocos Creator
- **Source**: https://github.com/cocos/cocos-engine (public OSS, MIT,
  with patented techniques in the underlying tech)
- **Date read**: 2026-05-07
- **Took**: Nothing.
- **Declined**: `RenderFlow` dispatch order specifics. CN patent
  risk per research brief. Loom Engine's RenderGraph uses an
  explicit named-stage list that the Director can reorder; we do
  not replicate Cocos's dispatch heuristic.
- **Notes**: We do not read Cocos source code beyond the
  high-level architecture diagrams. Clean-room discipline.

### Epic / Unreal (Nanite)
- **Source**: SIGGRAPH 2021 talk on virtualized geometry, public.
- **Date read**: 2026-05-07
- **Took**: Nothing.
- **Declined**: Nanite-style virtualized geometry. Epic owns
  patents in this area. Not relevant to 2.5D anyway. Even when the
  post-funding 3D extension lands, we will not replicate Nanite.
- **Notes**: 3D-extension-era concern. Not a v1 issue.

### Unity SRP
- **Source**: Unity blog posts on Scriptable Render Pipeline,
  public.
- **Date read**: 2026-05-07
- **Took**: The high-level idea that render passes should be data,
  not hardcoded. This is also the Frostbite FrameGraph idea, which
  predates Unity SRP. Loom Engine takes the Frostbite citation,
  not Unity's.
- **Declined**: Unity's specific SRP callback shape. Unity owns
  specifics. We have our own stage list shape.

---

## Render graph inspirations

### Frostbite FrameGraph (Yuriy O'Donnell, GDC 2017)
- **Source**: https://www.gdcvault.com/play/1024612/FrameGraph-Extensible-Rendering-Architecture-in
  (public talk, slides also public)
- **Date read**: 2026-05-07
- **Took**: Declarative render passes. Render flow is described as
  a list of named passes with declared inputs and outputs, not a
  hardcoded sequence of GPU calls. Loom Engine's RenderGraph is the
  same idea at a smaller scale - named stages, explicit ordering,
  Director can mutate the list per encounter.
- **Declined**: FrameGraph's resource-aliasing pass (auto-allocation
  of transient render targets to minimize VRAM). Overkill for
  Canvas2D + 2.5D; we will revisit if/when the WebGL2 backend lands
  in Phase 2.
- **Notes**: This is a GDC talk, not patented. Standard prior-art
  citation. The talk is one of the two or three most cited
  rendering-architecture references in the industry.

---

## ECS inspirations

### Bevy (Rust)
- **Source**: https://bevyengine.org/ + https://github.com/bevyengine/bevy
  (public OSS, MIT/Apache dual)
- **Date read**: 2026-05-07
- **Took**: ECS scheduling concepts - Resource pattern (singleton
  state injected by name), Query pattern (systems declare which
  components they read/write). Loom Engine has a simpler version:
  fixed-order scheduling, no parallelism in v1.
- **Declined**: Bevy's full parallel scheduler (work-stealing
  across CPU cores). JS is single-threaded; the parallel scheduler
  would be wasted complexity.
- **Notes**: Bevy is dual MIT/Apache. We do not copy Rust into JS.
  Architectural shape only.

### EnTT (C++)
- **Source**: https://github.com/skypjack/entt (public OSS, MIT)
- **Date read**: 2026-05-07
- **Took**: Sparse-set component storage idea (mentioned in their
  README and wiki). We may use this in Phase 2 if Map<EntityId, T>
  becomes a perf bottleneck.
- **Declined**: EnTT-specific template metaprogramming. Doesn't
  apply to TS.
- **Notes**: MIT-licensed. We do not port EnTT; we re-implement.

---

## Transform / SoA inspirations

### Mike Acton "Data-Oriented Design and C++" (CppCon 2014)
- **Source**: https://www.youtube.com/watch?v=rX0ItVEVjHc (public talk)
- **Date read**: 2026-05-07
- **Took**: Structure-of-arrays for hot data. Loom Engine's
  TransformPool stores x, y, z, rotation, scaleX, scaleY in
  separate Float32Arrays for cache-friendly iteration.
- **Declined**: Nothing specific.
- **Notes**: This is a public talk. The SoA pattern is
  decades-old. Not patented.

---

## Sprite batching inspirations

### Standard sprite-batcher pattern
- **Source**: ubiquitous - pre-2010 game-engine textbook.
- **Took**: One dynamic VBO, append vertex data per sprite, flush
  on state change (texture swap, blend mode change). To be
  implemented in Phase 2 if Canvas2D perf demands.
- **Declined**: Nothing specific. The technique predates almost
  all current engines.

---

## Isometric projection inspirations

### Standard 2:1 dimetric projection
- **Source**: ubiquitous - 1980s 2D arcade games (Q*bert,
  Marble Madness), 1990s ARPGs (Diablo, Baldur's Gate).
- **Took**: Tile-grid -> screen-space transform with the standard
  2:1 ratio. Sprite Z-sort on tile diagonal.
- **Declined**: Nothing specific. Public-domain technique.

---

## Audio inspirations

### Web Audio API (W3C)
- **Source**: https://www.w3.org/TR/webaudio/
- **Took**: Bus mixer pattern - audio nodes connected in a graph
  with gain control per bus. Loom Engine's audio in Phase 5 uses
  this directly.
- **Declined**: The full spatial audio extension. 2.5D doesn't need
  HRTF; simple stereo pan + distance attenuation covers it.

---

## What we will NOT cite without first updating this file

If a new inspiration is added to the engine code, the rule per
LOOM-ENGINE-SPEC.md Section 3C is:

1. Add an entry here with source URL, date, took / declined.
2. Reference it in the architectural commit message.
3. Never copy-paste from the source - read, close the tab, write.

Failing to update this file before adding the inspiration is a
process violation, not just a documentation gap. PRIOR-ART.md is
our primary defense in any patent dispute.

---

## Reviewer note for any future productization

If the Loom Engine is ever opened publicly (SaaS, OSS, or
asset-store sale), this file ships with the package. It is the
audit trail that demonstrates clean-room implementation. Reviewers
should be able to read it end-to-end and conclude we did not copy
any specific engine.
