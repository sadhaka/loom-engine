# Changelog

Loom Engine - cumulative phase-by-phase log. Each version line links
to the spec phase in [LOOM-ENGINE-SPEC.md](../docker/LOOM-ENGINE-SPEC.md)
Section 7 and the GitHub commit. Format follows the spirit of
[Keep a Changelog](https://keepachangelog.com/) but is organized by
phase rather than calendar release - solo-dev project, no semver
contract yet.

## 0.39.0 - 2026-05-08

**InputChord - combo / sequence / doubleTap / hold pattern recognizer
on top of InputActions.** InputActions (0.31.0) covers the
"single-key triggers an action" case; InputChord adds the four
patterns InputActions can't express:

- **`combo`** — all keys held simultaneously (Ctrl+S, Shift+W).
  Order-agnostic. Re-arms after any key in the set comes up.
- **`sequence`** — keys pressed in order, each within `windowMs` of
  the prior. Fighting-game / cheat-code style.
- **`doubleTap`** — same key pressed twice within `windowMs`.
  Common dash trigger.
- **`hold`** — single key held continuously for `holdMs`. Charge
  attacks, contextual prompts, long-press menus.

Same driving model as InputActions: wire `handleKeyDown` /
`handleKeyUp` to whatever event source you have, call `tick(dtMs)`
once per frame, read `wasFired(name)` or subscribe via
`onFired(name, cb)`.

### Added

- `src/input/input-chord.ts` - `InputChord` class:
  - `define(name, def)` / `undefine(name)` / `has(name)` /
    `chordNames()` / `clear()`.
  - `handleKeyDown(key)` / `handleKeyUp(key)` / `releaseAll()`
    (wipes in-flight state on window blur).
  - `tick(dtMs)` advances hold clocks (firing on threshold) and
    ages sequence/doubleTap windows (resetting on timeout). Also
    clears `firedThisFrame` so `wasFired` is single-frame.
  - `wasFired(name)` polling + `onFired(name, cb)` callback API.
    Throwing callbacks isolated.
  - `stats()` introspection (chord count + watched key count).
  - Reverse-index from key -> chord names so handleKeyDown /
    handleKeyUp dispatch is O(chords-watching-this-key) not
    O(all-chords).
- `ChordDef`, `ChordKind` types exported.
- `RESOURCE_INPUT_CHORD` constant.

### Tests

914 -> 944 (30 new in tests/input-chord.test.ts):
- RESOURCE_INPUT_CHORD stable string.
- define + has + chordNames; undefine drops chord + reverse index;
  undefine missing returns false.
- combo: fires when all held; order-agnostic; once per
  satisfaction with re-arm on key-up; does not fire if a key comes
  up before completion; single-key combo fires on key-down.
- sequence: fires on in-order completion; wrong key resets;
  windowMs timeout resets; stays alive across multiple ticks;
  first-key recovery (wrong key that's the start key restarts).
- doubleTap: fires on second tap within window; window timeout
  blocks; ignores unrelated keys in between.
- hold: fires after threshold; cancels on early release; once per
  press cycle with re-arm on key-up.
- onFired: callback fires on match; unsubscribe works; throwing
  callback does not break dispatch.
- releaseAll wipes in-flight recognition state.
- tick clears firedThisFrame (single-frame); tick(0) clears flag
  without advancing clocks.
- redefining a chord resets state and drops callbacks.
- clear drops everything; stats reflects counts.
- Ignores key events for unwatched keys.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { InputChord } from '@sadhaka/loom-engine';

var ch = new InputChord();

// Save: Ctrl+S anywhere.
ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });

// Dash: double-tap a movement key.
ch.define('dash-left', { kind: 'doubleTap', keys: 'KeyA', windowMs: 250 });

// Charge attack: hold E for 600ms.
ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 600 });

// Hadoken: down, down-forward, forward, punch.
ch.define('hadoken', {
  kind: 'sequence',
  keys: ['ArrowDown', 'ArrowRight', 'KeyP'],
  windowMs: 400,
});

// Wire to your event source:
window.addEventListener('keydown', (e) => ch.handleKeyDown(e.code));
window.addEventListener('keyup', (e) => ch.handleKeyUp(e.code));
window.addEventListener('blur', () => ch.releaseAll());

// Each frame:
ch.tick(deltaTimeMs);
if (ch.wasFired('hadoken')) playHadoken();
```

## 0.38.0 - 2026-05-08

**PersistentStorage - browser/SSR-safe key/value adapter for engine state.**
0.26.0 WorldSnapshot produces an `IPersistableResource` envelope;
PersistentStorage gives consumers a place to put it. Three pieces:
a minimal async `IStorageBackend` contract, two concrete backends
(`MemoryStorageBackend` for tests / SSR / fallback and
`LocalStorageBackend` for browser `window.localStorage`), and the
`PersistentStorage` facade that adds JSON encoding, namespacing, and
typed `WorldSnapshot` helpers on top.

Async-only API so the same code runs against synchronous
localStorage today and asynchronous IndexedDB / network backends
tomorrow without consumers branching.

### Added

- `src/runtime/persistent-storage.ts`:
  - `IStorageBackend` interface: `get / set / remove / keys / clear`,
    all returning Promises.
  - `MemoryStorageBackend` - Map-backed, useful for tests + SSR.
  - `LocalStorageBackend` - wraps `window.localStorage` with optional
    per-instance `prefix` for safe sharing. Falls back to in-memory
    if no Storage is available (Node SSR boot path). `isLive()`
    surfaces which mode it's in.
  - `PersistentStorage` facade:
    - `save(key, data)` / `load(key)` - JSON-encoded read/write.
      Corrupted JSON returns null instead of throwing.
    - `hasKey(key)` / `remove(key)` / `listKeys()` / `clearAll()`.
    - `saveSnapshot(key, snap)` / `loadSnapshot(key)` - typed
      WorldSnapshot helpers; loadSnapshot validates the envelope
      shape and returns null on mismatch (defensive against
      corrupted localStorage).
    - `dispose()` - locks subsequent ops; the underlying backend is
      NOT disposed (consumer owns its lifetime).
  - Optional `namespace` on the facade, separate from the backend's
    `prefix`, so multiple subsystems can share one localStorage.
- `RESOURCE_PERSISTENT_STORAGE` constant.

### Tests

884 -> 914 (30 new in tests/persistent-storage.test.ts):
- RESOURCE_PERSISTENT_STORAGE stable string.
- MemoryStorageBackend: starts empty; set+get; overwrite; remove;
  keys; clear.
- LocalStorageBackend: provided Storage; prefix scoping; keys
  prefix-stripped; clear with prefix only clears scoped keys; falls
  back to in-memory; missing key returns null; remove on missing is
  no-op.
- PersistentStorage facade: save+load roundtrip; missing key null;
  corrupted JSON null; hasKey; remove; namespace isolation;
  listKeys namespace-stripped; clearAll within namespace; dispose
  no-op; circular reference rejects.
- WorldSnapshot helpers: roundtrip envelope; missing snapshot null;
  non-snapshot payload null; wrong field types null; works against
  LocalStorageBackend with prefix + namespace.
- IStorageBackend can be implemented externally (custom Counter
  backend example).

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  PersistentStorage, LocalStorageBackend,
  serializeWorldSnapshot, deserializeWorldSnapshot,
} from '@sadhaka/loom-engine';

var ps = PersistentStorage.create({
  backend: new LocalStorageBackend({ prefix: 'twt:' }),
  namespace: 'snap:',
});

// Save on quit:
var snap = serializeWorldSnapshot(world.resources, '0.38.0');
await ps.saveSnapshot('autosave', snap);

// Load on boot:
var prior = await ps.loadSnapshot('autosave');
if (prior) deserializeWorldSnapshot(world.resources, prior);
```

## 0.37.0 - 2026-05-08

**FloatingText - HUD primitive for damage numbers / floating labels.**
A renderer-agnostic state container for the short-lived numeric /
text overlays every action game ships: damage numbers on hit, "+10
XP" reward popups, miss indicators, status confirmations. Pool-
backed (no per-spawn GC), kinematic integration with optional
gravity / drift, and an alpha curve that fades over the last
portion of lifetime. Engine ships ZERO render path - consumers wire
`forEach()` to whatever they have (Canvas2D fillText, WebGL2
SpriteBatcher with a font atlas, DOM-overlay element pool, etc.).

### Added

- `src/runtime/floating-text.ts` - `FloatingText` class:
  - `emit(spawn)` -> slot index >= 0, or -1 if pool full / disposed.
    Spawn shape carries position, text, optional vx/vy/ax/ay,
    lifetimeMs, color (0xRRGGBB), and scale. Missing fields fall
    back to system options, then library defaults.
  - `tick(dtMs)` - semi-implicit Euler integration of velocity +
    acceleration; auto-deactivates entries past their lifetimeMs.
    `tick(0)` is a no-op.
  - `forEach(cb)` - iterate active entries with their current
    render state (text, x, y, alpha, color, scale, ageMs,
    lifetimeMs). Throwing callbacks are isolated per-entry.
  - `clearAll()` - deactivate all entries immediately.
  - `activeCount()` / `capacity()` - introspection.
  - `dispose()` - locks subsequent ops.
- Alpha curve: linear fade-in over `fadeFractionStart` of lifetime,
  hold at 1 in the middle, linear fade-out over the final
  `fadeFractionEnd`. Defaults: 0% fade-in, 30% fade-out.
- Round-robin slot search keeps allocation O(capacity) without
  preferring head-of-array entries.
- `FloatingTextSpawn`, `FloatingTextRenderState`, `FloatingTextOptions`
  types exported.
- `RESOURCE_FLOATING_TEXT` constant.

### Tests

861 -> 884 (23 new in tests/floating-text.test.ts):
- RESOURCE_FLOATING_TEXT stable string.
- Default capacity 64.
- emit returns slot index >= 0 when pool has space.
- emit returns -1 when pool full.
- emit defaults pull from system options.
- emit explicit options override system defaults.
- tick integrates position from velocity over time.
- tick integrates velocity from acceleration (semi-implicit Euler).
- tick deactivates entries past lifetimeMs.
- alpha is 1 in the middle of lifetime.
- alpha fades linearly over the last fadeFractionEnd.
- alpha fade-in ramps up at start when fadeFractionStart > 0.
- forEach iterates only active entries.
- Deactivated slot is reusable on next emit.
- clearAll deactivates all texts immediately.
- dispose makes ops no-op.
- tick(0) is a no-op.
- forEach swallows callback errors per entry.
- ageMs and lifetimeMs surface to render state.
- emit text content preserved verbatim.
- Round-robin slot search reuses freed slots.
- lifetimeMs <= 0 falls back to default.
- Alpha never escapes [0, 1].

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { FloatingText } from '@sadhaka/loom-engine';

var fx = FloatingText.create({ capacity: 128 });

// On hit:
fx.emit({
  x: enemy.x, y: enemy.y - 20,
  text: '42',
  color: isCrit ? 0xffd700 : 0xffffff,
  scale: isCrit ? 1.5 : 1,
  vy: -80, ay: 100, lifetimeMs: 700,
});

// Each frame:
fx.tick(deltaTimeMs);

