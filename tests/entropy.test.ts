// Loom Engine - seeded entropy resource tests.
//
// Acceptance: same seed -> same sequence; different seeds -> divergent
// sequences. State is checkpointable (getState / setState round-trips).
// pick() and int() honour their range contracts. Engine.create wires
// RESOURCE_ENTROPY by default so consumer code can require() it.
//
// Phase 0.17.0: this is the new tripwire that catches future
// Math.random() regressions in src/. The engine ships seeded RNG so
// trace replays / network sync / save state can reproduce exactly.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Entropy,
  createEntropy,
  RESOURCE_ENTROPY,
  DEFAULT_ENTROPY_SEED,
  type IEntropy,
} from '../src/index.js';

test('entropy: same seed produces same sequence', () => {
  const a = createEntropy(42);
  const b = createEntropy(42);
  for (let i = 0; i < 1000; i++) {
    assert.equal(a.random(), b.random(), 'mismatch at i=' + i);
  }
});

test('entropy: different seeds diverge within first 4 calls', () => {
  const a = createEntropy(1);
  const b = createEntropy(2);
  let diverged = false;
  for (let i = 0; i < 4; i++) {
    if (a.random() !== b.random()) {
      diverged = true;
      break;
    }
  }
  assert.ok(diverged, 'sequences should diverge quickly across seeds');
});

test('entropy: random() output is in [0, 1)', () => {
  const e = createEntropy(0xDEADBEEF);
  for (let i = 0; i < 10000; i++) {
    const r = e.random();
    assert.ok(r >= 0, 'r >= 0, got ' + r);
    assert.ok(r < 1, 'r < 1, got ' + r);
  }
});

test('entropy: getState + setState round-trip preserves the next sample', () => {
  const e = createEntropy(123);
  // Burn 10 samples.
  for (let i = 0; i < 10; i++) e.random();
  const checkpoint = e.getState();
  const next1 = e.random();
  // Restore + replay.
  e.setState(checkpoint);
  const next2 = e.random();
  assert.equal(next1, next2);
});

test('entropy: reseed resets the stream', () => {
  const e = createEntropy(7);
  const seq1 = [e.random(), e.random(), e.random()];
  e.reseed(7);
  const seq2 = [e.random(), e.random(), e.random()];
  assert.deepEqual(seq2, seq1);
});

test('entropy: int() respects inclusive bounds', () => {
  const e = createEntropy(99);
  for (let i = 0; i < 1000; i++) {
    const r = e.int(3, 7);
    assert.ok(r >= 3 && r <= 7, 'r in [3,7], got ' + r);
    assert.equal(r, Math.floor(r), 'int() must return integers');
  }
});

test('entropy: int() throws on inverted range', () => {
  const e = createEntropy(99);
  assert.throws(() => e.int(10, 5), /bad range/);
});

test('entropy: int(min, min) returns min', () => {
  const e = createEntropy(99);
  for (let i = 0; i < 100; i++) {
    assert.equal(e.int(5, 5), 5);
  }
});

test('entropy: pick() picks each element of a 4-array given enough draws', () => {
  const e = createEntropy(999);
  const arr = ['a', 'b', 'c', 'd'];
  const seen: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 4000; i++) {
    const v = e.pick(arr);
    seen[v]! += 1;
  }
  // Each bucket should be at least 800 (~20% lower bound on 25%).
  assert.ok(seen.a! > 800);
  assert.ok(seen.b! > 800);
  assert.ok(seen.c! > 800);
  assert.ok(seen.d! > 800);
});

test('entropy: pick() throws on empty array', () => {
  const e = createEntropy(1);
  assert.throws(() => e.pick([]), /empty array/);
});

test('entropy: DEFAULT_ENTROPY_SEED is a stable u32 constant', () => {
  // The exact value is deliberate (golden ratio fraction). If you bump
  // it, the engine's default-seed visual output changes; bump engine
  // minor version too.
  assert.equal(DEFAULT_ENTROPY_SEED, 0x9e3779b9);
});

test('entropy: RESOURCE_ENTROPY is a stable string constant', () => {
  // Resource keys are public API. Renaming is a breaking change for
  // consumers that wire their own resource overrides.
  assert.equal(RESOURCE_ENTROPY, 'loom.entropy');
});

test('entropy: NaN seed coerces to deterministic stream (no crash)', () => {
  // Defensive: tests that reseed() with bad input still produces a
  // usable stream (mulberry32 cannot be seeded with NaN).
  const a = createEntropy(NaN as unknown as number);
  const b = createEntropy(NaN as unknown as number);
  assert.equal(a.random(), b.random(), 'two NaN-seeded streams agree');
  // The stream is still in [0,1).
  for (let i = 0; i < 10; i++) {
    const r = a.random();
    assert.ok(r >= 0 && r < 1);
  }
});

test('entropy: seed 0 still produces a usable stream (mulberry32 wraps)', () => {
  const e = createEntropy(0);
  // First few outputs are deterministic and within [0,1).
  for (let i = 0; i < 5; i++) {
    const r = e.random();
    assert.ok(r >= 0 && r < 1, 'r in [0,1) for seed 0, got ' + r);
  }
});

test('entropy: Entropy class implements IEntropy structurally', () => {
  const e: IEntropy = new Entropy(1);
  assert.equal(typeof e.random, 'function');
  assert.equal(typeof e.int, 'function');
  assert.equal(typeof e.pick, 'function');
  assert.equal(typeof e.getState, 'function');
  assert.equal(typeof e.setState, 'function');
  assert.equal(typeof e.reseed, 'function');
});
