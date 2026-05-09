// NoiseField - deterministic 2D fractal noise (multi-octave).
//
// 1.6.1 enabling primitive (Wave 1.6 procgen depth). Workhorse
// for terrain elevation, moisture maps, density fields, fog
// patterns, anything that needs smooth continuous pseudo-random
// values keyed on (x, y). Same seed + same (x, y) always returns
// the same value, so worlds are reproducible from a seed string.
//
//   var nf = NoiseField.create({
//     seed: 'world-42',
//     octaves: 4,        // sum 4 octaves of noise (default)
//     persistence: 0.5,  // each octave's amplitude scaled by this (default)
//     lacunarity: 2.0,   // each octave's frequency scaled by this (default)
//     scale: 0.05,       // base frequency multiplier on input coords
//   });
//   var elevation = nf.sample(x, y);  // -> [-1, 1]
//   var height01  = nf.sample01(x, y); // -> [0, 1]
//
// Internal: value noise (cheap, integer-keyed lookup table) with
// smoothstep interpolation, summed across N octaves with
// configurable persistence + lacunarity. Not as smooth as Perlin
// but visually equivalent for our use cases (terrain, moisture,
// region masks) and avoids gradient table construction.
//
// Pairs with NameGenerator (1.6.0, region names), VoronoiPartition
// (1.6.2 next, region boundaries), BiomeMixer (1.6.4, classifies
// elevation+moisture), WorldSeed (1.6.5 milestone).
//
// Code style: var-only in browser source.

export interface NoiseFieldOptions {
  // Seed for the deterministic hash. Default 'noise-field-seed'.
  seed?: number | string;
  // Number of summed octaves. Default 4. Range 1..8.
  octaves?: number;
  // Amplitude multiplier per octave. Default 0.5. Range (0, 1].
  persistence?: number;
  // Frequency multiplier per octave. Default 2.0.
  lacunarity?: number;
  // Base frequency applied to input coordinates. Default 0.05.
  // Smaller values = larger features.
  scale?: number;
}

function fnv1a(s: string): number {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function resolveSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length > 0) return fnv1a(seed);
  return fnv1a('noise-field-seed');
}

// Stable integer hash of (ix, iy, seed). 32-bit Mulberry-style mix.
function hash2(ix: number, iy: number, seed: number): number {
  var h = (ix | 0) * 0x27d4eb2d ^ (iy | 0) * 0x165667b1 ^ seed;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296; // 0..1
}

// Smoothstep (5th order, "smootherstep"). C2 continuous; better
// looking than the cubic version for terrain.
function smoothStep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class NoiseField {
  private seed: number;
  private octaves: number;
  private persistence: number;
  private lacunarity: number;
  private scale: number;

  private constructor(opts: NoiseFieldOptions) {
    this.seed = resolveSeed(opts.seed);
    var oct = (typeof opts.octaves === 'number') ? Math.floor(opts.octaves) : 4;
    if (oct < 1) oct = 1; if (oct > 8) oct = 8;
    this.octaves = oct;
    var p = (typeof opts.persistence === 'number' && opts.persistence > 0) ? opts.persistence : 0.5;
    if (p > 1) p = 1;
    this.persistence = p;
    this.lacunarity = (typeof opts.lacunarity === 'number' && opts.lacunarity > 0) ? opts.lacunarity : 2.0;
    this.scale = (typeof opts.scale === 'number' && opts.scale > 0) ? opts.scale : 0.05;
  }

  static create(opts: NoiseFieldOptions = {}): NoiseField {
    return new NoiseField(opts);
  }

  // Single-octave value noise at (x, y). Output is [0, 1].
  private value(x: number, y: number): number {
    var ix = Math.floor(x);
    var iy = Math.floor(y);
    var fx = x - ix;
    var fy = y - iy;
    var a = hash2(ix,     iy,     this.seed);
    var b = hash2(ix + 1, iy,     this.seed);
    var c = hash2(ix,     iy + 1, this.seed);
    var d = hash2(ix + 1, iy + 1, this.seed);
    var sx = smoothStep(fx);
    var sy = smoothStep(fy);
    var ab = lerp(a, b, sx);
    var cd = lerp(c, d, sx);
    return lerp(ab, cd, sy);
  }

  // Fractal sample at (x, y) -> [-1, 1].
  sample(x: number, y: number): number {
    var freq = this.scale;
    var amp = 1;
    var sum = 0;
    var norm = 0;
    for (var i = 0; i < this.octaves; i++) {
      var v = this.value(x * freq, y * freq); // 0..1
      sum += amp * (v * 2 - 1);               // -amp..amp
      norm += amp;
      amp *= this.persistence;
      freq *= this.lacunarity;
    }
    if (norm === 0) return 0;
    return sum / norm;
  }

  // Same as sample() but normalized to [0, 1].
  sample01(x: number, y: number): number {
    return (this.sample(x, y) + 1) * 0.5;
  }

  // Reseed in place; preserves octaves / persistence / lacunarity / scale.
  setSeed(seed: number | string): void {
    this.seed = resolveSeed(seed);
  }

  // Read-only accessors for diagnostics + tests.
  getSeed(): number { return this.seed; }
  getOctaves(): number { return this.octaves; }
  getPersistence(): number { return this.persistence; }
  getLacunarity(): number { return this.lacunarity; }
  getScale(): number { return this.scale; }
}

// Resource key for the world's resource registry.
export const RESOURCE_NOISE_FIELD = 'noise_field';
