// GeneticPersonaEngine - a 256-bit genome table with seeded-PRNG
// bitwise crossover and mutation.
//
// The Trinity dossier's section 15 (Gemini Volume I). The Gemini
// sketch's mutate(entityId, seed) flipped genome bits with a mask
// derived from a raw per-call seed, sketched alongside a Math.random()
// path; Codex flagged "deterministic replay and authority mapping are
// unsafe". This rebuild closes that: every random draw comes from an
// injected IEntropy stream - the engine's seeded PRNG resource - never
// Math.random, so an evolution replayed from the same entropy sequence
// is bit-identical. Authority mapping is closed by omission: this
// module stores genomes and nothing else; it never maps a genome to
// wealth, social reach, or truth authority. That wiring, if a consumer
// wants it, is the consumer's gated policy, never the engine's.
//
// A genome is 256 bits - 8 x Uint32 - per entity, indexed by an
// externally-owned entityId. The engine attaches a persona genome to
// an entity the consumer's allocator owns; it is a component table,
// not a slot pool, so it carries no generation handle of its own (the
// entity's allocator owns liveness; this table owns the 256 bits).
// Storage is one flat Uint32Array.
//
// The 5 Codex gates, enforced:
//   1. seeded PRNG only - randomize / mutate / crossover take an
//      IEntropy; the module holds no RNG of its own and never calls
//      Math.random. The same entropy stream in yields bit-identical
//      genomes out, so a seeded world replays its evolution exactly.
//   2. bounds-checked ids - every entityId, trait bit, and word index
//      is range-validated before it indexes the genome array; a bad id
//      throws a RangeError instead of reading a neighbour's bits.
//   3. non-allocating reads - getTrait / getGenomeWord /
//      hammingDistance are pure integer bit math over the flat array;
//      they allocate nothing and return primitives, safe on a hot
//      AI-tick read path.
//   4. no authority mapping - the module exposes genome bits and a
//      Hamming distance and stops there. It deliberately offers no
//      "fitness", "influence", or "authority" surface; a genome bit is
//      inert data until a consumer's gated policy reads it.
//   5. single-thread ownership - one owner calls randomize / mutate /
//      crossover / setGenome / clear. The genome array is not
//      concurrency-safe; a worker-parallel consumer drains its
//      breeding ops onto the owning thread.

import type { IEntropy } from './entropy.js';

// A genome is GENOME_WORDS x 32-bit = GENOME_BITS bits.
export const GENOME_WORDS = 8;
export const GENOME_BITS = 256;

// Sanity cap on the constructor-derived genome table size. Not a hard
// engine limit - just a guard so a bad argument throws a clear error
// instead of attempting an absurd typed-array allocation.
const MAX_CAPACITY = 1 << 20;

