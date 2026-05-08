# LOOM-AUDIO-SPEC

Audio subsystem for the Loom Engine: positional 3D + asset loading + cue
catalog + music director. Phase 17 of the Loom Engine roadmap. Builds on
the existing AudioBus mixer (Phase 5) and integrates with Phase 16
zone-scoped Director events so the world feels alive in multiplayer.

Status: **v1 DRAFT 2026-05-08** - frozen contract for parallel
implementation across Tracks A (engine spatializer + listener),
B (engine asset loader + cue catalog + music director), C (TWT
integration + boss-spawn audio demo). Lock anticipated after the demo
proves the e2e contract.

References (read-only, do not edit):
- `src/audio/audio-bus.ts` - existing Web Audio mixer with VE budget gating (Phase 5)
- `src/director/zone/zone-event-envelope.ts` - Phase 16 zone events (boss / narrator / knot / state)
- `src/director/zone/zone-event-system.ts` - Phase 16 system that drains zone events each tick
- `src/network/peer-pool.ts` - 15.x interpolated peer state (used for footstep audio)
- `LOOM-DIRECTOR-PROTOCOL-V2.md` - Phase 16 protocol; this spec wires audio reactions to its events

---

## Section 1 - Vision

The Loom is everything. Phase 16 made the Loom's voice **shared** - one
Founder triggers a zone event, every Founder hears the consequence.
Phase 17 makes that consequence **audible**.

Three load-bearing properties:

1. **Positional truth.** A boss spawns at (x, y) in a zone; every peer
   in that zone hears the spawn from the correct direction relative to
   their character's listener pose. A peer walking past you to the
   right has footsteps panning right.

2. **Cue, not assemble.** Gameplay code does not call into the Web Audio
   API directly. It calls `cues.play('boss_spawn', { x, y })`. The cue
   catalog owns the wiring: which sound, which bus, which spatializer,
   what falloff, what music response.

3. **Director-driven.** Audio reacts to Director events the same way
   palette + VE budget already do. zone.boss.spawn -> `boss_spawn` cue.
   zone.knot -> music crossfade. zone.narrator -> voice cue. The
   integration layer is generic so engine consumers register their own
   mappings; TWT ships the mappings for its own demo.

### 1.2 Non-goals (v1)

- Real-time DSP effects beyond what Web Audio nodes provide natively
  (no convolution reverb, no biquad chains - those land in v2 if
  profiling shows the need).
- Custom audio formats. Web Audio's `decodeAudioData` accepts
  browser-supported formats (MP3, OGG, WAV, AAC); v1 uses those.
- Streaming music tracks. v1 preloads music as AudioBuffer (memory cost
  acceptable for the small set of tracks per zone). Streaming via
  HTMLAudioElement + MediaElementSource deferred.
- Per-peer voice chat. Phase 17 is about Director-emitted audio, not
  player-emitted voice.

---

## Section 2 - Architecture

```
                        SpatialAudioBus (Track A)
                        =========================
                        master gain
                          |- 'sfx'     (existing, AudioBus)
                          |- 'music'   (existing, AudioBus)
                          |- 'voice'   (existing, AudioBus)
                          |- 'ui'      (existing, AudioBus)
                          |- 'spatial' (NEW: routes through PannerNodes)
                          |        \-- per-source PannerNode -> spatial gain -> master
                          |
                        AudioListener (NEW)
                          - position {x, y, z}
                          - forward {x, y, z}
                          - up {x, y, z}

                        AssetLoader + AssetCache (Track B)
                        ==================================
                        load(url) -> Promise<AudioBuffer>
                        preload(manifest) -> Promise<void>
                        get(name) -> AudioBuffer | null

                        CueCatalog (Track B)
                        ====================
                        register(name, def)
                        play(name, opts) -> CueHandle | null
                        stop(handle)

                        MusicDirector (Track B)
                        =======================
                        playMusic(name, fadeMs)
                        stopMusic(fadeMs)
                        crossfadeMusic(name, fadeMs)
                        currentMusic() -> string | null

                        ZoneAudioSystem (Track C, mostly TWT)
                        ====================================
                        registerMapping(eventType, handler)
                        runs PHASE_RENDER, drains ZoneEventLog,
                        dispatches handlers that play cues
```

