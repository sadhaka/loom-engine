// Camera for the Loom Engine.
//
// 2D camera with optional zoom + rotation. Iso projection happens
// in iso-projection.ts; this camera produces the screen-space view
// rect that systems use for frustum culling.

import type { Rect } from '../util/math.js';

export interface CameraView {
  // World-space center the camera looks at.
  centerX: number;
  centerY: number;
  // Pixels per world unit. 1.0 = no zoom.
  zoom: number;
  // Rotation in radians. 0 for now; engine ships axis-aligned in v1.
  rotation: number;
  // Viewport dimensions in screen pixels.
  viewportWidth: number;
  viewportHeight: number;
}

export function createCamera(viewportWidth: number, viewportHeight: number): CameraView {
  return {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    rotation: 0,
    viewportWidth,
    viewportHeight,
  };
}

// World-space rect that the camera currently sees. Used for frustum
// culling. Rotation is ignored in v1 (engine ships axis-aligned).
export function getCameraViewRect(cam: CameraView, out: Rect): Rect {
  const halfW = cam.viewportWidth / cam.zoom / 2;
  const halfH = cam.viewportHeight / cam.zoom / 2;
  out.x = cam.centerX - halfW;
  out.y = cam.centerY - halfH;
  out.width = halfW * 2;
  out.height = halfH * 2;
  return out;
}

// World-space coords -> screen-space coords. Iso transform happens
// before this; this is the pure camera transform.
export function worldToScreen(
  cam: CameraView,
  worldX: number,
  worldY: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  out.x = (worldX - cam.centerX) * cam.zoom + cam.viewportWidth / 2;
  out.y = (worldY - cam.centerY) * cam.zoom + cam.viewportHeight / 2;
  return out;
}

export function screenToWorld(
  cam: CameraView,
  screenX: number,
  screenY: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  out.x = (screenX - cam.viewportWidth / 2) / cam.zoom + cam.centerX;
  out.y = (screenY - cam.viewportHeight / 2) / cam.zoom + cam.centerY;
  return out;
}
