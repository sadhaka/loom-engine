// Loom Engine - GeneticPersonaEngine (256-bit genome table) tests.
//
// Covers constructor validation, genome authoring (randomize /
// setGenome / copyGenome / clearGenome), the seeded-PRNG evolution ops
// (mutate, crossover), non-allocating reads (getTrait / getGenomeWord /
// hammingDistance), bounds + entropy validation, and the gate-1
// guarantee: a seeded entropy stream reproduces an evolution
// bit-for-bit.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  GeneticPersonaEngine,
  GENOME_WORDS,
  GENOME_BITS,
  createEntropy,
} from '../src/index.js';

// Read every genome word in the table into a flat array - the
// determinism-snapshot primitive for the tests below.
function snapshot(engine: GeneticPersonaEngine): number[] {
  const out: number[] = [];
  for (let e = 0; e < engine.capacity; e++) {
    for (let w = 0; w < GENOME_WORDS; w++) {
      out.push(engine.getGenomeWord(e, w));
    }
  }
  return out;
}

test('genetic persona: constructor validates capacity', () => {
  const g = new GeneticPersonaEngine(16);
  assert.equal(g.capacity, 16);
  assert.throws(() => new GeneticPersonaEngine(0), /capacity/);
  assert.throws(() => new GeneticPersonaEngine(-4), /capacity/);
  assert.throws(() => new GeneticPersonaEngine(2.5), /capacity/);
  assert.throws(() => new GeneticPersonaEngine((1 << 20) + 1), /capacity/);
});

test('genetic persona: GENOME_WORDS / GENOME_BITS are the stable shape', () => {
  assert.equal(GENOME_WORDS, 8);
  assert.equal(GENOME_BITS, 256);
});

test('genetic persona: a fresh table is all-zero', () => {
  const g = new GeneticPersonaEngine(4);
  for (let e = 0; e < 4; e++) {
    for (let w = 0; w < GENOME_WORDS; w++) assert.equal(g.getGenomeWord(e, w), 0);
  }
});

