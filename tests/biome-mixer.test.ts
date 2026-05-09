// Phase 1.6.4 - BiomeMixer tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  BiomeMixer,
  RESOURCE_BIOME_MIXER,
} from '../src/index.js';

test('bm: RESOURCE_BIOME_MIXER is the stable string', () => {
  assert.equal(RESOURCE_BIOME_MIXER, 'biome_mixer');
});

test('bm: starts empty', () => {
  const bm = BiomeMixer.create();
  assert.equal(bm.count(), 0);
  assert.equal(bm.classify(0, 0), null);
});

test('bm: defineBiome adds + classify hits it', () => {
  const bm = BiomeMixer.create();
  assert.equal(bm.defineBiome({ id: 'desert', minElev: 0, maxElev: 0.5,
                                 minMoist: 0, maxMoist: 0.3 }), true);
  assert.equal(bm.classify(0.2, 0.1), 'desert');
});

test('bm: defineBiome rejects empty id / duplicate / inverted', () => {
  const bm = BiomeMixer.create();
  assert.equal(bm.defineBiome({ id: '', minElev: 0, maxElev: 1 }), false);
  bm.defineBiome({ id: 'x' });
  assert.equal(bm.defineBiome({ id: 'x' }), false);
  assert.equal(bm.defineBiome({ id: 'y', minElev: 1, maxElev: 0 }), false,
               'inverted elev rejected');
});

test('bm: classify returns first-match in insertion order', () => {
  const bm = BiomeMixer.create();
  // Two rules cover the same point; first wins.
  bm.defineBiome({ id: 'first',  minElev: 0, maxElev: 1, minMoist: 0, maxMoist: 1 });
  bm.defineBiome({ id: 'second', minElev: 0, maxElev: 1, minMoist: 0, maxMoist: 1 });
  assert.equal(bm.classify(0.5, 0.5), 'first');
});

test('bm: missing point returns null without fallback', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'desert', minElev: 0, maxElev: 0.5,
                   minMoist: 0, maxMoist: 0.3 });
  assert.equal(bm.classify(0.7, 0.7), null);
});

test('bm: setFallback honored when no rule matches', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'desert', minElev: 0, maxElev: 0.5 });
  bm.defineBiome({ id: 'unknown' });
  bm.setFallback('unknown');
  assert.equal(bm.getFallback(), 'unknown');
  assert.equal(bm.classify(0.7, 0.5), 'unknown');
});

test('bm: setFallback rejects unknown id', () => {
  const bm = BiomeMixer.create();
  bm.setFallback('bogus');
  assert.equal(bm.getFallback(), null);
});

test('bm: omitted ranges default to infinite', () => {
  const bm = BiomeMixer.create();
  // No range spec at all - should match anything.
  bm.defineBiome({ id: 'any' });
  assert.equal(bm.classify(-100, 100), 'any');
  assert.equal(bm.classify(0, 0), 'any');
});

test('bm: standard whittaker layout - 7 biomes', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'ocean',     minElev: -1,    maxElev: -0.2 });
  bm.defineBiome({ id: 'beach',     minElev: -0.2,  maxElev: 0 });
  bm.defineBiome({ id: 'desert',    minElev: 0,     maxElev: 0.4,
                   minMoist: 0,     maxMoist: 0.3 });
  bm.defineBiome({ id: 'grassland', minElev: 0,     maxElev: 0.4,
                   minMoist: 0.3,   maxMoist: 0.7 });
  bm.defineBiome({ id: 'forest',    minElev: 0,     maxElev: 0.5,
                   minMoist: 0.7,   maxMoist: 1 });
  bm.defineBiome({ id: 'mountain',  minElev: 0.5,   maxElev: 0.8 });
  bm.defineBiome({ id: 'snow',      minElev: 0.8,   maxElev: 1 });
  assert.equal(bm.classify(-0.5, 0.5),  'ocean');
  assert.equal(bm.classify(0.2, 0.1),   'desert');
  assert.equal(bm.classify(0.2, 0.5),   'grassland');
  assert.equal(bm.classify(0.2, 0.85),  'forest');
  assert.equal(bm.classify(0.6, 0.5),   'mountain');
  assert.equal(bm.classify(0.95, 0.5),  'snow');
});

test('bm: classifyFull returns id + data payload', () => {
  const bm = BiomeMixer.create<{ color: string }>();
  bm.defineBiome({ id: 'desert', minElev: 0, maxElev: 1, minMoist: 0, maxMoist: 0.3,
                   data: { color: '#dabd6e' } });
  const r = bm.classifyFull(0.5, 0.1);
  assert.equal(r!.id, 'desert');
  assert.equal(r!.data!.color, '#dabd6e');
});

test('bm: removeBiome drops it', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'a' });
  bm.defineBiome({ id: 'b' });
  assert.equal(bm.removeBiome('a'), true);
  assert.equal(bm.hasBiome('a'), false);
  assert.equal(bm.removeBiome('a'), false, 'second remove no-ops');
  assert.equal(bm.hasBiome('b'), true);
});

test('bm: list() preserves insertion order', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'a' });
  bm.defineBiome({ id: 'b' });
  bm.defineBiome({ id: 'c' });
  assert.deepEqual(bm.list(), ['a', 'b', 'c']);
});

test('bm: clear empties + resets fallback', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'a' });
  bm.setFallback('a');
  bm.clear();
  assert.equal(bm.count(), 0);
  assert.equal(bm.getFallback(), null);
});

test('bm: boundary values are inclusive', () => {
  const bm = BiomeMixer.create();
  bm.defineBiome({ id: 'mid', minElev: 0, maxElev: 1, minMoist: 0, maxMoist: 1 });
  assert.equal(bm.classify(0, 0), 'mid');
  assert.equal(bm.classify(1, 1), 'mid');
});
