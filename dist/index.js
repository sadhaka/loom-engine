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
export const LOOM_ENGINE_VERSION = '0.15.0';
export { vec2, vec3, rect, clamp, lerp, smoothstep, approxEq, rectContains, rectIntersects, visibleInView, } from './util/math.js';
export { rgba, hexToRgba, rgbaToHexString, rgbaToCssString, colorLerp, COLOR_WHITE, COLOR_BLACK, COLOR_TRANSPARENT, COLOR_KNOT_STR, COLOR_KNOT_DEX, COLOR_KNOT_INT, COLOR_KNOT_CENTER, } from './util/color.js';
export { EntityAllocator, NULL_ENTITY, entityIndex, entityGeneration, makeEntity, } from './entity.js';
export { TransformPool, TRANSFORM_FLAG_DIRTY, TRANSFORM_FLAG_VISIBLE, TRANSFORM_FLAG_STATIC, TRANSFORM_FLAG_HAS_PARENT, } from './components/transform.js';
export { SpritePool, SPRITE_FLAG_ACTIVE, SPRITE_FLAG_TINTED, } from './components/sprite.js';
// ECS core
export { World, POOL_TRANSFORM, POOL_SPRITE } from './world.js';
export { SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, SYSTEM_PHASE_PHYSICS, SYSTEM_PHASE_ANIMATION, SYSTEM_PHASE_RENDER, SYSTEM_PHASE_POST_RENDER, SYSTEM_PHASES_IN_ORDER, } from './system.js';
export { ResourceRegistry, createTimeResource, createVeilBudgetResource, RESOURCE_TIME, RESOURCE_CAMERA, RESOURCE_DEVICE, RESOURCE_VEIL_BUDGET, } from './resources.js';
// Default systems
export { SpriteRenderSystem } from './systems/sprite-render-system.js';
// Engine facade
export { Engine, registerBackend, isBackendRegistered } from './engine.js';
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
//# sourceMappingURL=index.js.map