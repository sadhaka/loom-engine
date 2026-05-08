// ParticleCurves - utility curves for particle emit rate, color
// over life, and size over life.
//
// 0.43.0 enabling primitive. The existing ParticleEmitterPool /
// ParticleEmitterSystem (Phase 4 / Phase 14) emit at a constant
// rate with constant per-particle color and size. Modern engines
// shape these over time: emit rate ramps up at boss-spawn then
// decays; particle color tints from white-hot to ember-orange to
// smoke-grey; particle size grows fast at birth then shrinks
// before death.
//
// Rather than rewrite the emitter / pool layout (which would be a
// breaking change to per-particle SoA Float32Arrays), 0.43.0 ships
// a UTILITY module: pure math + helpers consumers can call from
// their own per-frame code. A future emitter refactor can absorb
// these curves; today, the engine surface stays additive.
//
// Three primitives:
//
//   1. EmitRateCurve - given a normalized time t in [0, 1] and an
//      emitter age in seconds, returns particles-per-second to emit
//      this frame. Built-in shapes: constant, linear ramp, ease-out
//      pulse, sustain-then-fade.
//
//   2. ColorOverLife - given a normalized particle age t in [0, 1]
//      and 2-4 keyframe colors, returns a blended ColorRGBA. Reuses
//      colorLerp from the existing color util (0.05.0 / 0.33.0).
//
//   3. SizeOverLife - given a normalized particle age t in [0, 1]
//      and a curve type, returns a scalar multiplier on the base
//      size. Built-in shapes: constant, growThenShrink, easeOut,
//      step.
//
// All three use the 0.29.0 Easings table when an easing-shaped
// curve is requested. ColorOverLife stops + colors are exposed as
// data structures so consumers can serialize them / drive from
// editor UI / interpolate at any time without rebuilding closures.
//
// Code style: var-only in browser source.

import type { ColorRGBA } from '../util/color.js';
import { colorLerp, rgba } from '../util/color.js';
import { Easings, type EasingFn, type EasingName } from './tween.js';

