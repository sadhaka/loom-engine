# LOOM-BOSS-RENDER-SPEC

Visual rendering of zone-spawned bosses: engine-side entity primitives +
TWT Three.js mesh renderer + DOM HP bar UI. Phase 18 of the Loom Engine
roadmap. Closes the loop opened by Phase 16 (zone protocol fanout) and
Phase 17 (zone audio cues): the boss is now also visible.

Status: **v1 DRAFT 2026-05-08** - frozen contract for parallel
implementation across Tracks A (engine ZoneBossEntity primitives),
B (TWT Three.js renderer), C (HP bar UI + narrator banner + death
animation). Lock anticipated after the demo proves the boss spawns
visibly, takes hits visibly, and dies visibly across both browser
windows.

References (read-only, do not edit):
- `LOOM-DIRECTOR-PROTOCOL-V2.md` - Phase 16 zone-event types
  (zone.boss.spawn / tick / end). Boss data lives at `env.data.boss`
  with `{boss_id, name, hp_max, hp_current, x, y, dmg, knot_flavor}`.
- `LOOM-AUDIO-SPEC.md` - Phase 17 audio cues fire on the same DOM
  CustomEvents this spec consumes. Visual + audio share the event
  surface; renderers and audio module are siblings, not stacked.
- `docker/web/html/arpg/arpg-zone-system.js` - emits
  `arpg:zone-boss-spawn`, `arpg:zone-boss-tick`, `arpg:zone-boss-end`
  CustomEvents on `window`. Already includes `getActiveBoss(zoneId)`
  query API.
- `docker/web/html/arpg/arpg-3d-core.js` - `window.ARPG_3D_CORE`
  exposes `getScene()`, `getHero()`, `getCamera()`, `getHeroPos()`.
  THREE.Scene is the integration target.

This spec finishes the boss-spawn loop on the renderer side. Phase 16
proved fanout; Phase 17 proved audio reactivity; Phase 18 makes the
boss visible.

---

## Section 1 - Vision

The Loom is everything. Phase 16 made the boss real to the protocol;
Phase 17 made the boss audible; Phase 18 makes the boss **visible**.

Three load-bearing properties:

1. **Sprite-truth tracks event-truth.** The boss's on-screen position,
   HP, and name are derived purely from the zone event stream. No
   side-channel state, no client prediction beyond standard frame
   interpolation. The renderer is a pure projection of the
   ZoneEventLog.
2. **Renderer-agnostic primitives.** The engine ships a `ZoneBossEntity`
   abstraction (data shape + system that pumps it from events) so any
   renderer (Three.js, Canvas2D, Pixi, custom) can subscribe. TWT v1
   ships a Three.js renderer; the abstraction is reusable.
3. **HUD reads from entity, not from events.** HP bar / name banner /
   damage numbers read the `ZoneBossEntityResource` snapshot each
   frame. UI is not coupled to event timing; it just reads the
   current truth.

### 1.2 Non-goals (v1)

- Custom 3D boss models. v1 uses placeholder geometry (cylinder + glow
  + name text) so the demo ships without a 3D art pipeline. Asset
  swap is mechanical post-v1.
- Client-side hit prediction. The visual hit shake fires only when the
  zone.boss.tick arrives over SSE - no local "I clicked the boss so
  shake immediately" optimism. Latency is server-bound.
- Multi-boss-per-zone. v1 assumes at most one active boss per zone
  (matches Phase 16 spec). Multi-boss deferred.
- Boss-vs-player combat AI rendering. The boss's own behavior (chase,
  attack animations) is server-driven via the AI plugin and emitted
  as zone events; v1 visual just reflects whatever spawn/tick payloads
  carry.

---

## Section 2 - Architecture

```
                       Phase 16 (existing)
                       ===================
                       SSE: zone.event {boss_id, x, y, hp_*}
                         |
                       ARPG_ZONE_BRIDGE.ingest()
                         |
                       ARPG_ZONE_SYSTEM.tick() (60Hz auto-loop)
                         |
                         |---> arpg:zone-boss-spawn  CustomEvent
                         |---> arpg:zone-boss-tick   CustomEvent
                         |---> arpg:zone-boss-end    CustomEvent

                       Phase 17 (existing, sibling consumer)
                       =====================================
                              + arpg-audio.js: cue.play()

                       Phase 18 (NEW, sibling consumers)
                       =================================

                       Track A (engine):
                       ZoneBossEntityResource + system
                         - exposed via ARPG_ZONE_SYSTEM.getActiveBoss
                           today; engine-native abstraction lifts it
                           to a reusable primitive

                       Track B (TWT, arpg-loom 3D):
                       arpg-zone-boss-renderer.js
                         - listens for arpg:zone-boss-* events
                         - spawns / updates / despawns THREE.Mesh
                           in window.ARPG_3D_CORE.getScene()
                         - placeholder: cylinder + emissive shell
                         - hit-flash + death-fade animation

                       Track C (TWT, DOM overlay):
                       arpg-zone-boss-hud.js
                         - HP bar div positioned over boss screen-xy
                           (worldToScreen project each frame)
                         - boss name label
                         - damage numbers floating up on each tick's
                           recent_hits delta
                         - narrator banner (consumes arpg:zone-narrator)
```

