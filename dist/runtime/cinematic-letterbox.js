// CinematicLetterbox - cutscene framing bars with smooth open/close.
//
// 1.4.4 enabling primitive (Wave 1.4 audio cinematic depth).
// Standard movie-style framing for cutscenes / dialogue / boss
// reveals: black bars slide in from top + bottom to crop the
// frame, then slide out when the moment ends. Engine ships zero
// render path - the consumer reads the bar height percentage per
// frame and draws the bars in whatever style fits.
//
//   var lb = CinematicLetterbox.create({
//     defaultBarPct: 0.12,    // bars cover 12% top + 12% bottom
//     defaultFadeMs: 600,
//   });
//
//   on cutscene start: lb.close();
//   on cutscene end:   lb.open();
//
//   each frame:
//     lb.tick(dtMs);
//     var s = lb.getState();
//     renderer.drawTopBar(s.topBarPct);
//     renderer.drawBottomBar(s.bottomBarPct);
//
// Pairs with CameraDirector (1.1.3, camera moves), CutsceneSequencer
// (1.1.4, broader timeline), AmbientLayerMixer (1.4.0, ambient bed
// often dips during letterboxed sequences).
//
// Code style: var-only in browser source.
const DEFAULT_BAR_PCT = 0.12;
const DEFAULT_FADE_MS = 600;
function clamp01(v) {
    if (!isFinite(v))
        return 0;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
export class CinematicLetterbox {
    currentVal = 0;
    targetVal = 0;
    fadeStartVolume = 0;
    fadeRemainingMs = 0;
    fadeTotalMs = 0;
    barPct;
    defaultFadeMs;
    pulse_ = null;
    disposed = false;
    constructor(opts) {
        this.barPct = opts.defaultBarPct !== undefined && isFinite(opts.defaultBarPct)
            ? clamp01(opts.defaultBarPct) : DEFAULT_BAR_PCT;
        this.defaultFadeMs = opts.defaultFadeMs !== undefined
            && isFinite(opts.defaultFadeMs) && opts.defaultFadeMs >= 0
            ? opts.defaultFadeMs : DEFAULT_FADE_MS;
    }
    static create(opts = {}) {
        return new CinematicLetterbox(opts);
    }
    // Slide bars in.
    close(opts = {}) {
        if (this.disposed)
            return;
        var pct = opts.barPct !== undefined && isFinite(opts.barPct)
            ? clamp01(opts.barPct) : this.barPct;
        this.barPct = pct;
        var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
            && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
        this.startFade(1, fade);
    }
    // Slide bars out.
    open(opts = {}) {
        if (this.disposed)
            return;
        var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
            && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
        this.startFade(0, fade);
    }
    // Toggle between fully open / fully closed.
    toggle(opts = {}) {
        if (this.targetVal >= 0.5)
            this.open(opts);
        else
            this.close(opts);
    }
    // Manually set target 0..1.
    setTarget(value, opts = {}) {
        if (this.disposed)
            return;
        if (!isFinite(value))
            return;
        var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
            && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
        this.startFade(clamp01(value), fade);
    }
    // One-shot cinematic flash: close, hold, open.
    pulse(opts = {}) {
        if (this.disposed)
            return;
        var pct = opts.barPct !== undefined && isFinite(opts.barPct)
            ? clamp01(opts.barPct) : this.barPct;
        var hold = opts.holdMs !== undefined && isFinite(opts.holdMs)
            && opts.holdMs >= 0 ? opts.holdMs : 1000;
        var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
            && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
        this.barPct = pct;
        this.pulse_ = {
            phase: 'closing',
            phaseElapsed: 0,
            closeMs: fade,
            holdMs: hold,
            openMs: fade,
            barPct: pct,
            onComplete: opts.onComplete ?? null,
        };
        this.startFade(1, fade);
    }
    isOpen() {
        return this.currentVal === 0 && this.targetVal === 0;
    }
    isClosed() {
        return this.currentVal === 1 && this.targetVal === 1;
    }
    isAnimating() {
        return this.fadeRemainingMs > 0 || this.pulse_ !== null;
    }
    getState() {
        return {
            current: this.currentVal,
            target: this.targetVal,
            topBarPct: this.currentVal * this.barPct,
            bottomBarPct: this.currentVal * this.barPct,
            isAnimating: this.isAnimating(),
        };
    }
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        // Advance pulse phases.
        if (this.pulse_ !== null) {
            this.advancePulse(dt);
        }
        // Advance fade.
        if (this.fadeRemainingMs > 0) {
            this.fadeRemainingMs -= dt;
            if (this.fadeRemainingMs <= 0) {
                this.currentVal = this.targetVal;
                this.fadeRemainingMs = 0;
                this.fadeTotalMs = 0;
                this.fadeStartVolume = this.targetVal;
            }
            else {
                var t = (this.fadeTotalMs - this.fadeRemainingMs) / this.fadeTotalMs;
                this.currentVal = clamp01(this.fadeStartVolume + (this.targetVal - this.fadeStartVolume) * t);
            }
        }
    }
    dispose() {
        this.currentVal = 0;
        this.targetVal = 0;
        this.fadeRemainingMs = 0;
        this.pulse_ = null;
        this.disposed = true;
    }
    // ---------- private ----------
    startFade(target, fadeMs) {
        this.targetVal = target;
        this.fadeStartVolume = this.currentVal;
        if (fadeMs <= 0 || target === this.currentVal) {
            this.currentVal = target;
            this.fadeRemainingMs = 0;
            this.fadeTotalMs = 0;
        }
        else {
            this.fadeRemainingMs = fadeMs;
            this.fadeTotalMs = fadeMs;
        }
    }
    advancePulse(dt) {
        if (!this.pulse_)
            return;
        this.pulse_.phaseElapsed += dt;
        if (this.pulse_.phase === 'closing') {
            if (this.pulse_.phaseElapsed >= this.pulse_.closeMs) {
                var leftover = this.pulse_.phaseElapsed - this.pulse_.closeMs;
                this.pulse_.phase = 'hold';
                this.pulse_.phaseElapsed = leftover;
            }
        }
        if (this.pulse_.phase === 'hold') {
            if (this.pulse_.phaseElapsed >= this.pulse_.holdMs) {
                var leftover2 = this.pulse_.phaseElapsed - this.pulse_.holdMs;
                this.pulse_.phase = 'opening';
                this.pulse_.phaseElapsed = leftover2;
                this.startFade(0, this.pulse_.openMs);
            }
        }
        if (this.pulse_.phase === 'opening') {
            if (this.pulse_.phaseElapsed >= this.pulse_.openMs) {
                var cb = this.pulse_.onComplete;
                this.pulse_ = null;
                if (cb) {
                    try {
                        cb();
                    }
                    catch { /* ignore */ }
                }
            }
        }
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_CINEMATIC_LETTERBOX = 'cinematic_letterbox';
//# sourceMappingURL=cinematic-letterbox.js.map