// Loom Engine - public entry point.
//
// Phase 1 surface: types, math, transform pool, Canvas2D device,
// iso projection. No high-level Engine class yet; consumers wire
// the device + camera + transform pool together themselves until
// Phase 2 (ECS World) lands.

export const LOOM_ENGINE_VERSION = '0.1.0-phase1';

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

// Renderer
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