Engine ships A. TWT ships B + C. Both renderers are zero-coupled to
each other; HUD reads ZoneBossEntityResource snapshot, mesh renderer
reads it too. Either can be swapped independently.

---

## Section 3 - Engine ZoneBossEntity primitives (Track A scope)

### 3.1 ZoneBossEntity shape

```typescript
export interface ZoneBossEntity {
  zone_id: string;
  boss_id: string;
  name: string;
  type: string;            // catalog key (e.g. 'lastlight_warden')
  hp_max: number;
  hp_current: number;
  dmg: number;
  x: number;
  y: number;
  knot_flavor: string;
  spawned_at_ms: number;   // wall-clock spawn time
  // Latest tick-ts carried for animation timing on the renderer side.
  // Renderer can detect "took a hit since last frame" by comparing
  // last_tick_ms against its own per-frame snapshot of this value.
  last_tick_ms: number;
  // Damage events received since spawn. Bounded ring of 32 entries
  // for floating-damage-number renderers. Each: {amount, at_ms,
  // from_character_id} - position not carried (read boss x/y at
  // render time).
  recent_hits: ReadonlyArray<{ amount: number; at_ms: number; from_character_id: string }>;
}

export interface ZoneBossEntityResource {
  // Per-zone active boss (or null when none). v1 supports at most one
  // active boss per zone.
  byZone: Map<string, ZoneBossEntity | null>;
}

export const RESOURCE_ZONE_BOSS_ENTITY = 'zone_boss_entity';
export function createZoneBossEntityResource(): ZoneBossEntityResource;
```

### 3.2 ZoneBossEntitySystem

Runs PHASE_LOGIC, AFTER `ZoneEventSystem` (so the event log is
already drained). Polls `ZoneEventLog` for boss events since the last
tick, mutates `ZoneBossEntityResource`:

| Event | Effect on resource |
|---|---|
| `zone.boss.spawn` | `byZone[zid] = new ZoneBossEntity(env.data.boss)` with `spawned_at_ms = env.ts` |
| `zone.boss.tick`  | If boss_id matches active: update hp_current, x, y, append recent_hits, set last_tick_ms = env.ts |
| `zone.boss.end`   | If boss_id matches: `byZone[zid] = null` (renderer treats null transition as "death") |
| `zone.snapshot`   | Replace `byZone[zid]` from `data.active_boss` (cold join + reconnect) |

Emits no DOM CustomEvents itself; renderers either:
- Subscribe to the same DOM CustomEvents from Phase 16 (preferred for
  TWT v1 - no new wiring), OR
- Poll `ZoneBossEntityResource.byZone[zoneId]` each frame (preferred
  for ECS consumers using the engine standalone)

### 3.3 Tests

- `zone-boss-entity-resource.test.ts` (5+) - factory shape, byZone map
  isolation per zone, null-then-spawn-then-null lifecycle.
- `zone-boss-entity-system.test.ts` (8+) - spawn populates entity,
  tick updates HP + position + appends hit, mismatched boss_id on
  tick is ignored, end clears entity, snapshot replaces wholesale,
  recent_hits ring caps at 32, multi-zone isolation.

### 3.4 Files

New under `src/director/zone/`:
- `zone-boss-entity.ts` - resource shape + factory + key + types
- `zone-boss-entity-system.ts` - PHASE_LOGIC system

Edits (additive only):
- `src/director/zone/index.ts` - re-export new surface
- `src/index.ts` - re-export at root under a `// ===== Phase 18 visual boss (Track A) =====` block
- `package.json` - add 2 new test files. **DO NOT** bump version.

---

## Section 4 - TWT 3D Three.js renderer (Track B scope)

### 4.1 arpg-zone-boss-renderer.js

IIFE-wrapped, var-only, no arrows / no template literals. New module
in `docker/web/html/arpg/`.

