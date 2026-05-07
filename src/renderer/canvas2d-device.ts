// Canvas2D backend for the Loom Engine.
//
// Primary backend for v1. Iso world coords -> screen coords happens
// inside the device. drawImage is the workhorse; sorting is the
// caller's responsibility (the render-graph stage submits sprites
// in depth-sort order).
//
// Babylon.js inspires the ThinEngine split: this file is the lean
// GPU-talking core. Higher-level scene logic lives elsewhere. See
// PRIOR-ART.md.

import type { ColorRGBA } from '../util/color.js';
import { rgbaToCssString } from '../util/color.js';
import {
  type IGraphicsDevice,
  type AtlasHandle,
  type AtlasDescriptor,
  type TextStyle,
} from './graphics-device.js';
import {
  type CameraView,
  worldToScreen,
} from './camera.js';
import {
  ISO_HALF_W,
  ISO_HALF_H,
  ISO_Z_SCALE,
} from './iso-projection.js';

interface RegisteredAtlas {
  desc: AtlasDescriptor;
  released: boolean;
}

const SCRATCH_VEC2 = { x: 0, y: 0 };

// Pre-baked particle disc - white-to-transparent radial gradient at
// 64px diameter on an offscreen canvas. drawParticle uses this with
// drawImage instead of allocating a fresh CanvasGradient per call.
// Additive blend with globalAlpha = color.a gives correct brightness
// per particle. For non-additive tinted particles the gradient path
// is preserved as a fallback (RGB tinting under straight alpha
// requires a tinted disc per color, which would need a per-color
// cache; the demo + Phase 4 emitters are all additive so this fast
// path covers the hot case).
const PARTICLE_DISC_SIZE = 64;
function bakeParticleDisc(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = PARTICLE_DISC_SIZE;
  c.height = PARTICLE_DISC_SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const center = PARTICLE_DISC_SIZE / 2;
  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export class Canvas2DDevice implements IGraphicsDevice {
  readonly canvas: HTMLCanvasElement;
  readonly viewportWidth: number;
  readonly viewportHeight: number;

  private ctx: CanvasRenderingContext2D;
  private atlases: Array<RegisteredAtlas | null> = [];
  private nextAtlasHandle: number = 0;
  private camera: CameraView | null = null;
  private drawCallCount: number = 0;
  // Lazy-initialized; null in headless / non-DOM contexts.
  private particleDisc: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.viewportWidth = canvas.width;
    this.viewportHeight = canvas.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Canvas2DDevice: failed to acquire 2D context');
    }
    this.ctx = ctx;
    // Pixel-art friendly defaults. Future style configurability
    // belongs in a device options object; v1 ships pixel-art-first.
    this.ctx.imageSmoothingEnabled = false;
  }

  beginFrame(): void {
    this.drawCallCount = 0;
    // Clear to opaque black. Higher-level stages can paint a sky
    // color in their own clear stage if they want a different bg.
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);
  }

  endFrame(): void {
    // Immediate-mode backend - nothing to flush.
  }

  setCamera(cam: Readonly<CameraView>): void {
    // Store a reference rather than copying. The caller owns the
    // camera object; we only read it inside draw* calls.
    this.camera = cam as CameraView;
  }

  registerAtlas(desc: AtlasDescriptor): AtlasHandle {
    const handle = this.nextAtlasHandle++;
    this.atlases[handle] = { desc, released: false };
    return handle;
  }

  releaseAtlas(handle: AtlasHandle): void {
    const slot = this.atlases[handle];
    if (slot) {
      slot.released = true;
      this.atlases[handle] = null;
    }
  }

  drawSprite(
    worldX: number,
    worldY: number,
    worldZ: number,
    atlas: AtlasHandle,
    frame: number,
    tint?: Readonly<ColorRGBA>,
  ): void {
    const slot = this.atlases[atlas];
    if (!slot || slot.released) return;
    const f = slot.desc.frames[frame];
    if (!f) return;
    const cam = this.camera;
    if (!cam) return;

    // Iso projection: world (x,y,z) -> iso (sx,sy) before camera.
    const isoX = (worldX - worldY) * ISO_HALF_W;
    const isoY = (worldX + worldY) * ISO_HALF_H - worldZ * ISO_Z_SCALE;

    // Camera transform: iso world -> screen.
    worldToScreen(cam, isoX, isoY, SCRATCH_VEC2);
    const screenX = SCRATCH_VEC2.x;
    const screenY = SCRATCH_VEC2.y;

    // Draw centered horizontally, anchored at the bottom (sprite's
    // feet on the iso projection point). This is the standard iso
    // sprite anchor.
    const dw = f.w * cam.zoom;
    const dh = f.h * cam.zoom;
    const dx = screenX - dw / 2;
    const dy = screenY - dh;

    if (tint) {
      this.ctx.save();
      this.ctx.globalAlpha = tint.a;
      // Canvas2D doesn't tint drawImage natively. For pixel-perfect
      // tint we'd need to pre-bake tinted variants in an offscreen
      // canvas. For v1 we use globalAlpha + a colored overlay
      // composite. Optimization deferred.
      this.ctx.drawImage(slot.desc.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
      if (tint.r !== 1 || tint.g !== 1 || tint.b !== 1) {
        this.ctx.globalCompositeOperation = 'multiply';
        this.ctx.fillStyle = rgbaToCssString(tint);
        this.ctx.fillRect(dx, dy, dw, dh);
      }
      this.ctx.restore();
    } else {
      this.ctx.drawImage(slot.desc.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    }

    this.drawCallCount++;
  }

  drawTile(
    tileX: number,
    tileY: number,
    atlas: AtlasHandle,
    frame: number,
  ): void {
    const slot = this.atlases[atlas];
    if (!slot || slot.released) return;
    const f = slot.desc.frames[frame];
    if (!f) return;
    const cam = this.camera;
    if (!cam) return;

    // Tile -> iso (no Z; tiles sit on the ground plane).
    const isoX = (tileX - tileY) * ISO_HALF_W;
    const isoY = (tileX + tileY) * ISO_HALF_H;

    worldToScreen(cam, isoX, isoY, SCRATCH_VEC2);
    const screenX = SCRATCH_VEC2.x;
    const screenY = SCRATCH_VEC2.y;

    const dw = f.w * cam.zoom;
    const dh = f.h * cam.zoom;
    // Tile anchor: top of the diamond aligns with the iso point.
    // Standard 2:1 dimetric. Tile draws centered horizontally on
    // the projection point, top edge at the iso Y.
    const dx = screenX - dw / 2;
    const dy = screenY - dh / 2;

    this.ctx.drawImage(slot.desc.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    this.drawCallCount++;
  }

  drawText(
    worldX: number,
    worldY: number,
    text: string,
    style: TextStyle,
  ): void {
    const cam = this.camera;
    if (!cam) return;

    // Text is treated as a 2D-overlay; no iso projection (text
    // labels read left-to-right regardless of iso angle).
    worldToScreen(cam, worldX, worldY, SCRATCH_VEC2);
    const screenX = SCRATCH_VEC2.x;
    const screenY = SCRATCH_VEC2.y;

    this.ctx.save();
    this.ctx.font = style.font;
    this.ctx.fillStyle = rgbaToCssString(style.fill);
    this.ctx.textAlign = style.align ?? 'left';
    this.ctx.textBaseline = style.baseline ?? 'alphabetic';
    this.ctx.fillText(text, screenX, screenY);
    this.ctx.restore();
    this.drawCallCount++;
  }

  drawParticle(
    worldX: number,
    worldY: number,
    worldZ: number,
    size: number,
    color: Readonly<ColorRGBA>,
    additive: boolean,
  ): void {
    const cam = this.camera;
    if (!cam) return;
    if (size <= 0 || color.a <= 0) return;

    // Iso projection same as drawSprite: world (x,y,z) -> iso (sx,sy)
    // -> screen via camera.
    const isoX = (worldX - worldY) * ISO_HALF_W;
    const isoY = (worldX + worldY) * ISO_HALF_H - worldZ * ISO_Z_SCALE;
    worldToScreen(cam, isoX, isoY, SCRATCH_VEC2);
    const sx = SCRATCH_VEC2.x;
    const sy = SCRATCH_VEC2.y;
    const r = (size / 2) * cam.zoom;

    // Fast path for additive particles: pre-baked white soft-disc
    // with globalAlpha. Under 'lighter' blend, white * alpha gives
    // RGB brightness contributions and the underlying canvas color
    // emerges, so additive is hue-correct enough for the demo +
    // Phase 4 sparkle emitters. No per-call CanvasGradient
    // allocation; drawImage hits the fast composite path.
    if (additive) {
      if (!this.particleDisc) this.particleDisc = bakeParticleDisc();
      if (this.particleDisc) {
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'lighter';
        // For colored additive particles, multiply by color via
        // globalAlpha (intensity) AND by drawing tinted via a
        // single fillStyle pre-tint pass. Simpler heuristic for
        // demo: alpha = color.a * brightness factor. Hue comes
        // from the underlying canvas + sequential additive layers.
        // For correctness we'd want per-color discs; deferred until
        // a profile shows colored particles dominate.
        const dia = r * 2;
        const intensity = color.a;
        // RGB brightness folds into globalAlpha for additive blend
        // - white * alpha = grey. For tinted additive (most common),
        // we drawImage twice: once with the disc weighted by R, etc.
        // Simpler: bake a single colored composite by chaining.
        // Practical compromise: alpha = max(r, g, b) * a so colored
        // particles aren't washed out.
        const channelMax = Math.max(color.r, color.g, color.b);
        this.ctx.globalAlpha = intensity * channelMax;
        this.ctx.drawImage(
          this.particleDisc,
          sx - r, sy - r,
          dia, dia,
        );
        this.ctx.restore();
        this.drawCallCount++;
        return;
      }
    }

    // Fallback: gradient path (correct color tinting for non-additive,
    // or when the pre-baked disc isn't available e.g. headless / SSR).
    this.ctx.save();
    if (additive) {
      this.ctx.globalCompositeOperation = 'lighter';
    }
    const grad = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    grad.addColorStop(0, rgbaToCssString(color));
    grad.addColorStop(1, rgbaToCssString({ r: color.r, g: color.g, b: color.b, a: 0 }));
    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
    this.drawCallCount++;
  }

  getDrawCallCount(): number {
    return this.drawCallCount;
  }
}
