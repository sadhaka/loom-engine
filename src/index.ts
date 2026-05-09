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
export const LOOM_ENGINE_VERSION = '0.65.0';

// Math + util
export type { Vec2, Vec3, Rect } from './util/math.js';
export {
  vec2,
  vec3,
  rect,
  clamp,
  lerp,
  smoothstep,
  approxEq,
  rectContains,
  rectIntersects,
  visibleInView,
} from './util/math.js';

export type { ColorRGBA } from './util/color.js';
export {
  rgba,
  hexToRgba,
  rgbaToHexString,
  rgbaToCssString,
  colorLerp,
  COLOR_WHITE,
  COLOR_BLACK,
  COLOR_TRANSPARENT,
  COLOR_KNOT_STR,
  COLOR_KNOT_DEX,
  COLOR_KNOT_INT,
  COLOR_KNOT_CENTER,
} from './util/color.js';

// Entity / components
export type { EntityId } from './entity.js';
export {
  EntityAllocator,
  NULL_ENTITY,
  entityIndex,
  entityGeneration,
  makeEntity,
} from './entity.js';

export {
  TransformPool,
  TRANSFORM_FLAG_DIRTY,
  TRANSFORM_FLAG_VISIBLE,
  TRANSFORM_FLAG_STATIC,
  TRANSFORM_FLAG_HAS_PARENT,
} from './components/transform.js';

export {
  SpritePool,
  SPRITE_FLAG_ACTIVE,
  SPRITE_FLAG_TINTED,
} from './components/sprite.js';