Responsibilities:
- On `arpg:zone-boss-spawn`: build a placeholder boss mesh and add it
  to `window.ARPG_3D_CORE.getScene()`. Mesh structure:
  - `THREE.CylinderGeometry(0.6, 0.6, 1.8, 16)` for body
  - `THREE.MeshStandardMaterial({color: <knot-derived>, emissive: <darker>, emissiveIntensity: 0.4})`
  - `THREE.SpriteMaterial`-backed name label above the cylinder (boss.name)
  - Soft point light (`THREE.PointLight`) at boss position, color matches knot
  - Position: `mesh.position.set(boss.x, 0, boss.y)` (matches existing 3D world's xz-as-floor convention)
- On `arpg:zone-boss-tick`: lerp mesh.position toward (boss.x, 0, boss.y)
  over ~150ms; flash emissive intensity briefly on each hit (0.4 -> 1.5 over
  120ms) to sell impact.
- On `arpg:zone-boss-end`: animate death:
  - Scale ramp 1.0 -> 1.3 over 200ms (overshoot)
  - Then scale + opacity ramp to 0 over 800ms
  - Then `scene.remove(mesh)` + `mesh.traverse(disposeMeshDeep)` to free GPU resources
- Cleanup on zone change (player walks to a different zone) - despawn the boss mesh from current zone's scene reference.

### 4.2 Knot palette derivation

Map `boss.knot_flavor` to a base + emissive color:

| knot_flavor | base | emissive |
|---|---|---|
| `str` (red)        | 0xc23a3a | 0x701c1c |
| `dex` (green)      | 0x3ac256 | 0x1c701c |
| `int` (blue)       | 0x3a8cc2 | 0x1c4670 |
| `center` (purple)  | 0x9d4ec2 | 0x4d1c70 |
| (default)          | 0xc2a83a | 0x705e1c |

These align with the existing `COLOR_KNOT_*` constants in the engine's
`util/color.ts`. Renderer should use those constants if reachable from
the bundle, else inline hex above.

### 4.3 Bundle ritual

Mirror `arpg-zone-boss-renderer.js` verbatim into `arpg-bundle.js` per
CLAUDE.md bundle ritual, with `/* ===== arpg-zone-boss-renderer.js ===== */`
delimiter pattern.

### 4.4 Cache-bust ritual

Add `<script src="/arpg/arpg-zone-boss-renderer.js?v=p18-boss-render-v1">`
to all three `arpg-loom/index.html` shells (en/ru/th) AFTER
`arpg-zone-system.js` (so its CustomEvents are emitted by the time the
renderer's listeners attach... actually addEventListener is order-
independent, but conventional ordering helps debugging).

Bump `web/html/sw.js` `CACHE_VERSION` to `twt-vNN.NN-boss-render-v1`.

---

## Section 5 - HP bar UI + narrator banner + damage numbers (Track C scope)

### 5.1 arpg-zone-boss-hud.js

IIFE-wrapped, var-only, no arrows / no template literals. New module
in `docker/web/html/arpg/`.

Three UI elements, all DOM overlays positioned by world-to-screen
projection each frame:

**HP bar:**
- Floats above the boss mesh's screen position (project `(boss.x, 1.6, boss.y)` to NDC then to screen px via existing `ARPG_3D_CORE.getCamera()`).
- 240px wide x 18px tall. Dark grey background, red fill width tied to `hp_current / hp_max`.
- Border + tiny "Boss Name (lvl --)" label above.
- Hidden when `boss == null` for current zone.

**Damage numbers:**
- For each new entry in `recent_hits` since the last frame, spawn a small floating div at the boss's screen position.
- Animates up + fades over 1000ms. White text with red shadow. Font 18px bold.
- DOM-pooled (max 16 simultaneous; older recycle).

**Narrator banner:**
- Listens for `arpg:zone-narrator` CustomEvent (already emitted by Phase 16).
- Fixed position: top center, 60% width, semi-transparent dark background, italic body text.
- Auto-dismiss after `event.detail.ttl_ms` (default 5000ms). Stack-of-1: a new narrator line replaces the prior immediately with a short crossfade.

### 5.2 Implementation notes

- World-to-screen each frame should be a single matrix multiply per element. THREE provides `vector.project(camera)` which gives NDC; multiply by half viewport size for px.
- Use a single `requestAnimationFrame` driver in this module that updates HP bar position + damage number positions + animations. Don't poll on a separate `setInterval` - frame-locked makes it match the renderer.
- Damage numbers parsing: each frame, compare current `recent_hits` array length to last-seen length. New entries are the diff. Spawn a div per new entry. (The system layer already provides this; we just react to length deltas.)

### 5.3 Bundle ritual + cache-bust

Same as Track B. Add script tag to all three arpg-loom shells AFTER
the renderer (so the renderer's `getBossMesh()` API, if any, is
available).

### 5.4 Multi-language

`arpg:zone-narrator` events carry localized text via `event.detail.lines[lang]`
already (Phase 16 Track C). HUD just consumes the resolved string from
the event - no new translation work.

Boss name label: use `boss.name` directly (server already localizes
via `name_lines[lang]` per Phase 16 - the value in `data.boss.name` is
already in the right language).

"Boss" label prefix: hardcoded EN/TH/RU dictionary in the module (one
key, three values, ~6 lines).

---

## Section 6 - Backwards compatibility

- Phase 16 zone-event surface untouched. CustomEvents stay as they
  are; new consumers attach without disturbing existing audio
  consumer (Phase 17).
- Phase 17 audio module untouched.
- ZoneBossEntityResource is opt-in. Engine consumers who do not
  register the system see zero impact; ARPG_ZONE_SYSTEM's existing
  `getActiveBoss(zoneId)` API is unchanged.
- TWT consumers without the new modules (older bundle) see no change.
- An engine consumer that ignores Phase 18 (no ZoneBossEntitySystem
  registered) sees identical behavior to 0.15.0.

---

## Section 7 - Track contract surface

### Track A - engine boss-entity primitives

**New files:**
- `src/director/zone/zone-boss-entity.ts`
- `src/director/zone/zone-boss-entity-system.ts`
- `src/director/zone/index.ts` (NEW barrel; or extend if exists)

**Edits (additive only):**
- `src/index.ts` - re-export Phase 18 surface under a new comment block
- `package.json` - add 2 new test files

**Tests (2 files):**
- `tests/zone-boss-entity-resource.test.ts`
- `tests/zone-boss-entity-system.test.ts`

**Branch:** `claude/phase-18-1-zone-boss-entity` (engine repo)

**No version bump.** Coordination merges into 0.16.0.

### Track B - TWT 3D Three.js renderer

**New files (TWT):**
- `web/html/arpg/arpg-zone-boss-renderer.js`

**Edits:**
- `web/html/arpg/arpg-bundle.js` - mirror new module verbatim
- `web/html/arpg-loom/index.html` (en + ru + th) - add `<script>` tag with cache-bust
- `web/html/arpg/index.html` - bump bundle `?v=` query string
- `web/html/sw.js` - bump CACHE_VERSION

**No backend changes.** All client-side.

**Branch:** TWT worktree (harness-assigned). Merges to `week-19-visual`.

### Track C - HUD: HP bar + damage numbers + narrator banner

**New files (TWT):**
- `web/html/arpg/arpg-zone-boss-hud.js`

**Edits:**
- `web/html/arpg/arpg-bundle.js` - mirror new module verbatim
- `web/html/arpg-loom/index.html` (en + ru + th) - add `<script>` tag with cache-bust
- `web/html/arpg/index.html` - bump bundle `?v=` query string
- `web/html/sw.js` - share Track B's CACHE_VERSION (no further bump if landing same release)

**Coordination with Track B:** Both edit `arpg-bundle.js` (different sections, no conflict if both add their own delimited blocks). Both edit `index.html` shells (same `<script>` block, real conflict on merge — coordination resolves). Both edit `sw.js` (same line — coordination picks one CACHE_VERSION value).

**Branch:** Separate TWT worktree (harness-assigned).

---

## Section 8 - Open questions (resolve at lock)

### 8.1 Boss visual representation
**Resolution: placeholder cylinder + emissive material + name sprite.**
Ships TODAY without a 3D art pipeline. Asset swap to a proper boss
model is mechanical post-v1 (one geometry/material change in the
renderer module).

### 8.2 HP bar position
**Resolution: floating overhead, projected each frame.** DOM overlay
positioned via `vector.project(camera)`. Alternative (corner-of-
screen) deferred - overhead is more readable and matches typical
ARPG conventions (Diablo, PoE).

### 8.3 Death animation
**Resolution: scale-overshoot 1.0 -> 1.3 -> 0 + opacity fade over
1000ms total.** Mid-budget; sells the death moment without requiring
particle systems. Phase 17.5+ can layer particles via GPU particles
once that lands.

### 8.4 Boss vs player damage feedback
Player taking damage is OUT of scope. v1 boss is invulnerable to
boss attacks (server-side combat) and only shows player-dealt
damage via tick events. Player HP / death rendering: deferred.

### 8.5 Multi-boss per zone
v1 supports at most one. Multi-boss deferred per spec sec.1.2.

---

End of v1 spec.
