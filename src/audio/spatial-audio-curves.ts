// SpatialAudioCurves - distance attenuation curves for spatial audio.
//
// 0.44.0 enabling primitive. SpatialAudioBus (0.15.0) already passes
// `distanceModel: 'linear' | 'inverse' | 'exponential'` into Web Audio's
// PannerNode, but the engine has no way to EVALUATE these curves
// outside the audio thread. Consumers need that for:
//
//   - "Is this sound audible?" cull predicates before allocating a
//     PannerNode (cheap mute-when-far check).
//   - HUD / diagnostic overlays that show falloff envelopes.
//   - AI proximity reasoning ("would this character hear that?").
//   - Custom non-Web-Audio attenuation (e.g. wall occlusion, fog
//     density modifiers).
//
// This module ships pure-math implementations of the three Web Audio
// distance models plus a registry for named custom curves. The
// existing SpatialAudioBus / PositionalPlayOptions are unchanged.
//
// Code style: var-only in browser source.

export type DistanceModelName = 'linear' | 'inverse' | 'exponential';

// Per-call curve config. Mirrors the Web Audio PannerNode tuning so
// the engine-side evaluator agrees with what the actual audio path
// is doing.
export interface AttenuationOptions {
  // Distance at which gain is full (1.0). Must be > 0. Default 1.
  refDistance?: number;
  // Maximum distance for linear model (gain reaches 0 here). For
  // inverse / exponential, distances past this are clamped. Must
  // be > refDistance. Default 32.
  maxDistance?: number;
  // Sharper falloff = higher rolloff. Default 1.
  rolloffFactor?: number;
}

const DEFAULT_REF = 1;
const DEFAULT_MAX = 32;
const DEFAULT_ROLLOFF = 1;

function clampNonNeg(v: number): number {
  // Infinity passes through so per-model logic clamps it to max.
  // NaN / negative collapse to 0 (caller is at the source).
  if (Number.isNaN(v) || v < 0) return 0;
  return v;
}

function safeOpts(opts: AttenuationOptions | undefined): {
  ref: number;
  max: number;
  rolloff: number;
} {
  var ref = opts && opts.refDistance !== undefined && opts.refDistance > 0
    ? opts.refDistance : DEFAULT_REF;
  var max = opts && opts.maxDistance !== undefined && opts.maxDistance > ref
    ? opts.maxDistance : Math.max(DEFAULT_MAX, ref + 1);
  var rolloff = opts && opts.rolloffFactor !== undefined && opts.rolloffFactor >= 0
    ? opts.rolloffFactor : DEFAULT_ROLLOFF;
  return { ref: ref, max: max, rolloff: rolloff };
}

// Web Audio "linear distance" model:
//
//   gain = 1 - rolloffFactor * (clamp(d, ref, max) - ref) / (max - ref)
//
// Linearly drops from 1 at refDistance to (1 - rolloffFactor) at
// maxDistance. With default rolloff=1, the gain reaches exactly 0 at
// max. Distances past max are clamped to that floor (or 0).
export function linearAttenuation(distance: number, opts?: AttenuationOptions): number {
  var d = clampNonNeg(distance);
  var p = safeOpts(opts);
  if (d <= p.ref) return 1;
  if (d >= p.max) return Math.max(0, 1 - p.rolloff);
  var span = p.max - p.ref;
  if (span <= 0) return 1;
  var gain = 1 - p.rolloff * (d - p.ref) / span;
  if (gain < 0) return 0;
  if (gain > 1) return 1;
  return gain;
}

// Web Audio "inverse distance" model:
//
//   gain = ref / (ref + rolloff * (max(d, ref) - ref))
//
// Asymptotically approaches 0 with distance. Default rolloff=1
// produces a 1/r curve from refDistance outward. Capped to maxDistance
// (distances past max use the maxDistance value).
export function inverseAttenuation(distance: number, opts?: AttenuationOptions): number {
  var d = clampNonNeg(distance);
  var p = safeOpts(opts);
  var clamped = d > p.max ? p.max : d;
  if (clamped <= p.ref) return 1;
  var denom = p.ref + p.rolloff * (clamped - p.ref);
  if (denom <= 0) return 0;
  var gain = p.ref / denom;
  if (gain < 0) return 0;
  if (gain > 1) return 1;
  return gain;
}

// Web Audio "exponential distance" model:
//
//   gain = (max(d, ref) / ref)^(-rolloff)
//
// Sharper than inverse at default rolloff; falls off as a power
// curve. Distances past maxDistance use the maxDistance value.
export function exponentialAttenuation(distance: number, opts?: AttenuationOptions): number {
  var d = clampNonNeg(distance);
  var p = safeOpts(opts);
  var clamped = d > p.max ? p.max : d;
  if (clamped <= p.ref) return 1;
  if (p.rolloff <= 0) return 1;
  var ratio = clamped / p.ref;
  if (ratio <= 0) return 1;
  var gain = Math.pow(ratio, -p.rolloff);
  if (gain < 0) return 0;
  if (gain > 1) return 1;
  return gain;
}

// Convenience: compute attenuation by named model.
export function attenuationByModel(
  model: DistanceModelName,
  distance: number,
  opts?: AttenuationOptions,
): number {
  if (model === 'linear') return linearAttenuation(distance, opts);
  if (model === 'inverse') return inverseAttenuation(distance, opts);
  if (model === 'exponential') return exponentialAttenuation(distance, opts);
  return inverseAttenuation(distance, opts);
}

// Custom curve callable: takes a 2D distance + options and returns a
// gain in [0, 1]. Returning out-of-range values is the caller's
// concern; consumers wrap in clamp01 if needed.
export type AttenuationFn = (distance: number, opts?: AttenuationOptions) => number;

// Named-curve registry. Lets consumers register custom attenuation
// shapes ("fog-occluded", "underwater", "indoor-wall") and look them
// up by name later. The three Web Audio standard models are
// pre-registered.
export class AttenuationRegistry {
  private curves: Map<string, AttenuationFn> = new Map();

  constructor() {
    this.curves.set('linear', linearAttenuation);
    this.curves.set('inverse', inverseAttenuation);
    this.curves.set('exponential', exponentialAttenuation);
  }

  register(name: string, fn: AttenuationFn): void {
    if (typeof name !== 'string' || name.length === 0) return;
    this.curves.set(name, fn);
  }

  unregister(name: string): boolean {
    return this.curves.delete(name);
  }

  has(name: string): boolean {
    return this.curves.has(name);
  }

  // Evaluate a registered curve. Falls back to inverse if name is
  // unknown (matches Web Audio's PannerNode default).
  evaluate(name: string, distance: number, opts?: AttenuationOptions): number {
    var fn = this.curves.get(name);
    if (!fn) return inverseAttenuation(distance, opts);
    try {
      var v = fn(distance, opts);
      if (typeof v !== 'number' || !isFinite(v)) return 0;
      if (v < 0) return 0;
      if (v > 1) return 1;
      return v;
    } catch {
      return 0;
    }
  }

  names(): string[] {
    var out: string[] = [];
    this.curves.forEach((_fn, name) => out.push(name));
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_ATTENUATION_REGISTRY = 'attenuation_registry';