test('genetic persona: setGenome / getGenomeWord round-trip', () => {
  const g = new GeneticPersonaEngine(4);
  g.setGenome(1, [1, 2, 3, 4, 5, 6, 7, 8]);
  for (let w = 0; w < GENOME_WORDS; w++) assert.equal(g.getGenomeWord(1, w), w + 1);
  // Other entities are untouched.
  assert.equal(g.getGenomeWord(0, 0), 0);
  // A high word is coerced to uint32.
  g.setGenome(2, [0xffffffff, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(g.getGenomeWord(2, 0), 0xffffffff);
  // Too-short word arrays are rejected.
  assert.throws(() => g.setGenome(3, [1, 2, 3]), /words/);
});

test('genetic persona: getTrait / setTrait round-trip across words', () => {
  const g = new GeneticPersonaEngine(4);
  assert.equal(g.getTrait(0, 5), false);
  g.setTrait(0, 5, true);
  assert.equal(g.getTrait(0, 5), true);
  assert.equal(g.getTrait(0, 6), false);
  // A bit in a high word (200 -> word 6, bit 8).
  g.setTrait(0, 200, true);
  assert.equal(g.getTrait(0, 200), true);
  assert.notEqual(g.getGenomeWord(0, 6) & (1 << 8), 0);
  // Clearing a bit.
  g.setTrait(0, 5, false);
  assert.equal(g.getTrait(0, 5), false);
  // The 200-bit is still set - setTrait touches one bit only.
  assert.equal(g.getTrait(0, 200), true);
});

test('genetic persona: randomize is deterministic for a given entropy stream', () => {
  const a = new GeneticPersonaEngine(4);
  const b = new GeneticPersonaEngine(4);
  a.randomize(0, createEntropy(12345));
  b.randomize(0, createEntropy(12345));
  for (let w = 0; w < GENOME_WORDS; w++) {
    assert.equal(a.getGenomeWord(0, w), b.getGenomeWord(0, w));
  }
  // A randomized genome is not all-zero (overwhelmingly likely).
  let bits = 0;
  for (let w = 0; w < GENOME_WORDS; w++) bits |= a.getGenomeWord(0, w);
  assert.notEqual(bits, 0);
  // A different seed gives a different genome.
  const c = new GeneticPersonaEngine(4);
  c.randomize(0, createEntropy(99999));
  assert.notEqual(a.getGenomeWord(0, 0), c.getGenomeWord(0, 0));
});

test('genetic persona: mutate flips exactly the bits it draws', () => {
  const g = new GeneticPersonaEngine(4);
  // entity 1 is an untouched copy of entity 0's (all-zero) genome.
  g.copyGenome(0, 1);
  // mutationCount 0 changes nothing.
  g.mutate(0, createEntropy(7), 0);
  assert.equal(g.hammingDistance(0, 1), 0);
  // mutationCount 1 flips exactly one bit.
  g.mutate(0, createEntropy(7), 1);
  assert.equal(g.hammingDistance(0, 1), 1);
  // bounds.
  assert.throws(() => g.mutate(0, createEntropy(1), -1), /mutationCount/);
  assert.throws(() => g.mutate(0, createEntropy(1), GENOME_BITS + 1), /mutationCount/);
});

test('genetic persona: mutate is deterministic for a given entropy stream', () => {
  const a = new GeneticPersonaEngine(4);
  const b = new GeneticPersonaEngine(4);
  a.setGenome(0, [11, 22, 33, 44, 55, 66, 77, 88]);
  b.setGenome(0, [11, 22, 33, 44, 55, 66, 77, 88]);
  a.mutate(0, createEntropy(555), 20);
  b.mutate(0, createEntropy(555), 20);
  for (let w = 0; w < GENOME_WORDS; w++) {
    assert.equal(a.getGenomeWord(0, w), b.getGenomeWord(0, w));
  }
});

test('genetic persona: crossover of a genome with itself reproduces it', () => {
  const g = new GeneticPersonaEngine(4);
  g.randomize(0, createEntropy(2024));
  // (A & mask) | (A & ~mask) === A for any mask, so the child is A.
  g.crossover(0, 0, 1, createEntropy(404));
  for (let w = 0; w < GENOME_WORDS; w++) {
    assert.equal(g.getGenomeWord(1, w), g.getGenomeWord(0, w));
  }
});

test('genetic persona: crossover draws every child bit from one parent or the other', () => {
  const g = new GeneticPersonaEngine(4);
  // parentA all-ones, parentB all-zeros: every child bit is 0 or 1
  // from a real parent - trivially true, but it also proves the child
  // is a strict mix, never a third value.
  g.setGenome(0, [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
    0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]);
  g.setGenome(1, [0, 0, 0, 0, 0, 0, 0, 0]);
  g.crossover(0, 1, 2, createEntropy(31337));
  for (let w = 0; w < GENOME_WORDS; w++) {
    const child = g.getGenomeWord(2, w);
    // Every child bit set must come from parentA (all-ones); every
    // clear bit from parentB (all-zeros). With these parents the child
    // word IS the mask, so it is just some uint32 - the real assertion
    // is that it never escaped the parents, which holds by construction.
    assert.equal(child >>> 0, child);
  }
  // The child is a genuine mix - not equal to either parent (this seed
  // produces a mask that is neither all-ones nor all-zeros).
  let sawFromA = false;
  let sawFromB = false;
  for (let w = 0; w < GENOME_WORDS; w++) {
    const child = g.getGenomeWord(2, w);
    if ((child & 0xffffffff) !== 0) sawFromA = true;
    if ((~child & 0xffffffff) !== 0) sawFromB = true;
  }
  assert.equal(sawFromA, true);
  assert.equal(sawFromB, true);
});

test('genetic persona: crossover is deterministic and child may alias a parent', () => {
  // Non-aliased: child is its own entity.
  const a = new GeneticPersonaEngine(8);
  a.setGenome(0, [1, 2, 3, 4, 5, 6, 7, 8]);
  a.setGenome(1, [8, 7, 6, 5, 4, 3, 2, 1]);
  a.crossover(0, 1, 2, createEntropy(909));
  // Aliased: childId === parentA. Same parents, same entropy stream.
  const b = new GeneticPersonaEngine(8);
  b.setGenome(0, [1, 2, 3, 4, 5, 6, 7, 8]);
  b.setGenome(1, [8, 7, 6, 5, 4, 3, 2, 1]);
  b.crossover(0, 1, 0, createEntropy(909));
  // The aliased child (b entity 0) must equal the non-aliased child
  // (a entity 2) - reading both parent words before writing the child
  // word kept the aliased write correct.
  for (let w = 0; w < GENOME_WORDS; w++) {
    assert.equal(b.getGenomeWord(0, w), a.getGenomeWord(2, w));
  }
});

test('genetic persona: copyGenome clones, and src === dst is a safe no-op', () => {
  const g = new GeneticPersonaEngine(4);
  g.setGenome(0, [9, 9, 9, 9, 9, 9, 9, 9]);
  g.copyGenome(0, 1);
  assert.equal(g.hammingDistance(0, 1), 0);
  // Mutating the clone does not touch the original.
  g.mutate(1, createEntropy(1), 5);
  assert.notEqual(g.hammingDistance(0, 1), 0);
  // src === dst leaves the genome intact.
  const before = g.getGenomeWord(0, 3);
  g.copyGenome(0, 0);
  assert.equal(g.getGenomeWord(0, 3), before);
});

test('genetic persona: hammingDistance counts differing bits', () => {
  const g = new GeneticPersonaEngine(4);
  // Identical genomes -> distance 0.
  assert.equal(g.hammingDistance(0, 1), 0);
  // Full complement -> distance GENOME_BITS.
  g.setGenome(0, [0, 0, 0, 0, 0, 0, 0, 0]);
  g.setGenome(1, [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
    0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]);
  assert.equal(g.hammingDistance(0, 1), GENOME_BITS);
  // A known partial difference: 3 bits in word 0, 1 bit in word 5.
  g.setGenome(2, [0b1011, 0, 0, 0, 0, 1, 0, 0]);
  g.setGenome(3, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(g.hammingDistance(2, 3), 4);
});

test('genetic persona: ids, trait bits, and word indices are bounds-checked', () => {
  const g = new GeneticPersonaEngine(4);
  const e = createEntropy(1);
  assert.throws(() => g.randomize(4, e), /entityId/);
  assert.throws(() => g.randomize(-1, e), /entityId/);
  assert.throws(() => g.mutate(9, e, 1), /entityId/);
  assert.throws(() => g.crossover(0, 4, 1, e), /entityId/);
  assert.throws(() => g.getTrait(0, GENOME_BITS), /traitBit/);
  assert.throws(() => g.getTrait(0, -1), /traitBit/);
  assert.throws(() => g.setTrait(0, GENOME_BITS, true), /traitBit/);
  assert.throws(() => g.getGenomeWord(0, GENOME_WORDS), /wordIndex/);
  assert.throws(() => g.getGenomeWord(0, -1), /wordIndex/);
});

test('genetic persona: the evolution ops reject a non-IEntropy', () => {
  const g = new GeneticPersonaEngine(4);
  assert.throws(() => g.randomize(0, null as unknown as ReturnType<typeof createEntropy>), /entropy/);
  assert.throws(
    () => g.mutate(0, {} as unknown as ReturnType<typeof createEntropy>, 1),
    /entropy/,
  );
  // Has random() but not int() - still not a usable IEntropy.
  assert.throws(
    () => g.crossover(0, 1, 2, { random: () => 0 } as unknown as ReturnType<typeof createEntropy>),
    /entropy/,
  );
});

test('genetic persona: clearGenome and clear zero genomes', () => {
  const g = new GeneticPersonaEngine(4);
  for (let e = 0; e < 4; e++) g.randomize(e, createEntropy(100 + e));
  g.clearGenome(2);
  for (let w = 0; w < GENOME_WORDS; w++) assert.equal(g.getGenomeWord(2, w), 0);
  // Entity 2's neighbours are untouched.
  let other = 0;
  for (let w = 0; w < GENOME_WORDS; w++) other |= g.getGenomeWord(1, w);
  assert.notEqual(other, 0);
  // clear() zeroes the whole table.
  g.clear();
  for (let e = 0; e < 4; e++) {
    for (let w = 0; w < GENOME_WORDS; w++) assert.equal(g.getGenomeWord(e, w), 0);
  }
});

test('genetic persona: a seeded evolution replays bit-for-bit (gate 1)', () => {
  const SEED = 0xbeef;

  // Run a multi-generation breeding loop driven entirely by one seeded
  // entropy stream.
  function evolve(): GeneticPersonaEngine {
    const g = new GeneticPersonaEngine(16);
    const entropy = createEntropy(SEED);
    // Seed the founder population, entities 0..7.
    for (let e = 0; e < 8; e++) g.randomize(e, entropy);
    // Three generations: breed 0..7 pairwise into 8..15, then mutate
    // the children - all draws from the same stream.
    for (let gen = 0; gen < 3; gen++) {
      for (let k = 0; k < 8; k++) {
        const parentA = k % 8;
        const parentB = (k + 3) % 8;
        const child = 8 + k;
        g.crossover(parentA, parentB, child, entropy);
        g.mutate(child, entropy, 6);
      }
      // The children become the next founder pool.
      for (let k = 0; k < 8; k++) g.copyGenome(8 + k, k);
    }
    return g;
  }

  const first = snapshot(evolve());
  const second = snapshot(evolve());
  assert.deepEqual(second, first);
  // And the evolution actually did something - the table is not all-zero.
  let bits = 0;
  for (let i = 0; i < first.length; i++) bits |= first[i] ?? 0;
  assert.notEqual(bits, 0);
});

test('genetic persona: realistic example - select the closest persona to a target', () => {
  const g = new GeneticPersonaEngine(32);
  const entropy = createEntropy(0x1234);
  // A target persona and a population of candidates.
  g.randomize(0, entropy);
  for (let e = 1; e < 32; e++) g.randomize(e, entropy);
  // Find the candidate genetically closest to the target.
  let bestId = 1;
  let bestDist = g.hammingDistance(0, 1);
  for (let e = 2; e < 32; e++) {
    const d = g.hammingDistance(0, e);
    if (d < bestDist) {
      bestDist = d;
      bestId = e;
    }
  }
  assert.ok(bestDist >= 0 && bestDist <= GENOME_BITS);
  // Breed the target with its closest match; the child sits between
  // them in genome space (its distance to each parent is at most the
  // parents' distance to each other).
  g.crossover(0, bestId, 31, createEntropy(0x5678));
  const dParents = g.hammingDistance(0, bestId);
  assert.ok(g.hammingDistance(0, 31) <= dParents);
  assert.ok(g.hammingDistance(bestId, 31) <= dParents);
});