// ECS core
export { World, POOL_TRANSFORM, POOL_SPRITE } from './world.js';
export type { System, SystemPhase } from './system.js';
export {
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_PHYSICS,
  SYSTEM_PHASE_ANIMATION,
  SYSTEM_PHASE_RENDER,
  SYSTEM_PHASE_POST_RENDER,
  SYSTEM_PHASES_IN_ORDER,
} from './system.js';
export type { TimeResource, VeilBudgetResource, IManagedResource, LifecycleWorld } from './resources.js';
// 0.22.0 - ECS perf primitives.
export {
  ComponentSignature,
  componentMask,
  COMPONENT_SIGNATURE_MAX_BIT,
  RESOURCE_COMPONENT_SIGNATURE,
} from './runtime/component-signature.js';
export {
  QueryCache,
  RESOURCE_QUERY_CACHE,
} from './runtime/query-cache.js';
// 0.23.0 - render batching primitive.
export {
  RenderBatch,
  RENDER_LAYER_BACKGROUND,
  RENDER_LAYER_TERRAIN,
  RENDER_LAYER_ENTITIES,
  RENDER_LAYER_FX,
  RENDER_LAYER_HUD,
  RESOURCE_RENDER_BATCH,
} from './renderer/render-batch.js';
export type { BatchFlushCallback } from './renderer/render-batch.js';
// 0.24.0 - debug HUD primitive.
export { DebugHUD, RESOURCE_DEBUG_HUD } from './debug/debug-hud.js';
export type { DebugHUDOptions } from './debug/debug-hud.js';
// 0.25.0 - engine clock controls.
export { EngineClock, RESOURCE_ENGINE_CLOCK } from './runtime/engine-clock.js';
export type { EngineClockOptions } from './runtime/engine-clock.js';
// 0.26.0 - world snapshot (save / load via persistable resources).
export {
  serializeWorldSnapshot,
  deserializeWorldSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  RESOURCE_WORLD_SNAPSHOT,
} from './runtime/world-snapshot.js';
export type {
  IPersistableResource,
  WorldSnapshot,
} from './runtime/world-snapshot.js';
// 0.27.0 - camera controller (follow / shake / bounds / fit).
export {
  CameraController,
  RESOURCE_CAMERA_CONTROLLER,
} from './renderer/camera-controller.js';
export type { CameraControllerOptions } from './renderer/camera-controller.js';
// 0.28.0 - generic event bus.
export { EventBus, RESOURCE_EVENT_BUS } from './runtime/event-bus.js';
export type { EventHandler } from './runtime/event-bus.js';
// 0.29.0 - tween system.
// 0.40.0 extends Easings with back / elastic / bounce + adds the
// cubicBezier(x1,y1,x2,y2) factory for CSS-style custom curves.
export { Tween, Easings, cubicBezier, RESOURCE_TWEEN } from './runtime/tween.js';
export type { TweenHandle, TweenOptions, EasingFn, EasingName } from './runtime/tween.js';
// 0.30.0 - spatial hash for nearby-entity queries.
export { SpatialHash, RESOURCE_SPATIAL_HASH } from './runtime/spatial-hash.js';
// 0.31.0 - declarative input actions.
export { InputActions, RESOURCE_INPUT_ACTIONS } from './input/input-actions.js';
// 0.32.0 - generic object pool for short-lived reusable objects.
export { ObjectPool } from './runtime/object-pool.js';
export type { ObjectPoolOptions } from './runtime/object-pool.js';
// 0.33.0 - color utilities (parse / format / blend / HSL / pack32).
// Augments the existing color helpers without shadowing them.
export {
  clamp01,
  parseHex,
  toHexString,
  colorBlend,
  adjustHsl,
  pack32,
  unpack32,
} from './util/color.js';
// 0.34.0 - declarative asset preloader with progress events.
export { AssetPreloader, RESOURCE_ASSET_PRELOADER } from './runtime/asset-preloader.js';
export type {
  AssetProgressEvent,
  AssetLoadedEvent,
  AssetErrorEvent,
  AssetDoneEvent,
} from './runtime/asset-preloader.js';
// 0.35.0 - audio mixer (engine-side fade / crossfade / snapshot / duck).
export { AudioMixer, RESOURCE_AUDIO_MIXER } from './audio/audio-mixer.js';
export type {
  AudioMixerOptions,
  FadeOptions,
  DuckOptions,
  MixerSnapshot,
} from './audio/audio-mixer.js';
// 0.36.0 - frame budget scheduler (soft-deadline task queue).
export {
  FrameBudgetScheduler,
  RESOURCE_FRAME_BUDGET_SCHEDULER,
} from './runtime/frame-budget-scheduler.js';
export type {
  FrameBudgetTaskDef,
  FrameBudgetStats,
  FrameBudgetSchedulerOptions,
} from './runtime/frame-budget-scheduler.js';
// 0.37.0 - floating text / damage numbers HUD primitive.
export { FloatingText, RESOURCE_FLOATING_TEXT } from './runtime/floating-text.js';
export type {
  FloatingTextSpawn,
  FloatingTextRenderState,
  FloatingTextOptions,
} from './runtime/floating-text.js';
// 0.38.0 - persistent storage adapter (localStorage / in-memory key/value).
export {
  PersistentStorage,
  MemoryStorageBackend,
  LocalStorageBackend,
  RESOURCE_PERSISTENT_STORAGE,
} from './runtime/persistent-storage.js';
export type {
  IStorageBackend,
  PersistentStorageOptions,
  LocalStorageBackendOptions,
} from './runtime/persistent-storage.js';
// 0.39.0 - input chord recognizer (combo / sequence / doubleTap / hold).
export { InputChord, RESOURCE_INPUT_CHORD } from './input/input-chord.js';
export type { ChordDef, ChordKind } from './input/input-chord.js';
// 0.41.0 - layer manager (entity z-order on top of RenderBatch layers).
export { LayerManager, RESOURCE_LAYER_MANAGER } from './runtime/layer-manager.js';
export type { LayerEntry, LayerManagerOptions } from './runtime/layer-manager.js';
// 0.42.0 - memory budget tracker (per-pool / per-resource size estimator).
export {
  MemoryBudget,
  estimateTypedArrayBytes,
  estimateMapBytes,
  estimateSetBytes,
  estimateArrayBytes,
  estimateObjectBytes,
  RESOURCE_MEMORY_BUDGET,
} from './runtime/memory-budget.js';
export type {
  IMemorySource,
  MemoryReport,
  MemoryBudgetOptions,
} from './runtime/memory-budget.js';
// 0.43.0 - particle curves (emit-rate / color-over-life / size-over-life).
export {
  emitRateAt,
  particlesToEmit,
  colorAtAge,
  sizeAtAge,
  RESOURCE_PARTICLE_CURVES,
} from './runtime/particle-curves.js';
export type {
  EmitRateOptions,
  EmitRateShape,
  ColorStop,
  SizeOverLifeOptions,
  SizeShape,
} from './runtime/particle-curves.js';
// 0.44.0 - spatial audio attenuation curves (engine-side evaluation).
export {
  linearAttenuation,
  inverseAttenuation,
  exponentialAttenuation,
  attenuationByModel,
  AttenuationRegistry,
  RESOURCE_ATTENUATION_REGISTRY,
} from './audio/spatial-audio-curves.js';
export type {
  AttenuationOptions,
  AttenuationFn,
  DistanceModelName,
} from './audio/spatial-audio-curves.js';
// 0.45.0 - multi-slot save manager on top of PersistentStorage + WorldSnapshot.
export { SaveSlots, RESOURCE_SAVE_SLOTS } from './runtime/save-slots.js';
export type {
  SlotMetadata,
  SaveSlotsOptions,
  SaveSlotInput,
  LoadedSlot,
} from './runtime/save-slots.js';
// 0.46.0 - localization (string table + locale + parameter interpolation).
export { Localization, RESOURCE_LOCALIZATION } from './runtime/localization.js';
export type {
  LocalizationValue,
  LocalizationTable,
  LocalizationOptions,
  PluralForms,
} from './runtime/localization.js';
// 0.47.0 - tween chain (sequential composition of tweens / delays / callbacks).
export { TweenChain, RESOURCE_TWEEN_CHAIN } from './runtime/tween-chain.js';
export type { TweenChainStartOptions } from './runtime/tween-chain.js';
// 0.48.0 - timer scheduler (engine-clock-driven setTimeout / setInterval).
export { TimerScheduler, RESOURCE_TIMER_SCHEDULER } from './runtime/timer-scheduler.js';
export type { TimerHandle, TimerSchedulerOptions } from './runtime/timer-scheduler.js';
// 0.49.0 - spline path evaluators (linear / Catmull-Rom / Hermite).
export {
  linearPath,
  catmullRomPath,
  hermitePath,
  RESOURCE_SPLINE,
} from './runtime/spline.js';
export type {
  Vec2Like,
  HermiteKey,
  SplineOptions,
} from './runtime/spline.js';
// 0.50.0 - log ring buffer (severity-filtered fixed-capacity log).
export { LogRingBuffer, RESOURCE_LOG_RING_BUFFER } from './runtime/log-ring-buffer.js';
export type {
  LogLevel,
  LogEntry,
  LogRingBufferOptions,
  LogFilter,
} from './runtime/log-ring-buffer.js';
// 0.51.0 - generic finite state machine.
export { StateMachine, RESOURCE_STATE_MACHINE } from './runtime/state-machine.js';
export type { StateConfig, StateMachineOptions } from './runtime/state-machine.js';
// 0.52.0 - per-key cooldown manager.
export { CooldownManager, RESOURCE_COOLDOWN_MANAGER } from './runtime/cooldown-manager.js';
export type { CooldownManagerOptions } from './runtime/cooldown-manager.js';
// 0.53.0 - generic LRU cache.
export { LRUCache, RESOURCE_LRU_CACHE } from './runtime/lru-cache.js';
export type { LRUCacheOptions } from './runtime/lru-cache.js';
// 0.54.0 - 2D AABB queries.
export {
  aabb,
  aabbFromRect,
  aabbFromPoints,
  aabbContainsPoint,
  aabbContainsAabb,
  aabbOverlaps,
  aabbWidth,
  aabbHeight,
  aabbArea,
  aabbCenter,
  aabbExpand,
  aabbTranslate,
  aabbUnion,
  aabbIntersection,
  aabbRangeQuery,
  aabbRaycastSegment,
  RESOURCE_AABB,
} from './runtime/aabb.js';
export type { AABB } from './runtime/aabb.js';
// 0.55.0 - A* pathfinder on a grid (grid-agnostic via isWalkable callback).
export { findPath, RESOURCE_PATHFINDER } from './runtime/pathfinder.js';
export type {
  IsWalkableFn,
  CellCostFn,
  HeuristicFn,
  PathfinderOptions,
  PathPoint,
  PathResult,
} from './runtime/pathfinder.js';
// 0.56.0 - scene manager (named scenes with async enter/exit + tick).
export { SceneManager, RESOURCE_SCENE_MANAGER } from './runtime/scene-manager.js';
export type {
  SceneConfig,
  SceneStatus,
  SceneManagerOptions,
} from './runtime/scene-manager.js';
// 0.57.0 - 2D tile grid (Uint16Array-backed).
export { TileMap, RESOURCE_TILE_MAP } from './runtime/tile-map.js';
export type { TileMapOptions, TileMapSnapshot } from './runtime/tile-map.js';
// 0.58.0 - slot-based inventory grid with stack support.
export { InventoryGrid, RESOURCE_INVENTORY_GRID } from './runtime/inventory-grid.js';
export type {
  InventorySlot,
  ItemInfo,
  InventoryGridOptions,
  AddResult,
} from './runtime/inventory-grid.js';
// 0.59.0 - base + modifier stack producing derived stats.
export { StatStack, RESOURCE_STAT_STACK } from './runtime/stat-stack.js';
export type {
  Modifier,
  ModifierKind,
  StatStackOptions,
} from './runtime/stat-stack.js';
// 0.60.0 - replay recorder (deterministic input + tick capture).
export { ReplayRecorder, RESOURCE_REPLAY_RECORDER } from './runtime/replay-recorder.js';
export type {
  ReplayEvent,
  ReplayStep,
  ReplayTrace,
  ReplayRecorderOptions,
  RecorderMode,
} from './runtime/replay-recorder.js';
// 0.61.0 - branching dialog tree with conditions + actions.
export { DialogTree, RESOURCE_DIALOG_TREE } from './runtime/dialog-tree.js';
export type {
  DialogChoice,
  DialogNode,
  DialogTreeOptions,
  Predicate as DialogPredicate,
  Action as DialogAction,
} from './runtime/dialog-tree.js';
// 0.62.0 - weighted loot table with seedable RNG.
export { LootTable, RESOURCE_LOOT_TABLE } from './runtime/loot-table.js';
export type {
  LootEntry,
  LootDrop,
  LootTableOptions,
} from './runtime/loot-table.js';
// 0.63.0 - quest log state machine + objective tracking.
export { QuestLog, RESOURCE_QUEST_LOG } from './runtime/quest-log.js';
export type {
  QuestState,
  QuestObjective,
  QuestEntry,
  OfferQuestOptions,
  QuestLogOptions,
} from './runtime/quest-log.js';
// 0.64.0 - 2D steering behaviors (seek / flee / arrive / pursue / evade / separation / wander).
export {
  seek,
  flee,
  arrive,
  pursue,
  evade,
  separation,
  wander,
  RESOURCE_STEERING_BEHAVIORS,
} from './runtime/steering-behaviors.js';
export type { Agent, WanderState } from './runtime/steering-behaviors.js';
// 0.65.0 - severity-tiered notification queue with auto-dismiss.
export { ToastQueue, RESOURCE_TOAST_QUEUE } from './runtime/toast-queue.js';
export type {
  ToastSeverity,
  Toast,
  PostOptions,
  ToastQueueOptions,
} from './runtime/toast-queue.js';
export {
  ResourceRegistry,
  createTimeResource,
  createVeilBudgetResource,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
  RESOURCE_VEIL_BUDGET,
} from './resources.js';

