// VignetteRenderState - full-screen overlay tint primitive for
// low-HP / danger / status-effect states.
//
// 0.99.0 enabling primitive. Low-HP red pulse, poison green tint,
// berserker rage bloom, stunned grayscale, underwater blue - every
// game wants a full-screen colored overlay that tracks one or more
// active "vignette sources" and renders the dominant one per frame.
// VignetteRenderState owns that ledger.
//
//   var vig = VignetteRenderState.create({});
//   vig.upsert({
//     id: 'low_hp',
//     color: { r: 200, g: 30, b: 30 },
//     intensity: 0.7,        // 0..1 alpha
//     pulseHz: 1.5,          // 1.5 cycles/sec sine on intensity
//     pulseAmp: 0.25,        // +/- 25% modulation
//   });
//   on hp change:  vig.setIntensity('low_hp', hp < lowThreshold ? 0.7 : 0);
//   each frame:    vig.tick(dtMs);
//                  var s = vig.getState();
//                  if (s.active) renderer.drawOverlay(s.color, s.alpha);
//
// Pairs with HealthBar (0.80, per-entity HP), DamageFlash (0.93,
// per-entity hit tint), ScreenFader (0.91, full-screen black/white
// transitions). DamageFlash is per-entity; this is full-screen.
// ScreenFader is one-shot binary; this is sustained colored tint.
//
// Code style: var-only in browser source.
const DEFAULT_CAPACITY = 16;
const DEFAULT_MIN_INTENSITY = 0.001;
const TWO_PI = Math.PI * 2;
function clamp01(v) {
    if (!isFinite(v))
        return 0;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
function copyColor(c) {
    return {
        r: isFinite(c.r) ? c.r : 0,
        g: isFinite(c.g) ? c.g : 0,
        b: isFinite(c.b) ? c.b : 0,
    };
}
export class VignetteRenderState {
    sources = [];
    capacityNum;
    minIntensity;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
        this.minIntensity = opts.minIntensity !== undefined
            && isFinite(opts.minIntensity) && opts.minIntensity >= 0
            ? opts.minIntensity : DEFAULT_MIN_INTENSITY;
    }
    static create(opts = {}) {
        return new VignetteRenderState(opts);
    }
    // Add or update a vignette source. Returns true if accepted,
    // false if rejected (disposed, invalid id, capacity full and
    // not an existing id).
    upsert(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (!spec.color || typeof spec.color !== 'object')
            return false;
        var idx = this.indexOf(spec.id);
        if (idx < 0 && this.sources.length >= this.capacityNum) {
            return false;
        }
        var intensity = clamp01(spec.intensity);
        var pulseHz = spec.pulseHz !== undefined && isFinite(spec.pulseHz)
            && spec.pulseHz >= 0 ? spec.pulseHz : 0;
        var pulseAmp = spec.pulseAmp !== undefined ? clamp01(spec.pulseAmp) : 0;
        if (idx >= 0) {
            var existing = this.sources[idx];
            existing.color = copyColor(spec.color);
            existing.intensity = intensity;
            existing.pulseHz = pulseHz;
            existing.pulseAmp = pulseAmp;
            if (spec.data !== undefined)
                existing.data = spec.data;
            // pulsePhase preserved across updates so the pulse continues
            // smoothly when intensity rises again.
            this.recomputeEffective(existing);
            return true;
        }
        var src = {
            id: spec.id,
            color: copyColor(spec.color),
            intensity: intensity,
            pulseHz: pulseHz,
            pulseAmp: pulseAmp,
            pulsePhase: 0,
            effectiveIntensity: 0,
        };
        if (spec.data !== undefined)
            src.data = spec.data;
        this.recomputeEffective(src);
        this.sources.push(src);
        return true;
    }
    // Remove a source by id. Returns true if found.
    remove(id) {
        if (this.disposed)
            return false;
        var idx = this.indexOf(id);
        if (idx < 0)
            return false;
        this.sources.splice(idx, 1);
        return true;
    }
    // Update intensity for an existing source. Returns true if found.
    setIntensity(id, value) {
        if (this.disposed)
            return false;
        var idx = this.indexOf(id);
        if (idx < 0)
            return false;
        var src = this.sources[idx];
        src.intensity = clamp01(value);
        this.recomputeEffective(src);
        return true;
    }
    has(id) {
        return this.indexOf(id) >= 0;
    }
    count() { return this.sources.length; }
    capacity() { return this.capacityNum; }
    // Advance pulse phases. NaN / negative dt no-op.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var dtSec = dt / 1000;
        for (var i = 0; i < this.sources.length; i++) {
            var src = this.sources[i];
            if (src.pulseHz > 0 && src.pulseAmp > 0) {
                src.pulsePhase += TWO_PI * src.pulseHz * dtSec;
                // Keep phase bounded to avoid float drift over long runs.
                if (src.pulsePhase >= TWO_PI)
                    src.pulsePhase -= TWO_PI;
                if (src.pulsePhase < 0)
                    src.pulsePhase += TWO_PI;
            }
            this.recomputeEffective(src);
        }
    }
    // Composited render state: highest effective intensity wins.
    getState() {
        if (this.disposed || this.sources.length === 0) {
            return { active: false, color: { r: 0, g: 0, b: 0 }, alpha: 0, dominantId: '' };
        }
        var best = null;
        for (var i = 0; i < this.sources.length; i++) {
            var src = this.sources[i];
            if (src.effectiveIntensity < this.minIntensity)
                continue;
            if (best === null || src.effectiveIntensity > best.effectiveIntensity) {
                best = src;
            }
        }
        if (best === null) {
            return { active: false, color: { r: 0, g: 0, b: 0 }, alpha: 0, dominantId: '' };
        }
        return {
            active: true,
            color: copyColor(best.color),
            alpha: clamp01(best.effectiveIntensity),
            dominantId: best.id,
        };
    }
    forEach(cb) {
        if (this.disposed)
            return;
        for (var i = 0; i < this.sources.length; i++) {
            try {
                cb(this.snapshot(this.sources[i]));
            }
            catch { /* ignore */ }
        }
    }
    list() {
        var out = [];
        for (var i = 0; i < this.sources.length; i++) {
            out.push(this.snapshot(this.sources[i]));
        }
        return out;
    }
    clear() {
        if (this.disposed)
            return;
        this.sources.length = 0;
    }
    dispose() {
        this.sources.length = 0;
        this.disposed = true;
    }
    // ---------- private ----------
    indexOf(id) {
        if (typeof id !== 'string')
            return -1;
        for (var i = 0; i < this.sources.length; i++) {
            if (this.sources[i].id === id)
                return i;
        }
        return -1;
    }
    recomputeEffective(src) {
        if (src.pulseHz > 0 && src.pulseAmp > 0) {
            var modulation = 1 + src.pulseAmp * Math.sin(src.pulsePhase);
            src.effectiveIntensity = clamp01(src.intensity * modulation);
        }
        else {
            src.effectiveIntensity = src.intensity;
        }
    }
    snapshot(src) {
        var copy = {
            id: src.id,
            color: copyColor(src.color),
            intensity: src.intensity,
            pulseHz: src.pulseHz,
            pulseAmp: src.pulseAmp,
            pulsePhase: src.pulsePhase,
            effectiveIntensity: src.effectiveIntensity,
        };
        if (src.data !== undefined)
            copy.data = src.data;
        return copy;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_VIGNETTE_RENDER_STATE = 'vignette_render_state';
//# sourceMappingURL=vignette-render-state.js.map