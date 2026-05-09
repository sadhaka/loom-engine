// NameGenerator - Markov-chain procedural name generator.
//
// 1.6.0 enabling primitive (Wave 1.6 procgen depth opens). Trains
// an order-N character Markov chain on a corpus of names, then
// emits new names that read like the corpus but aren't in it.
// Standard pattern for fantasy / mythic / generated NPC names.
//
//   var ng = NameGenerator.create({ seed: 'world-42', order: 2 });
//   ng.train([
//     'Aelaria', 'Bryn', 'Caelum', 'Dorian', 'Elias',
//     'Faelan', 'Gareth', 'Halwin', 'Ithil', 'Joren',
//     'Kael', 'Liora', 'Mira', 'Naoise', 'Orin',
//     'Perrin', 'Quill', 'Rowan', 'Soren', 'Talia',
//   ]);
//   ng.generate({ minLen: 4, maxLen: 9 });
//   // -> 'Caelan' / 'Brynor' / 'Tarwin' / etc. (deterministic per seed)
//
// Pure deterministic: same seed + same corpus + same options =>
// same output sequence forever. Internal RNG is mulberry32 from
// the seed (string seeds hash to a 32-bit value first).
//
// Pairs with NoiseField (1.6.1, terrain), VoronoiPartition (1.6.2,
// region tiling), DungeonGenerator (1.6.3), BiomeMixer (1.6.4),
// WorldSeed (1.6.5 milestone).
//
// Code style: var-only in browser source.

export type MarkovOrder = 1 | 2 | 3;

export interface NameGeneratorOptions {
  // Seed for the deterministic RNG. Default 'name-generator-seed'.
  seed?: number | string;
  // Order of the Markov chain (lookback length). Default 2.
  // 1 = bigram (more chaos), 2 = trigram (good balance), 3 = quadgram
  // (closest to corpus, least variety).
  order?: MarkovOrder;
  // String prepended to the corpus tokens to mark "start of name".
  // Default '' (rare in real names, safe default).
  startToken?: string;
  // Suffix appended to corpus tokens to mark "end of name". Default
  // ''.
  endToken?: string;
}

export interface GenerateOptions {
  // Minimum length of generated name (inclusive). Default 3.
  minLen?: number;
  // Maximum length of generated name (inclusive). Default 12.
  maxLen?: number;
  // If the chain dead-ends before minLen, retry up to this many
  // times. Default 12.
  maxAttempts?: number;
  // Optional title-case the first letter even if corpus was
  // lowercase. Default true.
  titleCase?: boolean;
}

// 32-bit hash of a string seed (FNV-1a, fast + deterministic).
function fnv1a(s: string): number {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mulberry32 PRNG. Fast, deterministic, good enough for naming.
function mulberry32(seed: number): () => number {
  var t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length > 0) return fnv1a(seed);
  return fnv1a('name-generator-seed');
}

export class NameGenerator {
  private order: MarkovOrder;
  private startToken: string;
  private endToken: string;
  private rng: () => number;
  private seedNumeric: number;
  // Map<prefix, Map<nextChar, count>>
  private chain: Map<string, Map<string, number>> = new Map();
  // Distinct starting prefixes (for picking new generations).
  private starts: string[] = [];
  private trainedTokens: number = 0;

  private constructor(opts: NameGeneratorOptions) {
    this.order = (opts.order === 1 || opts.order === 3) ? opts.order : 2;
    this.startToken = (typeof opts.startToken === 'string' && opts.startToken.length > 0)
      ? opts.startToken : '';
    this.endToken = (typeof opts.endToken === 'string' && opts.endToken.length > 0)
      ? opts.endToken : '';
    this.seedNumeric = resolveSeed(opts.seed);
    this.rng = mulberry32(this.seedNumeric);
  }

  static create(opts: NameGeneratorOptions = {}): NameGenerator {
    return new NameGenerator(opts);
  }