// Default systems
export { SpriteRenderSystem } from './systems/sprite-render-system.js';

// Engine facade
export { Engine, registerBackend, isBackendRegistered } from './engine.js';
export type { EngineOptions, DeviceFactory } from './engine.js';

// Seeded entropy (Phase 0.17 deterministic ECS). The engine never
// calls Math.random() directly - any randomness goes through this
// resource so replays / save-state / network sync can reproduce the
// same stream. Engine.create registers one with DEFAULT_ENTROPY_SEED
// out of the box; consumers override per-character or per-run.
export type { IEntropy } from './runtime/entropy.js';
export {
  Entropy,
  createEntropy,
  RESOURCE_ENTROPY,
  DEFAULT_ENTROPY_SEED,
} from './runtime/entropy.js';

// Renderer (low-level, still exposed for direct device access in
// Director-bridge and similar scenarios).
export type {
  IGraphicsDevice,
  AtlasHandle,
  AtlasDescriptor,
  TextStyle,
  DeviceBackend,
} from './renderer/graphics-device.js';

export type { CameraView } from './renderer/camera.js';
export {
  createCamera,
  getCameraViewRect,
  worldToScreen,
  screenToWorld,
} from './renderer/camera.js';

export {
  Canvas2DDevice,
} from './renderer/canvas2d-device.js';

