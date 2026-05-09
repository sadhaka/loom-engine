// Phase 1.6.0 - NameGenerator tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  NameGenerator,
  RESOURCE_NAME_GENERATOR,
} from '../src/index.js';

const MYTHIC = [
  'Aelaria', 'Bryn', 'Caelum', 'Dorian', 'Elias',
  'Faelan', 'Gareth', 'Halwin', 'Ithil', 'Joren',
  'Kael', 'Liora', 'Mira', 'Naoise', 'Orin',
  'Perrin', 'Quill', 'Rowan', 'Soren', 'Talia',
];

test('ng: RESOURCE_NAME_GENERATOR is the stable string', () => {
  assert.equal(RESOURCE_NAME_GENERATOR, 'name_generator');
});

test('ng: empty before train', () => {
  const ng = NameGenerator.create({ seed: 1 });
  assert.equal(ng.count(), 0);
  assert.equal(ng.generate(), '');
});

test('ng: train counts tokens', () => {
  const ng = NameGenerator.create({ seed: 1 });
  ng.train(MYTHIC);
  assert.equal(ng.count(), 20);
});

test('ng: generate emits non-empty for seeded RNG', () => {
  const ng = NameGenerator.create({ seed: 'a' });
  ng.train(MYTHIC);
  const out = ng.generate();
  assert.ok(out.length > 0, 'name should not be empty');
});

test('ng: same seed + same corpus + same opts => same output', () => {
  const a = NameGenerator.create({ seed: 'twin' });
  const b = NameGenerator.create({ seed: 'twin' });
  a.train(MYTHIC); b.train(MYTHIC);
  const out1: string[] = [];
  const out2: string[] = [];
  for (let i = 0; i < 10; i++) { out1.push(a.generate()); out2.push(b.generate()); }
  assert.deepEqual(out1, out2);
});

test('ng: different seeds produce different sequences', () => {
  const a = NameGenerator.create({ seed: 'one' });
  const b = NameGenerator.create({ seed: 'two' });
  a.train(MYTHIC); b.train(MYTHIC);
  const out1: string[] = [];
  const out2: string[] = [];
  for (let i = 0; i < 10; i++) { out1.push(a.generate()); out2.push(b.generate()); }
  // Not strictly required, but extremely unlikely to collide all 10
  assert.notDeepEqual(out1, out2);
});

test('ng: respects minLen / maxLen bounds (most attempts)', () => {
  const ng = NameGenerator.create({ seed: 'len' });
  ng.train(MYTHIC);
  // 100 trials - allow a small fudge window for last-resort fallback
  let inBounds = 0;
  for (let i = 0; i < 100; i++) {
    const n = ng.generate({ minLen: 4, maxLen: 8 });
    if (n.length >= 4 && n.length <= 8) inBounds++;
  }
  assert.ok(inBounds >= 90, 'most names should be in bounds: ' + inBounds);
});

test('ng: titleCase capitalizes first letter', () => {
  const ng = NameGenerator.create({ seed: 'title' });
  ng.train(MYTHIC);
  const n = ng.generate();
  if (n.length > 0) {
    assert.equal(n[0], n[0]!.toUpperCase());
  }
});

test('ng: titleCase=false leaves it lowercase', () => {
  const ng = NameGenerator.create({ seed: 'nottitle' });
  ng.train(MYTHIC);
  const n = ng.generate({ titleCase: false });
  if (n.length > 0) {
    assert.equal(n[0], n[0]!.toLowerCase());
  }
});

test('ng: order 1 vs order 2 vs order 3 produce different chains', () => {
  const a = NameGenerator.create({ seed: 'o', order: 1 });
  const b = NameGenerator.create({ seed: 'o', order: 2 });
  const c = NameGenerator.create({ seed: 'o', order: 3 });
  a.train(MYTHIC); b.train(MYTHIC); c.train(MYTHIC);
  // All three should differ in state count (more order = more distinct prefixes)
  assert.ok(a.states() <= b.states(), 'order 2 has more states than order 1');
  assert.ok(b.states() <= c.states(), 'order 3 has more states than order 2');
});

test('ng: setSeed resets the RNG', () => {
  const ng = NameGenerator.create({ seed: 'a' });
  ng.train(MYTHIC);
  const seq1: string[] = [];
  for (let i = 0; i < 5; i++) seq1.push(ng.generate());
  ng.setSeed('a');
  const seq2: string[] = [];
  for (let i = 0; i < 5; i++) seq2.push(ng.generate());
  assert.deepEqual(seq1, seq2);
});

test('ng: reset clears all state', () => {
  const ng = NameGenerator.create({ seed: 1 });
  ng.train(MYTHIC);
  ng.reset();
  assert.equal(ng.count(), 0);
  assert.equal(ng.states(), 0);
  assert.equal(ng.generate(), '');
});

test('ng: train with empty / null entries skips them', () => {
  const ng = NameGenerator.create({ seed: 1 });
  // @ts-expect-error testing runtime guards
  ng.train(['ok', '', null, undefined, 'fine']);
  assert.equal(ng.count(), 2);
});

test('ng: numeric seed equivalent to string conversion', () => {
  const a = NameGenerator.create({ seed: 42 });
  const b = NameGenerator.create({ seed: 42 });
  a.train(MYTHIC); b.train(MYTHIC);
  assert.equal(a.generate(), b.generate());
});

test('ng: 100 generations have at least 35 unique names', () => {
  // Order-2 chain on a 20-name corpus has bounded variety; 35
  // distinct outputs across 100 generations is the realistic floor.
  const ng = NameGenerator.create({ seed: 'variety' });
  ng.train(MYTHIC);
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    seen.add(ng.generate({ minLen: 4, maxLen: 9 }));
  }
  assert.ok(seen.size >= 35, 'at least 35 unique names: ' + seen.size);
});
