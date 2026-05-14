// Loom Engine - OmniveilSKB (semantic knowledge base) tests.
//
// Covers constructor validation, the assert / retract / query
// lifecycle, and the 6 Codex gates:
//   gate 1 - active-slot metadata: tombstone reuse keeps a tiny table
//            from spuriously filling; bounds checks reject bad args.
//   gate 2 - identity-verified consensus: a DIRECT hash-collision test
//            (two triples forced onto the same start slot) proves they
//            do not cross-contaminate each other's consensus.
//   gate 3 - source-attributed consensus: re-asserting from one source
//            is idempotent; consensus counts distinct sources.
//   gate 4 - contradiction (isContested / resolveBest) and poisoning
//            (the per-source claim cap).
//   gate 5 - exportClaims copies into a caller-preallocated buffer.
//   gate 6 - single-thread determinism: identical assert/retract runs
//            produce identical state.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { OmniveilSKB, CLAIM_QUAD_STRIDE } from '../src/index.js';

// Mirror of OmniveilSKB's private hashTriple - lets the gate-2 test
// FIND a real hash collision rather than hoping for one.
function fnv1a(s: number, p: number, o: number): number {
  let h = 2166136261;
  h ^= s;
  h = Math.imul(h, 16777619);
  h ^= p;
  h = Math.imul(h, 16777619);
  h ^= o;
  h = Math.imul(h, 16777619);
  return h >>> 0;
}

// Two distinct `object` ids (with subject = predicate = 0) whose
// triples hash to the same start slot under `mask`. Pigeonhole
// guarantees a hit within mask+2 probes.
function findCollidingObjects(mask: number): [number, number] {
  const seen = new Map<number, number>();
  for (let o = 0; o < 100000; o++) {
    const slot = fnv1a(0, 0, o) & mask;
    const prior = seen.get(slot);
    if (prior !== undefined) return [prior, o];
    seen.set(slot, o);
  }
  throw new Error('no hash collision found - unexpected');
}

test('omniveil skb: constructor validates dimensions', () => {
  const skb = new OmniveilSKB(16, 4, 8);
  assert.equal(skb.maxClaims, 16);
  assert.equal(skb.maxSources, 4);
  assert.equal(skb.maxClaimsPerSource, 8);
  assert.equal(skb.getClaimCount(), 0);
  // maxClaims must be a power of two in range.
  assert.throws(() => new OmniveilSKB(3, 4, 2), /power of two/);
  assert.throws(() => new OmniveilSKB(0, 4, 2), /power of two/);
  assert.throws(() => new OmniveilSKB((1 << 20) * 2, 4, 2), /power of two/);
  // maxSources bounds.
  assert.throws(() => new OmniveilSKB(16, 0, 2), /maxSources/);
  assert.throws(() => new OmniveilSKB(16, 257, 2), /maxSources/);
  // maxClaimsPerSource bounds (cannot exceed maxClaims).
  assert.throws(() => new OmniveilSKB(16, 4, 0), /maxClaimsPerSource/);
  assert.throws(() => new OmniveilSKB(16, 4, 17), /maxClaimsPerSource/);
  assert.doesNotThrow(() => new OmniveilSKB(16, 4, 16));
  assert.equal(CLAIM_QUAD_STRIDE, 4);
});

test('omniveil skb: assert / consensusOf / hasClaim round-trip', () => {
  const skb = new OmniveilSKB(64, 8, 64);
  // An unknown triple has no consensus.
  assert.equal(skb.consensusOf(1, 2, 3), 0);
  assert.equal(skb.hasClaim(1, 2, 3), false);
  // First assert -> consensus 1.
  assert.equal(skb.assertClaim(0, 1, 2, 3), 1);
  assert.equal(skb.consensusOf(1, 2, 3), 1);
  assert.equal(skb.hasClaim(1, 2, 3), true);
  assert.equal(skb.hasSourceClaimed(0, 1, 2, 3), true);
  assert.equal(skb.hasSourceClaimed(1, 1, 2, 3), false);
  assert.equal(skb.getClaimCount(), 1);
});

