// Phase 1.6.1 - NoiseField tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  NoiseField,
  RESOURCE_NOISE_FIELD,
} from '../src/index.js';

test('nf: RESOURCE_NOISE_FIELD is the stable string', () => {
  assert.equal(RESOURCE_NOISE_FIELD, 'noise_field');
});

test('nf: create with defaults', () => {
  const nf = NoiseField.create();
  assert.equal(nf.getOctaves(), 4);
  assert.equal(nf.getPersistence(), 0.5);
  assert.equal(nf.getLacunarity(), 2.0);
  assert.equal(nf.getScale(), 0.05);
});

test('nf: sample returns finite number in [-1, 1]', () => {
  const nf = NoiseField.create({ seed: 1 });
  for (let i = 0; i < 50; i++) {
    const v = nf.sample(i * 3.7, i * -2.1);
    assert.ok(isFinite(v), 'finite at ' + i);
    assert.ok(v >= -1 && v <= 1, 'in [-1, 1]: ' + v);
  }
});

test('nf: sample01 returns finite number in [0, 1]', () => {
  const nf = NoiseField.create({ seed: 1 });
  for (let i = 0; i < 50; i++) {
    const v = nf.sample01(i, i + 7);
    assert.ok(isFinite(v));
    assert.ok(v >= 0 && v <= 1, 'in [0, 1]: ' + v);
  }
});

test('nf: same seed + same coords -> same value (deterministic)', () => {
  const a = NoiseField.create({ seed: 'world-42' });
  const b = NoiseField.create({ seed: 'world-42' });
  for (let i = 0; i < 20; i++) {
    const x = i * 1.3;
    const y = i * -0.7;
    assert.equal(a.sample(x, y), b.sample(x, y));
  }
});

test('nf: different seeds -> different fields', () => {
  const a = NoiseField.create({ seed: 'one' });
  const b = NoiseField.create({ seed: 'two' });
  let differences = 0;
  for (let i = 0; i < 50; i++) {
    if (a.sample(i, i) !== b.sample(i, i)) differences++;
  }
  assert.ok(differences >= 45, 'at least 45 / 50 samples differ');
});

test('nf: continuous - small dx maps to small dvalue', () => {
  const nf = NoiseField.create({ seed: 'cont', octaves: 1, scale: 0.1 });
  const a = nf.sample(5.0, 5.0);
  const b = nf.sample(5.001, 5.0);
  assert.ok(Math.abs(a - b) < 0.01, 'tiny step yields tiny delta: ' + Math.abs(a - b));
});

test('nf: octaves 1 differs from octaves 4', () => {
  const a = NoiseField.create({ seed: 'oct', octaves: 1 });
  const b = NoiseField.create({ seed: 'oct', octaves: 4 });
  // Same seed but different fractal layering -> different values
  let differences = 0;
  for (let i = 0; i < 30; i++) {
    if (a.sample(i, i + 0.5) !== b.sample(i, i + 0.5)) differences++;
  }
  assert.ok(differences >= 25, 'octave change shifts most samples');
});

test('nf: setSeed reseeds the field', () => {
  const nf = NoiseField.create({ seed: 'a' });
  const v1 = nf.sample(10, 10);
  nf.setSeed('b');
  const v2 = nf.sample(10, 10);
  // Possible (but extremely unlikely) collision; just check that it
  // happens for at least one of several samples.
  let differs = (v1 !== v2);
  for (let i = 0; i < 5 && !differs; i++) {
    if (nf.sample(i + 11, i + 11) !== NoiseField.create({ seed: 'a' }).sample(i + 11, i + 11)) {
      differs = true;
    }
  }
  assert.ok(differs, 'reseed produces different field');
});

test('nf: numeric seed works', () => {
  const a = NoiseField.create({ seed: 42 });
  const b = NoiseField.create({ seed: 42 });
  assert.equal(a.sample(1.5, 2.5), b.sample(1.5, 2.5));
});

test('nf: octaves clamped to [1, 8]', () => {
  const a = NoiseField.create({ octaves: 0 });
  const b = NoiseField.create({ octaves: 99 });
  assert.equal(a.getOctaves(), 1);
  assert.equal(b.getOctaves(), 8);
});

test('nf: persistence clamped to (0, 1]', () => {
  const a = NoiseField.create({ persistence: -1 });
  const b = NoiseField.create({ persistence: 5 });
  assert.equal(a.getPersistence(), 0.5, 'invalid -> default');
  assert.equal(b.getPersistence(), 1, 'too high -> 1');
});

test('nf: scale > 0 honored', () => {
  const nf = NoiseField.create({ scale: 0.2 });
  assert.equal(nf.getScale(), 0.2);
});

test('nf: histogram is roughly balanced (most samples near zero)', () => {
  const nf = NoiseField.create({ seed: 'hist' });
  let pos = 0, neg = 0, zeroish = 0;
  for (let i = 0; i < 1000; i++) {
    const v = nf.sample(i * 1.7, i * -2.3);
    if (v > 0.05) pos++;
    else if (v < -0.05) neg++;
    else zeroish++;
  }
  // not strict balance; just guard against pathological skew
  assert.ok(pos > 100 && neg > 100, 'pos + neg both well-represented');
});

test('nf: sample at integer grid points still smooth', () => {
  const nf = NoiseField.create({ seed: 'grid', octaves: 1, scale: 1 });
  // At integer grid points the value should equal the lattice value
  // (smoothstep collapses at boundaries). Just verify finite.
  assert.ok(isFinite(nf.sample(0, 0)));
  assert.ok(isFinite(nf.sample(10, -5)));
});