The engine ships A + B + the generic system shell from C. TWT registers
its specific mappings (boss_spawn cue, knot music crossfade, etc.).

---

## Section 3 - Spatializer + AudioListener (Track A scope)

### 3.1 SpatialAudioBus

Composes existing `AudioBus`. Adds:

```typescript
export interface PositionalPlayOptions {
  // World-space source position. Listener pose is queried from the
  // active AudioListener resource each play.
  x: number;
  y: number;
  // Optional z (height); defaults to 0 for 2D-engine use.
  z?: number;
  // Distance falloff model. 'linear' attenuates linearly between
  // refDistance and maxDistance. 'inverse' uses Web Audio inverse
  // distance model (1 / (1 + rolloff * (d - ref))). 'exponential'
  // uses Web Audio exponential model. Default: 'inverse'.
  distanceModel?: 'linear' | 'inverse' | 'exponential';
  refDistance?: number;   // distance at which gain = 1.0; default 1
  maxDistance?: number;   // distance at which gain = 0 (linear) or floor; default 32
  rolloffFactor?: number; // sharper falloff = larger rolloff; default 1
  // Pre-spatial gain (still subject to VE budget on 'spatial' bus).
  gain?: number;          // default 1.0
  // Playback rate (pitch); default 1.
  rate?: number;
  // Loop the buffer; default false. Loops are stoppable via the handle.
  loop?: boolean;
}

export class SpatialAudioBus {
  // Composes AudioBus; reuses sfx/music/voice/ui buses unchanged.
  static create(audioBus: AudioBus): SpatialAudioBus;

  // Update the listener pose. Renderer pushes this each frame from the
  // local character's transform. Pose is global to the AudioContext.
  setListener(pose: AudioListenerPose): void;

  // Play a one-shot positional sound. Returns a handle for stop()
  // and gain modulation. Returns null if context not unlocked or
  // 'spatial' bus is muted by VE budget.
  playPositional(buffer: AudioBuffer,
                 options: PositionalPlayOptions): SpatialSourceHandle | null;

  // Convenience: play a positional tone (no asset needed). Useful for
  // tests and code-only demos.
  playPositionalTone(freq: number, durationMs: number,
                     options: PositionalPlayOptions & { type?: OscillatorType }
                    ): SpatialSourceHandle | null;
}

export interface SpatialSourceHandle {
  // Stop and disconnect. Idempotent.
  stop(): void;
  // Update the source position (e.g. moving boss). Cheap; reuses the
  // PannerNode, no new allocation.
  setPosition(x: number, y: number, z?: number): void;
  // Fade gain to 0 then stop. Returns when fade completes.
  fadeOut(durationMs: number): Promise<void>;
  // True until stop() called or buffer ended.
  isPlaying(): boolean;
}
```

### 3.2 AudioListenerPose + resource

```typescript
export interface AudioListenerPose {
  x: number;
  y: number;
  z?: number;
  // Forward vector (where the listener faces). For a top-down 2D
  // engine, default to {x: 0, y: 0, z: -1} (camera looks down -Z).
  forward?: { x: number; y: number; z: number };
  // Up vector. Default {x: 0, y: 1, z: 0}.
  up?: { x: number; y: number; z: number };
}

export interface AudioListenerResource {
  pose: AudioListenerPose;
  // Frame counter of the most recent setListener call. Renderer code
  // can gate "did the listener move this frame?" off this.
  lastUpdateFrame: number;
}

export const RESOURCE_AUDIO_LISTENER = 'audio_listener';
export function createAudioListenerResource(): AudioListenerResource;
```

### 3.3 SpatialAudioSystem

Runs PHASE_RENDER, AFTER the camera/transform sync systems and BEFORE
the renderer. Reads the local character's transform (from existing pool
state) and pushes the position into `AudioListenerResource` via
`SpatialAudioBus.setListener`. One-line work per tick; no audio
processing here, just listener pose update.

---

## Section 4 - Asset loader + cue catalog + music director (Track B scope)

### 4.1 AudioAssetLoader + AudioAssetCache