test('omniveil skb: consensus counts DISTINCT sources, re-asserts are idempotent (gate 3)', () => {
  const skb = new OmniveilSKB(64, 8, 64);
  // The same source asserting the same triple repeatedly: consensus stays 1.
  assert.equal(skb.assertClaim(2, 7, 7, 7), 1);
  assert.equal(skb.assertClaim(2, 7, 7, 7), 1);
  assert.equal(skb.assertClaim(2, 7, 7, 7), 1);
  assert.equal(skb.consensusOf(7, 7, 7), 1, 'one source cannot inflate consensus');
  assert.equal(skb.getSourceClaimCount(2), 1, 'idempotent re-claims do not consume cap budget');
  // Distinct sources each add one to consensus.
  assert.equal(skb.assertClaim(3, 7, 7, 7), 2);
  assert.equal(skb.assertClaim(4, 7, 7, 7), 3);
  assert.equal(skb.consensusOf(7, 7, 7), 3);
});

test('omniveil skb: a hash collision does not cross-contaminate consensus (gate 2)', () => {
  // The headline fix. The Gemini sketch incremented consensus at the
  // hashed slot blind; two triples that hash together would share a
  // counter. Force a real collision and prove they stay separate.
  const [objA, objB] = findCollidingObjects(15);   // mask for maxClaims 16
  assert.notEqual(objA, objB);
  assert.equal(fnv1a(0, 0, objA) & 15, fnv1a(0, 0, objB) & 15, 'the two triples really collide');
  const skb = new OmniveilSKB(16, 8, 16);
  // Triple A claimed by 3 sources, triple B by 1 - same start slot.
  skb.assertClaim(1, 0, 0, objA);
  skb.assertClaim(2, 0, 0, objA);
  skb.assertClaim(3, 0, 0, objA);
  skb.assertClaim(1, 0, 0, objB);
  assert.equal(skb.consensusOf(0, 0, objA), 3, 'colliding triple A keeps its own consensus');
  assert.equal(skb.consensusOf(0, 0, objB), 1, 'colliding triple B is not cross-contaminated');
  assert.equal(skb.getClaimCount(), 2, 'both triples occupy their own slot');
});

test('omniveil skb: many distinct triples each keep their own consensus under heavy probing', () => {
  // A near-full table forces long probe chains - every triple must
  // still resolve to exactly its own slot.
  const skb = new OmniveilSKB(64, 16, 64);
  for (let i = 0; i < 50; i++) {
    // triple i is claimed by (i % 4) + 1 distinct sources.
    const sourceCount = (i % 4) + 1;
    for (let src = 0; src < sourceCount; src++) {
      skb.assertClaim(src, i, i * 2, i * 3);
    }
  }
  for (let i = 0; i < 50; i++) {
    assert.equal(skb.consensusOf(i, i * 2, i * 3), (i % 4) + 1, 'triple ' + i + ' consensus intact');
  }
  assert.equal(skb.getClaimCount(), 50);
});

test('omniveil skb: assertClaim validates source and triple ids', () => {
  const skb = new OmniveilSKB(16, 4, 16);
  assert.throws(() => skb.assertClaim(-1, 0, 0, 0), /source/);
  assert.throws(() => skb.assertClaim(4, 0, 0, 0), /source/);
  assert.throws(() => skb.assertClaim(0, -1, 0, 0), /subject/);
  assert.throws(() => skb.assertClaim(0, 0, 1.5, 0), /predicate/);
  assert.throws(() => skb.assertClaim(0, 0, 0, 0x100000000), /object/);
  assert.throws(() => skb.getSourceClaimCount(4), /source/);
});

