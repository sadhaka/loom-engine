// WeatherSystem - discrete weather states with ramped intensity transitions.
//
// 0.71.0 enabling primitive. Outdoor zones often layer a weather
// signal on top of TimeOfDay (0.70): a state machine that flips
// between named conditions (clear / rain / storm / snow / fog /
// custom) plus a continuous intensity that can ramp between values
// over a configurable duration. Renderers, ambient audio, encounter
// pools, and movement modifiers all read the current state +
// intensity each frame. WeatherSystem owns the transition; consumers
// react through onWeatherChanged + onIntensitySettled callbacks.
//
//   var weather = WeatherSystem.create({
//     states: [
//       { name: 'clear', defaultIntensity: 0 },
//       { name: 'rain',  defaultIntensity: 0.6 },
//       { name: 'storm', defaultIntensity: 1.0 },
//     ],
//     initial: 'clear',
//     onWeatherChanged: (next, prev) => audio.crossfade(next),
//     onIntensitySettled: (state, intensity) => {
//       hud.showWeatherBadge(state, intensity);
//     },
//   });
//   each frame: weather.tick(dtMs);
//   triggered: weather.setWeather('storm', { rampMs: 4000 });
//
// Code style: var-only in browser source.
// Pairs with TimeOfDay (0.70) and StateMachine (0.51).

export interface WeatherState {
  name: string;
  // Optional default target intensity for this state (0..1). Used
  // when setWeather is called without an explicit intensity. Default 1.
  defaultIntensity?: number;
}

export interface WeatherTransitionOptions {
  // Real-time ms over which the intensity eases from current to
  // target. 0 = instant. Default 0.
  rampMs?: number;
  // Target intensity [0, 1]. Defaults to the new state's
  // defaultIntensity, or 1 if neither is set.
  intensity?: number;
}

export interface WeatherSystemOptions {
  states?: WeatherState[];
  initial?: string;
  initialIntensity?: number;
  onWeatherChanged?: (next: string, prev: string | null) => void;
  onIntensitySettled?: (state: string, intensity: number) => void;
}

interface RampInternal {
  startIntensity: number;
  targetIntensity: number;
  durationMs: number;
  elapsedMs: number;
}

export class WeatherSystem {
  private states: Map<string, WeatherState>;
  private order: string[];
  private currentName: string | null;
  private intensity: number;
  private ramp: RampInternal | null = null;
  private onWeatherChanged: ((n: string, p: string | null) => void) | null;
  private onIntensitySettled: ((s: string, i: number) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: WeatherSystemOptions) {
    this.states = new Map();
    this.order = [];
    if (opts.states) {
      for (var i = 0; i < opts.states.length; i++) {
        var s = opts.states[i] as WeatherState;
        this.addStateInternal(s);
      }
    }
    this.onWeatherChanged = opts.onWeatherChanged ?? null;
    this.onIntensitySettled = opts.onIntensitySettled ?? null;
    if (opts.initial !== undefined && this.states.has(opts.initial)) {
      this.currentName = opts.initial;
    } else {
      this.currentName = null;
    }
    if (opts.initialIntensity !== undefined && isFinite(opts.initialIntensity)) {
      this.intensity = clamp01(opts.initialIntensity);
    } else if (this.currentName !== null) {
      var st = this.states.get(this.currentName) as WeatherState;
      // Missing defaultIntensity is treated as 0 (idle / no weather
      // effect). Consumers turn it on via setWeather with an explicit
      // intensity or via a state that carries a non-zero default.
      this.intensity = st.defaultIntensity !== undefined ? clamp01(st.defaultIntensity) : 0;
    } else {
      this.intensity = 0;
    }
  }

  static create(opts: WeatherSystemOptions = {}): WeatherSystem {
    return new WeatherSystem(opts);
  }

