// Loom Engine - public entry point.
//
// Phase 2 adds the ECS layer: World, System scheduler, Resources,
// SpritePool, SpriteRenderSystem, and the high-level Engine facade
// that wires everything together with sane defaults.

export const LOOM_ENGINE_VERSION = '0.7.0-phase7';

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
export type { TimeResource, VeilBudgetResource } from './resources.js';
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
export { Engine } from './engine.js';
export type { EngineOptions } from './engine.js';

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
export type { KnotPaletteRgba } from './director/knot-context-resource.js';
export { KnotContextResource } from './director/knot-context-resource.js';
export type { DirectorEventLog } from './director/director-system.js';
export {
  DirectorSystem,
  RESOURCE_DIRECTOR_LOG,
  createDirectorEventLog,
} from './director/director-system.js';

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