// Render (Canvas2D example):
fx.forEach(function (s) {
  ctx.globalAlpha = s.alpha;
  ctx.fillStyle = '#' + s.color.toString(16).padStart(6, '0');
  ctx.font = (14 * s.scale).toFixed(0) + 'px sans-serif';
  ctx.fillText(s.text, s.x, s.y);
});
ctx.globalAlpha = 1;
```

## 0.36.0 - 2026-05-08

**FrameBudgetScheduler - soft-deadline task queue for off-frame work.**
The engine routinely needs to run heavy work that does not fit in a
single 16ms frame: precomputing occlusion grids, baking nav-mesh
tiles, processing a long event queue, hydrating snapshot data,
JIT-loading sprite atlases. Doing it all on the main thread freezes
the frame and surfaces as a hitch in the browser.

FrameBudgetScheduler accepts step functions and runs as many as fit
in `budgetMs` per `tick()`. Each step returns true when done (drops
out of the queue), or false to keep itself queued for the next tick.
The currently-executing step is NEVER preempted - the scheduler
only stops queueing more after the budget is exhausted.

### Added

- `src/runtime/frame-budget-scheduler.ts` - `FrameBudgetScheduler` class:
  - `schedule(task)` -> taskId. Optional `id`, `priority`, `step`,
    `onComplete`, `onCancel`. Synthetic id `task#NNN` if none given.
  - `cancel(id)` -> boolean. Fires `onCancel` if the task existed.
  - `tick()` -> `FrameBudgetStats`. Drains tasks in priority desc /
    insert order (FIFO at ties) until `budgetMs` is reached.
  - `flush()` -> `FrameBudgetStats`. Drain everything ignoring budget
    (useful at shutdown / loading screens).
  - `setBudgetMs(ms)` / `getBudgetMs()` - runtime budget tuning.
  - `has(id)` / `pendingCount()` - introspection for debug HUD.
  - `dispose()` - cancels remaining tasks (firing `onCancel` for each)
    and makes subsequent operations no-ops.
- Throwing step is treated as "done" - the task is dropped without
  firing onComplete or onCancel, so a misbehaving step cannot stick
  in the queue forever.
- Custom `now: () => number` for deterministic replays (defaults to
  `performance.now()` with `Date.now()` fallback).
- `FrameBudgetTaskDef`, `FrameBudgetStats`, `FrameBudgetSchedulerOptions`
  types exported.
- `RESOURCE_FRAME_BUDGET_SCHEDULER` constant.

### Tests

837 -> 861 (24 new in tests/frame-budget-scheduler.test.ts):
- RESOURCE_FRAME_BUDGET_SCHEDULER stable string.
- Default budget 8ms.
- Empty queue tick returns zeroed stats.
- schedule + tick runs the step.
- Step returning false stays for next tick.
- Budget exceeded stops queueing more steps + overBudget flag.
- cancel removes pending task + fires onCancel.
- cancel unknown id returns false.
- onComplete fires once when step returns true.
- Priority - higher runs first.
- Same priority - FIFO ordering.
- schedule without id assigns synthetic monotonic id.
- Re-scheduling an existing id replaces the task.
- setBudgetMs updates the budget for the next tick.
- setBudgetMs ignores non-positive values.
- Stats.spentMs reflects wall time inside step calls.
- Throwing step drops the task without onComplete / onCancel.
- flush drains everything ignoring budget.
- dispose cancels remaining tasks and stops further work.
- Progressive task across multiple ticks completes.
- Stats.pendingCount reflects queue after the tick.
- Cancel during next-tick continuation removes step from queue.
- Completed task is not in byId map post-tick.
- pendingCount reflects count regardless of priority.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { FrameBudgetScheduler } from '@sadhaka/loom-engine';

var sched = FrameBudgetScheduler.create({ budgetMs: 4 });

// Bake a 32x32 nav-mesh chunk over many frames - one row per step.
var row = 0;
sched.schedule({
  id: 'navmesh-bake',
  priority: 5,
  step: function () {
    bakeRow(row);
    row++;
    return row >= 32;
  },
  onComplete: function () { console.log('nav-mesh ready'); },
});

// Each frame:
var stats = sched.tick();
if (stats.overBudget) {
  // Diagnostics: queue is backed up.
}
```

## 0.35.0 - 2026-05-08

**AudioMixer - engine-side fade / crossfade / snapshot / duck on top
of AudioBus.** AudioBus (Phase 5) already exposes master gain +
per-bus gain + mute + VE-budget priority floors, and MusicDirector
(Phase 17) does fade/crossfade for the music channel only. AudioMixer
fills the rest of the gap: animate any bus or master to a target
gain over time, snapshot/restore mix presets, and stack named ducks
with attack/release envelopes. Driven by `tick(dt)` (engine-side
animation, not Web Audio AudioParam ramps) so behavior is
deterministic against EngineClock and tests run against the same
FakeAudioContext mocks the rest of the audio module uses.

### Added

- `src/audio/audio-mixer.ts` - `AudioMixer` class:
  - `fadeBus(name, target, opts)` / `fadeMaster(target, opts)` -
    animate to a target gain over `durationMs` with optional easing
    (any 0.29.0 `EasingName` or custom `EasingFn`). `durationMs <= 0`
    applies immediately; `onComplete` fires once when the fade lands.
  - `crossfade(fromBus, toBus, toTarget, opts)` - simultaneous fades
    on the two buses; `onComplete` fires once at the end.
  - `snapshot(key)` / `restore(key, opts?)` / `hasSnapshot(key)` /
    `clearSnapshot(key)` - capture the current target gains under a
    name and replay them later (instant or faded).
  - `pushDuck(key, busName, opts)` / `releaseDuck(key)` /
    `hasDuck(key)` - apply a named multiplier (`scalar`, `attackMs`,
    `releaseMs`) to a target bus. Multiple ducks stack with
    lowest-scalar-wins. Useful for "duck music while voice plays"
    without coupling the systems.
  - `tick(dtMs)` - advances all in-flight fades + ducks, computes
    `target * lowestDuckMultiplier`, and pushes the result via
    `AudioBus.setBusGain` / `AudioBus.setMasterGain`. `tick(0)` is a
    no-op.
  - `isFading(name)` / `isMasterFading()` / `getBusTarget(name)` /
    `getMasterTarget()` - introspection for tests + debug HUD.
  - `dispose()` - clears all in-flight state. The underlying
    AudioBus is NOT disposed (mixer does not own it).
- `AudioBus.listBuses()` - tiny additive helper so the mixer can
  enumerate registered buses for snapshots without external tracking.
- `RESOURCE_AUDIO_MIXER` constant.

### Tests

804 -> 837 (33 new in tests/audio-mixer.test.ts):
- RESOURCE_AUDIO_MIXER stable string.
- Create seeds master + bus targets from live AudioBus state.
- fadeBus duration 0 applies immediately + fires onComplete.
- fadeBus animates linearly across ticks.
- fadeBus onComplete fires exactly once.
- Replacing in-flight fade re-targets from the current value.
- fadeBus on unknown bus is a no-op.
- fadeBus respects easeInOutQuad curve at quarter / half points.
- fadeBus accepts a custom easing function (sqrt example).
- fadeMaster animates / instant variant / onComplete behaviour.
- crossfade animates two buses simultaneously, single onComplete.
- snapshot + restore (instant) returns target gains.
- snapshot + restore (faded) animates back to snapshot targets.
- restore with unknown key is a no-op.
- clearSnapshot removes the entry.
- pushDuck attackMs=0 jumps multiplier immediately.
- pushDuck attack ramp 1 -> scalar over attackMs.
- releaseDuck releaseMs=0 removes the duck immediately.
- releaseDuck ramps multiplier scalar -> 1 then removes.
- Multiple ducks on same bus -> lowest scalar wins.
- Duck multiplies on top of a fading bus target.
- pushDuck on unknown bus is a no-op.
- Re-pushing an active duck replaces parameters.
- tick(0) is a no-op.
- dispose makes subsequent operations no-op.
- getBusTarget reflects animated value mid-fade.
- Easings module sanity check.
- fadeBus negative target clamps to 0.
- Snapshot captures a target that mutates after capture.
- Release after attack still ramps multiplier back to 1.
- AudioBus.listBuses returns the default 4 names.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { AudioBus, AudioMixer } from '@sadhaka/loom-engine';

var bus = AudioBus.create();
var mixer = AudioMixer.create({ bus });

// Fade music down to 30% over half a second when entering a menu.
mixer.fadeBus('music', 0.3, { durationMs: 500, easing: 'easeOutCubic' });

// Snapshot the in-game mix, switch to a cinematic preset, restore later.
mixer.snapshot('inGame');
mixer.fadeMaster(0.6, { durationMs: 200 });
// ... cinematic plays ...
mixer.restore('inGame', { durationMs: 400 });

// Duck music when voice plays.
mixer.pushDuck('voice-active', 'music', {
  scalar: 0.3, attackMs: 120, releaseMs: 400,
});
// ... voice line plays ...
mixer.releaseDuck('voice-active');

// Each frame:
mixer.tick(deltaTimeMs);
```

`AudioBus.listBuses()` is the only addition to existing surface; no
existing AudioBus consumers had it referenced.

## 0.34.0 - 2026-05-08

**AssetPreloader - declarative asset loading with progress events.**
The engine has individual asset helpers (asset-loader, audio-asset-
loader, sprite-sheet-loader); AssetPreloader bundles them into a
manifest the consumer hands over once + listens for events. Useful
for a loading screen.

### Added

- `src/runtime/asset-preloader.ts` - `AssetPreloader` class:
  - `add(id, loader)` - queue an asset; loader returns a Promise.
  - `on('progress' | 'asset' | 'error' | 'done', handler)` and the
    typed shortcuts onProgress / onAsset / onError / onDone.
  - `start()` -> Promise<AssetDoneEvent>. Idempotent; second call
    returns the existing done result.
  - `get(id)` - fetch successful result post-done.
  - `stats()` - introspection.
- Failed loaders don't halt the queue: every entry attempts; the
  'done' event reports succeeded + failed + errors[].
- Throwing event handler doesn't block siblings or queue progress.
- `AssetProgressEvent`, `AssetLoadedEvent`, `AssetErrorEvent`,
  `AssetDoneEvent` types exported.
- `RESOURCE_ASSET_PRELOADER` constant.

### Tests

788 -> 804 (16 new in tests/asset-preloader.test.ts):
- Empty queue -> done with zero counts.
- Single asset loads + done fires.
- Progress event per asset.
- Asset event per successful load.
- Failed loader fires error + done counts failed.
- Failed loader does NOT halt queue.
- add() after start() throws.
- Duplicate id / empty id / missing loader throw on add.
- get() returns null for failed; undefined for unknown.
- Stats reflect state at each phase.
- Throwing handler doesn't block siblings.
- Unsubscribe via returned function.
- Second start() returns same done result.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { AssetPreloader } from '@sadhaka/loom-engine';

var pre = new AssetPreloader();
pre.add('hero', () => fetch('/img/hero.png'));
pre.add('music', () => loadAudio('/snd/loom.ogg'));
pre.onProgress((ev) => updateBar(ev.fraction));
var done = await pre.start();
console.log('loaded', done.succeeded, 'failed', done.failed);
```

## 0.33.0 - 2026-05-08

**Color utility extensions.** The existing src/util/color.ts already
had ColorRGBA, hexToRgba (number), rgbaToHexString, colorLerp(out)
and the COLOR_KNOT palette. 0.33.0 adds string-parsing, blending,
HSL adjustment, and Uint32 pack/unpack without changing the
existing surface.

### Added

- `parseHex(str)` - parse a string hex color. Accepts 3 / 4 / 6 / 8
  hex digits with or without leading `#`. Returns null on invalid.