  train(corpus: string[]): void {
    if (!corpus || !corpus.length) return;
    for (var i = 0; i < corpus.length; i++) {
      var word = corpus[i];
      if (typeof word !== 'string' || word.length === 0) continue;
      var w = word.toLowerCase();
      var padded = repeat(this.startToken, this.order) + w + this.endToken;
      this.trainedTokens++;
      // Walk a sliding window of (order+1) chars.
      for (var j = 0; j <= padded.length - this.order - 1; j++) {
        var prefix = padded.substr(j, this.order);
        var next = padded.charAt(j + this.order);
        var bucket = this.chain.get(prefix);
        if (!bucket) {
          bucket = new Map();
          this.chain.set(prefix, bucket);
        }
        bucket.set(next, (bucket.get(next) || 0) + 1);
      }
      // First real prefix (after the start padding) is a viable
      // starting point. Phase 1: just record the start padding.
    }
    this.recomputeStarts();
  }

  generate(opts: GenerateOptions = {}): string {
    if (this.chain.size === 0) return '';
    var minLen = (typeof opts.minLen === 'number' && opts.minLen > 0) ? opts.minLen : 3;
    var maxLen = (typeof opts.maxLen === 'number' && opts.maxLen > 0) ? opts.maxLen : 12;
    if (maxLen < minLen) maxLen = minLen;
    var maxAttempts = (typeof opts.maxAttempts === 'number' && opts.maxAttempts > 0)
      ? opts.maxAttempts : 12;
    var titleCase = opts.titleCase !== false;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      var built = this.buildOne(maxLen);
      if (built.length >= minLen) {
        if (titleCase && built.length > 0) {
          built = built.charAt(0).toUpperCase() + built.slice(1);
        }
        return built;
      }
    }
    // Last-resort partial - return what we have, even if short.
    var fallback = this.buildOne(maxLen);
    if (titleCase && fallback.length > 0) {
      fallback = fallback.charAt(0).toUpperCase() + fallback.slice(1);
    }
    return fallback;
  }

  setSeed(seed: number | string): void {
    this.seedNumeric = resolveSeed(seed);
    this.rng = mulberry32(this.seedNumeric);
  }

  reset(): void {
    this.chain.clear();
    this.starts = [];
    this.trainedTokens = 0;
  }

  count(): number { return this.trainedTokens; }

  // Number of unique prefix states in the chain - useful for
  // diagnostics + tests.
  states(): number { return this.chain.size; }

  // ---------- private ----------

  private recomputeStarts(): void {
    var startKey = repeat(this.startToken, this.order);
    var bucket = this.chain.get(startKey);
    this.starts = [];
    if (bucket) {
      var iter = bucket.keys();
      var v = iter.next();
      while (!v.done) {
        // Push proportional to weight to make weighted-random simpler.
        var weight = bucket.get(v.value) || 0;
        for (var i = 0; i < weight; i++) this.starts.push(v.value);
        v = iter.next();
      }
    }
  }

  private buildOne(maxLen: number): string {
    var startKey = repeat(this.startToken, this.order);
    var prefix = startKey;
    var out = '';
    while (out.length < maxLen) {
      var bucket = this.chain.get(prefix);
      if (!bucket || bucket.size === 0) break;
      var ch = this.weightedPick(bucket);
      if (ch === this.endToken) break;
      out += ch;
      prefix = (prefix + ch).slice(-this.order);
    }
    return out;
  }

  private weightedPick(bucket: Map<string, number>): string {
    var total = 0;
    var iter = bucket.values();
    var v = iter.next();
    while (!v.done) { total += v.value; v = iter.next(); }
    if (total <= 0) return this.endToken;
    var roll = this.rng() * total;
    var acc = 0;
    var iter2 = bucket.entries();
    var e = iter2.next();
    while (!e.done) {
      acc += e.value[1];
      if (roll < acc) return e.value[0];
      e = iter2.next();
    }
    // numerical edge case
    return this.endToken;
  }
}

function repeat(s: string, n: number): string {
  var out = '';
  for (var i = 0; i < n; i++) out += s;
  return out;
}

// Resource key for the world's resource registry.
export const RESOURCE_NAME_GENERATOR = 'name_generator';