// WebGL2 backend (Phase 14.1). Importing this symbol triggers the
// module's self-registration of the 'webgl2' backend factory, so
// Engine.create({ backend: 'webgl2' }) starts working from then on.
// Canvas2D-only consumers do not import this and the entire WebGL2
// path tree-shakes out of the bundle.
export { WebGL2Device } from './renderer/webgl2-device.js';
export {
  TextureAtlas,
  makeParticleDiscAtlas,
} from './renderer/texture-atlas.js';
export {
  SpriteBatcher,
  FLOATS_PER_INSTANCE,
} from './renderer/sprite-batcher.js';
export type {
  BlendMode,
  FlushHandler,
} from './renderer/sprite-batcher.js';
export {
  SPRITE_VERT_SRC,
  SPRITE_FRAG_SRC,
  UNIT_QUAD_VERTICES,
} from './renderer/shaders/sprite-shader-source.js';

export {
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  ISO_HALF_W,
  ISO_HALF_H,
  ISO_Z_SCALE,
  tileToIso,
  worldToIso,
  isoToTile,
  isoDepthKey,
} from './renderer/iso-projection.js';

// Asset loading (Phase 2 sibling of the renderer; manifest-driven
// sprite-sheet pipeline ready to feed device.registerAtlas).
export type {
  SpriteFrame,
  SpriteAnchor,
  SpriteSheetManifest,
  LoadedSpriteSheet,
  LoaderOptions,
} from './asset/sprite-sheet-loader.js';
export {
  loadSpriteSheet,
  computeFrameIndex,
  SpriteSheetLoadError,
} from './asset/sprite-sheet-loader.js';

// Animation (Phase 3): named clips, per-entity state, and the
// AnimationSystem that advances them. Manifests now carry an
// optional clips[] field; loaders synthesize a 'default' clip
// when absent for backward compat with Phase 2 manifests.
export type { AnimationClip } from './animation/animation-clip.js';
export {
  synthesizeDefaultClip,
  clipDurationMs,
  frameInClipAt,
  manifestFrameIndex,
} from './animation/animation-clip.js';
export {
  AnimationStatePool,
  ANIMATION_FLAG_ACTIVE,
  ANIMATION_FLAG_FINISHED,
} from './animation/animation-state-pool.js';
export { AnimationSystem, POOL_ANIMATION } from './systems/animation-system.js';