// Count the set bits of a uint32 - the classic SWAR popcount, pure
// integer math, no allocation. Used by hammingDistance.
function popcount32(v: number): number {
  let x = v >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

// Gate 1: the module never owns randomness. Every random draw is
// pulled from a caller-supplied IEntropy, so a bad argument here is a
// programmer error worth a hard throw.
function requireEntropy(entropy: IEntropy, op: string): void {
  if (!entropy || typeof entropy.int !== 'function' || typeof entropy.random !== 'function') {
    throw new TypeError('GeneticPersonaEngine.' + op + ': entropy must implement IEntropy');
  }
}

export class GeneticPersonaEngine {
  // Number of entities the table can hold a genome for.
  readonly capacity: number;

  // Flat genome storage: entity e's 256-bit genome is the
  // GENOME_WORDS-word slice genomes[e * GENOME_WORDS .. + GENOME_WORDS).
  private readonly genomes: Uint32Array;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      throw new RangeError(
        'GeneticPersonaEngine: capacity must be an integer in [1, ' + MAX_CAPACITY + '], got ' + capacity,
      );
    }
    this.capacity = capacity;
    this.genomes = new Uint32Array(capacity * GENOME_WORDS);
  }

  // ---------- genome authoring ----------

  // Fill an entity's genome with GENOME_WORDS fresh words drawn from
  // the entropy stream. Gate 1: deterministic for a given stream.
  randomize(entityId: number, entropy: IEntropy): void {
    this.requireEntity(entityId, 'randomize');
    requireEntropy(entropy, 'randomize');
    const base = entityId * GENOME_WORDS;
    for (let w = 0; w < GENOME_WORDS; w++) {
      this.genomes[base + w] = entropy.int(0, 0xffffffff) >>> 0;
    }
  }

  // Overwrite an entity's genome from a caller-supplied word array.
  // For deterministic persona authoring and for seeding known genomes
  // in tests. `words` must have at least GENOME_WORDS elements.
  setGenome(entityId: number, words: ArrayLike<number>): void {
    this.requireEntity(entityId, 'setGenome');
    if (!words || words.length < GENOME_WORDS) {
      throw new RangeError(
        'GeneticPersonaEngine.setGenome: words must have at least ' + GENOME_WORDS + ' elements',
      );
    }
    const base = entityId * GENOME_WORDS;
    for (let w = 0; w < GENOME_WORDS; w++) {
      this.genomes[base + w] = (words[w] ?? 0) >>> 0;
    }
  }

  // Copy one entity's genome over another's. A no-op when src === dst.
  copyGenome(srcId: number, dstId: number): void {
    this.requireEntity(srcId, 'copyGenome');
    this.requireEntity(dstId, 'copyGenome');
    if (srcId === dstId) return;
    const s = srcId * GENOME_WORDS;
    const d = dstId * GENOME_WORDS;
    for (let w = 0; w < GENOME_WORDS; w++) {
      this.genomes[d + w] = this.genomes[s + w] ?? 0;
    }
  }

  // Zero one entity's genome.
  clearGenome(entityId: number): void {
    this.requireEntity(entityId, 'clearGenome');
    const base = entityId * GENOME_WORDS;
    for (let w = 0; w < GENOME_WORDS; w++) {
      this.genomes[base + w] = 0;
    }
  }

  // ---------- evolution ----------

  // Flip mutationCount genome bits, each chosen independently and
  // uniformly from the entropy stream. A bit chosen twice toggles back,
  // so the effective change is at most mutationCount bits.
  mutate(entityId: number, entropy: IEntropy, mutationCount: number): void {
    this.requireEntity(entityId, 'mutate');
    requireEntropy(entropy, 'mutate');
    if (!Number.isInteger(mutationCount) || mutationCount < 0 || mutationCount > GENOME_BITS) {
      throw new RangeError(
        'GeneticPersonaEngine.mutate: mutationCount ' + mutationCount
        + ' out of [0, ' + GENOME_BITS + ']',
      );
    }
    const base = entityId * GENOME_WORDS;
    for (let k = 0; k < mutationCount; k++) {
      const bit = entropy.int(0, GENOME_BITS - 1);
      const idx = base + (bit >>> 5);
      this.genomes[idx] = ((this.genomes[idx] ?? 0) ^ (1 << (bit & 31))) >>> 0;
    }
  }

  // Uniform crossover: build childId's genome by taking each bit from
  // parentA where a per-word entropy mask bit is set, and from parentB
  // where it is clear. Both parent words are read before the child word
  // is written, so childId may safely alias parentA or parentB.
  crossover(parentA: number, parentB: number, childId: number, entropy: IEntropy): void {
    this.requireEntity(parentA, 'crossover');
    this.requireEntity(parentB, 'crossover');
    this.requireEntity(childId, 'crossover');
    requireEntropy(entropy, 'crossover');
    const baseA = parentA * GENOME_WORDS;
    const baseB = parentB * GENOME_WORDS;
    const baseC = childId * GENOME_WORDS;
    for (let w = 0; w < GENOME_WORDS; w++) {
      const a = this.genomes[baseA + w] ?? 0;
      const b = this.genomes[baseB + w] ?? 0;
      const mask = entropy.int(0, 0xffffffff) >>> 0;
      this.genomes[baseC + w] = ((a & mask) | (b & ~mask)) >>> 0;
    }
  }

  // ---------- reads ----------

  // Read a single trait bit [0, GENOME_BITS). Non-allocating.
  getTrait(entityId: number, traitBit: number): boolean {
    this.requireEntity(entityId, 'getTrait');
    this.requireTraitBit(traitBit, 'getTrait');
    const word = this.genomes[entityId * GENOME_WORDS + (traitBit >>> 5)] ?? 0;
    return (word & (1 << (traitBit & 31))) !== 0;
  }

  // Set or clear a single trait bit [0, GENOME_BITS).
  setTrait(entityId: number, traitBit: number, value: boolean): void {
    this.requireEntity(entityId, 'setTrait');
    this.requireTraitBit(traitBit, 'setTrait');
    const idx = entityId * GENOME_WORDS + (traitBit >>> 5);
    const mask = 1 << (traitBit & 31);
    const cur = this.genomes[idx] ?? 0;
    this.genomes[idx] = (value ? cur | mask : cur & ~mask) >>> 0;
  }

  // Read a raw genome word [0, GENOME_WORDS) as a uint32. Non-allocating
  // - the building block for genome serialization and equality checks.
  getGenomeWord(entityId: number, wordIndex: number): number {
    this.requireEntity(entityId, 'getGenomeWord');
    this.requireWordIndex(wordIndex, 'getGenomeWord');
    return (this.genomes[entityId * GENOME_WORDS + wordIndex] ?? 0) >>> 0;
  }

  // The Hamming distance between two genomes - the count of differing
  // bits, [0, GENOME_BITS]. Pure integer bit math, non-allocating; the
  // genetic-similarity primitive a consumer's selection policy reads.
  hammingDistance(entityA: number, entityB: number): number {
    this.requireEntity(entityA, 'hammingDistance');
    this.requireEntity(entityB, 'hammingDistance');
    const baseA = entityA * GENOME_WORDS;
    const baseB = entityB * GENOME_WORDS;
    let total = 0;
    for (let w = 0; w < GENOME_WORDS; w++) {
      total += popcount32(((this.genomes[baseA + w] ?? 0) ^ (this.genomes[baseB + w] ?? 0)) >>> 0);
    }
    return total;
  }

  // ---------- lifecycle ----------

  // Reset every genome in the table to zero.
  clear(): void {
    this.genomes.fill(0);
  }

  // ---------- private ----------

  private requireEntity(entityId: number, op: string): void {
    if (!Number.isInteger(entityId) || entityId < 0 || entityId >= this.capacity) {
      throw new RangeError(
        'GeneticPersonaEngine.' + op + ': entityId ' + entityId + ' out of [0, ' + this.capacity + ')',
      );
    }
  }

  private requireTraitBit(traitBit: number, op: string): void {
    if (!Number.isInteger(traitBit) || traitBit < 0 || traitBit >= GENOME_BITS) {
      throw new RangeError(
        'GeneticPersonaEngine.' + op + ': traitBit ' + traitBit + ' out of [0, ' + GENOME_BITS + ')',
      );
    }
  }

  private requireWordIndex(wordIndex: number, op: string): void {
    if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= GENOME_WORDS) {
      throw new RangeError(
        'GeneticPersonaEngine.' + op + ': wordIndex ' + wordIndex + ' out of [0, ' + GENOME_WORDS + ')',
      );
    }
  }
}