  // Switch to a named state. Optionally ramps intensity over rampMs.
  // Returns false if the state is unknown (no flip, no callback).
  // Calling setWeather with the current state name is allowed - it
  // re-targets intensity without firing onWeatherChanged (use this
  // to dim an active rain to a drizzle).
  setWeather(name: string, opts?: WeatherTransitionOptions): boolean {
    if (this.disposed) return false;
    if (!this.states.has(name)) return false;
    var st = this.states.get(name) as WeatherState;
    var rampMs = opts && opts.rampMs !== undefined && isFinite(opts.rampMs) && opts.rampMs > 0
      ? opts.rampMs : 0;
    var target: number;
    if (opts && opts.intensity !== undefined && isFinite(opts.intensity)) {
      target = clamp01(opts.intensity);
    } else if (st.defaultIntensity !== undefined && isFinite(st.defaultIntensity)) {
      target = clamp01(st.defaultIntensity);
    } else {
      // Missing defaultIntensity = 0 (the consistent rule with the
      // constructor); pass an explicit intensity to override.
      target = 0;
    }
    var prev = this.currentName;
    var stateChanged = prev !== name;
    this.currentName = name;
    if (rampMs <= 0) {
      this.intensity = target;
      this.ramp = null;
      if (stateChanged && this.onWeatherChanged) {
        try { this.onWeatherChanged(name, prev); } catch { /* ignore */ }
      }
      if (this.onIntensitySettled) {
        try { this.onIntensitySettled(name, target); } catch { /* ignore */ }
      }
      return true;
    }
    this.ramp = {
      startIntensity: this.intensity,
      targetIntensity: target,
      durationMs: rampMs,
      elapsedMs: 0,
    };
    if (stateChanged && this.onWeatherChanged) {
      try { this.onWeatherChanged(name, prev); } catch { /* ignore */ }
    }
    return true;
  }

  // Advance any in-flight intensity ramp by dtMs. No-op when no ramp
  // is active. Fires onIntensitySettled exactly once when the ramp
  // completes.
  tick(dtMs: number): void {
    if (this.disposed) return;
    if (!this.ramp) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var r = this.ramp;
    r.elapsedMs += dt;
    if (r.elapsedMs >= r.durationMs) {
      this.intensity = r.targetIntensity;
      this.ramp = null;
      if (this.onIntensitySettled && this.currentName !== null) {
        try { this.onIntensitySettled(this.currentName, this.intensity); } catch { /* ignore */ }
      }
      return;
    }
    var t = r.elapsedMs / r.durationMs;
    this.intensity = r.startIntensity + (r.targetIntensity - r.startIntensity) * t;
  }

  // Add a new state at runtime. Returns false on duplicate name.
  registerState(state: WeatherState): boolean {
    if (this.disposed) return false;
    if (!state.name) return false;
    if (this.states.has(state.name)) return false;
    this.addStateInternal(state);
    return true;
  }

  hasState(name: string): boolean {
    return this.states.has(name);
  }

  getWeather(): string | null { return this.currentName; }
  getIntensity(): number { return this.intensity; }
  isTransitioning(): boolean { return this.ramp !== null; }

  // Defensive copy of the registered states (in registration order).
  getStates(): WeatherState[] {
    var out: WeatherState[] = [];
    for (var i = 0; i < this.order.length; i++) {
      var name = this.order[i] as string;
      var st = this.states.get(name) as WeatherState;
      var copy: WeatherState = { name: st.name };
      if (st.defaultIntensity !== undefined) copy.defaultIntensity = st.defaultIntensity;
      out.push(copy);
    }
    return out;
  }

  dispose(): void {
    this.states.clear();
    this.order = [];
    this.ramp = null;
    this.onWeatherChanged = null;
    this.onIntensitySettled = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private addStateInternal(s: WeatherState): void {
    if (!s.name) return;
    if (this.states.has(s.name)) return;
    var copy: WeatherState = { name: s.name };
    if (s.defaultIntensity !== undefined) copy.defaultIntensity = clamp01(s.defaultIntensity);
    this.states.set(s.name, copy);
    this.order.push(s.name);
  }
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Resource key for the world's resource registry.
export const RESOURCE_WEATHER_SYSTEM = 'weather_system';
