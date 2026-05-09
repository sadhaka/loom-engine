// ScreenFader - render-state primitive for fade-to-color overlays.
//
// 0.91.0 enabling primitive. Scene transitions, hit reactions,
// dramatic narrative beats, and tutorial tutorial-blackouts all
// share the same shape: an alpha-animated full-screen color
// overlay with a configurable color, duration, and easing. The
// renderer reads `getColor()` + `getAlpha()` each frame and draws
// a fullscreen rect; consumers fire `fadeTo()` / `fadeOut()` from
// gameplay code without touching the renderer.
//
//   var fader = ScreenFader.create({
//     onFadeComplete: (preset) => sceneManager.activate(preset.next),
//   });
//   fader.fadeTo({ color: 0x000000, durationMs: 800 });
//   each frame: fader.tick(dtMs); render(fader.getColor(), fader.getAlpha());
//
// Pairs with SceneManager (0.56) for scene transitions, EngineClock
// (0.25) for the dt source, and Easings (0.40) for curve options.
//
// Code style: var-only in browser source.

export type FadeDirection = 'in' | 'out' | 'to';

export interface ScreenFaderFadeOptions {
  // 0xRRGGBB target color. Default 0x000000 (black).
  color?: number;
  // Duration of the alpha ramp in ms. Default 500.
  durationMs?: number;
  // Target alpha [0, 1]. Default depends on fade direction.
  targetAlpha?: number;
  // Easing function returning [0, 1] given t in [0, 1]. Default
  // linear.
  easing?: (t: number) => number;
  // Optional metadata pass-through to onFadeComplete (e.g. scene id
  // for the renderer to swap to mid-fade).
  data?: Record<string, unknown>;
}

export interface ScreenFaderOptions {
  // Initial color (0xRRGGBB). Default 0x000000.
  initialColor?: number;
  // Initial alpha [0, 1]. Default 0 (transparent).
  initialAlpha?: number;
  // Fired when a fade reaches its target alpha. The arg carries
  // the spawn options so callers can chain (e.g. fade out after fade
  // in completes).
  onFadeComplete?: (opts: ScreenFaderFadeOptions) => void;
}

interface RampInternal {
  startAlpha: number;
  targetAlpha: number;
  startColor: number;
  targetColor: number;
  durationMs: number;
  elapsedMs: number;
  easing: (t: number) => number;
  data: Record<string, unknown> | null;
}

const DEFAULT_DURATION_MS = 500;
const DEFAULT_COLOR = 0x000000;

function defaultEasing(t: number): number {
  return t;
}

export class ScreenFader {
  private color: number;
  private alpha: number;
  private ramp: RampInternal | null = null;
  private onFadeComplete: ((opts: ScreenFaderFadeOptions) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: ScreenFaderOptions) {
    this.color = opts.initialColor !== undefined ? opts.initialColor : DEFAULT_COLOR;
    this.alpha = clamp01(opts.initialAlpha !== undefined ? opts.initialAlpha : 0);
    this.onFadeComplete = opts.onFadeComplete ?? null;
  }

  static create(opts: ScreenFaderOptions = {}): ScreenFader {
    return new ScreenFader(opts);
  }

  // Fade to an arbitrary alpha (0..1) at a target color. Used by
  // fadeIn / fadeOut helpers below.
  fadeTo(opts: ScreenFaderFadeOptions): void {
    if (this.disposed) return;
    var color = opts.color !== undefined ? opts.color : this.color;
    var target = clamp01(opts.targetAlpha !== undefined ? opts.targetAlpha : 1);
    // 0 = instant snap; positive = ramp; missing / NaN / negative
    // fall back to default (500ms).
    var dur: number;
    if (opts.durationMs !== undefined && isFinite(opts.durationMs)
        && opts.durationMs >= 0) {
      dur = opts.durationMs;
    } else {
      dur = DEFAULT_DURATION_MS;
    }
    var easing = opts.easing ?? defaultEasing;
    if (dur === 0) {
      this.color = color;
      this.alpha = target;
      this.ramp = null;
      this.fireComplete(opts);
      return;
    }
    this.ramp = {
      startAlpha: this.alpha,
      targetAlpha: target,
      startColor: this.color,
      targetColor: color,
      durationMs: dur,
      elapsedMs: 0,
      easing: easing,
      data: opts.data ? { ...opts.data } : null,
    };
  }

