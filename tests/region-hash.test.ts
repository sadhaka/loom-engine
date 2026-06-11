// Region-hash tests - v5 interest management (the partial-sync Merkle).
//
// Pins the golden vector (per-region leaves + global root) AND verifies the Merkle
// property + verifyRegion behave correctly.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { regionHash, regionLeaves, globalRegionHash, verifyRegion } from '../src/runtime/region-hash.js';
import { diffRegionLeaves } from '../src/runtime/region-sync.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v5_3_region_hash.json'), 'utf8'));

test('golden vector: region leaves + global root reproduce the pinned hashes', function () {
  var i = vec.inputs;
  assert.deepStrictEqual(regionLeaves(i.key, i.regions), vec.expect.leaves_before, 'leaves before');
  assert.strictEqual(globalRegionHash(i.key, i.regions), vec.expect.global_before, 'global before');
  assert.deepStrictEqual(regionLeaves(i.key, i.regions_after_south_mutation), vec.expect.leaves_after, 'leaves after');
  assert.strictEqual(globalRegionHash(i.key, i.regions_after_south_mutation), vec.expect.global_after, 'global after');
});

test('Merkle property: mutating one region touches only its leaf + the root', function () {
  var i = vec.inputs;
  var before = regionLeaves(i.key, i.regions);
  var after = regionLeaves(i.key, i.regions_after_south_mutation);
  assert.strictEqual(before.north, after.north, 'north leaf unchanged');
  assert.strictEqual(before.east, after.east, 'east leaf unchanged');
  assert.notStrictEqual(before.south, after.south, 'south leaf changed');
  assert.notStrictEqual(globalRegionHash(i.key, i.regions), globalRegionHash(i.key, i.regions_after_south_mutation), 'root changed');
});

test('verifyRegion: a partial-sync client validates its own region leaf (constant-time)', function () {
  var i = vec.inputs;
  var south = i.regions.south;
  var leaf = regionHash(i.key, south);
  assert.strictEqual(verifyRegion(i.key, south, leaf), true, 'correct leaf verifies');
  assert.strictEqual(verifyRegion(i.key, south, vec.expect.leaves_after.south), false, 'a stale/wrong leaf is rejected');
});

test('golden vector: diffRegionLeaves reports exactly the mutated region (the region-sync consumer)', function () {
  var i = vec.inputs;
  var diff = diffRegionLeaves(regionLeaves(i.key, i.regions), regionLeaves(i.key, i.regions_after_south_mutation));
  assert.deepStrictEqual(diff, vec.expect.diff, 'pinned diff');
  assert.deepStrictEqual(diff, { changed: ['south'], added: [], removed: [] }, 'changed=[south] only');
  // added / removed: a region appearing or vanishing on the server is reported too
  var withExtra = regionLeaves(i.key, i.regions);
  withExtra['zenith'] = withExtra['south'] as string;
  var d2 = diffRegionLeaves(regionLeaves(i.key, i.regions), withExtra);
  assert.deepStrictEqual(d2, { changed: [], added: ['zenith'], removed: [] }, 'added region detected');
  var d3 = diffRegionLeaves(withExtra, regionLeaves(i.key, i.regions));
  assert.deepStrictEqual(d3, { changed: [], added: [], removed: ['zenith'] }, 'removed region detected');
});