// VFX (Phase 4): particle pool, per-entity emitter component, and
// the three-system pipeline (emit -> simulate -> render). Render
// budget is gated by the VeilBudgetResource so the Director can
// throttle expensive scenes without engine code branching.
export type { ParticleSpawn } from './vfx/particle-pool.js';
export {
  ParticlePool,
  PARTICLE_FLAG_ALIVE,
  PARTICLE_FLAG_ADDITIVE,
} from './vfx/particle-pool.js';
export type { EmitterConfig } from './components/particle-emitter.js';
export {
  ParticleEmitterPool,
  EMITTER_FLAG_ACTIVE,
  EMITTER_FLAG_ADDITIVE,
} from './components/particle-emitter.js';
export {
  ParticleSimulationSystem,
  POOL_PARTICLE,
} from './systems/particle-simulation-system.js';
export {
  ParticleEmitterSystem,
  POOL_EMITTER,
} from './systems/particle-emitter-system.js';
export { ParticleRenderSystem } from './systems/particle-render-system.js';

// Audio (Phase 5): Web Audio bus mixer with VE-budget gating.
export type { BusOptions, BusPriority } from './audio/audio-bus.js';
export {
  AudioBus,
  RESOURCE_AUDIO_BUS,
  AUDIO_BUDGET_AMBIENT_FLOOR,
  AUDIO_BUDGET_ESSENTIAL_FLOOR,
} from './audio/audio-bus.js';

// ===== Phase 17 audio - spatializer + listener (Track A) =====
//
// LOOM-AUDIO-SPEC.md §3. Composes the existing AudioBus (Phase 5
// untouched), adds a 'spatial' sub-bus whose sources route through
// PannerNodes, and ships an AudioListener resource + system that
// pushes the local character's transform into the listener pose
// each frame.
export type {
  PositionalPlayOptions,
  AudioListenerPose,
  SpatialSourceHandle,
} from './audio/spatial-audio-bus.js';
export {
  SpatialAudioBus,
  SPATIAL_BUS_NAME,
  spatialDistance,
} from './audio/spatial-audio-bus.js';
export type { AudioListenerResource } from './audio/audio-listener-resource.js';
export {
  RESOURCE_AUDIO_LISTENER,
  createAudioListenerResource,
  DEFAULT_LISTENER_FORWARD,
  DEFAULT_LISTENER_UP,
} from './audio/audio-listener-resource.js';
export { SpatialAudioSystem } from './audio/spatial-audio-system.js';

// ===== Phase 17 audio - assets + cues + music (Track B) =====
//
// LOOM-AUDIO-SPEC §4. Asset cache + URL fetch+decode loader, named
// cue catalog routing through AudioBus / SpatialAudioBus, and a music
// director with fade and crossfade. The catalog and music director
// consume SpatialAudioBus + PositionalPlayOptions + SpatialSourceHandle
// from Track A's spatial-audio-bus.ts (now both merged into 0.15.0).
export {
  AudioAssetCache,
  createAudioAssetCache,
  RESOURCE_AUDIO_ASSET_CACHE,
} from './audio/audio-asset-cache.js';
export type { AudioAssetManifest } from './audio/audio-asset-loader.js';
export { AudioAssetLoader } from './audio/audio-asset-loader.js';
export type {
  CueDefinition,
  CuePlayOptions,
  CueCatalogOptions,
} from './audio/cue-catalog.js';
export {
  CueCatalog,
  RESOURCE_CUE_CATALOG,
} from './audio/cue-catalog.js';
export {
  MusicDirector,
  RESOURCE_MUSIC_DIRECTOR,
} from './audio/music-director.js';

// Input (Phase 5): unified keyboard / mouse / touch with frame-
// coherent snapshot resource.
export type {
  PointerSnapshot,
  TouchPoint,
  InputSnapshot,
} from './input/input-manager.js';
export {
  InputManager,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_INPUT,
} from './input/input-manager.js';
export { InputSystem } from './systems/input-system.js';
export { VeilBudgetSystem } from './systems/veil-budget-system.js';

// Phase 8.4: mobile + touch input. VirtualDpad mounts a 4-button DOM
// overlay that injects WASD into InputManager when pressed (so any
// existing key-driven movement system works unchanged on phones).
// TapToWalkSystem watches the InputSnapshot for single-tap canvas
// gestures and publishes a world-tile target on RESOURCE_TAP_WALK.
export type { DpadDirection, VirtualDpadOptions } from './input/virtual-dpad.js';
export { VirtualDpad } from './input/virtual-dpad.js';
export type {
  TapWalkTargetResource,
  TapToWalkSystemOptions,
} from './input/tap-to-walk.js';
export {
  TapToWalkSystem,
  RESOURCE_TAP_WALK,
  createTapWalkTarget,
} from './input/tap-to-walk.js';

