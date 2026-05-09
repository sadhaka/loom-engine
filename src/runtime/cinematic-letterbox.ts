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

export interface LetterboxState {
  // 0..1 lerp progress toward target.
  current: number;
  // 0..1 target (0 = fully open / no bars; 1 = fully closed).
  target: number;
  // Effective top bar height as 0..1 fraction of frame height.
  topBarPct: number;
  // Effective bottom bar height as 0..1 fraction of frame height.
  bottomBarPct: number;
  // True while a fade is in progress.
  isAnimating: boolean;
}

export interface CloseOptions {
  // Override defaultBarPct from create. 0..1 fraction.
  barPct?: number;
  // Override defaultFadeMs.
  fadeMs?: number;
}

export interface OpenOptions {
  fadeMs?: number;
}

export interface PulseOptions {
  // Bar height during the pulse. Default defaultBarPct.
  barPct?: number;
  // ms to hold at the closed state. Default 1000.
  holdMs?: number;
  // ms for both close + open ramps. Default defaultFadeMs.
  fadeMs?: number;
  // Fired when the pulse completes (returns to open).
  onComplete?: () => void;
}

export interface CinematicLetterboxOptions {
  // Default closed bar height (0..1 fraction of frame). Default
  // 0.12 (12% top + 12% bottom).
  defaultBarPct?: number;
  // Default fade duration ms. Default 600.
  defaultFadeMs?: number;
}

const DEFAULT_BAR_PCT = 0.12;
const DEFAULT_FADE_MS = 600;

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

interface PulseState {
  phase: 'closing' | 'hold' | 'opening';
  phaseElapsed: number;
  closeMs: number;
  holdMs: number;
  openMs: number;
  barPct: number;
  onComplete: (() => void) | null;
}

export class CinematicLetterbox {
  private currentVal: number = 0;
  private targetVal: number = 0;
  private fadeStartVolume: number = 0;
  private fadeRemainingMs: number = 0;
  private fadeTotalMs: number = 0;
  private barPct: number;
  private defaultFadeMs: number;
  private pulse_: PulseState | null = null;
  private disposed: boolean = false;

  private constructor(opts: CinematicLetterboxOptions) {
    this.barPct = opts.defaultBarPct !== undefined && isFinite(opts.defaultBarPct)
      ? clamp01(opts.defaultBarPct) : DEFAULT_BAR_PCT;
    this.defaultFadeMs = opts.defaultFadeMs !== undefined
        && isFinite(opts.defaultFadeMs) && opts.defaultFadeMs >= 0
      ? opts.defaultFadeMs : DEFAULT_FADE_MS;
  }

  static create(opts: CinematicLetterboxOptions = {}): CinematicLetterbox {
    return new CinematicLetterbox(opts);
  }

  // Slide bars in.
  close(opts: CloseOptions = {}): void {
    if (this.disposed) return;
    var pct = opts.barPct !== undefined && isFinite(opts.barPct)
      ? clamp01(opts.barPct) : this.barPct;
    this.barPct = pct;
    var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
        && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
    this.startFade(1, fade);
  }

  // Slide bars out.
  open(opts: OpenOptions = {}): void {
    if (this.disposed) return;
    var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
        && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
    this.startFade(0, fade);
  }

  // Toggle between fully open / fully closed.
  toggle(opts: CloseOptions = {}): void {
    if (this.targetVal >= 0.5) this.open(opts);
    else this.close(opts);
  }

  // Manually set target 0..1.
  setTarget(value: number, opts: CloseOptions = {}): void {
    if (this.disposed) return;
    if (!isFinite(value)) return;
    var fade = opts.fadeMs !== undefined && isFinite(opts.fadeMs)
        && opts.fadeMs >= 0 ? opts.fadeMs : this.defaultFadeMs;
    this.startFade(clamp01(value), fade);
  }

  // One-shot cinematic flash: close, hold, open.
  pulse(opts: PulseOptions = {}): void {
    if (this.disposed) return;
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

  isOpen(): boolean {
    return this.currentVal === 0 && this.targetVal === 0;
  }

  isClosed(): boolean {
    return this.currentVal === 1 && this.targetVal === 1;
  }

  isAnimating(): boolean {
    return this.fadeRemainingMs > 0 || this.pulse_ !== null;
  }

  getState(): LetterboxState {
    return {
      current: this.currentVal,
      target: this.targetVal,
      topBarPct: this.currentVal * this.barPct,
      bottomBarPct: this.currentVal * this.barPct,
      isAnimating: this.isAnimating(),
    };
  }

  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
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
      } else {
        var t = (this.fadeTotalMs - this.fadeRemainingMs) / this.fadeTotalMs;
        this.currentVal = clamp01(
          this.fadeStartVolume + (this.targetVal - this.fadeStartVolume) * t,
        );
      }
    }
  }

  dispose(): void {
    this.currentVal = 0;
    this.targetVal = 0;
    this.fadeRemainingMs = 0;
    this.pulse_ = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private startFade(target: number, fadeMs: number): void {
    this.targetVal = target;
    this.fadeStartVolume = this.currentVal;
    if (fadeMs <= 0 || target === this.currentVal) {
      this.currentVal = target;
      this.fadeRemainingMs = 0;
      this.fadeTotalMs = 0;
    } else {
      this.fadeRemainingMs = fadeMs;
      this.fadeTotalMs = fadeMs;
    }
  }

  private advancePulse(dt: number): void {
    if (!this.pulse_) return;
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
          try { cb(); } catch { /* ignore */ }
        }
      }
    }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_CINEMATIC_LETTERBOX = 'cinematic_letterbox';