test('omniveil skb: retract drops consensus, frees the slot at zero, reuses the tombstone', () => {
  const skb = new OmniveilSKB(64, 8, 64);
  skb.assertClaim(1, 5, 5, 5);
  skb.assertClaim(2, 5, 5, 5);
  assert.equal(skb.consensusOf(5, 5, 5), 2);
  // Retract one source.
  assert.equal(skb.retractClaim(1, 5, 5, 5), true);
  assert.equal(skb.consensusOf(5, 5, 5), 1);
  assert.equal(skb.hasSourceClaimed(1, 5, 5, 5), false);
  assert.equal(skb.hasSourceClaimed(2, 5, 5, 5), true);
  // Retracting a source that never claimed it, or an unknown triple, is false.
  assert.equal(skb.retractClaim(3, 5, 5, 5), false);
  assert.equal(skb.retractClaim(1, 9, 9, 9), false);
  // Retract the last source - the claim is gone.
  assert.equal(skb.retractClaim(2, 5, 5, 5), true);
  assert.equal(skb.consensusOf(5, 5, 5), 0);
  assert.equal(skb.hasClaim(5, 5, 5), false);
  assert.equal(skb.getClaimCount(), 0);
  assert.equal(skb.getSourceClaimCount(1), 0);
  assert.equal(skb.getSourceClaimCount(2), 0);
  // Re-asserting after a full retract reuses the tombstoned slot.
  assert.equal(skb.assertClaim(1, 5, 5, 5), 1);
  assert.equal(skb.getClaimCount(), 1);
});

test('omniveil skb: tombstone reuse keeps a tiny table from filling (gate 1)', () => {
  // maxClaims 2: without tombstone reuse an assert/retract loop would
  // eventually throw "table full"; with it, the slots recycle forever.
  const skb = new OmniveilSKB(2, 4, 2);
  for (let i = 0; i < 64; i++) {
    assert.equal(skb.assertClaim(0, i, i, i), 1);
    assert.equal(skb.retractClaim(0, i, i, i), true);
  }
  assert.equal(skb.getClaimCount(), 0);
  // Two fresh claims still fit.
  assert.doesNotThrow(() => skb.assertClaim(0, 100, 100, 100));
  assert.doesNotThrow(() => skb.assertClaim(0, 200, 200, 200));
});

test('omniveil skb: a genuinely full table throws on a new triple', () => {
  const skb = new OmniveilSKB(2, 4, 2);
  skb.assertClaim(0, 1, 1, 1);
  skb.assertClaim(0, 2, 2, 2);
  // Both slots are ACTIVE and hold other triples - no room for a third.
  assert.throws(() => skb.assertClaim(0, 3, 3, 3), /table full/);
  // But re-asserting an existing triple is always fine.
  assert.equal(skb.assertClaim(1, 1, 1, 1), 2);
});

test('omniveil skb: per-source claim cap blocks table flooding (gate 4 - poisoning)', () => {
  const skb = new OmniveilSKB(64, 8, 2);   // each source may assert at most 2 distinct triples
  assert.equal(skb.assertClaim(1, 1, 1, 1), 1);
  assert.equal(skb.assertClaim(1, 2, 2, 2), 1);
  assert.equal(skb.getSourceClaimCount(1), 2);
  // Source 1 is at its cap - a third distinct triple is rejected (returns 0).
  assert.equal(skb.assertClaim(1, 3, 3, 3), 0, 'capped source rejected on a new triple');
  assert.equal(skb.hasClaim(3, 3, 3), false, 'the rejected triple was not occupied');
  // Another source asserts (3,3,3); source 1 - still capped - cannot join it.
  assert.equal(skb.assertClaim(2, 3, 3, 3), 1);
  assert.equal(skb.assertClaim(1, 3, 3, 3), 0, 'capped source rejected even for an existing claim');
  assert.equal(skb.consensusOf(3, 3, 3), 1, 'consensus not bumped by the rejected assert');
  // A re-claim of a triple source 1 ALREADY asserts is idempotent, allowed at cap.
  assert.equal(skb.assertClaim(1, 1, 1, 1), 1);
  // Retracting frees budget - source 1 can claim once more.
  assert.equal(skb.retractClaim(1, 1, 1, 1), true);
  assert.equal(skb.getSourceClaimCount(1), 1);
  assert.equal(skb.assertClaim(1, 3, 3, 3), 2, 'freed budget -> the assert lands');
});