```typescript
export interface AudioAssetManifest {
  // name -> URL. URLs are fetched via fetch() and decoded.
  [name: string]: string;
}

export class AudioAssetCache {
  // Get a previously-loaded buffer by name. Returns null if not loaded.
  get(name: string): AudioBuffer | null;
  // True once load() / preload() has placed a buffer under name.
  has(name: string): boolean;
  // Drop a single asset. Future get() returns null. The buffer object
  // is GC'd if no live source still references it.
  drop(name: string): void;
  // Clear the whole cache.
  clear(): void;
  // Active entry names (for debug).
  list(): ReadonlyArray<string>;
}

export class AudioAssetLoader {
  static create(audioBus: AudioBus, cache: AudioAssetCache): AudioAssetLoader;

  // Fetch + decode one URL. Stores in cache under name (or the URL's
  // basename if name omitted). Returns the AudioBuffer. Re-loading the
  // same name overwrites.
  load(url: string, name?: string): Promise<AudioBuffer>;

  // Bulk preload. Resolves when ALL loads complete; rejects if any
  // single load rejects (consumer wraps in Promise.allSettled if they
  // want partial success).
  preload(manifest: AudioAssetManifest): Promise<void>;

  // Inflight count for "still loading" UI.
  inflightCount(): number;
}

export const RESOURCE_AUDIO_ASSET_CACHE = 'audio_asset_cache';
```

### 4.2 CueCatalog

A cue is a named sound event with predefined wiring. Gameplay code calls
`cues.play(name)` and the catalog handles the AudioBus / spatializer
routing.

```typescript
export interface CueDefinition {
  // The asset name registered in the AudioAssetCache.
  asset: string;
  // Which bus the cue routes through. Defaults to 'sfx'.
  bus?: 'sfx' | 'music' | 'voice' | 'ui' | string;
  // If true, the cue plays through SpatialAudioBus.playPositional and
  // requires { x, y } in the play options. If false (default), plays
  // through AudioBus.playOneShot on the named bus.
  spatial?: boolean;
  // Default play options. play() options merge over these.
  defaults?: Partial<PositionalPlayOptions> & { gain?: number; rate?: number };
  // Optional cooldown in ms; play() within cooldown returns null.
  // Useful for "boss_hit" so rapid-fire hits don't stack into clipping.
  cooldownMs?: number;
}

export class CueCatalog {
  static create(audioBus: AudioBus,
                spatialBus: SpatialAudioBus,
                cache: AudioAssetCache): CueCatalog;

  register(name: string, def: CueDefinition): void;
  unregister(name: string): void;
  has(name: string): boolean;
  list(): ReadonlyArray<string>;

  // Play a registered cue. Spatial cues require x + y in options.
  // Returns a handle for spatial cues; null for non-spatial / failure.
  play(name: string,
       options?: Partial<PositionalPlayOptions> & { gain?: number; rate?: number; x?: number; y?: number }
      ): SpatialSourceHandle | null;

  // Stop all live spatial sources for this cue. Useful for "boss died,
  // stop the loop" patterns.
  stopAll(name: string): void;
}

export const RESOURCE_CUE_CATALOG = 'cue_catalog';
```

### 4.3 MusicDirector

```typescript
export class MusicDirector {
  static create(audioBus: AudioBus, cache: AudioAssetCache): MusicDirector;

  // Start a music track. If music is already playing, stops it
  // immediately (use crossfadeMusic for smooth transitions).
  playMusic(name: string, fadeInMs?: number): void;

  // Stop the current track with a fade-out. Resolves when fade
  // completes; safe to call when no music is playing.
  stopMusic(fadeOutMs?: number): Promise<void>;

  // Smoothly transition to a different track. If no track is playing,
  // equivalent to playMusic with fadeInMs.
  crossfadeMusic(name: string, fadeMs?: number): void;

  // Currently-playing track name; null if silent.
  currentMusic(): string | null;
}

export const RESOURCE_MUSIC_DIRECTOR = 'music_director';
```

### 4.4 Default cue conventions (consumers may override)

The catalog ships a small set of empty cue slots that consumers can
register over with their own assets. Engine demos / tests use these for
sanity:

| Cue name | Bus | Spatial? | Default falloff |
|---|---|---|---|
| `boss_spawn`   | sfx   | yes | refDistance=2, maxDistance=24 |
| `boss_hit`     | sfx   | yes | refDistance=1, maxDistance=12, cooldownMs=80 |
| `boss_death`   | sfx   | yes | refDistance=2, maxDistance=32 |
| `footstep`     | sfx   | yes | refDistance=0.5, maxDistance=8, cooldownMs=180 |
| `narrator`     | voice | no  | (non-spatial) |
| `ui_click`     | ui    | no  | (non-spatial) |

