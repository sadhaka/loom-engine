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
export const LOOM_ENGINE_VERSION = '2.2.5';
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
// 1.7.6 - deterministic binary state snapshot. Canonical little-endian
// bytes of allocator + pool + RNG state, FNV-1a hashed for
// cross-runtime determinism verification and rewind/restore. Distinct
// from world-snapshot above (that is the JSON save-game serializer).
export { SnapshotWriter, SnapshotReader, StateSnapshot, fnv1a32, isSnapshotable, STATE_SNAPSHOT_VERSION, } from './runtime/state-snapshot.js';
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
// 1.7.7 - dense bounded uniform grid; zero-allocation fixed-arena counterpart to SpatialHash.
export { SpatialGrid } from './runtime/spatial-grid.js';
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
// 2.2.0 - dependency-free synchronous HMAC-SHA-256 (integrity primitive) +
// constant-time hex compare (2.2.1).
export { sha256Bytes, sha256Hex, hmacSha256Bytes, hmacSha256Hex, timingSafeEqualHex, } from './runtime/hmac-sha256.js';
// 2.2.0 - tamper-evident HMAC-chained event log (the integrity-bearing
// sibling of EventLog; detects field tamper, deletion, reordering, and - with
// a seal() commitment - tail truncation).
export { EventChain, RESOURCE_EVENT_CHAIN } from './runtime/event-chain.js';
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
// 1.7.4 (Wave 1.7 networking) - LagCompensation: client-side rollback
// netcode primitive (snapshot + input ring buffer).
export { LagCompensation, RESOURCE_LAG_COMPENSATION } from './runtime/lag-compensation.js';
export { attachLagCompensationToWs } from './runtime/ws-adapters/lag-compensation-ws.js';
// AIActionInterpreter - parse untrusted LLM action output into a
// validated ring buffer of (npcId, actionId, targetId) records;
// allocation-free line scan, malformed input rejected and counted.
export { AIActionInterpreter } from './runtime/ai-action-interpreter.js';
// LoomFlux - the Sim-LOD scheduler core: dense per-tier entity
// buckets, a frame-boundary migration queue, and a wrap-safe tiered
// tick. Relevance scoring + fast-forward are the deferred
// integration layer (need Omniveil / nav).
export { LoomFlux } from './runtime/loom-flux.js';
// LoomDecay - procedural material entropy: a chunked, seeded-PRNG
// material-fatigue pool that decays materials toward phase changes
// and recycling, via a generation-validated phase-change command buffer.
export { LoomDecay, makeMaterialHandle, materialSlot, materialGeneration } from './runtime/loom-decay.js';
// PhysicsSystem - a 2D AABB collision primitive over a SoA collider
// pool: SpatialGrid 3x3 broadphase, AABB narrowphase, and positional
// minimum-translation push-apart, split into integrate / syncGrid /
// detect / resolve phases so the stale-state gates hold by construction.
export { PhysicsSystem, makeColliderHandle, colliderSlot, colliderGeneration } from './runtime/physics-system.js';
// MarketSimulation - a deterministic batch-auction order book: Int32
// wealth + inventory ledgers, escrowed conservation-safe settlement,
// maker-price matching, generation-validated order handles. SAB
// multi-producer ingestion is the deferred layer.
export { MarketSimulation } from './runtime/market-simulation.js';
// GeneticPersonaEngine - a 256-bit genome table with seeded-PRNG
// bitwise crossover + mutation; a component table keyed by an
// externally-owned entityId, deliberately with no authority mapping.
export { GeneticPersonaEngine, GENOME_WORDS, GENOME_BITS } from './runtime/genetic-persona-engine.js';
// CognitiveMap - a deterministic HTN planner over flat typed-array
// domain tables, with overlay rollback, method backtracking, plan
// generation counters, and a step-budgeted priority-queue scheduler.
export { CognitiveMap } from './runtime/cognitive-map.js';
// LoomChrono - a deterministic rewind / replay log: a circular ring of
// fixed-size keyframes plus a circular log of fixed-size input events,
// both generation-validated, with a typed replay plan that fills a
// caller-provided index buffer.
export { LoomChrono, chronoSlot, chronoGeneration } from './runtime/loom-chrono.js';
// AIBehaviorBuffer - a zero-allocation SoA snapshot store for LLM
// context ingestion: one aliased backing buffer, a plain-counter
// seqlock publish protocol, and a built-in generation-stamped observer
// change-feed. Single-writer; the SAB + Atomics worker variant is deferred.
export { AIBehaviorBuffer, makeObserverHandle, observerSlot, observerGeneration, SNAPSHOT_NEVER_WRITTEN, SNAPSHOT_TORN, SNAPSHOT_UNCHANGED, } from './runtime/ai-behavior-buffer.js';
// AssetVirtualizer - a bounded LRU cache for virtualized GPU assets:
// wrap-safe LRU eviction, a load queue, a delayed GPUTexture
// destruction queue, a shared placeholder, and generation-checked
// stale-load rejection. The real GPU calls + async loading are deferred.
export { AssetVirtualizer, makeAssetHandle, assetSlot, assetGeneration, SLOT_STATE_FREE, SLOT_STATE_QUEUED, SLOT_STATE_LOADING, SLOT_STATE_RESIDENT, ASSET_HANDLE_INVALID, DESTROY_NONE, } from './runtime/asset-virtualizer.js';
// BlackSwan - the chaos engine: a windowed entropy monitor plus a
// governed event-proposal pipeline. Untrusted proposals move through
// a PROPOSED -> APPROVED -> CANARY/ACTIVE -> EXPIRED state machine
// under Mainframe approval; every transition is audit-logged. It never
// mutates the world directly.
export { BlackSwan, makeEventHandle, eventSlot, eventGeneration, EVENT_STATE_NONE, EVENT_STATE_PROPOSED, EVENT_STATE_APPROVED, EVENT_STATE_CANARY, EVENT_STATE_ACTIVE, EVENT_STATE_EXPIRED, EVENT_STATE_REJECTED, EVENT_STATE_REVOKED, EVENT_HANDLE_INVALID, AUDIT_RECORD_STRIDE, } from './runtime/black-swan.js';
// InfiniteHorizonStreamer - a Morton-coded chunk streaming manager:
// discovers the chunks around a moving viewpoint, queues the missing
// ones, evicts the ones that fall out of range. Signed-coordinate
// Morton encoding (no BigInt), open-addressed registry, load + eviction
// queues, payload-before-state publish ordering.
export { InfiniteHorizonStreamer, makeChunkHandle, chunkSlot, chunkGeneration, CHUNK_STATE_NONE, CHUNK_STATE_QUEUED, CHUNK_STATE_LOADING, CHUNK_STATE_READY, CHUNK_HANDLE_INVALID, EVICTION_RECORD_STRIDE, } from './runtime/infinite-horizon-streamer.js';
// OmniveilSKB - a semantic knowledge base: source-attributed truth
// claims as (subject, predicate, object) triples with a distinct-
// source consensus count, open-addressed storage, identity-verified
// consensus, and contradiction / per-source poisoning rules.
export { OmniveilSKB, CLAIM_QUAD_STRIDE } from './runtime/omniveil-skb.js';
// WebGPURenderer - the safe pure-logic core of the WebGPU SoA bridge:
// a double-buffered staging ring, upload validation against the
// device storage-buffer limit, an explicit bind-group-layout
// descriptor, and device-lost state. The actual GPU API calls are the
// deferred integration layer.
export { WebGPURenderer, SHADER_STAGE_VERTEX, SHADER_STAGE_FRAGMENT, SHADER_STAGE_COMPUTE, BUFFER_TYPE_UNIFORM, BUFFER_TYPE_STORAGE, BUFFER_TYPE_READ_ONLY_STORAGE, UPLOAD_NONE, } from './runtime/webgpu-renderer.js';
// SonicSync - the acoustic propagation kernel: SoA source/listener
// pools, a Q16.16 fixed-point voxel grid, Amanatides-Woo 3D DDA
// occlusion tracing, a double-buffered perception-event ring, and a
// (source, listener, semanticId) cooldown hash so the consumer reads
// compact events one frame later without flooding. The actual WebGPU
// acoustic ray-tracer is the deferred integration layer.
export { SonicSync, FP_SHIFT, FP_ONE, FP_HALF, ATTENUATION_FULL, ATTENUATION_NONE, TRACE_INAUDIBLE, SOURCE_SLOT_INVALID, LISTENER_SLOT_INVALID, PERCEPTION_EVENT_STRIDE, } from './runtime/sonic-sync.js';
// LoomVerify - the anti-cheat verifier: a server-side claim verdict
// pipeline with PASS / RESYNC / REJECT outcomes. Fixed-point integer
// claim envelopes, single-use nonce table with TTL, regional Merkle
// witnesses, key-epoch rotation with grace window, value-class gated
// ZK escalation, TTL-decayed per-entity violation score for the
// moderation pipeline. Never mutates the world; only emits verdicts.
// The Groth16 / Plonk WASM verifier is the deferred integration layer.
export { LoomVerify, VERDICT_NONE, VERDICT_PASS, VERDICT_RESYNC, VERDICT_REJECT, VERDICT_ID_INVALID, VERDICT_RECORD_STRIDE, REASON_NONE, REASON_BAD_NONCE, REASON_NONCE_EXPIRED, REASON_BAD_REGION_ROOT, REASON_BAD_KEY_EPOCH, REASON_PHYSICS, REASON_BAD_TICK, REASON_BAD_ENTITY, REASON_BAD_ACTION, REASON_CRYPTO_FAIL, REASON_NEEDS_PROOF, VALUE_CLASS_LOW, VALUE_CLASS_MEDIUM, VALUE_CLASS_HIGH, } from './runtime/loom-verify.js';
// NeuralMaterial - the runtime PBR-material synthesis kernel: a
// device-capability-gated path picker (PACKED_F16 / F16 / F32 fallback),
// an LRU atlas slot allocator with mipmap-ready bits, an SoA job
// queue with no Promise-per-material fan-out, a delayed-destruction
// queue for evicted GPU resources, and a rolling GPU-timestamp
// latency window for frame-budget claims. The deferred WebGPU
// dispatch / pipeline / mipmap pass is the integration layer.
export { NeuralMaterial, pickPath, makeNeuralMaterialHandle, neuralMaterialSlot, neuralMaterialGeneration, NEURAL_SLOT_STATE_FREE, NEURAL_SLOT_STATE_QUEUED, NEURAL_SLOT_STATE_SYNTHESIZING, NEURAL_SLOT_STATE_RESIDENT, PATH_PACKED_F16, PATH_F16, PATH_F32, PATH_INVALID, CAP_SHADER_F16, CAP_PACKED_4X8, CAP_TEXTURE_RGBA16F, CAP_TIMESTAMP_QUERY, MATERIAL_HANDLE_INVALID, JOB_ID_INVALID, ATLAS_SLOT_INVALID, NEURAL_DESTROY_NONE, JOB_RECORD_STRIDE, } from './runtime/neural-material.js';
// InferenceOrchestrator - the NPC-AI inference router: per-lane
// SoA request queues (LOCAL_SLM consented + CLOUD rate-limited),
// zero-allocation batch drain so the deferred dispatcher makes ONE
// inference call per batch (no Promise per NPC), per-lane token /
// rate / TTL / critical-ceiling budgets, and post-inference action
// validation against per-actionType allowed-result masks. The
// actual local-SLM and cloud-LLM HTTP calls are the deferred layer.
export { InferenceOrchestrator, makeRequestHandle, requestSlot, requestLane, requestGeneration, LANE_LOCAL_SLM, LANE_CLOUD, PRIORITY_LOW, PRIORITY_NORMAL, PRIORITY_HIGH, PRIORITY_CRITICAL, REQUEST_STATE_NONE, REQUEST_STATE_PENDING, REQUEST_STATE_INFLIGHT, REQUEST_STATE_COMPLETED, REQUEST_STATE_CANCELLED, REQUEST_STATE_EXPIRED, REASON_NONE as INFERENCE_REASON_NONE, REASON_RATE_LIMITED, REASON_BUDGET_EXHAUSTED, REASON_CRITICAL_CEILING, REASON_CONSENT_DENIED, REASON_DEADLINE_EXCEEDED, REASON_BAD_RESULT, REASON_STALE_HANDLE, REASON_BAD_LANE, REASON_BAD_PRIORITY, REASON_BAD_NPC, REASON_BAD_TOKENS, REASON_BAD_TTL, REASON_BAD_ACTION as INFERENCE_REASON_BAD_ACTION, REQUEST_HANDLE_INVALID, DROP_EVENT_STRIDE, } from './runtime/inference-orchestrator.js';
// LoomPulse - the player-vibe inference kernel: Q16.16 fixed-point
// EMA accumulators per vibe with confidence + decay + hysteresis,
// double-buffered front/back state, an explicit player-consent
// kill switch (default OFF), a deliberately-narrow output surface
// so inferred emotion CANNOT directly write permanent reputation,
// a corroboration-required read for any reputation pipeline, an
// atmosphere-impact clamp for "subtle local effects only", and a
// per-vibe audit ring for offline bias / misclassification analysis.
export { LoomPulse, PULSE_FP_SHIFT, PULSE_FP_ONE, VIBE_INVALID, AUDIT_RECORD_STRIDE as PULSE_AUDIT_RECORD_STRIDE, } from './runtime/loom-pulse.js';
// LoomFlow - the adaptive-network packet router: three lanes
// (UNRELIABLE_MOVEMENT, RELIABLE_COMBAT, RELIABLE_ECONOMY), each
// with its own per-lane sequence space, authority epoch, jitter
// buffer with TTL-driven late-packet drop, per-(lane, client)
// idempotency ring, per-client throttle with hysteresis +
// backpressure, and a transport profile picker (WEBTRANSPORT >
// WEBRTC > WEBSOCKET). The actual transport channel is the
// deferred integration layer.
export { LoomFlow, pickTransport, LANE_UNRELIABLE_MOVEMENT, LANE_RELIABLE_COMBAT, LANE_RELIABLE_ECONOMY, TRANSPORT_WEBTRANSPORT, TRANSPORT_WEBRTC, TRANSPORT_WEBSOCKET, TRANSPORT_INVALID, FLOW_CAP_WEBTRANSPORT, FLOW_CAP_WEBRTC, FLOW_CAP_WEBSOCKET, FLOW_REASON_NONE, FLOW_REASON_STALE_SEQ, FLOW_REASON_STALE_EPOCH, FLOW_REASON_DUPLICATE, FLOW_REASON_THROTTLED, FLOW_REASON_BUFFER_FULL, FLOW_REASON_BAD_LANE, FLOW_REASON_BAD_CLIENT, FLOW_REASON_BAD_SEQ, FLOW_REASON_TTL_EXPIRED, FLOW_REASON_OUTBOUND_FULL, PACKET_INVALID, FLOW_EVENT_STRIDE, FLOW_PACKET_STRIDE, } from './runtime/loom-flow.js';
// NeuralAnimationSystem - the motion-matching + inertialization
// kernel: Q16.16 fp feature DB + pose DB, brute-force best-match
// search, real per-bone pose-delta extraction at the transition,
// exponential per-bone inertial decay (precomputed exp() LUT),
// foot-locking mask. The WGSL compute-offload of the search and
// the bone-matrix render upload are the deferred integration layer.
export { NeuralAnimationSystem, ANIM_FP_SHIFT, ANIM_FP_ONE, BONE_SLOT_STRIDE, FOOT_LEFT, FOOT_RIGHT, ANIM_CLIP_INVALID, ANIM_FRAME_INVALID, ANIM_ENTITY_INVALID, } from './runtime/neural-animation.js';
// VoxelComputeSystem - the marching-cubes voxel mesher: SoA per-chunk
// density (front/back epoch-swapped) + material; externally-loaded
// 256-entry edge + 256x16 tri lookup tables; CPU mesher with real
// 8-corner indexing + linear edge interpolation; capacity-checked
// vertex emission with overflow counter; pre-allocated counter-reset
// buffer for the deferred GPU dispatcher's atomic reset pass.
export { VoxelComputeSystem, VOXEL_VERTEX_STRIDE, VOXEL_FP_SHIFT, VOXEL_FP_ONE, VOXEL_CHUNK_INVALID, } from './runtime/voxel-compute.js';
// AetherGrid - the N2N authority handoff kernel: per-entity owner +
// epoch (the fencing token), two-phase transfer state machine with
// idempotency keys / deadline expiry / commit/abort, SoA chunk
// replication queue with per-chunk seq numbers + stale rejection,
// split-brain detection (same-epoch divergent owners), and crash
// recovery via checkpoint reload. Control / data plane explicitly
// split for the deferred gRPC + shared-memory transports.
export { AetherGrid, makeHandle as makeTransferHandle, handleSlot as transferSlot, handleGen as transferGen, TRANSFER_STATE_NONE, TRANSFER_STATE_PROPOSED, TRANSFER_STATE_COMMITTED, TRANSFER_STATE_ABORTED, TRANSFER_STATE_EXPIRED, AETHER_REASON_NONE, AETHER_REASON_BAD_ENTITY, AETHER_REASON_BAD_NODE, AETHER_REASON_BAD_HANDLE, AETHER_REASON_BAD_STATE, AETHER_REASON_STALE_EPOCH, AETHER_REASON_SPLIT_BRAIN, AETHER_REASON_DEADLINE_EXCEEDED, AETHER_REASON_DUPLICATE_KEY, AETHER_REASON_BAD_SEQ, AETHER_REASON_BUFFER_FULL, TRANSFER_HANDLE_INVALID, NODE_INVALID, TRANSFER_RECORD_STRIDE, REPLICATION_RECORD_STRIDE, } from './runtime/aether-grid.js';
// LoomFSR - the temporal upscaler kernel: precomputed Halton(2,3)
// sub-pixel jitter, ping-pong color/depth/normal history texture
// handles (no GPU copy), per-pixel reactive/disocclusion mask,
// configured spatial sharpening for FSR-class reconstruction,
// validated texture format/usage/alignment. The deferred WGSL
// resolve pass + GPU texture binding is the integration layer.
export { LoomFSR, FSR_FP_SHIFT, FSR_FP_ONE, FSR_FP_HALF, FSR_CHANNEL_COLOR, FSR_CHANNEL_DEPTH, FSR_CHANNEL_NORMAL, TEX_FORMAT_RGBA8_UNORM, TEX_FORMAT_RGBA16_FLOAT, TEX_FORMAT_R32_FLOAT, TEX_FORMAT_RG16_SNORM, TEX_USAGE_TEXTURE_BINDING, TEX_USAGE_STORAGE_BINDING, TEX_USAGE_RENDER_ATTACHMENT, TEX_USAGE_COPY_DST, TEX_USAGE_COPY_SRC, REACTIVE_BIT_REACTIVE, REACTIVE_BIT_DISOCCLUDED, TEX_HANDLE_INVALID, FSR_REASON_NONE, FSR_REASON_BAD_FORMAT, FSR_REASON_BAD_USAGE, FSR_REASON_BAD_ALIGNMENT, FSR_REASON_BAD_COORD, FSR_REASON_BAD_CHANNEL, } from './runtime/loom-fsr.js';
// SealedAssetRegistry - the delayed-key-disclosure manifest:
// AES-GCM envelope packing convention, AAD binding (event/asset/
// version/contentHash), per-asset state machine (SEALED →
// KEY_DISCLOSED → DECRYPTING → READY/FAILED/REVOKED), per-event
// entitlement + region scoped key disclosure, opaque CDN-hash
// indirection, transferable-buffer accounting. The WebCrypto AES-
// GCM call + SSE delivery + CDN fetch are the deferred layers.
export { SealedAssetRegistry, SEALED_STATE_NONE, SEALED_STATE_SEALED, SEALED_STATE_KEY_DISCLOSED, SEALED_STATE_DECRYPTING, SEALED_STATE_READY, SEALED_STATE_FAILED, SEALED_STATE_REVOKED, SEALED_REASON_NONE, SEALED_REASON_BAD_ASSET, SEALED_REASON_BAD_EVENT, SEALED_REASON_BAD_HANDLE, SEALED_REASON_BAD_STATE, SEALED_REASON_BAD_ENVELOPE, SEALED_REASON_NOT_ENTITLED, SEALED_REASON_BAD_REGION, SEALED_REASON_STALE_GENERATION, SEALED_REASON_DUPLICATE, ENVELOPE_IV_BYTES, ENVELOPE_TAG_BYTES, ENVELOPE_MIN_BYTES, AAD_BYTES, AAD_HASH_BYTES, SEALED_HANDLE_INVALID, SEALED_ASSET_RECORD_STRIDE, } from './runtime/sealed-asset.js';
// LoomForgeBridge - the WASM-SIMD physics integration kernel:
// strict build contract (imported shared memory + min/max pages +
// SIMD), single-source memory layout constants, initialized-flag
// gate, validated dt + activeCount before delegating to the bound
// step callback, double-buffered position phase barrier so render
// never reads mid-write. The actual Wasm module instantiation +
// SIMD step kernel + SAB shared memory are the integration layer.
export { LoomForgeBridge, FORGE_POS_STRIDE, FORGE_VEL_STRIDE, FORGE_SCRATCH_STRIDE, FORGE_POS_OFFSET, WASM_PAGE_BYTES, FORGE_STATE_UNINITIALIZED, FORGE_STATE_READY, FORGE_REASON_NONE, FORGE_REASON_NOT_INITIALIZED, FORGE_REASON_BAD_DT, FORGE_REASON_BAD_COUNT, FORGE_REASON_BAD_CONTRACT, FORGE_REASON_NO_CALLBACK, FORGE_MAX_DT_FP, } from './runtime/loom-forge-bridge.js';
// GlobalStateLedger - the spatio-temporal persistence kernel:
// (regionId, lamport64, nodeId, sequence) total ordering, per-delta
// idempotency-key + authority-epoch binding, versioned NewValue
// codec, per-region Lamport clock, per-componentTypeId merge-rule
// registry (LWW / SUM / BITSET_OR / CRDT_CUSTOM), atomic +
// auditable compaction, vector-DB-index marker bit. The actual
// SQLite WAL writes + vector-DB writes + on-disk compaction are
// the deferred integration layers.
export { GlobalStateLedger, LEDGER_REASON_NONE, LEDGER_REASON_BAD_REGION, LEDGER_REASON_BAD_NODE, LEDGER_REASON_BAD_ENTITY, LEDGER_REASON_BAD_COMPONENT, LEDGER_REASON_BAD_CODEC_VERSION, LEDGER_REASON_STALE_EPOCH, LEDGER_REASON_DUPLICATE_KEY, LEDGER_REASON_FULL, LEDGER_REASON_BAD_LAMPORT, LEDGER_REASON_BAD_RULE, MERGE_RULE_NONE, MERGE_RULE_LAST_WRITE_WINS, MERGE_RULE_SUM, MERGE_RULE_BITSET_OR, MERGE_RULE_CRDT_CUSTOM, DELTA_FLAG_HAS_VECTOR_EMBEDDING, DELTA_HANDLE_INVALID, DELTA_RECORD_STRIDE, COMPACTION_ENTRY_STRIDE, } from './runtime/global-state-ledger.js';
// LoomStudioOrchestrator - the AI Director governance kernel:
// per-tick double-buffered telemetry snapshot with monotonic
// epoch, batched SLM query queue (no Promise per query),
// per-query-type allowed-action-mask validation, telemetry-epoch
// staleness rejection, fact proposals routed through (sourceId,
// expiresAtTick, telemetryEpoch, factTier) provenance envelope,
// SLM-tier guard that REJECTS VERIFIED tier (admin-only), reserved
// fact-index 0 the SLM can never write.
export { LoomStudioOrchestrator, makeHandle as makeStudioHandle, handleSlot as studioSlot, handleGen as studioGen, STUDIO_REASON_NONE, STUDIO_REASON_BAD_SIGNAL, STUDIO_REASON_BAD_QUERY_TYPE, STUDIO_REASON_BAD_HANDLE, STUDIO_REASON_BAD_STATE, STUDIO_REASON_STALE_EPOCH, STUDIO_REASON_BAD_ACTION_MASK, STUDIO_REASON_BAD_FACT_INDEX, STUDIO_REASON_TIER_FORBIDDEN, STUDIO_REASON_BAD_TIER, STUDIO_REASON_QUEUE_FULL, STUDIO_REASON_BAD_TTL, STUDIO_REASON_BAD_SOURCE, FACT_TIER_LOW, FACT_TIER_MEDIUM, FACT_TIER_HIGH, FACT_TIER_VERIFIED, QUERY_STATE_NONE, QUERY_STATE_PENDING, QUERY_STATE_INFLIGHT, QUERY_STATE_COMPLETED, QUERY_STATE_REJECTED, FACT_STATE_NONE, FACT_STATE_PROPOSED, FACT_STATE_APPROVED, FACT_STATE_EXPIRED, RESERVED_FACT_INDEX, QUERY_HANDLE_INVALID, FACT_HANDLE_INVALID, QUERY_RECORD_STRIDE, FACT_RECORD_STRIDE, } from './runtime/studio-orchestrator.js';
// 1.7.5 MILESTONE (Wave 1.7 networking complete) - ChatChannel +
// ChatChannelRegistry: moderated multi-channel chat with rate
// limit + filter hooks.
export { ChatChannel, ChatChannelRegistry, RESOURCE_CHAT_CHANNEL, RESOURCE_CHAT_CHANNEL_REGISTRY } from './runtime/chat-channel.js';
export { attachChatChannelToWs } from './runtime/ws-adapters/chat-channel-ws.js';
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
export { DeltaCompressor, DELTA_WIRE_MAGIC, DELTA_WIRE_VERSION, DELTA_MAX_COLUMNS, deltaFrameToBase64, deltaFrameFromBase64, } from './network/delta-compressor.js';
export { InputReconciliation, FIXED_POINT_SHIFT, FIXED_POINT_ONE, floatToFixed, fixedToFloat, } from './network/input-reconciliation.js';
export { ClientPluginRegistry, MapPluginStorage as ClientMapPluginStorage, ConsolePluginLogger as ClientConsolePluginLogger, PluginEntropy, PluginError, ALL_SCOPES as CLIENT_PLUGIN_SCOPES, DEFAULT_PLUGIN_STORAGE_MAX_BYTES as CLIENT_PLUGIN_DEFAULT_STORAGE_MAX_BYTES, DEFAULT_PLUGIN_TICK_BUDGET_MS as CLIENT_PLUGIN_DEFAULT_TICK_BUDGET_MS, setWithTtl as clientPluginSetWithTtl, getWithTtlCheck as clientPluginGetWithTtlCheck, } from './plugins/index.js';
// Bestiary - Trinity Wave 2.1 candidate creature lifecycle kernel.
// SoA storage of NPC creatures with generational handles, ticked from
// per-slot BehaviorTrees, fed perception events from SonicSync, mood
// values from LoomPulse, AI decisions from InferenceOrchestrator for
// high-tier creatures, and prior-encounter bias from NarrativeMemory
// at spawn. Emits compact death FX events through a double-buffered
// ring for the render layer.
export { BestiaryKernel, CREATURE_CATALOG, RESOURCE_BESTIARY, BESTIARY_FP_SHIFT, BESTIARY_FP_ONE, TIER_FODDER, TIER_ELITE, TIER_MINIBOSS, TIER_BOSS, TIER_RAID, INFERENCE_LANE_NONE as BESTIARY_INFERENCE_LANE_NONE, INFERENCE_LANE_LOCAL_SLM as BESTIARY_INFERENCE_LANE_LOCAL_SLM, INFERENCE_LANE_CLOUD as BESTIARY_INFERENCE_LANE_CLOUD, DEATH_FX_NONE, DEATH_FX_BONE_SHATTER, DEATH_FX_SOUL_WISP_RISE, DEATH_FX_SIGIL_BURST, DEATH_FX_CYAN_DIVIDE_SPLIT_2, DEATH_FX_CHAMPION_COLLAPSE, CREATURE_ACTION_IDLE, CREATURE_ACTION_PATROL, CREATURE_ACTION_PURSUE, CREATURE_ACTION_WIND_UP, CREATURE_ACTION_SWING, CREATURE_ACTION_DRAW, CREATURE_ACTION_RELEASE, CREATURE_ACTION_CHANNEL, CREATURE_ACTION_TAUNT, CREATURE_ACTION_FLEE, CREATURE_ACTION_TAKE_DAMAGE, CREATURE_ACTION_DEAD, CREATURE_HANDLE_INVALID, TARGET_HANDLE_NONE, VARIANT_IDX_INVALID, MOOD_AGITATION, MOOD_FEAR, MOOD_CAUTION, MOOD_BLOODLUST, MOOD_SORROW, MOOD_DOMINANCE, MOOD_INVALID, SONIC_SEMANTIC_PLAYER_FOOTSTEP, SONIC_SEMANTIC_PLAYER_ATTACK, SONIC_SEMANTIC_ALLY_DEATH, DEFAULT_LISTENER_SEMANTIC_MASK, DEATH_FX_EVENT_STRIDE, BB_KEY_HP, BB_KEY_MAX_HP, BB_KEY_POS_X, BB_KEY_POS_Y, BB_KEY_FACING, BB_KEY_MOOD, BB_KEY_TARGET_HANDLE, BB_KEY_TARGET_X, BB_KEY_TARGET_Y, BB_KEY_PERCEIVED_SOURCE, BB_KEY_PERCEIVED_DISTANCE, BB_KEY_TICK_COUNT, BB_KEY_VARIANT_IDX, BB_KEY_INTENT_ACTION, BB_KEY_INTENT_VEL_X, BB_KEY_INTENT_VEL_Y, BB_KEY_INTENT_FACING, BB_KEY_INFERENCE_DECISION, BB_KEY_BIAS_FROM_MEMORY, makeCreatureHandle, creatureSlot, creatureGeneration, getVariantIndex, getSpec, isCatalogValid, defaultBehaviorTreeFactory, } from './runtime/bestiary.js';
//# sourceMappingURL=index.js.map