test('omniveil skb: isContested and resolveBest surface contradictions (gate 4)', () => {
  const skb = new OmniveilSKB(64, 8, 64);
  // (10,20) -> object 100 has 3 sources, object 200 has 1: a contradiction.
  skb.assertClaim(1, 10, 20, 100);
  skb.assertClaim(2, 10, 20, 100);
  skb.assertClaim(3, 10, 20, 100);
  skb.assertClaim(1, 10, 20, 200);
  assert.equal(skb.isContested(10, 20), true);
  assert.equal(skb.resolveBest(10, 20), 100, 'highest distinct-source consensus wins');
  // A subject+predicate with one object is not contested.
  assert.equal(skb.isContested(10, 21), false);
  assert.equal(skb.resolveBest(10, 21), -1, 'no claims -> -1');
  skb.assertClaim(1, 10, 21, 555);
  assert.equal(skb.isContested(10, 21), false);
  assert.equal(skb.resolveBest(10, 21), 555);
  // A tie resolves deterministically to the lower object id.
  skb.assertClaim(5, 30, 30, 900);
  skb.assertClaim(6, 30, 30, 800);
  assert.equal(skb.isContested(30, 30), true);
  assert.equal(skb.resolveBest(30, 30), 800, 'tie -> lowest object id');
});

test('omniveil skb: exportClaims copies into a caller-preallocated buffer (gate 5)', () => {
  const skb = new OmniveilSKB(64, 8, 64);
  skb.assertClaim(1, 1, 2, 3);
  skb.assertClaim(1, 4, 5, 6);
  skb.assertClaim(2, 1, 2, 3);   // (1,2,3) -> consensus 2
  assert.equal(skb.getClaimCount(), 2);
  const out = new Uint32Array(2 * CLAIM_QUAD_STRIDE);
  assert.equal(skb.exportClaims(out), 2);
  // Export order is slot order, not insert order - sort for comparison.
  const quads: number[][] = [];
  for (let i = 0; i < 2; i++) quads.push(Array.from(out.subarray(i * 4, i * 4 + 4)));
  quads.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  assert.deepEqual(quads, [[1, 2, 3, 2], [4, 5, 6, 1]]);
  // A short buffer truncates the result.
  const small = new Uint32Array(CLAIM_QUAD_STRIDE);
  assert.equal(skb.exportClaims(small), 1);
});

test('omniveil skb: clear resets claims, sources, and counts', () => {
  const skb = new OmniveilSKB(64, 8, 64);
  skb.assertClaim(1, 1, 1, 1);
  skb.assertClaim(2, 1, 1, 1);
  skb.assertClaim(1, 2, 2, 2);
  assert.equal(skb.getClaimCount(), 2);
  assert.equal(skb.getSourceClaimCount(1), 2);
  skb.clear();
  assert.equal(skb.getClaimCount(), 0);
  assert.equal(skb.getSourceClaimCount(1), 0);
  assert.equal(skb.consensusOf(1, 1, 1), 0);
  assert.equal(skb.hasClaim(1, 1, 1), false);
  // Reusable after clear().
  assert.equal(skb.assertClaim(1, 9, 9, 9), 1);
});

test('omniveil skb: assert / retract is deterministic - identical runs match (gate 6)', () => {
  function run(): number[] {
    const skb = new OmniveilSKB(128, 16, 50);
    for (let i = 0; i < 60; i++) {
      skb.assertClaim(i % 16, i % 7, i % 5, i % 11);
    }
    for (let i = 0; i < 20; i++) {
      skb.retractClaim(i % 16, i % 7, i % 5, i % 11);
    }
    const out = new Uint32Array(128 * CLAIM_QUAD_STRIDE);
    const n = skb.exportClaims(out);
    return [n, ...Array.from(out.subarray(0, n * CLAIM_QUAD_STRIDE))];
  }
  assert.deepEqual(run(), run(), 'no RNG, no clock - the knowledge base is fully reproducible');
});