// Director (Phase 6): event-stream bridge to the Loom backend.
// Consumes events per LOOM-DIRECTOR-PROTOCOL.md and mutates engine
// resources (VeilBudget, KnotContext, DirectorEventLog). Renderer
// never decides palette or VE tier - Director emits, renderer applies.
export type {
  EventEnvelope,
  DirectorEvent,
  DirectorEventType,
  DirectorEventDataMap,
  EventPriority,
  // Per-event data shapes
  EncounterSpawnData,
  EncounterTickData,
  EncounterEndData,
  EncounterLootData,
  KnotContextData,
  KnotPaletteHex,
  KnotMood,
  VeBudgetUpdateData,
  VeilTier,
  SceneTransitionData,
  SceneTransitionKind,
  NarratorLineData,
  NarratorVoice,
  SystemHeartbeatData,
  SystemReplayCompleteData,
  SystemSnapshotRequiredData,
  MobSpec,
  BossSpec,
  DropSpec,
} from './director/event-envelope.js';
export {
  parseEnvelope,
  parseEnvelopeJson,
  priorityFor,
  EventEnvelopeParseError,
} from './director/event-envelope.js';
export type {
  IDirectorBridge,
  DirectorBridgeStatus,
  DirectorBridgeStats,
} from './director/director-bridge.js';
export {
  RESOURCE_DIRECTOR_BRIDGE,
  RESOURCE_KNOT_CONTEXT,
} from './director/director-bridge.js';
export { MockDirectorBridge } from './director/mock-director-bridge.js';
export type { SSEDirectorBridgeOptions } from './director/sse-director-bridge.js';
export { SSEDirectorBridge } from './director/sse-director-bridge.js';
export type {
  SnapshotResponse,
  SnapshotRecoveryOptions,
} from './director/snapshot-recovery.js';
export {
  SnapshotRecoveryHelper,
  SnapshotFetchError,
} from './director/snapshot-recovery.js';
export type { KnotPaletteRgba } from './director/knot-context-resource.js';
export { KnotContextResource } from './director/knot-context-resource.js';
export type { DirectorEventLog } from './director/director-system.js';
export {
  DirectorSystem,
  RESOURCE_DIRECTOR_LOG,
  createDirectorEventLog,
} from './director/director-system.js';
export type { DirectorEncounterSystemOptions } from './director/director-encounter-system.js';
export { DirectorEncounterSystem } from './director/director-encounter-system.js';

// ===== Director v2 (Phase 16) - zone-scoped event surface =====
//
// LOOM-DIRECTOR-PROTOCOL-V2.md §3 + §4. Parallel to v1 above; v1 stays
// untouched. v2 reuses v1's DropSpec, NarratorVoice, KnotPaletteHex,
// KnotMood for overlapping shapes - those are exported once via the
// v1 block above and the v2 envelope re-uses them by import.
//
// The zone-event surface targets a different scope (per-zone fanout)
// and a different stream (multiplexed onto the 15.x presence SSE
// channel). Consumers who do not register an IZoneEventBridge see
// identical behaviour to 0.13.0 - the ZoneEventSystem is a no-op
// without a bridge resource attached.
export type {
  ZoneEventEnvelope,
  ZoneEvent,
  ZoneEventType,
  ZoneEventDataMap,
  ZoneBossSpec,
  ZoneBossSpawnData,
  ZoneBossTickData,
  ZoneBossEndData,
  ZoneBossOutcome,
  ZoneBossHit,
  ZoneNarratorData,
  ZoneKnotData,
  ZoneStateData,
  ZoneSnapshotData,
  ZoneStateChange,
} from './director/zone/zone-event-envelope.js';
export {
  parseZoneEnvelope,
  parseZoneEnvelopeJson,
  priorityFor as zonePriorityFor,
  ZoneEventEnvelopeParseError,
} from './director/zone/zone-event-envelope.js';
export type {
  IZoneEventBridge,
  ZoneEventBridgeStatus,
  ZoneEventBridgeStats,
} from './director/zone/zone-event-bridge.js';
export { RESOURCE_ZONE_EVENT_BRIDGE } from './director/zone/zone-event-bridge.js';
export { MockZoneBridge } from './director/zone/mock-zone-bridge.js';
export type {
  SSEZoneBridgeOptions,
  SSEZoneBridgeEventSource,
} from './director/zone/sse-zone-bridge.js';
export { SSEZoneBridge } from './director/zone/sse-zone-bridge.js';
export type {
  ZoneEventLog,
  ZoneEventLogEntry,
} from './director/zone/zone-event-log.js';
export {
  RESOURCE_ZONE_EVENT_LOG,
  ZONE_RING_SIZE,
  createZoneEventLog,
  getOrCreateZoneEntry,
  pushZoneEvent,
} from './director/zone/zone-event-log.js';
export type { DirectorZoneStateResource } from './director/zone/zone-state-resource.js';
export {
  RESOURCE_DIRECTOR_ZONE_STATE,
  createDirectorZoneStateResource,
  getOrCreateZoneStateMap,
  applyZoneStateChanges,
  replaceZoneStateFromSnapshot,
} from './director/zone/zone-state-resource.js';
export type { ZoneEventSystemOptions } from './director/zone/zone-event-system.js';
export { ZoneEventSystem } from './director/zone/zone-event-system.js';

