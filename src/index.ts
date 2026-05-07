// Loom Engine - public entry point.
//
// Phase 2 adds the ECS layer: World, System scheduler, Resources,
// SpritePool, SpriteRenderSystem, and the high-level Engine facade
// that wires everything together with sane defaults.

export const LOOM_ENGINE_VERSION = '0.2.0-phase2';

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
export type { TimeResource } from './resources.js';
export {
  ResourceRegistry,
  createTimeResource,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
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