- `toHexString(c)` - format with auto 6 / 8 digits based on alpha.
- `colorBlend(over, under)` - alpha-composite two straight-alpha
  colors; output is straight-alpha. Returns a fresh object.
- `adjustHsl(c, dh, ds, dl)` - hue (degrees) + saturation + lightness
  deltas in HSL space; alpha preserved.
- `pack32(r, g, b, a)` -> Uint32 in 0xRRGGBBAA byte order. Useful
  for typed-array storage in particle pools.
- `unpack32(packed)` - inverse.
- `clamp01(v)` - clamp to [0, 1] with NaN / Infinity rejected.

### Backwards compatibility

Pure addition. Existing exports unchanged. The new helpers complement
rather than replace - e.g. parseHex(string) is the str-input
companion to the existing hexToRgba(number).

### Tests

769 -> 788 (19 new in tests/color.test.ts):
- rgba builds object; clamp01 edge cases.
- parseHex 3 / 4 / 6 / 8-digit forms; with / without # prefix;
  invalid input returns null.
- toHexString auto 6 / 8 digit formatting.
- parseHex -> toHexString round-trip.
- colorBlend opaque-over-opaque, transparent-over-opaque,
  transparent-over-transparent.
- adjustHsl shifts hue 120deg correctly; alpha preserved.
- pack32 + unpack32 round-trip.
- pack32 byte order is RRGGBBAA.
- pack32 clamps inputs.

## 0.32.0 - 2026-05-08

**ObjectPool - generic reusable object pool to cut GC pressure.**
Allocating short-lived objects every frame (damage numbers,
particles, projectiles, hit-flash overlays) creates GC pressure
that surfaces as frame-rate hitches. ObjectPool lets a system
pre-allocate N instances and reuse them.

### Added

- `src/runtime/object-pool.ts` - `ObjectPool<T>` class:
  - Constructor opts: `factory`, optional `reset(obj)`, optional
    `initialSize`, optional `maxSize` (cap).
  - `acquire()` - pops free instance OR allocates fresh OR returns
    null at cap.
  - `release(obj)` - calls `reset()` if configured, then returns
    object to free list.
  - `warm(count)` - pre-allocate more (capped by maxSize).
  - `clear()` - drop everything; subsequent acquire allocates fresh.
  - `freeCount()` / `inUseCount()` / `totalAllocated()` /
    `stats()` - introspection.
- Throwing `reset()` is caught + logged; release still adds to free.
- maxSize cap rejects acquire with null; counter tracks cap hits.

### Tests

756 -> 769 (13 new in tests/object-pool.test.ts):
- Factory required.
- acquire allocates from factory when free list empty.
- release returns object; subsequent acquire reuses.
- reset() called on release; no reset() means released state persists.
- initialSize pre-fills.
- maxSize caps total allocations; capRejects counter increments.
- warm() pre-allocates more (capped).
- clear() drops everything.
- Stats counters track acquires + releases + capRejects.
- Throwing reset is caught; release still adds to free.
- Large initial > maxSize is clamped.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { ObjectPool } from '@sadhaka/loom-engine';

var pool = new ObjectPool<DamageNumber>({
  factory: () => ({ x: 0, y: 0, life: 0 }),
  reset: (p) => { p.x = 0; p.y = 0; p.life = 0; },
  initialSize: 64,
});

// Hot path:
var p = pool.acquire();
if (p) { p.x = hitX; p.y = hitY; p.life = 1.0; }
// ... later
pool.release(p);
```

## 0.31.0 - 2026-05-08

**InputActions - declarative key/action bindings.** Existing
input-manager captures raw keydown/keyup; consumers wire game logic
to specific keys ("if SPACE is down, jump"). InputActions adds
indirection: declare an action ("jump") + the keys triggering it,
query by name. Foundation for a future settings-rebind UI.

### Added

- `src/input/input-actions.ts` - `InputActions` class:
  - `bind(action, keys)` / `unbind(action, keys?)` - manage bindings.
  - `handleKeyDown(key)` / `handleKeyUp(key)` - feed from window
    listeners or input-manager.
  - `releaseAll()` - drop all held keys (window blur).
  - `isActive(action)` / `wasJustPressed(action)` /
    `wasJustReleased(action)` - per-frame queries.
  - `update()` - call once per frame; clears just-pressed /
    just-released so they're single-frame events.
  - `keysFor(action)` / `actionNames()` - introspection.
  - `clear()` / `stats()`.
- Multi-key bindings: any of the bound keys triggers the action;
  action stays active while ANY bound key is held.
- Same key can drive multiple actions (e.g. Space -> 'jump' +
  'confirm-dialog').
- Duplicate keydown events on already-held key don't re-fire
  justPressed (matches DOM behaviour for held keys).
- Unbinding a held key forces re-evaluation of active state.
- `RESOURCE_INPUT_ACTIONS` constant.

### Tests

739 -> 756 (17 new in tests/input-actions.test.ts):
- bind + isActive single key.
- Bind to array - any triggers action.
- Multiple held keys keep action active until last released.
- wasJustPressed / wasJustReleased fire once per transition.
- Duplicate keydown does not re-fire justPressed.
- unbind drops keys; held key unbind re-evaluates.
- unbind() with no keys drops the whole action.
- releaseAll wipes held keys + fires justReleased.
- Same key shared across actions fires both.
- Stats track event counts.
- clear() drops everything.
- Empty key strings silently ignored; re-bind idempotent.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { InputActions } from '@sadhaka/loom-engine';

var ia = new InputActions();
ia.bind('jump', ['Space', 'Enter']);
window.addEventListener('keydown', e => ia.handleKeyDown(e.code));
window.addEventListener('keyup', e => ia.handleKeyUp(e.code));

// In game loop:
if (ia.wasJustPressed('jump')) player.jump();
ia.update();
```

## 0.30.0 - 2026-05-08

**SpatialHash - bucket entities by world cell for fast nearby
queries.** Boss target picking, AoE coverage, particle culling, peer
proximity - all the "entities NEAR a point" queries that ComponentSignature
+ QueryCache (0.22.0) don't accelerate. SpatialHash gives O(1) insert
+ O(K) query where K = entities in the queried cells.

### Added

- `src/runtime/spatial-hash.ts` - `SpatialHash` class:
  - `insert(entity, x, y)` - O(1) bucket assignment.
  - `update(entity, x, y)` - same-cell is no-op; cross-cell is
    swap-pop + reinsert.
  - `remove(entity)` - O(1) swap-pop; bucket auto-cleans when empty.
  - `queryRect(x0, y0, x1, y1)` - returns all entities in cells
    overlapping the rect. Caller filters by precise containment if
    needed.
  - `queryRadius(cx, cy, r)` - convenience over queryRect.
  - `size()`, `bucketCount()`, `clear()`, `stats()`.
- Cell size configurable at construction (default 32 world units).
  Invalid sizes (0, NaN, negative) clamp to 32.
- Negative coordinates handled (cell coord biased internally).
- Reversed query rect bounds normalized.
- `RESOURCE_SPATIAL_HASH` constant.

### Tests

726 -> 739 (13 new in tests/spatial-hash.test.ts):
- insert + queryRect / queryRadius narrows correctly.
- remove drops entity + cleans empty bucket; double-remove is false.
- update within same cell is a no-op.
- update across cells rebuckets; old cell empty + new cell has entity.
- insert on existing entity equivalent to update.
- queryRect with reversed bounds normalized.
- 100-entity stress: all retrievable from full bbox query.
- clear() drops everything.
- cellSize defaults to 32 on invalid input.
- Stats counters increment correctly.
- Negative coordinates work.
- Swap-pop maintains correct indexInBucket on remove (5-entity cell
  stress test).

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { SpatialHash } from '@sadhaka/loom-engine';

var sh = new SpatialHash(32);
// On entity transform update:
sh.update(entityId, transform.x, transform.y);
// Boss target search:
var nearby = sh.queryRadius(boss.x, boss.y, ATTACK_RANGE);
for (var i = 0; i < nearby.length; i++) {
  // exact-distance filter here
}
```

## 0.29.0 - 2026-05-08

**Tween system - animate scalar values over time with easings.**
Camera zoom, HUD fade, color transitions, particle alpha decay, audio
volume swells - any "value from A to B over T seconds with curve"
needs the same scheduler. Tween provides it.

### Added

- `src/runtime/tween.ts` - `Tween` class:
  - `to(from, to, durationSeconds, onUpdate, options?)` -> `TweenHandle`.
    Schedules an animation; calls `onUpdate(value)` each frame.
  - Options: `easing` (name string OR custom `(t) => number` fn) +
    `onComplete` callback.
  - `update(dtSeconds)` per-frame entry point.
  - `cancelAll()` and per-tween `handle.cancel()`.
  - `activeCount()` + `stats()` for diagnostics.
- `Easings` table with 13 standard curves: linear + easeIn / easeOut /
  easeInOut variants of quad / cubic / quart / sine. Custom curves
  accepted via callable `(t) => number`.
- Zero / negative duration snaps immediately to `to` and fires
  onComplete in the same call - useful for "toggle state with no
  transition".
- Throwing `onUpdate` / `onComplete` callbacks are caught + logged;
  one bad subscriber doesn't break the loop.
- Cancelled tweens do NOT fire `onComplete` - explicit "I aborted
  this" semantic.
- `RESOURCE_TWEEN` constant. `TweenHandle`, `TweenOptions`,
  `EasingFn`, `EasingName` types exported.

### Tests

711 -> 726 (15 new in tests/tween.test.ts):
- Linear interpolates from -> to over duration.
- Completes after duration; no further updates.
- onComplete fires once at the end.
- Zero duration snaps immediately + completes.
- Cancel stops further updates; onComplete does NOT fire.
- handle.isActive reflects status.
- Multiple tweens run in parallel.
- cancelAll cancels every running tween.
- Easing customizable via name AND callable.
- Unknown easing name falls back to linear.
- Invalid dt rejected (no NaN propagation).
- Throwing onUpdate is caught; tween still completes.
- Stats track active + completed + cancelled.
- Easings table has 13 named functions.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { Tween, Easings } from '@sadhaka/loom-engine';

var tw = new Tween();
tw.to(0, 100, 1.0, function (v) { hud.opacity = v; },
  { easing: 'easeOutCubic' });

// In render loop:
tw.update(dtSeconds);
```

## 0.28.0 - 2026-05-08

**EventBus - generic typed pub/sub for the engine.** Systems and
consumers need to talk without each side knowing the other's
identity. The engine already has specialized buses (zone events,
plugin dispatch, DOM CustomEvents); EventBus is the generic layer
for everything else.

### Added

- `src/runtime/event-bus.ts` - `EventBus` class:
  - `subscribe(topic, handler)` -> unsubscribe function. Idempotent
    unsubscribe.
  - `once(topic, handler)` - auto-removes after first delivery.
  - `publish(topic, data?)` - delivers to all current subscribers.
    Errors caught + logged; one bad handler doesn't block siblings
    or break the publisher.
  - `off(topic)` / `clear()` - bulk-drop subscribers.
  - `topics()` / `handlerCount(topic)` - introspection.
  - `stats()` - publishCount + deliveredCount + topicCount.