These conventions are documented; the catalog itself does NOT pre-register.

---

## Section 5 - Phase 16 zone-event audio integration (Track C scope)

### 5.1 ZoneAudioSystem (engine-side shell)

Generic system that maps zone events to cue plays. Lives in the engine
so any consumer benefits, but ships with NO mappings - consumers
register their own.

```typescript
export interface ZoneAudioMapping {
  // Triggers when a ZoneEvent of this type lands.
  eventType: ZoneEventType;
  // Returns either a cue play descriptor (cue + options) or null to
  // skip this event. Receives the full ZoneEvent envelope.
  handle(event: ZoneEvent, ctx: ZoneAudioContext): ZoneCuePlay | null;
}

export interface ZoneCuePlay {
  cue: string;
  options?: Partial<PositionalPlayOptions> & { gain?: number; rate?: number };
}

export interface ZoneAudioContext {
  cues: CueCatalog;
  music: MusicDirector;
  // The local character's current zone (used by the system to filter).
  localZone: string | null;
  // The local character's transform (so handlers can compute relative
  // distances if they want).
  listener: AudioListenerPose;
}

export class ZoneAudioSystem implements System {
  // PHASE_RENDER, AFTER ZoneEventSystem (which mutates ZoneEventLog
  // upstream), so handlers see this frame's freshly-applied events.
  registerMapping(mapping: ZoneAudioMapping): void;
  unregisterMapping(eventType: ZoneEventType): void;
}
```

### 5.2 TWT consumer mappings (Track C scope)

TWT provides specific mappings:

| Event | Handler effect |
|---|---|
| `zone.boss.spawn`  | `cues.play('boss_spawn', {x, y})` from envelope's `data.boss.x/y` |
| `zone.boss.tick`   | If `data.recent_hits` non-empty, `cues.play('boss_hit', {x, y})` for each hit |
| `zone.boss.end`    | `cues.play('boss_death', {x, y})`. If outcome=='killed', `music.crossfadeMusic('victory_brief', 800)`, otherwise `music.crossfadeMusic('plaza_ambient', 1500)` |
| `zone.narrator`    | `cues.play('narrator')` if `voice == 'urgent'`, otherwise text-only |
| `zone.knot`        | `music.crossfadeMusic(<knot-derived track>, fade_ms)` based on mood (calm -> plaza_ambient, tense -> tense_combat, climactic -> battle_climax) |
| `zone.state`       | (no audio v1; consumer-defined later) |

### 5.3 TWT demo audio assets

For the demo, TWT ships a small asset manifest. v1 uses synthesized
audio (OscillatorNode + filter envelope) where assets aren't available,
so the demo can ship without dependency on third-party audio licensing
or download size:

- `boss_spawn`     - 1.5s low-frequency rumble (synthesized: square wave 60Hz + sub-octave + envelope)
- `boss_hit`       - 80ms percussive hit (synthesized: filtered noise burst)
- `boss_death`     - 2.0s descending tone with reverb-ish tail (synthesized)
- `plaza_ambient`  - 30s loop (synthesized: pad tone with slow LFO)
- `tense_combat`   - 30s loop (synthesized: faster pulse)
- `battle_climax`  - 30s loop (synthesized: layered tones)
- `victory_brief`  - 5s sting (synthesized: ascending arpeggio)
- `narrator`       - 600ms gentle chime (synthesized)
- `footstep`       - 120ms short noise blip (synthesized)

Synthesized audio is generated lazily at first cue play via OscillatorNode
+ filter chains, captured into AudioBuffers via OfflineAudioContext, and
cached in the AudioAssetCache. This keeps the engine surface generic
(it still consumes AudioBuffers) while letting the TWT side ship without
asset files. A future Phase 17.5 can swap synthesized cues for stock
CC0 recordings without touching the engine.

---

## Section 6 - Backwards compatibility

- Existing `AudioBus` is untouched. v1 consumers calling
  `audioBus.playOneShot('sfx', buffer)` keep working.
