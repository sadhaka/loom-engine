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
const DEFAULT_DURATION_MS = 500;
const DEFAULT_COLOR = 0x000000;
function defaultEasing(t) {
    return t;
}
export class ScreenFader {
    color;
    alpha;
    ramp = null;
    onFadeComplete;
    disposed = false;
    constructor(opts) {
        this.color = opts.initialColor !== undefined ? opts.initialColor : DEFAULT_COLOR;
        this.alpha = clamp01(opts.initialAlpha !== undefined ? opts.initialAlpha : 0);
        this.onFadeComplete = opts.onFadeComplete ?? null;
    }
    static create(opts = {}) {
        return new ScreenFader(opts);
    }
    // Fade to an arbitrary alpha (0..1) at a target color. Used by
    // fadeIn / fadeOut helpers below.
    fadeTo(opts) {
        if (this.disposed)
            return;
        var color = opts.color !== undefined ? opts.color : this.color;
        var target = clamp01(opts.targetAlpha !== undefined ? opts.targetAlpha : 1);
        // 0 = instant snap; positive = ramp; missing / NaN / negative
        // fall back to default (500ms).
        var dur;
        if (opts.durationMs !== undefined && isFinite(opts.durationMs)
            && opts.durationMs >= 0) {
            dur = opts.durationMs;
        }
        else {
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
    fadeIn(opts = {}) {
        var merged = {
            color: opts.color !== undefined ? opts.color : this.color,
            targetAlpha: 1,
        };
        if (opts.durationMs !== undefined)
            merged.durationMs = opts.durationMs;
        if (opts.easing)
            merged.easing = opts.easing;
        if (opts.data)
            merged.data = opts.data;
        this.fadeTo(merged);
    }
    // Fade OUT = from opaque to clear (alpha 0). The current color
    // is preserved unless overridden.
    fadeOut(opts = {}) {
        var merged = {
            color: opts.color !== undefined ? opts.color : this.color,
            targetAlpha: 0,
        };
        if (opts.durationMs !== undefined)
            merged.durationMs = opts.durationMs;
        if (opts.easing)
            merged.easing = opts.easing;
        if (opts.data)
            merged.data = opts.data;
        this.fadeTo(merged);
    }
    // Advance the active ramp by dtMs. Snaps to target on completion;
    // fires onFadeComplete exactly once per ramp.
    tick(dtMs) {
        if (this.disposed)
            return;
        if (!this.ramp)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
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
        if (!isFinite(eased))
            eased = t;
        if (eased < 0)
            eased = 0;
        if (eased > 1)
            eased = 1;
        this.alpha = r.startAlpha + (r.targetAlpha - r.startAlpha) * eased;
        // Color blend is linear; renderers wanting per-channel curves can
        // intercept getColor + their own time read.
        this.color = lerpColor(r.startColor, r.targetColor, eased);
    }
    // Snap to fully clear (alpha 0). Useful for skipping in-progress
    // fades on player input.
    clear() {
        if (this.disposed)
            return;
        this.alpha = 0;
        this.ramp = null;
    }
    // Snap to fully opaque at the current color.
    fillOpaque() {
        if (this.disposed)
            return;
        this.alpha = 1;
        this.ramp = null;
    }
    // Renderer reads each frame.
    getColor() { return this.color; }
    getAlpha() { return this.alpha; }
    isFading() { return this.ramp !== null; }
    setColor(color) {
        if (this.disposed)
            return;
        this.color = color;
    }
    setAlpha(alpha) {
        if (this.disposed)
            return;
        this.alpha = clamp01(alpha);
    }
    dispose() {
        this.ramp = null;
        this.onFadeComplete = null;
        this.disposed = true;
    }
    // ---------- private ----------
    fireComplete(opts) {
        if (!this.onFadeComplete)
            return;
        try {
            this.onFadeComplete(opts);
        }
        catch { /* ignore */ }
    }
}
function clamp01(v) {
    if (!isFinite(v))
        return 0;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
function lerpColor(a, b, t) {
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
//# sourceMappingURL=screen-fader.js.map