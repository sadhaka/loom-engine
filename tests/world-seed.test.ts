// Phase 1.6.5 - WorldSeed MILESTONE tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  WorldSeed,
  RESOURCE_WORLD_SEED,
} from '../src/index.js';

test('ws: RESOURCE_WORLD_SEED is the stable string', () => {
  assert.equal(RESOURCE_WORLD_SEED, 'world_seed');
});

test('ws: create with string seed', () => {
  const ws = WorldSeed.create({ seed: 'lastlight-omega' });
  assert.equal(ws.getMasterSeed(), 'lastlight-omega');
  assert.ok(ws.getCorpusSize() > 0, 'has default corpus');
});

test('ws: create with numeric seed', () => {
  const ws = WorldSeed.create({ seed: 42 });
  assert.ok(ws.getMasterSeed().indexOf('n:') === 0, 'numeric seed prefixed n:');
});

test('ws: generateWorld returns full snapshot shape', () => {
  const ws = WorldSeed.create({ seed: 'a' });
  const w = ws.generateWorld({ width: 32, height: 24, regionCount: 6 });
  assert.equal(w.width, 32);
  assert.equal(w.height, 24);
  assert.ok(w.elevation instanceof Float32Array);
  assert.ok(w.moisture instanceof Float32Array);
  assert.ok(w.biomeId instanceof Uint16Array);
  assert.ok(w.regionId instanceof Uint16Array);
  assert.equal(w.elevation.length, 32 * 24);
  assert.equal(w.moisture.length, 32 * 24);
  assert.equal(w.biomeId.length, 32 * 24);
  assert.equal(w.regionId.length, 32 * 24);
  assert.ok(Array.isArray(w.biomeNames));
  assert.ok(Array.isArray(w.regions));
  assert.ok(Array.isArray(w.dungeons));
});

test('ws: same seed reproduces the world byte-for-byte', () => {
  const a = WorldSeed.create({ seed: 'twin' });
  const b = WorldSeed.create({ seed: 'twin' });
  const wa = a.generateWorld({ width: 24, height: 24, regionCount: 8, dungeonCount: 2 });
  const wb = b.generateWorld({ width: 24, height: 24, regionCount: 8, dungeonCount: 2 });
  assert.equal(wa.worldName, wb.worldName);
  assert.equal(wa.regions.length, wb.regions.length);
  for (let i = 0; i < wa.elevation.length; i++) {
    assert.equal(wa.elevation[i], wb.elevation[i]);
    assert.equal(wa.moisture[i], wb.moisture[i]);
    assert.equal(wa.biomeId[i], wb.biomeId[i]);
    assert.equal(wa.regionId[i], wb.regionId[i]);
  }
  for (let i = 0; i < wa.regions.length; i++) {
    assert.equal(wa.regions[i]!.name, wb.regions[i]!.name);
    assert.equal(wa.regions[i]!.centerX, wb.regions[i]!.centerX);
    assert.equal(wa.regions[i]!.centerY, wb.regions[i]!.centerY);
  }
});

test('ws: different seeds produce different worlds', () => {
  const a = WorldSeed.create({ seed: 'one' });
  const b = WorldSeed.create({ seed: 'two' });
  const wa = a.generateWorld({ width: 32, height: 32, regionCount: 8 });
  const wb = b.generateWorld({ width: 32, height: 32, regionCount: 8 });
  let differs = 0;
  for (let i = 0; i < wa.elevation.length; i++) {
    if (wa.elevation[i] !== wb.elevation[i]) differs++;
  }
  assert.ok(differs > wa.elevation.length / 2, 'most cells differ');
  // World names too
  // (may collide rarely; check across two specific seeds)
  // Don't assert names differ - too noisy. The cell data check is decisive.
});

test('ws: every cell gets a valid biome', () => {
  const ws = WorldSeed.create({ seed: 'bio' });
  const w = ws.generateWorld({ width: 24, height: 24, regionCount: 4 });
  for (let i = 0; i < w.biomeId.length; i++) {
    const id = w.biomeId[i]!;
    assert.ok(id < w.biomeNames.length, 'biome index in range: ' + id);
    assert.ok(w.biomeNames[id], 'biome name non-empty');
  }
});

test('ws: every cell gets a region', () => {
  const ws = WorldSeed.create({ seed: 'reg' });
  const w = ws.generateWorld({ width: 24, height: 24, regionCount: 8 });
  for (let i = 0; i < w.regionId.length; i++) {
    const rid = w.regionId[i]!;
    assert.ok(rid < w.regions.length, 'region index in range: ' + rid);
  }
});

test('ws: regionCount honored', () => {
  const ws = WorldSeed.create({ seed: 'count' });
  const w = ws.generateWorld({ width: 32, height: 32, regionCount: 12 });
  assert.equal(w.regions.length, 12);
});