- `setAudioBudget` semantics unchanged. The new 'spatial' bus
  participates in the same budget gating with priority 'ambient'
  (so it mutes under load like 'music').
- New resource keys added; existing keys unchanged.
- An engine consumer that never opts into Track A (no
  SpatialAudioBus.create) sees zero positional code path; all spatial
  imports are tree-shake-friendly.

---

## Section 7 - Track contract surface

### Track A - engine spatializer + listener

**New files:**
- `src/audio/spatial-audio-bus.ts` (SpatialAudioBus + handle)
- `src/audio/audio-listener-resource.ts` (resource shape + factory + key)
- `src/audio/spatial-audio-system.ts` (PHASE_RENDER listener pose sync)

**Edits (additive):**
- `src/index.ts` - re-export new types/classes from `./audio/spatial-*`
- `package.json` - add 3 new test files to `test` script. **DO NOT** bump version.

**Tests (4):**
- `tests/spatial-audio-bus.test.ts` - playPositional with mock AudioContext, fade-out, setPosition reuses PannerNode, distance model fields applied to PannerNode, returns null when unlocked / muted by budget
- `tests/audio-listener-resource.test.ts` - factory shape, lastUpdateFrame increments, default forward/up vectors
- `tests/spatial-audio-system.test.ts` - PHASE_RENDER ordering, listener pose pushed once per tick, no-op when no local character set
- `tests/spatial-falloff-math.test.ts` - distance model edge cases (zero distance, beyond max, NaN handling)

**Hard NOs:**
- DO NOT edit `src/audio/audio-bus.ts` (Phase 5 lock; SpatialAudioBus composes it).
- DO NOT edit `src/director/zone/*` (Track C handles integration).
- DO NOT touch CHANGELOG.md (coordination step assembles 0.15.0 changelog post-merge).

**Deliverable:** PR on `loom-engine`, branch `claude/phase-17-1-spatializer` -> coordination merges to main alongside Track B.

### Track B - engine asset loader + cue catalog + music director

**New files:**
- `src/audio/audio-asset-cache.ts` (AudioAssetCache class + key)
- `src/audio/audio-asset-loader.ts` (AudioAssetLoader class)
- `src/audio/cue-catalog.ts` (CueCatalog class + key + CueDefinition)
- `src/audio/music-director.ts` (MusicDirector class + key + crossfade)

**Edits (additive):**
- `src/index.ts` - re-export new surface. **DO NOT** edit the same lines as Track A; both tracks add their own `// ===== Phase 17 audio (Track X) =====` block.
- `package.json` - add 5 new test files to `test` script. **DO NOT** bump version.

**Tests (5):**
- `tests/audio-asset-cache.test.ts` - get/has/drop/clear/list, name collision overwrite
- `tests/audio-asset-loader.test.ts` - load() resolves with AudioBuffer (mock fetch + mock decodeAudioData), preload() rejects on first failure, inflightCount tracks
- `tests/cue-catalog.test.ts` - register/unregister/has/list, play() routes spatial vs non-spatial, cooldown enforcement, defaults merging
- `tests/music-director.test.ts` - playMusic resets prior, stopMusic with fade resolves, crossfadeMusic transitions, currentMusic getter
- `tests/cue-stop-all.test.ts` - stopAll invalidates handles for the named cue but leaves other cues running

**Cross-track type imports:** Track B's `cue-catalog.ts` and `music-director.ts` need `SpatialAudioBus` + `PositionalPlayOptions` + `SpatialSourceHandle` types from Track A's path. Same pattern as Phase 16:

- If Track A has merged, import directly: `import type { SpatialAudioBus, PositionalPlayOptions, SpatialSourceHandle } from './spatial-audio-bus.js';`
- If Track A has NOT merged in this branch, define minimal stub types at the top of the file with `// TODO[phase-17-merge]: replace stub with real import after Track A lands` markers. Coordination commit swaps to real imports.

**Hard NOs:**
- DO NOT edit `src/audio/audio-bus.ts` (Phase 5 lock).
- DO NOT touch CHANGELOG.md.
- DO NOT touch `src/director/*` or `src/network/*`.

**Deliverable:** PR on `loom-engine`, branch `claude/phase-17-2-cue-music` -> coordination merges alongside Track A.