- Snapshot semantics: handlers added DURING a publish do NOT fire
  for that same publish (they're added to the next-publish list).
  This matches DOM EventTarget behavior.
- `RESOURCE_EVENT_BUS` constant.
- `EventHandler<T>` type.

### Tests

698 -> 711 (13 new in tests/event-bus.test.ts):
- subscribe + publish delivers data.
- Multiple subscribers all receive each publish.
- Unsubscribe stops delivery; idempotent.
- once fires exactly once + auto-removes.
- Handlers added during publish don't fire for same publish.
- Throwing handler doesn't block siblings or subsequent publishes.
- off() / clear() bulk-drops.
- topics() / handlerCount() / stats() round-trip.
- Publish with no subscribers is silent.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { EventBus } from '@sadhaka/loom-engine';

var bus = new EventBus();
var unsub = bus.subscribe('player.died', function (data) { ... });
bus.publish('player.died', { x: 10, y: 20 });
unsub();
```

## 0.27.0 - 2026-05-08

**CameraController - smooth follow / shake / bounds clamp / fit-rect.**
Higher-level camera behaviors on top of the existing CameraView. The
controller writes back into the same CameraView so render systems
see no API change.

### Added

- `src/renderer/camera-controller.ts` - `CameraController` class:
  - `followTarget(x, y, smoothing?)` - per-frame target update; the
    controller lerps toward it each tick using exponential smoothing.
  - `clearFollow()` - stop following.
  - `snapTo(x, y)` - immediate reposition; clears follow target.
  - `shake(amplitude, durationMs)` - additive screen shake; linear
    amplitude decay; replaces any active shake.
  - `getShakeOffset()` - read the current applied shake offset (for
    HUD elements that should also shake).
  - `setBounds(rect | null)` - clamp the visible rect inside the
    given world bounds. null disables. Tiny worlds (smaller than
    viewport) center on bounds midpoint.
  - `fit(rect, paddingPx?)` - one-shot zoom + center to show the
    rect with paddingPx pixels of slack. Picks the tighter axis.
  - `update(dtSeconds)` - apply pending follow + shake decay each
    frame.
- `CameraControllerOptions` (defaultSmoothing + randomFn injection
  seam for deterministic shake tests).
- `RESOURCE_CAMERA_CONTROLLER` constant.

### Tests

686 -> 698 (12 new in tests/camera-controller.test.ts):
- snapTo immediate reposition.
- followTarget lerps with smoothing factor; converges over time.
- clearFollow stops the lerp.
- shake decays to zero offset over duration.
- shake replaces an active shake; invalid duration cancels.
- setBounds clamps view center; setBounds(null) disables.
- fit centers + zooms; fit honors padding.
- Tiny world centers on bounds midpoint when bounds < viewport.
- Invalid dt rejected (no NaN propagation).

### Backwards compatibility

Pure addition. CameraView shape unchanged; render systems read it
the same way. Engine consumers opt in:

```ts
import { CameraController, createCamera } from '@sadhaka/loom-engine';

var view = createCamera(canvas.width, canvas.height);
var ctrl = new CameraController(view);

ctrl.followTarget(player.x, player.y);
// ... in render loop:
ctrl.update(dtSeconds);
device.setCamera(view);
```

## 0.26.0 - 2026-05-08

**WorldSnapshot - opt-in save/load via persistable resources.** Lets
a consumer serialize world state to JSON for persistence / replay /
trace export, and restore it later. Resources opt in by implementing
`IPersistableResource`; resources that don't are silently skipped.

### Why this scope (not full ECS serialization)

Component pools are SoA Float32Arrays - serializing them generally
requires schema versioning per pool + entity-id remapping on restore
(complex). What CAN be saved cheaply today is the registered resource
state: time, knot context, plugin storage snapshots, custom consumer
resources. WorldSnapshot delivers exactly that with a minimal
contract.

A future v2 can layer entity-pool serialization on top once a stable
component-schema discipline lands.

### Added

- `src/runtime/world-snapshot.ts` -
  - `IPersistableResource` interface: optional `persistKey?: string`
    + `serialize?(): unknown` + `deserialize?(data): void`. Both
    methods return / accept JSON-safe data.
  - `serializeWorldSnapshot(registry, engineVersion, nowFn?)` walks
    the registry, calls serialize() on persistable resources,
    returns a versioned envelope `{schemaVersion, engineVersion,
    capturedAtMs, resources}`. Errors in serialize() are logged +
    skipped; the rest of the envelope still ships.
  - `deserializeWorldSnapshot(registry, snapshot)` matches envelope
    keys to resources via `persistKey` (or registry key if absent),
    calls deserialize() on each, returns count restored. Malformed
    envelopes return 0; missing entries leave resources alone.
  - `SNAPSHOT_SCHEMA_VERSION = 1`. Bump when the envelope shape
    changes.
  - `RESOURCE_WORLD_SNAPSHOT` constant for an attached snapshot
    facility (e.g. an auto-save system).

### Tests

676 -> 686 (10 new in tests/world-snapshot.test.ts):
- serialize collects only persistable resources; non-persistable
  resources skipped silently.
- persistKey overrides registry key in the envelope.
- nowFn injection for deterministic capturedAtMs.
- serialize() that throws is logged + skipped.
- deserialize restores counter state.
- deserialize uses persistKey to match envelope -> resource.
- Missing persistKey in envelope leaves resource alone.
- deserialize that throws is caught + counted out.
- serialize -> deserialize round-trip preserves state.
- Malformed snapshot envelopes return 0 restored.

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import {
  serializeWorldSnapshot,
  deserializeWorldSnapshot,
  type IPersistableResource,
} from '@sadhaka/loom-engine';

class SaveData implements IPersistableResource {
  persistKey = 'save-data';
  level = 1;
  serialize() { return { level: this.level }; }
  deserialize(data) { this.level = data.level; }
}

// At save time:
var snapshot = serializeWorldSnapshot(world.resources, LOOM_ENGINE_VERSION);
localStorage.setItem('save-1', JSON.stringify(snapshot));

// At load time:
var snap = JSON.parse(localStorage.getItem('save-1'));
var restored = deserializeWorldSnapshot(world.resources, snap);
```

## 0.25.0 - 2026-05-08

**EngineClock - pause / step / timeScale controls.** Self-contained
timing wrapper around the consumer's render loop -> world.update
chain. Lets a debug HUD pause the world, single-step frames, or run
slow-mo / fast-forward without touching world or system code.

### Added

- `src/runtime/engine-clock.ts` - `EngineClock` class. Surface:
  `pause()`, `resume()`, `isPaused()`, `setTimeScale(s)`,
  `timeScale()`, `tick(realDtMs)` -> simulated dt, `step(stepMs?)`
  for fixed-dt stepping while paused, `totalSimulatedMs()`,
  `totalRealMs()`, `totalSteps()`, `resetCounters()`.
- Pause + timeScale=0 both make tick() return 0; only step()
  bypasses the pause gate (the explicit "advance one frame while
  paused" affordance).
- `EngineClockOptions` (timeScale + defaultStepMs) for construction.
- `RESOURCE_ENGINE_CLOCK` constant for world-attached clock.

### Usage pattern

```ts
import { EngineClock } from '@sadhaka/loom-engine';
var clock = new EngineClock();

function frame(realDtMs) {
  var simDt = clock.tick(realDtMs);
  world.update(simDt);
}

// Debug stepping:
clock.pause();
function onStepButton() {
  var dt = clock.step();
  world.update(dt);
}
```

### Tests

665 -> 676 (11 new in tests/engine-clock.test.ts):
- tick passes through dt at scale=1.
- pause makes tick return 0; resume restores.
- timeScale multiplies sim dt; clamping rejects negative / NaN /
  Infinity to 0.
- timeScale=0 acts like pause (real ms still tracked).
- step() emits dt even while paused; bumps counters; ignores
  invalid stepMs.
- tick() rejects invalid realDtMs.
- defaultStepMs reflects constructor; invalid clamps to ~16.67.
- resetCounters wipes timing but preserves pause + scale.

### Backwards compatibility

Pure addition. World, systems, render loop untouched.

## 0.24.0 - 2026-05-08

**DebugHUD primitive.** Self-contained stats overlay any consumer
can drop in without rolling their own fps tracker / line layout.

### Added

- `src/debug/debug-hud.ts` - `DebugHUD` class. Tracks a rolling
  60-sample fps window via beginFrame() per render frame; exposes
  `fps()`, `fpsRange()`, `frameCount()`. Custom stat lines via
  `addLine(label, value | thunk)` - thunks re-evaluate every render
  so dynamic counters (entity count, plugin stats, batch entries)
  stay live without re-registration. `toText()` returns a string
  snapshot; `attachToDom(parent)` mounts a top-left absolute-
  positioned overlay div with sane default styling. `render()`
  refreshes the DOM + returns the snapshot.
- `nowFn` injection seam (defaults to `performance.now`) so tests
  can drive deterministic clocks.
- Static `RESOURCE_DEBUG_HUD` constant for world-attached HUDs.
- `DebugHUDOptions` type exported.

### Tests

654 -> 665 (11 new in tests/debug-hud.test.ts):
- fps starts at 0; beginFrame computes from clock delta.
- Rolling window averages mixed-rate frames.
- fpsRange reports min + max.
- frameCount monotonically increments.
- addLine + toText round-trip (static + thunk values).
- Dynamic thunk re-evaluates on each render.
- clearLines drops custom lines, keeps built-ins.
- Thunk that throws renders <error>.
- render() returns same text as toText().
- attachToDom requires a DOM (headless throws).

### Backwards compatibility

Pure addition. Engine consumers opt in:

```ts
import { DebugHUD } from '@sadhaka/loom-engine';

const hud = new DebugHUD();
hud.addLine('entities', () => String(world.countEntities()));
hud.attachToDom(document.body);

// Inside render loop:
hud.beginFrame();
hud.render();
```

## 0.23.0 - 2026-05-08

**Render pipeline batching primitive: RenderBatch.** Lays foundation
for grouping sprite draws by (layer, atlas) without forcing existing
render systems to migrate. Opt-in: a system that wants to amortise
state changes calls batch.submit() instead of device.drawSprite()
directly, then flushTo() once at end-of-frame. Existing systems are
unmodified.

### Why this scope (not full pipeline rewrite)

Today's Canvas2D backend has no real GPU state machine - drawSprite
just calls drawImage. The benefits of batching are:
1. Foundation for the future WebGL2 backend where uniform/texture
   binding state changes per-call dominate.
2. Lets a HUD-rendering system explicitly express painter order
   without each system reaching into the device.
3. Per-frame batching enables future per-batch sort / dedupe /
   instancing transforms without touching consumer systems.

### Added

- `src/renderer/render-batch.ts` - `RenderBatch` class. Submission
  surface: `submit(layer, atlas, frame, x, y, z, tint?)`. Drainage:
  `flushTo(device, callback)` calls callback per (layer, atlas)
  group in layer-ascending order then submission order. Atlas
  grouping is by reference equality so non-adjacent same-atlas
  submissions land in separate groups (painter order preserved).
  `clear()` drops the queue without flushing. `stats()` for
  diagnostics.
- Layer constants: `RENDER_LAYER_BACKGROUND` (-100),
  `RENDER_LAYER_TERRAIN` (0), `RENDER_LAYER_ENTITIES` (100),
  `RENDER_LAYER_FX` (200), `RENDER_LAYER_HUD` (1000). Consumers
  can use any int; these are conventions for the demo's painter
  order.
- `RESOURCE_RENDER_BATCH` constant for world-attached batch.
- `BatchFlushCallback` type exported.

### Backwards compatibility

Pure additions. Existing pools, systems, render path unchanged.
Engine consumers opt in by:

```ts
import { RenderBatch, RENDER_LAYER_ENTITIES } from '@sadhaka/loom-engine';

const batch = new RenderBatch();
// In a system:
batch.submit(RENDER_LAYER_ENTITIES, atlasRef, frame, x, y, z);
// At end of frame:
batch.flushTo(device, (layer, atlas, entries) => {
  // Issue native draws for the group.
});
```

### Tests

645 -> 654 (9 new in tests/render-batch.test.ts):
- Empty flush is a no-op.
- Consecutive same-atlas submits merge into one group.
- Non-adjacent same-atlas submits land in separate groups (painter
  order).
- Layers iterate ascending regardless of submit order.
- Tint pass-through round-trips.
- Flush clears the queue.
- clear() drops queue without flushing.
- Stats track submits + groups + entries.
- Same-number layers coalesce into one bucket.

## 0.22.0 - 2026-05-08

**ECS query primitives: ComponentSignature + QueryCache.** Lays the
foundation for archetype-style queries without forcing a rewrite of
the existing structure-of-arrays component pools. Opt-in: existing
systems are unmodified; new systems can adopt the primitives where
the perf win matters.

### Why this scope (not full archetype storage)

A true archetype rewrite reshuffles entities so all entities sharing
a component combination live in a single packed table. The current
SoA pools (TransformPool, SpritePool, etc.) are already cache-
friendly within a pool; the cost they DON'T amortise is the
multi-component intersection a system asks for every frame ("entities
with both transform AND sprite"). ComponentSignature + QueryCache
solve exactly that without touching the pool layout.

A future v2 can layer archetype-based packing on top.

### Added

- `src/runtime/component-signature.ts` - `ComponentSignature` class.
  Per-entity Uint32 bitmask; up to 32 component bits. Surface:
  `setBit / clearBit / clearEntity / getMask / hasAll / hasAny /
  collectMatching / version / capacity`. Capacity grows pow-2 on
  demand. The version counter bumps on every actual mutation so a
  consumer can detect "any change" cheaply.
- `componentMask(...bits)` helper to build a bitmask from a list of
  bit indices. Throws on out-of-range bits in development.
- `RESOURCE_COMPONENT_SIGNATURE = 'loom.component_signature'`.
- `src/runtime/query-cache.ts` - `QueryCache` class. Memoizes
  signature queries by mask, invalidates on version bump. Surface:
  `query(mask) / clear() / stats()`. FIFO eviction at maxEntries
  (default 64) prevents long-running games from accumulating an
  unbounded cache.
- `RESOURCE_QUERY_CACHE = 'loom.query_cache'`.

### Backwards compatibility

Pure additions. Existing pools, systems, tests unchanged. Engine
consumers opt in by:

```ts
import { ComponentSignature, QueryCache, componentMask } from '@sadhaka/loom-engine';

const sig = new ComponentSignature();
const cache = new QueryCache(sig);

// Pool registers entity components on attach.
sig.setBit(entityIdx, COMPONENT_BIT_TRANSFORM);
sig.setBit(entityIdx, COMPONENT_BIT_SPRITE);

// System queries.
const matches = cache.query(componentMask(COMPONENT_BIT_TRANSFORM, COMPONENT_BIT_SPRITE));
for (let i = 0; i < matches.length; i++) {
  const idx = matches[i];
  // ...
}
```

### Tests

631 -> 645 (14 new in tests/component-signature.test.ts):
- setBit / clearBit / hasAll / hasAny / clearEntity round-trips.
- setBit out of range throws.
- Capacity grows pow-2 on demand; existing data preserved.
- Version bumps only on actual mutations (idempotent set/clear no-op).
- collectMatching returns sorted entity indices.
- QueryCache hit/miss + reference identity on hit.
- QueryCache invalidates on signature version bump.
- Multiple masks cached independently; FIFO eviction at maxEntries.
- clear() resets state.

## 0.21.0 - 2026-05-08

**IManagedResource lifecycle hooks.** Resources owning external state
(workers, listeners, network bridges, audio contexts, pools) can now
participate in attach / detach / dispose lifecycle without the engine
core needing to know about each resource type.

### Added

- `IManagedResource` interface with three optional methods:
  `onAttach(world)`, `onDetach(world)`, `dispose()`. All optional; a
  resource declares only the hooks it needs.
- `LifecycleWorld` structural type forward-declared to avoid the
  circular import resources.ts <-> world.ts. The concrete World is
  structurally compatible.
- `ResourceRegistry.bindWorld(world)` - one-time binding so the
  registry can pass the world to lifecycle hooks. World constructor
  calls this immediately after registry creation.
- `ResourceRegistry.attach(key, value)` - lifecycle-aware setter.
  Calls onAttach if present. If a row already exists at that key, it
  is detached + disposed first so hook ordering is well-defined.
- `ResourceRegistry.detach(key)` - lifecycle-aware remover. Calls
  onDetach + dispose (in that order) before deleting. Errors in any
  hook are logged but don't block subsequent hook calls or the row
  removal.
- `ResourceRegistry.disposeAll()` - iterates every registered resource
  and calls detach on each. Used by World.dispose() during shutdown.
- `World.dispose()` - graceful shutdown. Phase 1 calls every
  system's optional `onDispose(world)` so systems can release
  handles before resources go away. Phase 2 disposes all resources.
  Phase 3 clears the systems map and pools. Idempotent.

### Backwards compatibility

The legacy `set()` / `remove()` paths bypass the new hooks. Existing
resources that don't declare lifecycle methods see zero behaviour
change. Only opt-in callers using `attach()` / `detach()` /
`disposeAll()` trigger hooks. This keeps every existing 0.20.x test
passing without modification.

### Tests

617 -> 631 (14 new in tests/resource-lifecycle.test.ts):
- attach calls onAttach with bound world.
- detach calls onDetach + dispose then removes.
- detach on missing key returns false; no hooks called.
- Re-attach detaches prior value first (defined hook ordering).
- Legacy set/remove do NOT call hooks (back-compat).
- disposeAll iterates every resource.
- Resources without IManagedResource methods skip silently.
- Errors in onAttach / onDetach / dispose are logged but don't block.
- World.dispose disposes resources + notifies systems via onDispose.
- World.dispose is idempotent.
- Standalone ResourceRegistry without bindWorld skips hooks (still
  registers the row).

### Public surface

`IManagedResource` and `LifecycleWorld` types exported from
`@sadhaka/loom-engine`. `ResourceRegistry` already exported; gains
`bindWorld`, `attach`, `detach`, `disposeAll` methods.

## 0.20.1 - 2026-05-08

**SSEZoneBridge networking polish.** Mirrors the 0.20.0
director-bridge surface for the zone-event channel, scoped to what
makes sense for a bridge that does NOT own its EventSource (the
presence layer does). No backoff or snapshot-required handling -
those would be foreign concerns - just status state-machine + timing
stats parity.

### Added

- `arpg:zone-bridge-status` CustomEvent on every status transition
  with `{from, to, characterId}` detail. Default target is
  `globalThis.window`; `opts.statusEventTarget` can pin a custom
  target (or `null` to disable dispatch).
- `transitionTo(next)` private method routes every status change
  through one site so timing-stat bumps stay consistent. Idempotent
  (same-status calls no-op + don't double-bump counters).
- `ZoneEventBridgeStats` gains `lastConnectedAtMs`,
  `lastDisconnectedAtMs`, `totalConnectsCount`,
  `totalDisconnectsCount`. Reuses the underlying
  `EventSource.readyState` transitions as the trigger; the bridge
  doesn't own retry, so these track OBSERVED state changes from the
  presence layer.
- `nowFn` injection seam (defaults to `Date.now`) for deterministic
  timing in tests.
- `MockZoneBridge` updated to include the new stats fields so type
  callers don't fork.

### Tests

606 -> 617 (11 new). Coverage:
- Initial idle status; start with open/connecting/closed ES
  reflects correctly.
- `status()` reflects underlying readyState transitions even when
  ES changes after start.
- `stop()` transitions to closed.
- Connected transition bumps lastConnectedAtMs + totalConnectsCount.
- Connected -> closed bumps lastDisconnectedAtMs + totalDisconnectsCount.
- arpg:zone-bridge-status CustomEvent fires with full detail
  (`from / to / characterId`).
- All 0.20.1 fields present on `stats()` AND existing fields
  preserved.
- Out-of-order delivery still works (regression duplicate of the
  fuzzer contract from 0.20.0).
- Idempotent `transitionTo` - redundant `status()` polls don't
  double-bump `totalConnectsCount`.

### Why this scope (not the original 0.20.x plan)

The first attempt at this phase added gap-detection +
snapshot-required handling at the bridge layer. That broke the
fuzzer's "out-of-order events MUST still be queued" contract,
because gap detection lives downstream in `ZoneEventSystem` per the
existing comment at `tests/fuzzer/fuzzer.test.ts` line 113-116.
Reverting to the existing buffer-everything semantic + adding only
status / timing parity ships the surface improvements without
crossing the contract.

A future 0.21.x can layer system-level gap detection (with a
configurable `GAP_THRESHOLD` + snapshot-pull recovery) without
touching the bridge.

## 0.20.0 - 2026-05-08

**Networking polish for SSEDirectorBridge.** Eliminates the
fixed-delay reconnect anti-pattern and gives consumers + operators
visibility into bridge lifecycle. The director bridge is now the
canonical reference; SSEZoneBridge gets the same treatment in 0.20.1
once the gap-detection + snapshot-pull paths are validated against
the protocol fuzzer.

### Added

- **Exponential backoff with full jitter.** On `EventSource.onerror`,
  the bridge takes ownership of the retry loop and schedules a
  manual reconnect with `delay_n = min(MAX, BASE * 2^n) + uniform(0,
  BASE)`. Defaults `BASE=500ms` / `MAX=30000ms`, both configurable
  via constructor opts. Replaces the prior fixed-2000ms retry
  scheduled inside `EventSource`'s default reconnect path.
- **Last-Event-Id idempotent replay.** `lastEventId` appended to the
  reconnect URL as both `?last_event_id` (legacy) and `?since=`
  (canonical per LOOM-DIRECTOR-PROTOCOL-V2 sec.3) so the server-side
  replay route fills the gap and the bridge dedupes any envelopes
  with `id <= initialLastEventId`.
- **Status state machine.** Statuses: `idle / connecting / connected
  / reconnecting / snapshot-required / closed`. Every transition
  logs and dispatches `arpg:director-bridge-status` CustomEvent with
  `{from, to, characterId}` detail on `globalThis.window` (or
  `opts.statusEventTarget`). Consumers wire UI off this stream.
- **Stats counters expanded.** `DirectorBridgeStats` adds
  `lastConnectedAtMs`, `lastDisconnectedAtMs`, `totalConnectsCount`,
  `totalDisconnectsCount`, `currentReconnectAttempt`. Existing
  fields (`eventsReceived`, `reconnects`, `lastEventId`, etc.)
  preserved.
- **Injection seams** for deterministic tests:
  `setTimeoutFn`/`clearTimeoutFn`/`randomFn`/`nowFn`/`statusEventTarget`.
  Production code uses `globalThis` defaults.

### Tests

597 -> 606 (9 new networking tests). Coverage:

- Initial idle status; start -> connecting transition.
- onopen -> connected + lastConnected/totalConnects bumped.
- onerror -> reconnecting + scheduled reconnect with computed
  backoff (zero-jitter case asserts exact 500ms first retry).
- Backoff doubles per attempt; caps at maxBackoffMs (asserted by
  driving 5 successive errors with base=100/max=800: 100/200/400/
  800/800).
- Jitter adds 0..BASE: randomFn=0.5 with BASE=500 yields 750ms total.
- Successful onopen resets `currentReconnectAttempt` to 0; the next
  error re-starts at attempt 0's delay.
- arpg:director-bridge-status CustomEvents fire with `{from, to}`
  detail on every transition.
- onerror bumps `lastDisconnectedAtMs` + `totalDisconnectsCount`.
- Explicit `stop()` -> closed AND cancels any pending reconnect
  timeout (advancing the clock 10s after stop creates no new ES).

### Deferred to 0.20.1

- **SSEZoneBridge networking polish** with the same backoff +
  status state machine, plus a gap-detection + snapshot-pull
  recovery path. Initial implementation broke the protocol fuzzer's
  out-of-order delivery contract; ships in 0.20.1 once the gap-
  threshold semantics are reconciled with the existing reorder
  buffer.

### Changed

- `LOOM_ENGINE_VERSION` 0.19.1 -> 0.20.0. Smoke + webgl2 version
  pinning tests bumped accordingly.
- `tests/no-nondeterminism.test.ts` whitelist updated to allow the
  director bridge's `Math.random` for jitter (production seam) and
  `Date.now` for connection timestamps (out-of-tick metric, mirrors
  the plugin runtime entry).

## 0.19.1 - 2026-05-08

**Hot fix** for two bugs discovered when registering a sync hook in
production:

1. `safeCall` calls `hookFn.apply(...)` and assumed the return was a
   Promise. A hook returning `null` synchronously (mirrors the Python
   `Optional[EmittedEvents]` return shape) made `withTimeout` call
   `.then()` on `null` and throw "Cannot read properties of null
   (reading 'then')". Fixed by wrapping the return value in
   `Promise.resolve(...)` before passing to `withTimeout`.

2. `withTimeout` cleared the timeout via the inner promise's
   `.then()` callbacks. With a sync hook the inner promise had
   already resolved before the chain attached, so `clearTimeout`
   never ran and the timeout always fired at +budget regardless of
   the actual hook duration. Fixed via a `fired` boolean both the
   timeout callback and the resolve/reject path check first - the
   first to set it wins, the other becomes a no-op.

Two regression tests added: `sync hook returning null is safe + fast`
and `sync hook returning a value resolves correctly`. Run from a
fresh registry, neither bumps `hook_timeout_count` or
`hook_error_count`. 595 -> 597 tests, all green.

## 0.19.0 - 2026-05-08

**Client-side plugin SDK** (LOOM-DIRECTOR-PROTOCOL-V3 sec.3.1).
TypeScript companion of the Python `loom_ai_plugin_runtime`. Lets
Founders author client-side Loom plugins reacting to zone-events
without forking the engine. Same names + semantics as the Python
runtime where they apply on the client (no per-character v1 stream;
no asyncio - Promise + async/await throughout).

### Why

The Python plugin runtime in `api/loom_ai_plugin_runtime.py` is a
clean abstraction for server-side plugin authors but stops at the
HTTP boundary - a Founder writing a client-side HUD widget reacting
to `zone.boss.tick` had to monkey-patch the ARPG-loom IIFE. v3
sec.3.1 carved out the slot for a TS companion; this release fills
it. Authors moving between server-side (Python) and client-side
(TypeScript) plugins now share a vocabulary.

### Added

- `src/plugins/types.ts` - TypeScript Protocol equivalents:
  `IClientPlugin`, `PluginContext`, `PluginStorage`, `PluginLogger`,
  `PluginOpsStats`, `PluginDescribeRow`, `EmittedEvents`, `PeerInfo`,
  `PluginError`, `PluginEntropy`, scope constants. Mirrors
  `loom_ai_plugin_runtime.py` shape-for-shape.
- `src/plugins/client-registry.ts` - `ClientPluginRegistry` with the
  same surface as the Python `AIPluginRegistry`:
  - `register / unregister / reload / list / describe`,
  - per-plugin `MapPluginStorage` wrapped in a counting wrapper
    (storage cap + ops counters),
  - per-plugin tick budget enforced via `Promise.race` timeout,
  - per-plugin scope gates (`read_zones / read_characters /
    read_events`) gating `getZonePeers / getZoneState /
    getZoneEventsTail`,
  - `PluginError(retryable=true)` triggers ONE retry before drop,
  - error isolation: a hook throw drops only that plugin's
    contribution for that dispatch,
  - lifecycle hooks: `onZoneEvent`, `onPreTick / onPostTick`,
    narrow `onBossSpawn / onBossEnd / onLootDrop` conveniences,
    `dispose`,
  - DOM bridge auto-attaches to `arpg:zone-*` CustomEvents on
    `globalThis.window` so any host already dispatching the ARPG-loom
    custom events gets plugin routing for free,
  - `reload(name, moduleSpecifier)` re-imports the plugin module via
    dynamic import with a cache-bust query.
  - TTL storage helpers (`setWithTtl / getWithTtlCheck`) layered
    over any PluginStorage.
- `src/plugins/index.ts` - bare exports surface.
- `tests/plugins/client-registry.test.ts` - 18 tests covering
  register/replace, dispatch order, error isolation, retry,
  tick-budget timeout, scope gates, storage cap, ops counters,
  describe shape, dispose, DOM bridge, spatial helpers, entropy
  determinism, TTL helpers, scope set.
- `tests/plugins/example-hud-plugin.test.ts` - 3 tests demonstrating
  the canonical use case: a boss HUD plugin that mounts on
  `zone.boss.spawn`, updates on `zone.boss.tick`, unmounts on
  `zone.boss.end`, and flushes overlays in `dispose()`.

### Changed

- `src/index.ts` exports the new client-plugin surface
  (`ClientPluginRegistry`, `PluginError`, `PluginEntropy`,
  `IClientPlugin`, etc.).
- `LOOM_ENGINE_VERSION` -> `0.19.0`.
- `package.json` -> `0.19.0`.
- `tests/no-nondeterminism.test.ts` whitelists `plugins/types.ts`
  and `plugins/client-registry.ts` for `Date.now()` reads (plugin
  runtime is out-of-tick, mirror of `director/ai/plugin-context.ts`).

### Test count

574 -> 595 (21 new).

---

## 0.18.0 - 2026-05-08

**Replay determinism polish** (Phase E5, on top of E3 + E4). Closes
the loop opened by 0.17.0's seeded RNG: deterministic clock everywhere
in the tick path, ordering audit, snapshot fixture for regression
detection, and an end-to-end smoke that proves "two worlds, same
seed, same outcome".

### Why

0.17.0 routed Math.random through a seeded entropy resource. That
fixed RNG drift but left a second source of non-determinism: every
tick-driven system was reading `performance.now()` for damage / fade
/ cooldown timestamps. Two HeadlessTickers with the same seed but
different real-time elapsed since process start would diverge on the
first health.applyDamage / KnotContext.beginFade call. 0.18.0 routes
all in-tick clock reads through TimeResource.elapsed * 1000 so the
clock is part of the seeded contract.

### Changed

- `src/director/zone/zone-event-system.ts` - knot fade `nowMs` no
  longer adds `performance.now()` to TimeResource.elapsed * 1000.
  Audit also confirmed the system iterates `bridge.pollEvents()` in
  arrival order; no Set / Map.entries / Object.keys walks; no entropy
  reads.
- `src/director/director-system.ts` - same nowMs cleanup. Now in the
  same coordinate as ZoneEventSystem so beginFade / tickFade stay
  in sync across replays.
- `src/systems/attack-system.ts` - applyDamage timestamp from
  TimeResource.
- `src/systems/damage-system.ts` - kill timestamp from TimeResource.
- `src/systems/projectile-system.ts` - projectile-impact damage
  timestamp from TimeResource.
- `src/systems/pursue-system.ts` - contact-damage cooldown clock
  from TimeResource.
- `src/systems/ranged-attack-system.ts` - cooldown + projectile spawn
  timestamps from TimeResource.
- `src/systems/peer-presence-system.ts` - peer interpolation clock
  from TimeResource.
- `src/audio/cue-catalog.ts` - new `CueCatalogOptions.now` injection
  seam. CueCatalog.create({ now }) accepts a TimeResource-driven
  closure; the default fallback to performance.now() / Date.now()
  is unchanged so existing call sites keep working.

### Added

- `tests/zone-event-system-determinism.test.ts` - 7 tests. Two
  seeded tickers + same trace -> identical state snapshots; reverse
  trace -> divergent state (system is arrival-order sensitive);
  TPS 30 vs 120 keeps semantic state identical; entropy-blind
  tripwire (seed 1 vs seed 2 produce same zone state).
- `tests/no-nondeterminism.test.ts` - 8 tripwire tests. Greps the
  src/ tree and asserts: Math.random count = 0; Date.now in
  src/systems/ = 0; Date.now outside the documented whitelist
  (cue-catalog default fallback, plugin-context, multiplayer
  bridges) = 0; new Date().getTime = 0; performance.now in
  src/systems/ = 0; director-system + zone-event-system no longer
  call performance.now.
- `tests/fixtures/expected-final-state-seed-42.json` - hand-checked
  snapshot of the canonical trace replay with seed=42. Pinned in
  git; future PRs that change a system update the fixture or fail
  the test.
- `tests/fixtures/_regen-replay-snapshot.ts` - regen helper. Runs
  the same buildSnapshot routine as the test and writes the JSON.
- `tests/replay-snapshot.test.ts` - 4 tests. Live replay deep-equals
  the fixture; fixture metadata intact; eventsApplied = 20; live
  replay reproducible across two runs.
- `tests/determinism-smoke.test.ts` - 7 tests. Two HeadlessTickers
  with same seed run a 5-entity pursuit scenario for 200 ticks and
  produce byte-identical resource snapshots (TimeResource, entropy,
  transforms, health, DeathLog). Per-tick reproducibility verified
  at 20 sample-points. Different seeds produce same outcome
  (entropy-blind for these systems).

### Tests

574 / 574 pass (548 baseline + 26 new). Breakdown of new tests:
- 7 zone-event determinism
- 8 no-nondeterminism tripwire
- 4 replay-snapshot
- 7 determinism-smoke

### Open / deferred

- src/director/snapshot-recovery.ts still reads performance.now() in
  `applySnapshot`. That code is OUT of the per-tick loop (one-shot
  recovery boot path) so it does not affect replay determinism.
  Wired through the whitelist in tests/no-nondeterminism.test.ts.
- src/director/ai/plugin-context.ts uses Date.now as the default
  plugin clock. Plugins are async + opt-in + run on consumer
  timers, NOT the world tick. Whitelisted.
- The HMAC-signed fuzzer (Phase E4) is unchanged. Its protocol-level
  randomness comes from the seeded entropy resource introduced in
  0.17.0.

## 0.17.0 - 2026-05-08

**Deterministic ECS via seeded RNG** (Phase E3, test infrastructure
hardening). The engine no longer calls `Math.random()` from `src/` -
every random draw routes through a seeded PRNG resource so trace
replays, save-state restoration, and network-sync scenarios all
produce identical output for the same seed. Closes the determinism
gap that made the trace-replay harness (Phase E2) unable to assert
exact particle / VFX state across runs.

### Why

`Math.random()` is non-reproducible across runs and across V8 builds.
Any test that asserts on a value derived from RNG was either flaky
(if the assertion was tight) or trivially passing (if loosened to a
range). With the seeded resource, the same seed produces the same
stream byte-for-byte, so trace replay can diff exact world state.

### Added

- `src/runtime/entropy.ts` - `Entropy` class implementing `IEntropy`
  via inlined mulberry32 (200-byte public-domain PRNG, no deps).
  Surface: `random()` / `int(min,max)` / `pick(arr)` / `getState()` /
  `setState(s)` / `reseed(seed)`.
- `RESOURCE_ENTROPY` resource key (`'loom.entropy'`).
- `DEFAULT_ENTROPY_SEED = 0x9e3779b9` (golden-ratio fraction; stable
  default seed used by `Engine.create` when consumer omits it).
- `Engine.create({ entropySeed })` wires the resource on every fresh
  engine instance. Override the seed per-character or per-run for
  save-game replays.

### Changed

- `src/systems/particle-emitter-system.ts` - the only `src/` site
  that called `Math.random()` (cone direction sampling at line 58 +
  60, particle speed at line 142). All three now route through the
  world's `RESOURCE_ENTROPY` resource. A module-level fallback
  Entropy keeps bare-bones `World` instances (without `Engine.create`)
  working without throwing.
- `LOOM_ENGINE_VERSION` 0.16.0 -> 0.17.0. Smoke + webgl2 version
  pinning tests bumped accordingly.

### Tests

540 / 540 pass (525 baseline + 15 new entropy tests). Coverage:

- Same seed produces same sequence (1000-call equality across two
  fresh streams).
- Different seeds diverge within 4 calls.
- Output range: [0, 1) verified across 10000 draws.
- `getState()`/`setState()` round-trips - the next sample after
  restore matches the next sample before restore.
- `reseed()` resets the stream.
- `int()` honours inclusive bounds + integer contract; throws on
  inverted range; `int(n, n)` always returns n.
- `pick()` covers all elements of a 4-element array within 4000 draws
  (chi-squared sanity); throws on empty input.
- NaN seed coerces deterministically (no crash, two NaN-seeded
  streams agree); seed 0 produces a usable stream.
- `RESOURCE_ENTROPY` and `DEFAULT_ENTROPY_SEED` constants pinned -
  renaming or bumping is a breaking change for consumers.

### Open / deferred

- `crypto.getRandomValues` not used - mulberry32 is fast and
  reproducible but NOT cryptographic. Authoritative server-side dice
  rolls still use Python's `random.SystemRandom` on the backend.
- VFX systems other than the particle emitter currently have no RNG
  draws. If future systems add one (mob AI tie-breakers, projectile
  spread, audio-stinger jitter), they MUST go through `IEntropy`.
  The audit comment in `entropy.ts` is the tripwire.

## 0.16.0 - 2026-05-08

**Visual boss rendering primitives** (Phase 18.1, engine side). Engine
surface for the renderer-agnostic boss entity per
[LOOM-BOSS-RENDER-SPEC.md](LOOM-BOSS-RENDER-SPEC.md). Closes the loop
opened by Phase 16 (zone protocol fanout) and Phase 17 (zone audio
cues): renderers can now poll a typed boss entity each frame instead
of parsing SSE envelopes themselves. v1 supports at most one active
boss per zone (matches Phase 16 spec).

### Added

- `ZoneBossEntity` shape: `{boss_id, name, type, hp_max, hp_current,
  dmg, x, y, knot_flavor, spawned_at_ms, last_tick_ms, recent_hits}`.
  recent_hits is a bounded ring of `RECENT_HITS_RING_SIZE = 32`
  entries for floating-damage-number renderers.
- `ZoneBossEntityResource` (per-zone Map; null entry means no active
  boss). `RESOURCE_ZONE_BOSS_ENTITY` key + `createZoneBossEntityResource()`
  factory.
- `buildEntityFromSpawn(env)` helper supporting both `zone.boss.spawn`
  and `zone.snapshot` envelopes (the latter when `data.active_boss` is
  non-null).
- `applyTick(entity, env)` helper; mutates HP + position + appends
  recent_hits (capped at RECENT_HITS_RING_SIZE).
- `ZoneBossEntitySystem` (PHASE_LOGIC, runs after ZoneEventSystem)
  with per-zone `lastProcessedEventId` cursor strategy. Reads
  `ZoneEventLog`, applies new boss events to the entity resource.
  Tolerates missing log / entity resources (no-op).

### Tests

514 / 514 pass (487 baseline + 17 new resource tests + 12 new system
tests). Zero v1 / Phase 16 / Phase 17 regressions. Coverage:

- Resource: factory shape, byZone Map isolation per zone, null-spawn-
  null lifecycle, buildEntityFromSpawn maps all 12 fields, applyTick
  updates HP+pos+appends, applyTick caps recent_hits at ring size,
  buildEntityFromSpawn supports zone.snapshot's active_boss path.
- System: spawn populates entity in correct zone, tick updates HP+pos+
  appends hit, mismatched boss_id on tick is ignored, end clears entity
  to null when boss_id matches, end with mismatched boss_id leaves
  active boss intact, snapshot with active_boss replaces wholesale,
  snapshot with null active_boss clears entity, recent_hits ring caps
  at RECENT_HITS_RING_SIZE under hit-storm, multi-zone isolation,
  cursor advances per-zone preventing double-apply, cursor is per-zone
  not global, tolerates missing log / entity resources.

### Changed

- `LOOM_ENGINE_VERSION` 0.15.0 -> 0.16.0. Smoke + webgl2 version
  pinning tests bumped accordingly.

### Open / deferred

- Multi-boss per zone (v1 supports one). Deferred per spec §1.2.
- TWT-side renderer (Three.js mesh + DOM HUD): in flight on docker
  repo; ships separately to week-19-visual.

## 0.15.0 - 2026-05-08

**Audio engine: positional 3D + asset loader + cue catalog + music
director + zone-event integration shell** (Phase 17.1 + 17.2 + 17.3).
Engine surface for the audio subsystem locked at
[LOOM-AUDIO-SPEC.md](LOOM-AUDIO-SPEC.md). Phase 5 AudioBus mixer
remains untouched and locked; consumers who do not opt into the new
surfaces see identical behavior to 0.14.0.

### Why

Phase 16 made multiplayer Director events shared across peers in a
zone. Phase 17 makes those events audible: the boss spawns at (x, y),
every peer hears the spawn from the correct direction relative to
their listener pose, music crossfades to combat, and per-peer
footsteps sell the other player's presence. The Director is no
longer just visible - it's spatial and reactive.

### Added

- **Spatializer + AudioListener** (Track A, §3 of spec):
  - `SpatialAudioBus` composes the existing AudioBus, adds a `'spatial'`
    sub-bus (priority 'ambient', VE-budget gated), and routes per-source
    Web Audio `PannerNode`s into it.
  - `playPositional(buffer, opts)` returns a `SpatialSourceHandle` with
    `stop()`, `setPosition(x, y, z?)`, `fadeOut(durMs)`, `isPlaying()`.
    Reuses the PannerNode for `setPosition` (no realloc on movement).
  - `playPositionalTone(freq, durMs, opts)` for code-only demos.
  - `AudioListenerPose` / `AudioListenerResource` + `RESOURCE_AUDIO_LISTENER`
    + `createAudioListenerResource()` factory + default forward and up
    vectors.
  - `SpatialAudioSystem` (PHASE_RENDER, AFTER camera/transform sync)
    pushes the local character's transform into the listener pose each
    frame. Tolerates missing local character (no-op).
  - `spatialDistance(...)` pure helper for distance math.

- **Asset loader + cue catalog + music director** (Track B, §4):
  - `AudioAssetCache` - in-memory `Map<string, AudioBuffer>` with
    `get/has/set/drop/clear/list`. Re-loading the same name overwrites.
  - `AudioAssetLoader.create(audioBus, cache)` - `load(url, name?)` does
    fetch + `decodeAudioData` + cache write. Default name is URL
    basename without extension. `preload(manifest)` rejects on first
    failure. `inflightCount()` for "still loading" UI gates. Failure
    does NOT pollute cache.
  - `CueCatalog` - named cue events with predefined wiring.
    `register(name, def)`, `play(name, opts) -> SpatialSourceHandle | null`,
    `stopAll(name)`. Spatial cues route through `SpatialAudioBus`,
    non-spatial through `audioBus.playOneShot`. Cooldown enforced via
    per-cue last-play timestamp. Defaults merging.
  - `MusicDirector` - `playMusic(name, fadeInMs)`, `stopMusic(fadeOutMs)`,
    `crossfadeMusic(name, fadeMs)`, `currentMusic()`. Routes through
    `audioBus.input('music')`. `linearRampToValueAtTime` envelopes;
    `setTimeout` resolves the fade-out promise after the ramp completes.

- **Zone-event audio integration shell** (Track C engine side, §5):
  - `ZoneAudioSystem` (PHASE_RENDER, AFTER ZoneEventSystem) drains
    `ZoneEventLog.recent` for the local zone and dispatches each event
    to a registered mapping handler. `registerMapping(mapping)` /
    `unregisterMapping(eventType)`. Engine ships zero mappings;
    consumers (e.g. TWT) register their own (boss_spawn cue, knot
    music crossfade, etc.).
  - `ZoneAudioMapping` + `ZoneCuePlay` + `ZoneAudioContext` types.

### Changed

- `LOOM_ENGINE_VERSION` constant in `src/index.ts` now reads `'0.15.0'`
  (was stale at `'0.13.0'` since Phase 16 - smoke + webgl2 version
  pinning tests updated to match).
- `src/index.ts` re-export blocks expanded with three new audio
  sections: spatializer + listener (Track A), assets/cues/music
  (Track B), zone-event integration (Track C).

### Tests

487 / 487 pass (252 baseline + 57 zone + 62 plugin + 116 audio across
Tracks A/B + the ZoneAudioSystem suite). Zero regressions on Phase 5,
Phase 16, or anything earlier. Coverage:

- Spatializer: PannerNode wiring, positionXYZ assignment, connect chain,
  setPosition reuse (no realloc), fade-out promise resolution, handle
  idempotent stop, null on suspended context, null on budget mute,
  distance model + ref/max distance + rolloffFactor passthrough.
- Audio listener: factory shape, lastUpdateFrame tracking, default
  vectors, pose mutation.
- SpatialAudioSystem: phase ordering, pose pushed exactly once per
  tick, no-op on null local character, multi-tick lastUpdateFrame.
- Falloff math: zero distance, beyond max, NaN guards.
- Asset cache: get/has/set/drop/clear/list, name collision overwrite.
- Asset loader: load resolves with AudioBuffer (mock), preload reject
  on first failure, success path inserts all, inflightCount tracks,
  name override, failure no cache pollution.
- Cue catalog: register/unregister/has/list, spatial vs non-spatial
  routing, cooldown enforcement, defaults merging, missing-asset null,
  unregistered-cue null, register overwrite.
- Cue stopAll: handle invalidation per cue, isolation from other cues,
  no-op on empty.
- Music director: playMusic resets prior, stopMusic resolves after fade,
  crossfade transitions both gains, currentMusic getter, missing-asset
  no-op.
- ZoneAudioSystem: registerMapping wiring, dispatch on event drain,
  missing mapping silent skip, missing cue catalog silent skip,
  multiple mappings dispatch in registration order.

### Spec ambiguities resolved during implementation

- Spatial source `onended` now triggers handle cleanup so naturally-
  ended buffers don't leak nodes.
- `SPATIAL_BUS_NAME = 'spatial'` exported as a named constant so
  consumers don't depend on the literal string.
- `SpatialAudioSystem.setLocalCharacterEntity(entity)` (engine works
  in entity ids; consumer translates from character_id at the app
  layer - same pattern as `PeerPool.setLocalCharacterId`).
- `register()` mid-dispatch in CueCatalog: registry snapshot at
  dispatch start so newly-registered cues fire on the next dispatch.
- `dispose()` and logger errors isolated the same way hook errors are
  (carried over from Phase 16 plugin SPI pattern).
- Music `fadeIn=0` skips the ramp entirely (no zero-duration ramp).
- AudioAssetLoader name basename strips both query string and fragment.

### Open / deferred

- TWT consumer mappings + 9 synthesized demo cues + bundle integration
  (Track C TWT side): in flight on the docker repo; ships separately
  via week-19-visual.
- Stock CC0 audio replacing synthesized cues: deferred to Phase 17.5
  follow-up. The catalog API is asset-agnostic so the swap is mechanical.
- Streaming music tracks: deferred per spec §8.2. AudioBuffer-only v1.
- Custom JS spatialization: deferred per spec §8.3. PannerNode-only v1.
- Listener rotation: deferred per spec §8.4. Fixed forward+up v1.

## 0.14.0 - 2026-05-08

**Director Protocol v2: zone-scoped events + AI plugin SPI** (Phase
16.1 + 16.2). Engine surface for the v2 protocol locked at
[LOOM-DIRECTOR-PROTOCOL-V2.md](LOOM-DIRECTOR-PROTOCOL-V2.md). v1 (Phase
6) remains untouched and locked; consumers who do not opt into v2 see
identical behavior to 0.13.0.

### Why

v1 gave each Founder a private Loom-voice in their combat loop. v2
lets the Loom address an entire zone - when one player witnesses a
boss spawn, every player in that zone witnesses it together. The
Director is also no longer one hardcoded LLM flow: an AI plugin SPI
under the new `@sadhaka/loom-engine/server` entry point lets engine
consumers wire any backend (Anthropic, OpenAI, local model,
deterministic state machine) by implementing `IAIPlugin`. Browser
bundle stays LLM-free; plugins run server-side only.

### Added

- **Zone-scoped event surface** (Track A, §3 + §4 of spec):
  - `ZoneEventEnvelope<T>` + 7 typed events: `zone.boss.spawn`,
    `zone.boss.tick`, `zone.boss.end`, `zone.narrator`, `zone.knot`,
    `zone.state`, `zone.snapshot`. Per-zone monotonic event ids.
  - `IZoneEventBridge` abstraction; concrete `MockZoneBridge` (tests +
    offline) and `SSEZoneBridge` (multiplexes onto an existing
    presence EventSource per spec §2.1 - no second connection).
  - `ZoneEventSystem` runs PHASE_INPUT after `DirectorSystem` +
    `PeerPresenceSystem`. Local-zone filter: foreign-zone events are
    logged for observability but not applied (spec §4.3).
  - `ZoneEventLog` ring buffer + `DirectorZoneStateResource` (per-zone
    KV store, mutated by `zone.state` and `zone.snapshot`).

- **AI plugin SPI** under `@sadhaka/loom-engine/server` (Track B, §5):
  - `IAIPlugin` interface with 5 lifecycle hooks (`onTick`,
    `onPeerJoin`, `onPeerLeave`, `onZoneEnter`, `onPlayerAction`).
    Hooks return `EmittedEvents` ({ characterEvents?, zoneEvents? }).
  - `AIPluginRegistry` with priority-ordered dispatch and
    error-isolation guarantee: a plugin throwing in one hook drops
    only that plugin's contribution for that dispatch; other plugins
    continue, dispatch never throws to caller.
  - `MockAIPlugin` for deterministic synthetic events in tests +
    offline demo.
  - `MapPluginStorage` + `ConsolePluginLogger` reference impls of the
    storage / logger SPI surfaces.
  - New `package.json` exports field entry: `./server` -> the SPI
    bundle. Browser-bundle consumers (`@sadhaka/loom-engine`) never
    pull this in.

### Changed

- `src/director/index.ts` is now organized into a v1 block and a v2
  block, both exported at the package root for ergonomic single-import
  consumers. v1 names unchanged.
- `src/index.ts` re-exports the v2 zone surface alongside v1 so
  consumers wiring `ZoneEventSystem`, `MockZoneBridge`, etc. import
  from the package root just like v1 systems.

### Tests

371 / 371 pass (252 baseline + 57 new zone tests + 62 new AI plugin
tests). Zero v1 regressions. Coverage:

- Zone envelope round-trip for all 7 types; malformed-input rejection;
  priority class lookup; JSON parser nullability.
- Mock zone bridge: enqueue/poll, snapshot recovery, local-zone filter.
- Zone system: spawn/tick/end lifecycle, multi-zone fanout, PHASE_INPUT
  ordering vs v1 DirectorSystem, ring buffer caps, no-op tolerance
  when bridge absent, per-zone state isolation.
- AI plugin registry: register/unregister/list/get; dispatch order;
  merged EmittedEvents; snapshot-during-dispatch (newly-registered
  plugins fire on next dispatch).
- Error isolation: sync throw, async reject, partial-hook failure,
  all-fail, hostile logger fallback to console, dispose() throws,
  earlier-events preserved on later-plugin failure.
- Mock AI plugin: script determinism, multi-instance via name
  override, priority override, sparse-script gaps.
- Plugin context: storage round-trip, namespace isolation,
  clearPlugin, console logger tagging, circular-meta resilience.

### Spec ambiguities resolved during implementation

- Equal-priority plugins fire in registration order (insertion-sort
  preserves it).
- `register()` mid-dispatch: registry snapshot at dispatch start;
  newly-registered plugins fire on next dispatch.
- Empty-array `EmittedEvents` fields stay undefined in the merged
  result (no allocation churn).
- `dispose()` errors are isolated the same way hook errors are; an
  unregister never throws to the caller.
- Logger throwing while logging a hook failure falls back to console
  so dispatch never crashes.

### Open / deferred

- Browser-side plugins (small local models, WASM stubs) deferred per
  spec §8.4. Server-side only in v2.
- Cross-zone / world events deferred per spec §8.5.
- Zone event throughput perf-bench scenario: deferred. Existing
  scenario #4 (SSE event drain) in `tools/perf-suite.ts` covers
  Director-bridge throughput; a sibling MockZoneBridge scenario
  would be a near-duplicate. Will add if profiling reveals a
  different bottleneck on zone fanout.

## 0.13.0 - 2026-05-08

**Multiplayer presence layer** (Phase 15.1, client-side). Engine-side
primitives for showing other players in real time on the same world.
Pluggable transport (works with SSE / WebSocket / WebRTC), per-peer
linear interpolation between known positions, and a render system
that draws peers with name labels above each sprite. No CRDT;
position-only state. Shared state beyond position is deferred until
there's a concrete need.

### Why

The Loom-survivor + plaza experiences both want "see who else is
here" without the implementation cost of a fully concurrent shared
world. Position alone covers the social-presence feeling; the
server is authoritative on conflicts (last-write-wins). The wire
protocol mirrors Director's SSE shape so the same backend tooling
applies, and the bridge interface is small enough to swap to
WebSocket or WebRTC without engine changes.

### Added

- `IMultiplayerBridge` (`src/network/multiplayer-bridge.ts`) - five
  methods (`connect` / `disconnect` / `status` / `pollMessages` /
  `broadcastPosition` plus `stats`). All transports implement this.
- `SSEMultiplayerBridge` (`src/network/sse-multiplayer-bridge.ts`) -
  EventSource subscription paired with a fetch POST for outbound
  position frames. Browser-only; throws in Node.
- `MockMultiplayerBridge` (`src/network/mock-multiplayer-bridge.ts`) -
  in-process bridge for tests + offline demos. `enqueueIncoming()`
  simulates server pushes; `getSentBroadcasts()` captures local
  sends so tests can assert cadence.
- `PeerPool` (`src/network/peer-pool.ts`) - tracks known peers and
  their last two known positions. `forEachRendered(nowMs, frame, fn)`
  iterates with the per-peer interpolated position computed as
  `lerp(prev, current, clamp01((now - prevTs) / (curTs - prevTs)))`.
  Self-filter via `setLocalCharacterId()`.
- `PeerSpritePool` (`src/components/peer-sprite.ts`) - per-peer
  rendering hints (atlas, frame, tint) keyed by `character_id`.
  `setOverride()` for cosmetic / class differentiation; otherwise
  the default entry from the constructor is used.
- `PeerPresenceSystem` (`src/systems/peer-presence-system.ts`) -
  drains the bridge each tick (`PHASE_INPUT`) and routes `update` /
  `depart` / `snapshot` messages to the right `PeerPool` method.
- `PeerRenderSystem` (same file) - draws each peer at the
  interpolated position with an optional name label above
  (`PHASE_RENDER`).
- Wire protocol shared with the server-side Track B: SSE event
  types `presence.update` / `presence.depart` / `presence.snapshot`,
  client `POST /presence/move` rate-limited to 10 Hz
  (`BROADCAST_HZ`). Documented in the README's Multiplayer section.
- `demo/plaza-multiplayer/` - extends the plaza-mini demo with three
  synthetic peers driven by a `MockMultiplayerBridge`. Local player
  walks via WASD; peers wander randomly. Stats overlay shows bridge
  stats + peer count live.

### Tests

Adds `tests/multiplayer.test.ts` (23 cases): pool interpolation
(midpoint, saturate-above, clamp-below), prev/current slide on
update, out-of-order drop, self-filter, snapshot replaces roster,
mock bridge enqueue + drain + rate-limit (100 calls in 1 simulated
second admit at most `BROADCAST_HZ`), end-to-end snapshot / update /
depart through `PeerPresenceSystem`, render-system draw counts +
name-label gating + per-peer override. 252 tests total (229 + 23);
all green.

### Compat

Backwards-compatible: nothing in 0.12 changed. The new modules are
additive. Engine consumers who don't use the multiplayer surface
pay zero runtime cost (tree-shakes out).

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