  // Fade IN = from clear (alpha 0) to opaque (alpha 1). Default
  // black; consumers override color for non-black fade-ins.
  fadeIn(opts: Partial<ScreenFaderFadeOptions> = {}): void {
    var merged: ScreenFaderFadeOptions = {
      color: opts.color !== undefined ? opts.color : this.color,
      targetAlpha: 1,
    };
    if (opts.durationMs !== undefined) merged.durationMs = opts.durationMs;
    if (opts.easing) merged.easing = opts.easing;
    if (opts.data) merged.data = opts.data;
    this.fadeTo(merged);
  }

  // Fade OUT = from opaque to clear (alpha 0). The current color
  // is preserved unless overridden.
  fadeOut(opts: Partial<ScreenFaderFadeOptions> = {}): void {
    var merged: ScreenFaderFadeOptions = {
      color: opts.color !== undefined ? opts.color : this.color,
      targetAlpha: 0,
    };
    if (opts.durationMs !== undefined) merged.durationMs = opts.durationMs;
    if (opts.easing) merged.easing = opts.easing;
    if (opts.data) merged.data = opts.data;
    this.fadeTo(merged);
  }

  // Advance the active ramp by dtMs. Snaps to target on completion;
  // fires onFadeComplete exactly once per ramp.
  tick(dtMs: number): void {
    if (this.disposed) return;
    if (!this.ramp) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var r = this.ramp;
    r.elapsedMs += dt;
    if (r.elapsedMs >= r.durationMs) {
      this.alpha = r.targetAlpha;
      this.color = r.targetColor;
      var data = r.data;
      this.ramp = null;
      this.fireComplete(data ? { color: r.targetColor, data: data,
                                 targetAlpha: r.targetAlpha,
                                 durationMs: r.durationMs }
                       : { color: r.targetColor,
                           targetAlpha: r.targetAlpha,
                           durationMs: r.durationMs });
      return;
    }
    var t = r.elapsedMs / r.durationMs;
    var eased = r.easing(t);
    if (!isFinite(eased)) eased = t;
    if (eased < 0) eased = 0;
    if (eased > 1) eased = 1;
    this.alpha = r.startAlpha + (r.targetAlpha - r.startAlpha) * eased;
    // Color blend is linear; renderers wanting per-channel curves can
    // intercept getColor + their own time read.
    this.color = lerpColor(r.startColor, r.targetColor, eased);
  }

  // Snap to fully clear (alpha 0). Useful for skipping in-progress
  // fades on player input.
  clear(): void {
    if (this.disposed) return;
    this.alpha = 0;
    this.ramp = null;
  }

  // Snap to fully opaque at the current color.
  fillOpaque(): void {
    if (this.disposed) return;
    this.alpha = 1;
    this.ramp = null;
  }

  // Renderer reads each frame.
  getColor(): number { return this.color; }
  getAlpha(): number { return this.alpha; }
  isFading(): boolean { return this.ramp !== null; }

  setColor(color: number): void {
    if (this.disposed) return;
    this.color = color;
  }

  setAlpha(alpha: number): void {
    if (this.disposed) return;
    this.alpha = clamp01(alpha);
  }

  dispose(): void {
    this.ramp = null;
    this.onFadeComplete = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private fireComplete(opts: ScreenFaderFadeOptions): void {
    if (!this.onFadeComplete) return;
    try { this.onFadeComplete(opts); } catch { /* ignore */ }
  }
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerpColor(a: number, b: number, t: number): number {
  var ar = (a >> 16) & 0xff;
  var ag = (a >> 8) & 0xff;
  var ab = a & 0xff;
  var br = (b >> 16) & 0xff;
  var bg = (b >> 8) & 0xff;
  var bb = b & 0xff;
  var r = Math.round(ar + (br - ar) * t);
  var g = Math.round(ag + (bg - ag) * t);
  var bl = Math.round(ab + (bb - ab) * t);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (bl & 0xff);
}

// Resource key for the world's resource registry.
export const RESOURCE_SCREEN_FADER = 'screen_fader';
