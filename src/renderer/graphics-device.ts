// Graphics device abstraction for the Loom Engine.
//
// All higher-level systems talk to IGraphicsDevice, never to the
// concrete backend. This is the Babylon.js ThinEngine split: lean
// GPU core (the device) + higher-level scene logic (everything
// else). See PRIOR-ART.md for the citation.
//
// Two backends ship over time:
//   Canvas2DDevice  - v1 primary, Phase 1
//   WebGL2Device    - Phase 2 if profiling demands

import type { ColorRGBA } from '../util/color.js';
import type { CameraView } from './camera.js';

// Opaque handle to an atlas registered with the device. The handle
// is just an integer; the device maps it to the underlying image /
// texture / buffer. Higher-level code never touches the underlying
// resource.
export type AtlasHandle = number;

// Atlas registration: an image + a list of frame rects within it.
export interface AtlasDescriptor {
  // The source image. Engine does not load images; caller does.
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  // Frames keyed by index (0..N). Each frame is an integer rect in
  // the source image's pixel space.
  frames: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
  // Optional debug name surfaced in profiling tools.
  name?: string;
}

// Optional text style for drawText. Engine renders plain text only;
// rich text and IME composition are not in scope.
export interface TextStyle {
  font: string;            // CSS font shorthand, e.g. "12px sans-serif"
  fill: ColorRGBA;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
}

// The frame sandwich. beginFrame clears + sets the camera; endFrame
// flushes any pending batch and presents.
export interface IGraphicsDevice {
  readonly canvas: HTMLCanvasElement;
  readonly viewportWidth: number;
  readonly viewportHeight: number;

  // Frame lifecycle.
  beginFrame(): void;
  endFrame(): void;

  // Camera. The device applies the transform internally; higher
  // layers pass world-space coords to draw* methods.
  setCamera(cam: Readonly<CameraView>): void;

  // Asset registration. Returns an opaque handle to use in draw*.
  registerAtlas(desc: AtlasDescriptor): AtlasHandle;
  releaseAtlas(handle: AtlasHandle): void;

  // Draw calls. Coordinates are world-space; the device handles
  // camera transform + iso projection + sorting at the device layer
  // is not the device's responsibility (the render-graph stage
  // handles sort order; the device just blits in submitted order).
  drawSprite(
    worldX: number,
    worldY: number,
    worldZ: number,
    atlas: AtlasHandle,
    frame: number,
    tint?: Readonly<ColorRGBA>,
  ): void;

  drawTile(
    tileX: number,
    tileY: number,
    atlas: AtlasHandle,
    frame: number,
  ): void;

  drawText(
    worldX: number,
    worldY: number,
    text: string,
    style: TextStyle,
  ): void;

  // VFX particle. Drawn as an iso-projected disc at (worldX, worldY,
  // worldZ) with the given pixel size and rgba color. additive=true
  // uses 'lighter' compositing for glow; false uses standard alpha
  // blend. Texturing for particles is a Phase 5+ extension; v1
  // particles are code-painted gradient discs.
  drawParticle(
    worldX: number,
    worldY: number,
    worldZ: number,
    size: number,
    color: Readonly<ColorRGBA>,
    additive: boolean,
  ): void;

  // Diagnostic. Returns the count of draw calls submitted this frame.
  // Reset on beginFrame.
  getDrawCallCount(): number;
}

// Backend identifier. Useful in logging and conditional code paths.
export type DeviceBackend = 'canvas2d' | 'webgl2';
