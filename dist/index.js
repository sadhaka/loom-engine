// Loom Engine - public entry point.
//
// Phase 2 adds the ECS layer: World, System scheduler, Resources,
// SpritePool, SpriteRenderSystem, and the high-level Engine facade
// that wires everything together with sane defaults.
// Keep this string in agreement with package.json.version. Bump both
// in the same commit when cutting a release. Audit L-01 (0.10.0):
// the previous suffix `-perf-9-1` lingered after package.json was
// bumped to 0.10.0, surfacing as a drift bug in
// engine.LOOM_ENGINE_VERSION-based diagnostics.
export const LOOM_ENGINE_VERSION = '1.7.3';
export { vec2, vec3, rect, clamp, lerp, smoothstep, approxEq, rectContains, rectIntersects, visibleInView, } from './util/math.js';
export { rgba, hexToRgba, rgbaToHexString, rgbaToCssString, colorLerp, COLOR_WHITE, COLOR_BLACK, COLOR_TRANSPARENT, COLOR_KNOT_STR, COLOR_KNOT_DEX, COLOR_KNOT_INT, COLOR_KNOT_CENTER, } from './util/color.js';
export { EntityAllocator, NULL_ENTITY, entityIndex, entityGeneration, makeEntity, } from './entity.js';
export { TransformPool, TRANSFORM_FLAG_DIRTY, TRANSFORM_FLAG_VISIBLE, TRANSFORM_FLAG_STATIC, TRANSFORM_FLAG_HAS_PARENT, } from './components/transform.js';
export { SpritePool, SPRITE_FLAG_ACTIVE, SPRITE_FLAG_TINTED, } from './components/sprite.js';
// ECS core
export { World, POOL_TRANSFORM, POOL_SPRITE } from './world.js';
export { SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_PHYSICS, SYSTEM_PHASE_ANIMATION, SYSTEM_PHASE_RENDER, SYSTEM_PHASE_POST_RENDER, SYSTEM_PHASES_IN_ORDER, } from './system.js';
// 0.22.0 - ECS perf primitives.
export { ComponentSignature, componentMask, COMPONENT_SIGNATURE_MAX_BIT, RESOURCE_COMPONENT_SIGNATURE, } from './runtime/component-signature.js';
export { QueryCache, RESOURCE_QUERY_CACHE, } from './runtime/query-cache.js';
// 0.23.0 - render batching primitive.
export { RenderBatch, RENDER_LAYER_BACKGROUND, RENDER_LAYER_TERRAIN, RENDER_LAYER_ENTITIES, RENDER_LAYER_FX, RENDER_LAYER_HUD, RESOURCE_RENDER_BATCH, } from './renderer/render-batch.js';
// 0.24.0 - debug HUD primitive.
export { DebugHUD, RESOURCE_DEBUG_HUD } from './debug/debug-hud.js';
// 0.25.0 - engine clock controls.
export { EngineClock, RESOURCE_ENGINE_CLOCK } from './runtime/engine-clock.js';
// 0.26.0 - world snapshot (save / load via persistable resources).
export { serializeWorldSnapshot, deserializeWorldSnapshot, SNAPSHOT_SCHEMA_VERSION, RESOURCE_WORLD_SNAPSHOT, } from './runtime/world-snapshot.js';
// 0.27.0 - camera controller (follow / shake / bounds / fit).
export { CameraController, RESOURCE_CAMERA_CONTROLLER, } from './renderer/camera-controller.js';
// 0.28.0 - generic event bus.
export { EventBus, RESOURCE_EVENT_BUS } from './runtime/event-bus.js';
// 0.29.0 - tween system.
// 0.40.0 extends Easings with back / elastic / bounce + adds the
// cubicBezier(x1,y1,x2,y2) factory for CSS-style custom curves.
export { Tween, Easings, cubicBezier, RESOURCE_TWEEN } from './runtime/tween.js';
// 0.30.0 - spatial hash for nearby-entity queries.
export { SpatialHash, RESOURCE_SPATIAL_HASH } from './runtime/spatial-hash.js';
// 0.31.0 - declarative input actions.
export { InputActions, RESOURCE_INPUT_ACTIONS } from './input/input-actions.js';
// 0.32.0 - generic object pool for short-lived reusable objects.
export { ObjectPool } from './runtime/object-pool.js';
// 0.33.0 - color utilities (parse / format / blend / HSL / pack32).
// Augments the existing color helpers without shadowing them.
export { clamp01, parseHex, toHexString, colorBlend, adjustHsl, pack32, unpack32, } from './util/color.js';
// 0.34.0 - declarative asset preloader with progress events.
export { AssetPreloader, RESOURCE_ASSET_PRELOADER } from './runtime/asset-preloader.js';
// 0.35.0 - audio mixer (engine-side fade / crossfade / snapshot / duck).
export { AudioMixer, RESOURCE_AUDIO_MIXER } from './audio/audio-mixer.js';
// 0.36.0 - frame budget scheduler (soft-deadline task queue).
export { FrameBudgetScheduler, RESOURCE_FRAME_BUDGET_SCHEDULER, } from './runtime/frame-budget-scheduler.js';
// 0.37.0 - floating text / damage numbers HUD primitive.
export { FloatingText, RESOURCE_FLOATING_TEXT } from './runtime/floating-text.js';
// 0.38.0 - persistent storage adapter (localStorage / in-memory key/value).
export { PersistentStorage, MemoryStorageBackend, LocalStorageBackend, RESOURCE_PERSISTENT_STORAGE, } from './runtime/persistent-storage.js';
// 0.39.0 - input chord recognizer (combo / sequence / doubleTap / hold).
export { InputChord, RESOURCE_INPUT_CHORD } from './input/input-chord.js';
// 0.41.0 - layer manager (entity z-order on top of RenderBatch layers).
export { LayerManager, RESOURCE_LAYER_MANAGER } from './runtime/layer-manager.js';
// 0.42.0 - memory budget tracker (per-pool / per-resource size estimator).
export { MemoryBudget, estimateTypedArrayBytes, estimateMapBytes, estimateSetBytes, estimateArrayBytes, estimateObjectBytes, RESOURCE_MEMORY_BUDGET, } from './runtime/memory-budget.js';
// 0.43.0 - particle curves (emit-rate / color-over-life / size-over-life).
export { emitRateAt, particlesToEmit, colorAtAge, sizeAtAge, RESOURCE_PARTICLE_CURVES, } from './runtime/particle-curves.js';
// 0.44.0 - spatial audio attenuation curves (engine-side evaluation).
export { linearAttenuation, inverseAttenuation, exponentialAttenuation, attenuationByModel, AttenuationRegistry, RESOURCE_ATTENUATION_REGISTRY, } from './audio/spatial-audio-curves.js';
// 0.45.0 - multi-slot save manager on top of PersistentStorage + WorldSnapshot.
export { SaveSlots, RESOURCE_SAVE_SLOTS } from './runtime/save-slots.js';
// 0.46.0 - localization (string table + locale + parameter interpolation).
export { Localization, RESOURCE_LOCALIZATION } from './runtime/localization.js';
// 0.47.0 - tween chain (sequential composition of tweens / delays / callbacks).
export { TweenChain, RESOURCE_TWEEN_CHAIN } from './runtime/tween-chain.js';
// 0.48.0 - timer scheduler (engine-clock-driven setTimeout / setInterval).
export { TimerScheduler, RESOURCE_TIMER_SCHEDULER } from './runtime/timer-scheduler.js';
// 0.49.0 - spline path evaluators (linear / Catmull-Rom / Hermite).
export { linearPath, catmullRomPath, hermitePath, RESOURCE_SPLINE, } from './runtime/spline.js';
// 0.50.0 - log ring buffer (severity-filtered fixed-capacity log).
export { LogRingBuffer, RESOURCE_LOG_RING_BUFFER } from './runtime/log-ring-buffer.js';
// 0.51.0 - generic finite state machine.
export { StateMachine, RESOURCE_STATE_MACHINE } from './runtime/state-machine.js';
// 0.52.0 - per-key cooldown manager.
export { CooldownManager, RESOURCE_COOLDOWN_MANAGER } from './runtime/cooldown-manager.js';
// 0.53.0 - generic LRU cache.
export { LRUCache, RESOURCE_LRU_CACHE } from './runtime/lru-cache.js';
// 0.54.0 - 2D AABB queries.
export { aabb, aabbFromRect, aabbFromPoints, aabbContainsPoint, aabbContainsAabb, aabbOverlaps, aabbWidth, aabbHeight, aabbArea, aabbCenter, aabbExpand, aabbTranslate, aabbUnion, aabbIntersection, aabbRangeQuery, aabbRaycastSegment, RESOURCE_AABB, } from './runtime/aabb.js';
// 0.55.0 - A* pathfinder on a grid (grid-agnostic via isWalkable callback).
export { findPath, RESOURCE_PATHFINDER } from './runtime/pathfinder.js';
// 0.56.0 - scene manager (named scenes with async enter/exit + tick).
export { SceneManager, RESOURCE_SCENE_MANAGER } from './runtime/scene-manager.js';
// 0.57.0 - 2D tile grid (Uint16Array-backed).
export { TileMap, RESOURCE_TILE_MAP } from './runtime/tile-map.js';
// 0.58.0 - slot-based inventory grid with stack support.
export { InventoryGrid, RESOURCE_INVENTORY_GRID } from './runtime/inventory-grid.js';
// 0.59.0 - base + modifier stack producing derived stats.
export { StatStack, RESOURCE_STAT_STACK } from './runtime/stat-stack.js';
// 0.60.0 - replay recorder (deterministic input + tick capture).
export { ReplayRecorder, RESOURCE_REPLAY_RECORDER } from './runtime/replay-recorder.js';
// 0.61.0 - branching dialog tree with conditions + actions.
export { DialogTree, RESOURCE_DIALOG_TREE } from './runtime/dialog-tree.js';
// 0.62.0 - weighted loot table with seedable RNG.
export { LootTable, RESOURCE_LOOT_TABLE } from './runtime/loot-table.js';
// 0.63.0 - quest log state machine + objective tracking.
export { QuestLog, RESOURCE_QUEST_LOG } from './runtime/quest-log.js';
// 0.64.0 - 2D steering behaviors (seek / flee / arrive / pursue / evade / separation / wander).
export { seek, flee, arrive, pursue, evade, separation, wander, RESOURCE_STEERING_BEHAVIORS, } from './runtime/steering-behaviors.js';
// 0.65.0 - severity-tiered notification queue with auto-dismiss.
export { ToastQueue, RESOURCE_TOAST_QUEUE } from './runtime/toast-queue.js';
// 0.66.0 - canonical RPG damage formula (atk/def/crit/mit/resist).
export { computeDamage, RESOURCE_DAMAGE_FORMULA } from './runtime/damage-formula.js';
// 0.67.0 - undo / redo stack with command pattern.
export { ActionHistory, RESOURCE_ACTION_HISTORY } from './runtime/action-history.js';
// 0.68.0 - generator-based multi-tick coroutine.
export { Coroutine, waitMs, waitUntil, waitFrames, RESOURCE_COROUTINE, } from './runtime/coroutine.js';
// 0.69.0 - heartbeat watchdog with stale-detection callbacks.
export { Watchdog, RESOURCE_WATCHDOG } from './runtime/watchdog.js';
// 0.70.0 - day/night cycle with named phase transitions.
export { TimeOfDay, RESOURCE_TIME_OF_DAY } from './runtime/time-of-day.js';
// 0.71.0 - discrete weather states with ramped intensity transitions.
export { WeatherSystem, RESOURCE_WEATHER_SYSTEM } from './runtime/weather-system.js';
// 0.72.0 - DamageFormula -> FloatingText pipeline (auto-spawn styled damage numbers).
export { DamageNumberPipeline, RESOURCE_DAMAGE_NUMBER_PIPELINE, } from './runtime/damage-number-pipeline.js';
// 0.73.0 - duration-tracked StatStack modifiers with auto-expire (buffs / debuffs).
export { BuffLifecycle, RESOURCE_BUFF_LIFECYCLE, } from './runtime/buff-lifecycle.js';
// 0.74.0 - recipe registry + atomic ingredient consume / output produce on InventoryGrid.
export { Crafting, RESOURCE_CRAFTING } from './runtime/crafting.js';
// 0.75.0 - milestone tracker with progress + unlock callbacks.
export { Achievements, RESOURCE_ACHIEVEMENTS } from './runtime/achievements.js';
// 0.76.0 - multi-target threat ledger for boss AI.
export { AggroTable, RESOURCE_AGGRO_TABLE } from './runtime/aggro-table.js';
// 0.77.0 - Signal / Computed / Effect reactive primitive.
export { Reactivity, RESOURCE_REACTIVITY } from './runtime/reactivity.js';
// 0.78.0 - local + remote leaderboard primitive.
export { Leaderboard, RESOURCE_LEADERBOARD } from './runtime/leaderboard.js';
// 0.79.0 - typewriter text reveal with skip-on-click.
export { TextScroll, RESOURCE_TEXT_SCROLL } from './runtime/text-scroll.js';
// 0.80.0 - render-state primitive for entity HP bars (M9 0.80 milestone).
export { HealthBar, RESOURCE_HEALTH_BAR } from './runtime/health-bar.js';
// 0.81.0 - 2D broadphase quadtree (sparse / clustered worlds).
export { Quadtree, RESOURCE_QUADTREE } from './runtime/quadtree.js';
// 0.82.0 - value-crossing threshold trigger with hysteresis.
export { ThresholdTrigger, RESOURCE_THRESHOLD_TRIGGER } from './runtime/threshold-trigger.js';
// 0.83.0 - structured replay-friendly event log.
export { EventLog, RESOURCE_EVENT_LOG } from './runtime/event-log.js';
// 0.84.0 - declarative asset list + dependency graph.
export { AssetManifest, RESOURCE_ASSET_MANIFEST } from './runtime/asset-manifest.js';
// 0.85.0 - keybinding profile manager (M9 0.85 milestone).
export { HotKeyProfileManager, RESOURCE_HOTKEY_PROFILE } from './runtime/hotkey-profile.js';
// 0.86.0 - per-faction reputation track with tiered status.
export { FactionReputation, RESOURCE_FACTION_REPUTATION } from './runtime/faction-reputation.js';
// 0.87.0 - N-mob spawn with budget cap.
export { CrowdSpawner, RESOURCE_CROWD_SPAWNER } from './runtime/crowd-spawner.js';
// 0.88.0 - sequenced UI hints with anchor-target tracking.
export { TutorialFlow, RESOURCE_TUTORIAL_FLOW } from './runtime/tutorial-flow.js';
// 0.89.0 - record + replay dialog choices.
export { DialogChoiceHistory, RESOURCE_DIALOG_CHOICE_HISTORY } from './runtime/dialog-choice-history.js';
// 0.90.0 - per-locale / per-platform asset selection (M9 0.90 milestone).
export { AssetVariant, RESOURCE_ASSET_VARIANT } from './runtime/asset-variant.js';
// 0.91.0 - render-state primitive for fade-to-color overlays.
export { ScreenFader, RESOURCE_SCREEN_FADER } from './runtime/screen-fader.js';
// 0.92.0 - camera trauma model for screen shake effects.
export { ScreenShake, RESOURCE_SCREEN_SHAKE } from './runtime/screen-shake.js';
// 0.93.0 - per-entity tint reaction on hit.
export { DamageFlash, RESOURCE_DAMAGE_FLASH } from './runtime/damage-flash.js';
// 0.94.0 - prioritized one-shot SFX queue.
export { AudioCueQueue, RESOURCE_AUDIO_CUE_QUEUE } from './runtime/audio-cue-queue.js';
// 0.95.0 - track sequencer for ambient music.
export { MusicPlaylist, RESOURCE_MUSIC_PLAYLIST } from './runtime/music-playlist.js';
// 0.96.0 - chain hit counter with reset timer + thresholds.
export { ComboCounter, RESOURCE_COMBO_COUNTER } from './runtime/combo-counter.js';
// 0.97.0 - anchored tooltip primitive with fade-in/out lifecycle.
export { TooltipQueue, RESOURCE_TOOLTIP_QUEUE } from './runtime/tooltip-queue.js';
// 0.98.0 - i18n number formatting helper (compact / format / percent / currency).
export { NumberFormatter, RESOURCE_NUMBER_FORMATTER } from './runtime/number-formatter.js';
// 0.99.0 - full-screen overlay tint primitive (low-HP / status FX).
export { VignetteRenderState, RESOURCE_VIGNETTE_RENDER_STATE } from './runtime/vignette-render-state.js';
// 1.0.0 CAPSTONE - performance baseline tracker.
export { BenchmarkHarness, RESOURCE_BENCHMARK_HARNESS } from './runtime/benchmark-harness.js';
// 1.1.0 (Wave 1.1 combat depth) - input intent buffer with windowed expiry.
export { InputBuffer, RESOURCE_INPUT_BUFFER } from './runtime/input-buffer.js';
// 1.1.1 (Wave 1.1 combat depth) - buff/debuff stacking with DR + immunity windows.
export { StatusEffectStack, RESOURCE_STATUS_EFFECT_STACK } from './runtime/status-effect-stack.js';
// 1.1.2 (Wave 1.1 combat depth) - pluggable AI decision tree.
export { BehaviorTree, RESOURCE_BEHAVIOR_TREE } from './runtime/behavior-tree.js';
// 1.1.3 (Wave 1.1 combat depth) - cinematic camera sequencer.
export { CameraDirector, RESOURCE_CAMERA_DIRECTOR } from './runtime/camera-director.js';
// 1.1.4 (Wave 1.1 combat depth) - generic timed-cue event timeline.
export { CutsceneSequencer, RESOURCE_CUTSCENE_SEQUENCER } from './runtime/cutscene-sequencer.js';
// 1.1.5 CAPSTONE (Wave 1.1 combat depth milestone) - record + replay translucent shadow runs.
export { GhostReplay, RESOURCE_GHOST_REPLAY } from './runtime/ghost-replay.js';
// 1.2.0 (Wave 1.2 world depth opens) - memoization layer for A* path queries.
export { PathfindingCache, RESOURCE_PATHFINDING_CACHE } from './runtime/pathfinding-cache.js';
// 1.2.1 (Wave 1.2 world depth) - connected-zone topology + traversal.
export { RegionGraph, RESOURCE_REGION_GRAPH } from './runtime/region-graph.js';
// 1.2.2 (Wave 1.2 world depth) - declarative spawn rules with rate-limits + caps.
export { SpawnDirector, RESOURCE_SPAWN_DIRECTOR } from './runtime/spawn-director.js';
// 1.2.3 (Wave 1.2 world depth) - weighted encounter pools per zone / phase / level.
export { EncounterTable, RESOURCE_ENCOUNTER_TABLE } from './runtime/encounter-table.js';
// 1.2.4 (Wave 1.2 world depth) - restocking shop inventory with caps + dynamic pricing.
export { MerchantStock, RESOURCE_MERCHANT_STOCK } from './runtime/merchant-stock.js';
// 1.2.5 CAPSTONE (Wave 1.2 world depth milestone) - tiered loot pools.
export { LootTier, RESOURCE_LOOT_TIER } from './runtime/loot-tier.js';
// 1.3.0 (Wave 1.3 AI persona depth opens) - NPC personality trait ledger.
export { PersonaTrait, RESOURCE_PERSONA_TRAIT } from './runtime/persona-trait.js';
// 1.3.1 (Wave 1.3 AI persona depth) - per-pair character bonds (asymmetric).
export { RelationshipGraph, RESOURCE_RELATIONSHIP_GRAPH } from './runtime/relationship-graph.js';
// 1.3.2 (Wave 1.3 AI persona depth) - per-character mood / fear / anger / joy gauges.
export { EmotionState, RESOURCE_EMOTION_STATE } from './runtime/emotion-state.js';
// 1.3.3 (Wave 1.3 AI persona depth) - voice-line scheduler for DialogTree nodes.
export { DialogVoice, RESOURCE_DIALOG_VOICE } from './runtime/dialog-voice.js';
// 1.3.4 (Wave 1.3 AI persona depth) - NPC daily routine ledger.
export { SchedulePlan, RESOURCE_SCHEDULE_PLAN } from './runtime/schedule-plan.js';
// 1.3.5 CAPSTONE (Wave 1.3 AI persona depth milestone) - cross-session NPC recall ledger.
export { NarrativeMemory, RESOURCE_NARRATIVE_MEMORY } from './runtime/narrative-memory.js';
// 1.4.0 (Wave 1.4 audio cinematic depth opens) - cross-faded ambient music layer mixer.
export { AmbientLayerMixer, RESOURCE_AMBIENT_LAYER_MIXER } from './runtime/ambient-layer-mixer.js';
// 1.4.1 (Wave 1.4 audio cinematic depth) - automatic music ducking on high-priority SFX.
export { AudioDuck, RESOURCE_AUDIO_DUCK } from './runtime/audio-duck.js';
// 1.4.2 (Wave 1.4 audio cinematic depth) - timed subtitle display + fade.
export { SubtitleQueue, RESOURCE_SUBTITLE_QUEUE } from './runtime/subtitle-queue.js';
// 1.4.3 (Wave 1.4 audio cinematic depth) - per-channel interruption-aware VO queue.
export { VoiceLineQueue, RESOURCE_VOICE_LINE_QUEUE } from './runtime/voice-line-queue.js';
// 1.4.4 (Wave 1.4 audio cinematic depth) - cutscene framing bars (top/bottom) with smooth open/close.
export { CinematicLetterbox, RESOURCE_CINEMATIC_LETTERBOX } from './runtime/cinematic-letterbox.js';
// 1.4.5 CAPSTONE (Wave 1.4 audio cinematic depth milestone) - context-driven music orchestration.
export { SoundtrackDirector, RESOURCE_SOUNDTRACK_DIRECTOR } from './runtime/soundtrack-director.js';
// 1.5.0 (Wave 1.5 educational depth opens) - line / bar / scatter chart render-state.
export { ChartRenderer, RESOURCE_CHART_RENDERER } from './runtime/chart-renderer.js';
// 1.5.1 (Wave 1.5 educational depth) - events along time axis (history view, replay scrubber).
export { TimelineLedger, RESOURCE_TIMELINE_LEDGER } from './runtime/timeline-ledger.js';
// 1.5.2 (Wave 1.5 educational depth) - force-directed node graph layout.
export { GraphLayout, RESOURCE_GRAPH_LAYOUT } from './runtime/graph-layout.js';
// 1.5.3 (Wave 1.5 educational depth) - quiz items + SM-2 spaced repetition scheduler.
export { QuestionBank, RESOURCE_QUESTION_BANK } from './runtime/question-bank.js';
// 1.5.4 (Wave 1.5 educational depth) - skill mastery via Bloom's taxonomy + decay.
export { ProgressTracker, RESOURCE_PROGRESS_TRACKER } from './runtime/progress-tracker.js';
// 1.5.5 CAPSTONE (Wave 1.5 educational milestone) - prerequisite-graph
// topology for learning + skill trees, pairs with ProgressTracker.
export { KnowledgeMap, RESOURCE_KNOWLEDGE_MAP } from './runtime/knowledge-map.js';
// 1.6.0 (Wave 1.6 procgen depth opens) - Markov-chain procedural names.
export { NameGenerator, RESOURCE_NAME_GENERATOR } from './runtime/name-generator.js';
// 1.6.1 (Wave 1.6 procgen) - deterministic 2D fractal noise field.
export { NoiseField, RESOURCE_NOISE_FIELD } from './runtime/noise-field.js';
// 1.6.2 (Wave 1.6 procgen) - Voronoi region partitioning.
export { VoronoiPartition, RESOURCE_VORONOI_PARTITION } from './runtime/voronoi-partition.js';
// 1.6.3 (Wave 1.6 procgen) - BSP rooms-and-corridors dungeon layout.
export { DungeonGenerator, RESOURCE_DUNGEON_GENERATOR } from './runtime/dungeon-generator.js';
// 1.6.4 (Wave 1.6 procgen) - Whittaker-style biome classifier.
export { BiomeMixer, RESOURCE_BIOME_MIXER } from './runtime/biome-mixer.js';
// 1.6.5 CAPSTONE (Wave 1.6 procgen MILESTONE) - WorldSeed orchestrator
// stitching all 5 procgen primitives + NameGenerator into a single
// deterministic world. Type renamed WorldSeedSnapshot to avoid
// collision with the older save-system WorldSnapshot.
export { WorldSeed, RESOURCE_WORLD_SEED } from './runtime/world-seed.js';
// 1.7.0 (Wave 1.7 networking depth opens) - PresenceTracker: online
// roster with heartbeat + auto-timeout.
export { PresenceTracker, RESOURCE_PRESENCE_TRACKER } from './runtime/presence-tracker.js';
// 1.7.1 (Wave 1.7 networking) - LobbyState: pre-game waiting room
// with ready states + host election.
export { LobbyState, RESOURCE_LOBBY_STATE } from './runtime/lobby-state.js';
// 1.7.2 (Wave 1.7 networking) - MatchmakingPool: skill-based pairing
// with widening windows so rare-skill queues don't starve.
export { MatchmakingPool, RESOURCE_MATCHMAKING_POOL } from './runtime/matchmaking-pool.js';
export { attachMatchmakingPoolToWs } from './runtime/ws-adapters/matchmaking-pool-ws.js';
// 1.7.3 (Wave 1.7 networking) - AuthorityHandoff: host election +
// failover when current authority drops.
export { AuthorityHandoff, RESOURCE_AUTHORITY_HANDOFF } from './runtime/authority-handoff.js';
export { attachAuthorityHandoffToWs } from './runtime/ws-adapters/authority-handoff-ws.js';
export { ResourceRegistry, createTimeResource, createVeilBudgetResource, RESOURCE_TIME, RESOURCE_CAMERA, RESOURCE_DEVICE, RESOURCE_VEIL_BUDGET, } from './resources.js';
// Default systems
export { SpriteRenderSystem } from './systems/sprite-render-system.js';
// Engine facade
export { Engine, registerBackend, isBackendRegistered } from './engine.js';
export { Entropy, createEntropy, RESOURCE_ENTROPY, DEFAULT_ENTROPY_SEED, } from './runtime/entropy.js';
export { createCamera, getCameraViewRect, worldToScreen, screenToWorld, } from './renderer/camera.js';
export { Canvas2DDevice, } from './renderer/canvas2d-device.js';
// WebGL2 backend (Phase 14.1). Importing this symbol triggers the
// module's self-registration of the 'webgl2' backend factory, so
// Engine.create({ backend: 'webgl2' }) starts working from then on.
// Canvas2D-only consumers do not import this and the entire WebGL2
// path tree-shakes out of the bundle.
export { WebGL2Device } from './renderer/webgl2-device.js';
export { TextureAtlas, makeParticleDiscAtlas, } from './renderer/texture-atlas.js';
export { SpriteBatcher, FLOATS_PER_INSTANCE, } from './renderer/sprite-batcher.js';
export { SPRITE_VERT_SRC, SPRITE_FRAG_SRC, UNIT_QUAD_VERTICES, } from './renderer/shaders/sprite-shader-source.js';
export { ISO_TILE_WIDTH, ISO_TILE_HEIGHT, ISO_HALF_W, ISO_HALF_H, ISO_Z_SCALE, tileToIso, worldToIso, isoToTile, isoDepthKey, } from './renderer/iso-projection.js';
export { loadSpriteSheet, computeFrameIndex, SpriteSheetLoadError, } from './asset/sprite-sheet-loader.js';
export { synthesizeDefaultClip, clipDurationMs, frameInClipAt, manifestFrameIndex, } from './animation/animation-clip.js';
export { AnimationStatePool, ANIMATION_FLAG_ACTIVE, ANIMATION_FLAG_FINISHED, } from './animation/animation-state-pool.js';
export { AnimationSystem, POOL_ANIMATION } from './systems/animation-system.js';
export { ParticlePool, PARTICLE_FLAG_ALIVE, PARTICLE_FLAG_ADDITIVE, } from './vfx/particle-pool.js';
export { ParticleEmitterPool, EMITTER_FLAG_ACTIVE, EMITTER_FLAG_ADDITIVE, } from './components/particle-emitter.js';
export { ParticleSimulationSystem, POOL_PARTICLE, } from './systems/particle-simulation-system.js';
export { ParticleEmitterSystem, POOL_EMITTER, } from './systems/particle-emitter-system.js';
export { ParticleRenderSystem } from './systems/particle-render-system.js';
export { AudioBus, RESOURCE_AUDIO_BUS, AUDIO_BUDGET_AMBIENT_FLOOR, AUDIO_BUDGET_ESSENTIAL_FLOOR, } from './audio/audio-bus.js';
export { SpatialAudioBus, SPATIAL_BUS_NAME, spatialDistance, } from './audio/spatial-audio-bus.js';
export { RESOURCE_AUDIO_LISTENER, createAudioListenerResource, DEFAULT_LISTENER_FORWARD, DEFAULT_LISTENER_UP, } from './audio/audio-listener-resource.js';
export { SpatialAudioSystem } from './audio/spatial-audio-system.js';
// ===== Phase 17 audio - assets + cues + music (Track B) =====
//
// LOOM-AUDIO-SPEC §4. Asset cache + URL fetch+decode loader, named
// cue catalog routing through AudioBus / SpatialAudioBus, and a music
// director with fade and crossfade. The catalog and music director
// consume SpatialAudioBus + PositionalPlayOptions + SpatialSourceHandle
// from Track A's spatial-audio-bus.ts (now both merged into 0.15.0).
export { AudioAssetCache, createAudioAssetCache, RESOURCE_AUDIO_ASSET_CACHE, } from './audio/audio-asset-cache.js';
export { AudioAssetLoader } from './audio/audio-asset-loader.js';
export { CueCatalog, RESOURCE_CUE_CATALOG, } from './audio/cue-catalog.js';
export { MusicDirector, RESOURCE_MUSIC_DIRECTOR, } from './audio/music-director.js';
export { InputManager, RESOURCE_INPUT_MANAGER, RESOURCE_INPUT, } from './input/input-manager.js';
export { InputSystem } from './systems/input-system.js';
export { VeilBudgetSystem } from './systems/veil-budget-system.js';
export { VirtualDpad } from './input/virtual-dpad.js';
export { TapToWalkSystem, RESOURCE_TAP_WALK, createTapWalkTarget, } from './input/tap-to-walk.js';
export { parseEnvelope, parseEnvelopeJson, priorityFor, EventEnvelopeParseError, } from './director/event-envelope.js';
export { RESOURCE_DIRECTOR_BRIDGE, RESOURCE_KNOT_CONTEXT, } from './director/director-bridge.js';
export { MockDirectorBridge } from './director/mock-director-bridge.js';
export { SSEDirectorBridge } from './director/sse-director-bridge.js';
export { SnapshotRecoveryHelper, SnapshotFetchError, } from './director/snapshot-recovery.js';
export { KnotContextResource } from './director/knot-context-resource.js';
export { DirectorSystem, RESOURCE_DIRECTOR_LOG, createDirectorEventLog, } from './director/director-system.js';
export { DirectorEncounterSystem } from './director/director-encounter-system.js';
export { parseZoneEnvelope, parseZoneEnvelopeJson, priorityFor as zonePriorityFor, ZoneEventEnvelopeParseError, } from './director/zone/zone-event-envelope.js';
export { RESOURCE_ZONE_EVENT_BRIDGE } from './director/zone/zone-event-bridge.js';
export { MockZoneBridge } from './director/zone/mock-zone-bridge.js';
export { SSEZoneBridge } from './director/zone/sse-zone-bridge.js';
export { RESOURCE_ZONE_EVENT_LOG, ZONE_RING_SIZE, createZoneEventLog, getOrCreateZoneEntry, pushZoneEvent, } from './director/zone/zone-event-log.js';
export { RESOURCE_DIRECTOR_ZONE_STATE, createDirectorZoneStateResource, getOrCreateZoneStateMap, applyZoneStateChanges, replaceZoneStateFromSnapshot, } from './director/zone/zone-state-resource.js';
export { ZoneEventSystem } from './director/zone/zone-event-system.js';
export { ZoneAudioSystem, RESOURCE_AUDIO_LISTENER_STUB, RESOURCE_CUE_CATALOG_STUB, RESOURCE_MUSIC_DIRECTOR_STUB, } from './audio/zone-audio-system.js';
export { RESOURCE_ZONE_BOSS_ENTITY, RECENT_HITS_RING_SIZE, createZoneBossEntityResource, buildEntityFromSpawn, applyTick, } from './director/zone/zone-boss-entity.js';
export { ZoneBossEntitySystem } from './director/zone/zone-boss-entity-system.js';
// Combat (Phase 7): health, damage, simple AI, attack. Engine-side
// primitives that the actual Survivor port will use. The full
// Survivor wave engine sits on top of these in subsequent sessions.
export { HealthPool, POOL_HEALTH, HEALTH_FLAG_ACTIVE, HEALTH_FLAG_DEAD, HEALTH_FLAG_INVULNERABLE, } from './components/health.js';
export { PursuePool, POOL_PURSUE, PURSUE_FLAG_ACTIVE, } from './components/pursue.js';
export { DamageSystem, DeathLog, RESOURCE_DEATH_LOG, } from './systems/damage-system.js';
export { PursueSystem } from './systems/pursue-system.js';
export { AttackSystem } from './systems/attack-system.js';
export { ProjectilePool, POOL_PROJECTILE, PROJECTILE_FLAG_ALIVE, PROJECTILE_FLAG_HOMING, PROJECTILE_FLAG_PIERCE, } from './vfx/projectile-pool.js';
export { RangedAttackPool, POOL_RANGED, RANGED_FLAG_ACTIVE, RANGED_FLAG_HOMING, } from './components/ranged-attack.js';
export { ProjectileSystem } from './systems/projectile-system.js';
export { RangedAttackSystem } from './systems/ranged-attack-system.js';
export { ProjectileRenderSystem } from './systems/projectile-render-system.js';
export { MOB_CATALOG, spawnMob } from './combat/mob-catalog.js';
export { createZoneState, beginTransition, tickTransition, isTransitioning, RESOURCE_ZONE_STATE, } from './zone/zone-state.js';
export { ZONE_CATALOG } from './zone/zone-catalog.js';
export { InteractablePool, POOL_INTERACTABLE, INTERACTABLE_FLAG_ACTIVE, } from './components/interactable.js';
export { InteractionSystem, createLastInteraction, RESOURCE_LAST_INTERACTION, } from './systems/interaction-system.js';
export { RESOURCE_MULTIPLAYER_BRIDGE, RESOURCE_PEER_POOL, BROADCAST_HZ, BROADCAST_MIN_INTERVAL_MS, } from './network/multiplayer-bridge.js';
export { PeerPool } from './network/peer-pool.js';
export { MockMultiplayerBridge } from './network/mock-multiplayer-bridge.js';
export { SSEMultiplayerBridge } from './network/sse-multiplayer-bridge.js';
export { PeerSpritePool, POOL_PEER_SPRITE } from './components/peer-sprite.js';
export { PeerPresenceSystem, PeerRenderSystem, } from './systems/peer-presence-system.js';
export { ClientPluginRegistry, MapPluginStorage as ClientMapPluginStorage, ConsolePluginLogger as ClientConsolePluginLogger, PluginEntropy, PluginError, ALL_SCOPES as CLIENT_PLUGIN_SCOPES, DEFAULT_PLUGIN_STORAGE_MAX_BYTES as CLIENT_PLUGIN_DEFAULT_STORAGE_MAX_BYTES, DEFAULT_PLUGIN_TICK_BUDGET_MS as CLIENT_PLUGIN_DEFAULT_TICK_BUDGET_MS, setWithTtl as clientPluginSetWithTtl, getWithTtlCheck as clientPluginGetWithTtlCheck, } from './plugins/index.js';
//# sourceMappingURL=index.js.map