// ===== Phase 17 audio - zone integration shell (Track C) =====
//
// Generic system that maps zone events to cue plays. Engine ships
// ZERO mappings; consumers register their own per spec sec.5.2.
// The system tolerates missing CueCatalog / MusicDirector resources
// (Track A + B may not be wired in every embedding) so it can be
// safely added to a world before the audio chain finishes booting.
export type {
  ZoneAudioMapping,
  ZoneCuePlay,
  ZoneAudioContext,
  ZoneAudioSystemOptions,
  PositionalPlayOptionsStub,
  AudioListenerPoseStub,
  AudioListenerResourceStub,
  CueCatalogStub,
  MusicDirectorStub,
} from './audio/zone-audio-system.js';
export {
  ZoneAudioSystem,
  RESOURCE_AUDIO_LISTENER_STUB,
  RESOURCE_CUE_CATALOG_STUB,
  RESOURCE_MUSIC_DIRECTOR_STUB,
} from './audio/zone-audio-system.js';

// ===== Phase 18 visual boss (Track A) =====
//
// LOOM-BOSS-RENDER-SPEC §3. Renderer-agnostic boss entity primitive +
// system that pumps it from Phase 16 zone events. Renderers (Three.js,
// Canvas2D, etc.) read ZoneBossEntityResource.byZone[zoneId] each frame
// without knowing about the underlying SSE protocol.
export type {
  ZoneBossEntity,
  ZoneBossEntityResource,
  ZoneBossHitRecord,
} from './director/zone/zone-boss-entity.js';
export {
  RESOURCE_ZONE_BOSS_ENTITY,
  RECENT_HITS_RING_SIZE,
  createZoneBossEntityResource,
  buildEntityFromSpawn,
  applyTick,
} from './director/zone/zone-boss-entity.js';
export { ZoneBossEntitySystem } from './director/zone/zone-boss-entity-system.js';

// Combat (Phase 7): health, damage, simple AI, attack. Engine-side
// primitives that the actual Survivor port will use. The full
// Survivor wave engine sits on top of these in subsequent sessions.
export {
  HealthPool,
  POOL_HEALTH,
  HEALTH_FLAG_ACTIVE,
  HEALTH_FLAG_DEAD,
  HEALTH_FLAG_INVULNERABLE,
} from './components/health.js';
export {
  PursuePool,
  POOL_PURSUE,
  PURSUE_FLAG_ACTIVE,
} from './components/pursue.js';
export type { KillEvent } from './systems/damage-system.js';
export {
  DamageSystem,
  DeathLog,
  RESOURCE_DEATH_LOG,
} from './systems/damage-system.js';
export { PursueSystem } from './systems/pursue-system.js';
export type { AttackSystemOptions } from './systems/attack-system.js';
export { AttackSystem } from './systems/attack-system.js';

// Combat (Phase 7 deeper port): ranged attacks + projectiles + mob
// catalog. The Survivor port can now spawn 3 archetypes
// (skel_warrior melee, skel_archer ranged, skel_caster homing) by
// calling spawnMob(world, type, x, y, target, atlas).
export type { ProjectileSpawn } from './vfx/projectile-pool.js';
export {
  ProjectilePool,
  POOL_PROJECTILE,
  PROJECTILE_FLAG_ALIVE,
  PROJECTILE_FLAG_HOMING,
  PROJECTILE_FLAG_PIERCE,
} from './vfx/projectile-pool.js';
export type { RangedAttackConfig } from './components/ranged-attack.js';
export {
  RangedAttackPool,
  POOL_RANGED,
  RANGED_FLAG_ACTIVE,
  RANGED_FLAG_HOMING,
} from './components/ranged-attack.js';
export { ProjectileSystem } from './systems/projectile-system.js';
export { RangedAttackSystem } from './systems/ranged-attack-system.js';
export { ProjectileRenderSystem } from './systems/projectile-render-system.js';
export type { MobArchetype, MobCatalogEntry } from './combat/mob-catalog.js';
export { MOB_CATALOG, spawnMob } from './combat/mob-catalog.js';