test('ws: dungeonCount honored', () => {
  const ws = WorldSeed.create({ seed: 'dungs' });
  const w = ws.generateWorld({ width: 64, height: 48, regionCount: 6, dungeonCount: 3 });
  assert.equal(w.dungeons.length, 3);
  for (let i = 0; i < w.dungeons.length; i++) {
    const d = w.dungeons[i]!;
    assert.ok(d.layout.tiles.length > 0, 'dungeon ' + i + ' has tiles');
    assert.ok(d.layout.rooms.length >= 1, 'dungeon ' + i + ' has at least one room');
    assert.ok(typeof d.name === 'string' && d.name.length > 0, 'dungeon has a name');
  }
});

test('ws: dungeonCount=0 produces empty array', () => {
  const ws = WorldSeed.create({ seed: 'nodgs' });
  const w = ws.generateWorld({ width: 32, height: 32, regionCount: 4, dungeonCount: 0 });
  assert.equal(w.dungeons.length, 0);
});

test('ws: world name is non-empty', () => {
  const ws = WorldSeed.create({ seed: 'name-test' });
  const w = ws.generateWorld({ width: 24, height: 24, regionCount: 4 });
  assert.ok(w.worldName.length > 0);
});

test('ws: region names are non-empty', () => {
  const ws = WorldSeed.create({ seed: 'reg-name' });
  const w = ws.generateWorld({ width: 32, height: 32, regionCount: 8 });
  for (let i = 0; i < w.regions.length; i++) {
    assert.ok(w.regions[i]!.name.length > 0, 'region ' + i + ' has name');
  }
});

test('ws: biome diversity - at least 2 biomes appear in a 64x64 world', () => {
  const ws = WorldSeed.create({ seed: 'div' });
  const w = ws.generateWorld({ width: 64, height: 64, regionCount: 8 });
  const seen = new Set<number>();
  for (let i = 0; i < w.biomeId.length; i++) seen.add(w.biomeId[i]!);
  assert.ok(seen.size >= 2, 'at least 2 distinct biomes: ' + seen.size);
});

test('ws: rejects width=0 / height=0', () => {
  const ws = WorldSeed.create({ seed: 'x' });
  assert.throws(function () {
    ws.generateWorld({ width: 0, height: 24 });
  });
  assert.throws(function () {
    ws.generateWorld({ width: 24, height: 0 });
  });
});

test('ws: custom biome rules honored', () => {
  const ws = WorldSeed.create({ seed: 'custom-bio' });
  const w = ws.generateWorld({
    width: 32, height: 32, regionCount: 4,
    biomes: [
      { id: 'sea',  minElev: -1, maxElev: 0 },
      { id: 'land', minElev:  0, maxElev: 1 },
    ],
  });
  assert.deepEqual(w.biomeNames, ['sea', 'land']);
  // Every cell biomeId in [0, 1]
  for (let i = 0; i < w.biomeId.length; i++) {
    assert.ok(w.biomeId[i]! <= 1);
  }
});

test('ws: JSON-serializable shape (sanity)', () => {
  const ws = WorldSeed.create({ seed: 'json' });
  const w = ws.generateWorld({ width: 16, height: 16, regionCount: 4, dungeonCount: 1 });
  // Float32Array / Uint16Array don't survive JSON round-trip cleanly,
  // but the shape (regions / dungeons / names) does.
  const meta = {
    seed: w.seed,
    worldName: w.worldName,
    width: w.width,
    height: w.height,
    biomeNames: w.biomeNames,
    regions: w.regions,
    dungeonNames: w.dungeons.map(function (d) { return d.name; }),
  };
  const restored = JSON.parse(JSON.stringify(meta));
  assert.equal(restored.seed, w.seed);
  assert.equal(restored.worldName, w.worldName);
  assert.equal(restored.regions.length, w.regions.length);
});

test('ws: numeric seed reproduces deterministically', () => {
  const a = WorldSeed.create({ seed: 12345 });
  const b = WorldSeed.create({ seed: 12345 });
  const wa = a.generateWorld({ width: 16, height: 16, regionCount: 4 });
  const wb = b.generateWorld({ width: 16, height: 16, regionCount: 4 });
  for (let i = 0; i < wa.elevation.length; i++) {
    assert.equal(wa.elevation[i], wb.elevation[i]);
  }
});

test('ws: custom name corpus changes generated names', () => {
  const a = WorldSeed.create({ seed: 'corpus-a' });
  const b = WorldSeed.create({
    seed: 'corpus-a',
    nameCorpus: ['ZZZ', 'XXX', 'YYY', 'WWW', 'VVV'],
  });
  const wa = a.generateWorld({ width: 16, height: 16, regionCount: 4 });
  const wb = b.generateWorld({ width: 16, height: 16, regionCount: 4 });
  // Default and custom corpora should yield different world names.
  assert.notEqual(wa.worldName, wb.worldName);
});