function clampUnit(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function resolveEasing(easing: EasingFn | EasingName | undefined): EasingFn {
  if (typeof easing === 'function') return easing;
  if (typeof easing === 'string') {
    var fn = Easings[easing];
    if (fn) return fn;
  }
  return Easings.linear;
}

// ---------- Emit-rate curves ----------

export type EmitRateShape = 'constant' | 'linearRamp' | 'pulse' | 'sustainFade';

export interface EmitRateOptions {
  shape: EmitRateShape;
  // Particles per second at peak. Constant uses this directly.
  peakRate: number;
  // Optional starting rate for shapes that ramp (linearRamp's t=0
  // value, sustainFade's pre-fade value). Default 0.
  startRate?: number;
  // Optional easing applied to the time axis. Defaults to the
  // shape-natural easing (linear for linearRamp, easeOutQuad for
  // pulse, etc.).
  easing?: EasingFn | EasingName;
  // sustainFade: fraction of the curve [0, 1] held at peakRate
  // before the fade. Default 0.5.
  sustainFraction?: number;
}

// Returns rate (particles/second) for normalized time t in [0, 1].
// Multiply by dt to get particles to emit this frame.
//
// Note: emitters typically accumulate fractional particles between
// frames; the consumer is responsible for that accumulator. This
// function is pure: takes (opts, t), returns rate.
export function emitRateAt(opts: EmitRateOptions, t: number): number {
  var ct = clampUnit(t);
  var peak = opts.peakRate > 0 ? opts.peakRate : 0;
  var start = opts.startRate !== undefined && opts.startRate >= 0 ? opts.startRate : 0;
  if (opts.shape === 'constant') {
    return peak;
  }
  if (opts.shape === 'linearRamp') {
    var ease1 = resolveEasing(opts.easing);
    return start + (peak - start) * ease1(ct);
  }
  if (opts.shape === 'pulse') {
    // Up then down. Peaks at t=0.5; eased on each half so t=0 and
    // t=1 both return startRate (or 0 if startRate omitted).
    var ease2 = resolveEasing(opts.easing ?? 'easeOutQuad');
    var phase = ct < 0.5 ? ease2(ct * 2) : ease2(1 - (ct - 0.5) * 2);
    return start + (peak - start) * phase;
  }
  if (opts.shape === 'sustainFade') {
    var sf = opts.sustainFraction !== undefined ? clampUnit(opts.sustainFraction) : 0.5;
    if (ct < sf) {
      // Ramp-up portion: linearRamp from start to peak across [0, sf].
      var rampT = sf > 0 ? ct / sf : 1;
      var ease3 = resolveEasing(opts.easing);
      return start + (peak - start) * ease3(rampT);
    }
    // Fade portion: ease from peak to 0 across [sf, 1].
    var fadeSpan = 1 - sf;
    if (fadeSpan <= 0) return peak;
    var fadeT = (ct - sf) / fadeSpan;
    var ease4 = resolveEasing(opts.easing ?? 'easeOutCubic');
    return peak * (1 - ease4(fadeT));
  }
  return peak;
}

// Convenience: how many particles to emit between t0 and t1, given
// the curve, the curve's total lifetime, and an external accumulator
// for fractional remainders. The accumulator is mutated on the
// returned object.
//
// Caller pattern:
//   var acc = { value: 0 };
//   for each frame: var n = particlesToEmit(opts, prevT, currT, acc);
//
// The function returns INTEGER particles to emit; the leftover
// fraction is stashed in acc.value for the next call.
export function particlesToEmit(
  opts: EmitRateOptions,
  t0: number,
  t1: number,
  durationSeconds: number,
  accumulator: { value: number },
): number {
  if (durationSeconds <= 0) return 0;
  // Midpoint sample is good enough for typical 16-33ms frames.
  var mid = (t0 + t1) / 2;
  var rate = emitRateAt(opts, mid);
  var dt = (t1 - t0) * durationSeconds;
  if (dt <= 0) return 0;
  var raw = accumulator.value + rate * dt;
  var whole = Math.floor(raw);
  accumulator.value = raw - whole;
  if (whole < 0) {
    accumulator.value += whole;
    return 0;
  }
  return whole;
}

// ---------- Color over life ----------

export interface ColorStop {
  // Normalized particle age in [0, 1] at which the color applies.
  t: number;
  color: ColorRGBA;
}

// Linear-segment color blend. Stops must be sorted t-asc; the
// function does not re-sort. t outside [first.t, last.t] clamps to
// the nearest endpoint color.
export function colorAtAge(stops: ReadonlyArray<ColorStop>, age: number): ColorRGBA {
  if (!stops || stops.length === 0) return rgba(1, 1, 1, 1);
  if (stops.length === 1) {
    var only = stops[0] as ColorStop;
    return rgba(only.color.r, only.color.g, only.color.b, only.color.a);
  }
  var first = stops[0] as ColorStop;
  var last = stops[stops.length - 1] as ColorStop;
  if (age <= first.t) {
    return rgba(first.color.r, first.color.g, first.color.b, first.color.a);
  }
  if (age >= last.t) {
    return rgba(last.color.r, last.color.g, last.color.b, last.color.a);
  }
  // Find the segment.
  for (var i = 0; i < stops.length - 1; i++) {
    var a = stops[i] as ColorStop;
    var b = stops[i + 1] as ColorStop;
    if (age >= a.t && age <= b.t) {
      var span = b.t - a.t;
      if (span <= 0) {
        return rgba(b.color.r, b.color.g, b.color.b, b.color.a);
      }
      var f = (age - a.t) / span;
      var out = rgba(0, 0, 0, 0);
      colorLerp(a.color, b.color, f, out);
      return out;
    }
  }
  // Fallthrough (should not occur given the bounds checks above).
  return rgba(last.color.r, last.color.g, last.color.b, last.color.a);
}

// ---------- Size over life ----------

export type SizeShape = 'constant' | 'growThenShrink' | 'easeOut' | 'easeIn' | 'step';

export interface SizeOverLifeOptions {
  shape: SizeShape;
  // Multiplier at t=0. Default 1.
  startScale?: number;
  // Multiplier at peak (growThenShrink) or at t=1 (other shapes).
  // Default 1.
  endScale?: number;
  // For growThenShrink: where the peak lives in [0, 1]. Default 0.5.
  peakAt?: number;
  // For step: threshold. t < threshold => startScale; t >= threshold
  // => endScale. Default 0.5.
  stepAt?: number;
  // Optional easing override.
  easing?: EasingFn | EasingName;
}

// Returns the size multiplier at normalized particle age t in [0, 1].
// Multiply this by the particle's base size.
export function sizeAtAge(opts: SizeOverLifeOptions, t: number): number {
  var ct = clampUnit(t);
  var s = opts.startScale !== undefined ? opts.startScale : 1;
  var e = opts.endScale !== undefined ? opts.endScale : 1;
  if (opts.shape === 'constant') {
    return s;
  }
  if (opts.shape === 'easeOut') {
    var ease1 = resolveEasing(opts.easing ?? 'easeOutQuad');
    return s + (e - s) * ease1(ct);
  }
  if (opts.shape === 'easeIn') {
    var ease2 = resolveEasing(opts.easing ?? 'easeInQuad');
    return s + (e - s) * ease2(ct);
  }
  if (opts.shape === 'step') {
    var threshold = opts.stepAt !== undefined ? clampUnit(opts.stepAt) : 0.5;
    return ct < threshold ? s : e;
  }
  if (opts.shape === 'growThenShrink') {
    var peak = opts.peakAt !== undefined ? clampUnit(opts.peakAt) : 0.5;
    var ease3 = resolveEasing(opts.easing ?? 'easeOutQuad');
    if (ct < peak) {
      var rt = peak > 0 ? ct / peak : 1;
      return s + (e - s) * ease3(rt);
    }
    var fallSpan = 1 - peak;
    if (fallSpan <= 0) return e;
    var ft = (ct - peak) / fallSpan;
    return e + (s - e) * ease3(ft);
  }
  return s;
}

// Resource key for the world's resource registry. Tag for any
// curve-tracking system the consumer attaches.
export const RESOURCE_PARTICLE_CURVES = 'particle_curves';
