// AmbientLayerMixer - cross-faded ambient music layer mixer.
//
// 1.4.0 enabling primitive (Wave 1.4 audio cinematic depth opens).
// MusicPlaylist (0.95) is a track sequencer (one ambient track at
// a time). AmbientLayerMixer is what plays UNDER the music: layered
// ambient stems (rain, wind, crickets, distant battle) that fade
// in / out independently as zone or context changes. Each layer
// has a target volume; the mixer lerps current volumes toward
// targets per frame, producing a per-tick volume snapshot the
// audio system applies to its stems.
//
//   var mix = AmbientLayerMixer.create();
//   mix.registerLayer({ id: 'rain',     volume: 0 });
//   mix.registerLayer({ id: 'wind',     volume: 0.3 });
//   mix.registerLayer({ id: 'crickets', volume: 0 });
//
//   on entering forest: mix.setTarget('crickets', 0.6);
//   on rain start:      mix.setTarget('rain', 0.8);
//   on rain stop:       mix.setTarget('rain', 0, { fadeMs: 8000 });
//
//   each frame:
//     mix.tick(dtMs);
//     mix.forEach((layer) => audioBus.setStemVolume(layer.id, layer.volume));
//
// Pairs with MusicPlaylist (0.95, music tracks above the ambient
// bed), AudioCueQueue (0.94, one-shot SFX), AudioBus (the
// ultimate consumer), AudioDuck (1.4.1 next, ducks ambient when
// SFX fires).
//
// Engine ships zero audio: consumer reads the volume snapshot per
// frame and routes to whatever audio system they have.
//
// Code style: var-only in browser source.
function defaultClamp(v) {
    if (!isFinite(v))
        return 0;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
const DEFAULT_FADE_MS = 1000;
export class AmbientLayerMixer {
    layers = new Map();
    volumeClamp;
    disposed = false;
    constructor(opts) {
        this.volumeClamp = typeof opts.volumeClamp === 'function'
            ? opts.volumeClamp : defaultClamp;
    }
    static create(opts = {}) {
        return new AmbientLayerMixer(opts);
    }
    registerLayer(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        var initial = this.volumeClamp(spec.volume !== undefined && isFinite(spec.volume) ? spec.volume : 0);
        var target = this.volumeClamp(spec.target !== undefined && isFinite(spec.target) ? spec.target : initial);
        var defaultFade = spec.defaultFadeMs !== undefined
            && isFinite(spec.defaultFadeMs) && spec.defaultFadeMs >= 0
            ? spec.defaultFadeMs : DEFAULT_FADE_MS;
        var layer = {
            id: spec.id,
            volume: initial,
            target: target,
            fadeStartVolume: initial,
            fadeRemainingMs: 0,
            fadeTotalMs: 0,
            defaultFadeMs: defaultFade,
        };
        if (spec.data !== undefined)
            layer.data = spec.data;
        this.layers.set(spec.id, layer);
        return true;
    }
    removeLayer(id) {
        if (this.disposed)
            return false;
        return this.layers.delete(id);
    }
    hasLayer(id) {
        return this.layers.has(id);
    }
    getLayer(id) {
        var l = this.layers.get(id);
        return l ? this.snapshot(l) : null;
    }
    layerCount() { return this.layers.size; }
    layerIds() {
        var out = [];
        var keys = this.layers.keys();
        var k = keys.next();
        while (!k.done) {
            out.push(k.value);
            k = keys.next();
        }
        return out;
    }
    // Set a layer's target volume; lerp current -> target over fadeMs.
    // Returns true if the layer exists.
    setTarget(id, target, opts = {}) {
        if (this.disposed)
            return false;
        var l = this.layers.get(id);
        if (!l)
            return false;
        if (!isFinite(target))
            return false;
        var clampedTarget = this.volumeClamp(target);
        var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs) && opts.fadeMs >= 0
            ? opts.fadeMs : l.defaultFadeMs;
        if (clampedTarget === l.volume || fade <= 0) {
            l.volume = clampedTarget;
            l.target = clampedTarget;
            l.fadeStartVolume = clampedTarget;
            l.fadeRemainingMs = 0;
            l.fadeTotalMs = 0;
            return true;
        }
        l.target = clampedTarget;
        l.fadeStartVolume = l.volume;
        l.fadeRemainingMs = fade;
        l.fadeTotalMs = fade;
        return true;
    }
    // Set all layers' targets simultaneously (batch fade). Layers
    // not in `targets` are unchanged.
    setTargets(targets, opts = {}) {
        if (this.disposed)
            return;
        var keys = Object.keys(targets);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            this.setTarget(k, targets[k], opts);
        }
    }
    // Snap a layer to a volume immediately (no fade). Returns true
    // if found.
    snap(id, volume) {
        return this.setTarget(id, volume, { fadeMs: 0 });
    }
    // Snap every layer to silence (no fade).
    silenceAll() {
        if (this.disposed)
            return;
        var iter = this.layers.values();
        var v = iter.next();
        while (!v.done) {
            var l = v.value;
            l.volume = 0;
            l.target = 0;
            l.fadeStartVolume = 0;
            l.fadeRemainingMs = 0;
            l.fadeTotalMs = 0;
            v = iter.next();
        }
    }
    // Tick advances active fades.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var iter = this.layers.values();
        var v = iter.next();
        while (!v.done) {
            var l = v.value;
            if (l.fadeRemainingMs > 0) {
                l.fadeRemainingMs -= dt;
                if (l.fadeRemainingMs <= 0) {
                    l.volume = l.target;
                    l.fadeRemainingMs = 0;
                    l.fadeTotalMs = 0;
                    l.fadeStartVolume = l.target;
                }
                else {
                    // Lerp current = fadeStart + (target - fadeStart) * t
                    // where t = (fadeTotalMs - fadeRemainingMs) / fadeTotalMs.
                    var t = (l.fadeTotalMs - l.fadeRemainingMs) / l.fadeTotalMs;
                    l.volume = this.volumeClamp(l.fadeStartVolume + (l.target - l.fadeStartVolume) * t);
                }
            }
            v = iter.next();
        }
    }
    forEach(cb) {
        if (this.disposed)
            return;
        var iter = this.layers.values();
        var v = iter.next();
        while (!v.done) {
            try {
                cb(this.snapshot(v.value));
            }
            catch { /* ignore */ }
            v = iter.next();
        }
    }
    list() {
        var out = [];
        var iter = this.layers.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.snapshot(v.value));
            v = iter.next();
        }
        return out;
    }
    clear() {
        if (this.disposed)
            return;
        this.layers.clear();
    }
    dispose() {
        this.layers.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    snapshot(l) {
        var out = {
            id: l.id,
            volume: l.volume,
            target: l.target,
            fadeRemainingMs: l.fadeRemainingMs,
        };
        if (l.data !== undefined)
            out.data = l.data;
        return out;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_AMBIENT_LAYER_MIXER = 'ambient_layer_mixer';
//# sourceMappingURL=ambient-layer-mixer.js.map