// Phase 8: Zone + interaction (ARPG hub-and-spoke).
export type {
  ZoneId,
  TransitionKind,
  ZoneStateResource,
} from './zone/zone-state.js';
export {
  createZoneState,
  beginTransition,
  tickTransition,
  isTransitioning,
  RESOURCE_ZONE_STATE,
} from './zone/zone-state.js';
export type {
  ZoneCatalogEntry,
  ZoneTilePalette,
} from './zone/zone-catalog.js';
export { ZONE_CATALOG } from './zone/zone-catalog.js';
export type {
  InteractableKind,
  InteractableConfig,
} from './components/interactable.js';
export {
  InteractablePool,
  POOL_INTERACTABLE,
  INTERACTABLE_FLAG_ACTIVE,
} from './components/interactable.js';
export type {
  LastInteractionResource,
  InteractionSystemOptions,
} from './systems/interaction-system.js';
export {
  InteractionSystem,
  createLastInteraction,
  RESOURCE_LAST_INTERACTION,
} from './systems/interaction-system.js';

// Multiplayer (Phase 15.1): pluggable presence transport, per-peer
// interpolation between known positions, simple peer rendering with
// name labels. Server-side wire protocol is shared with Track B in
// the LOOM-WEEK15 spec; the bridge layer hides transport details so
// consumers can swap SSE for WebSocket or WebRTC without touching
// the systems above it.
export type {
  IMultiplayerBridge,
  MultiplayerBridgeStatus,
  MultiplayerBridgeStats,
  PresenceMessage,
  PresenceUpdate,
  PresenceDepart,
  PresenceSnapshot,
} from './network/multiplayer-bridge.js';
export {
  RESOURCE_MULTIPLAYER_BRIDGE,
  RESOURCE_PEER_POOL,
  BROADCAST_HZ,
  BROADCAST_MIN_INTERVAL_MS,
} from './network/multiplayer-bridge.js';
export type { PeerEntry, RenderedPeerView } from './network/peer-pool.js';
export { PeerPool } from './network/peer-pool.js';
export type { MockMultiplayerBridgeOptions } from './network/mock-multiplayer-bridge.js';
export { MockMultiplayerBridge } from './network/mock-multiplayer-bridge.js';
export type { SSEMultiplayerBridgeOptions } from './network/sse-multiplayer-bridge.js';
export { SSEMultiplayerBridge } from './network/sse-multiplayer-bridge.js';
export type { PeerSpriteEntry, PeerSpritePoolOptions } from './components/peer-sprite.js';
export { PeerSpritePool, POOL_PEER_SPRITE } from './components/peer-sprite.js';
export {
  PeerPresenceSystem,
  PeerRenderSystem,
} from './systems/peer-presence-system.js';

// ===== Phase 0.19 client-side plugin SDK =====
//
// TypeScript companion of api/loom_ai_plugin_runtime.py. Lets Founders
// author client-side Loom plugins reacting to zone-events without
// forking the engine. Same names + semantics as the Python runtime
// where they apply on the client (no per-character v1 stream; no
// asyncio - Promise-based throughout).
//
// LOOM-DIRECTOR-PROTOCOL-V3 sec.3.1 explicitly reserves this slot.
// The registry routes window dispatched arpg:zone-* CustomEvents
// through every registered plugin's onZoneEvent hook, with optional
// narrow conveniences (onBossSpawn / onBossEnd / onLootDrop) and the
// full Phase 25 hardening surface (tick budgets, storage caps,
// scopes, ops counters, hot reload via dynamic import).
export type {
  IClientPlugin,
  PluginContext as ClientPluginContext,
  PluginStorage as ClientPluginStorage,
  PluginLogger as ClientPluginLogger,
  PluginOpsStats,
  PluginDescribeRow,
  PluginScope,
  IPluginEntropy,
  EmittedEvents as ClientEmittedEvents,
  PeerInfo as ClientPeerInfo,
  ClientPluginRegistryOptions,
} from './plugins/index.js';
export {
  ClientPluginRegistry,
  MapPluginStorage as ClientMapPluginStorage,
  ConsolePluginLogger as ClientConsolePluginLogger,
  PluginEntropy,
  PluginError,
  ALL_SCOPES as CLIENT_PLUGIN_SCOPES,
  DEFAULT_PLUGIN_STORAGE_MAX_BYTES as CLIENT_PLUGIN_DEFAULT_STORAGE_MAX_BYTES,
  DEFAULT_PLUGIN_TICK_BUDGET_MS as CLIENT_PLUGIN_DEFAULT_TICK_BUDGET_MS,
  setWithTtl as clientPluginSetWithTtl,
  getWithTtlCheck as clientPluginGetWithTtlCheck,
} from './plugins/index.js';