### Track C - TWT integration + boss-spawn audio demo

**Engine-side (small):**
- `src/audio/zone-audio-system.ts` - generic mapping shell per spec §5.1; engine ships zero mappings.
- `src/index.ts` - add re-export for ZoneAudioSystem + ZoneAudioMapping types.
- `package.json` - add 1 new test (`tests/zone-audio-system.test.ts`).

**TWT backend:** No backend changes. Audio is entirely client-side; zone events already arrive over the v2 SSE channel.

**TWT frontend** (`docker/web/html/arpg/`):
- New module: `arpg-audio.js` (IIFE-wrapped, var-only, no arrows / no template literals). Wires:
  - SpatialAudioBus on existing AudioBus
  - AudioAssetCache + AudioAssetLoader
  - CueCatalog with all 9 demo cues registered
  - MusicDirector
  - ZoneAudioSystem with the 6 mappings from spec §5.2
  - Synthesized audio generation for all 9 cues (OfflineAudioContext + OscillatorNode chains), executed lazily at unlock
  - Unlock-on-first-input handler (the existing pattern in arpg-bundle.js for AudioBus unlock can be extended).
- Mirror `arpg-audio.js` into `arpg-bundle.js` per CLAUDE.md bundle ritual.
- Cache-bust ritual: bump `?v=...` query strings + `CACHE_VERSION` in `sw.js` to `twt-vNN.NN-audio-v1`.

**Demo bar (locked acceptance):**
- Open theworldtable.ai/arpg-loom/, log in as Misha, walk to lastlight_plaza.
- Trigger boss spawn (existing /boss POST or in-game button).
- Within ~1 frame after the zone.boss.spawn SSE arrives, the boss_spawn cue fires positionally - if the boss spawned to the player's right, the rumble is panned right.
- Music crossfades from plaza_ambient to tense_combat over ~1s.
- Each /boss/hit POST plays a positional boss_hit cue at the boss's last-known x/y. Rapid hits respect cooldown.
- On boss death, boss_death cue + victory_brief music crossfade fire.
- (Bonus) Walk a peer character past the local player; their footstep cue pans correctly with their position.

**Verification:** prod e2e is mostly manual (audio is hard to assert programmatically). Smoke can confirm the cue catalog is registered and the asset cache holds the expected names; the actual audio output is verified by listening.

**Deliverable:** PR on `the-world-table`, branch `claude/phase-17-3-twt-audio-integration` -> merge to `week-19-visual` per project_deploy_flow memory.

---

## Section 8 - Open questions (resolve at lock)

### 8.1 Synthesized vs stock CC0 audio for v1
**Resolution: synthesized for v1.** Generated lazily via
OfflineAudioContext at unlock time. Ships TODAY without third-party
asset licensing or download size. Phase 17.5 follow-up swaps synthesized
cues for stock CC0 recordings without touching the engine - the
catalog API is asset-agnostic.

### 8.2 Music format
**Resolution: preloaded AudioBuffer.** Music tracks are 30s loops at
~500KB each; total v1 music budget ~4MB. Streaming via
HTMLAudioElement + MediaElementSource deferred until tracks exceed
~5MB total or when a streaming-only requirement (e.g. licensed
copyrighted music) lands.

### 8.3 Spatializer model
**Resolution: Web Audio PannerNode.** Browser-native, GPU-accelerated
where available, no per-frame JS math. v1 uses 'inverse' distance model
by default; cue catalog can override per cue. Custom JS spatialization
deferred until profiling shows PannerNode is the bottleneck.

### 8.4 Listener orientation in 2D top-down
**Resolution: fixed forward = (0, 0, -1), up = (0, 1, 0).** The
listener does not rotate; only the position changes. PannerNode
azimuth math derives entirely from source-relative-to-listener xy.
Future v2 may rotate the listener with player facing for first-person
or third-person experiences.

### 8.5 Per-peer footstep audio
**Resolution: in scope as a Track C bonus.** Engine-side, the existing
PeerPresenceSystem in `src/network/peer-pool.ts` produces per-peer
position deltas each tick. TWT can wire a "peer moved by > N units in
the last frame" detector and play `footstep` cues positionally.
Optional for the v1 demo bar but stretches well.

---

End of v1 spec.
