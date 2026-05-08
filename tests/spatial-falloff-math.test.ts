// Loom Engine - Phase 17 Track A: spatial falloff math tests.
//
// Pure-function distance helper. PannerNode itself does the actual
// gain falloff curve in the Web Audio implementation; this helper
// is the JS-side hook for cooldown / culling decisions ("don't
// allocate a panner for a cue beyond maxDistance"). Edge cases
// matter: NaN inputs must be guarded so a misconfigured caller
// doesn't propagate NaN through to PannerNode positions.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { spatialDistance } from '../src/index.js';

test('spatial-falloff-math: zero distance when listener and source coincide', () => {
  var d = spatialDistance({ x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(d, 0);
  // Non-origin coincident pair too.
  d = spatialDistance({ x: 7, y: -3, z: 2 }, { x: 7, y: -3, z: 2 });
  assert.equal(d, 0);
});

test('spatial-falloff-math: 2D Euclidean distance', () => {
  // 3-4-5 triangle.
  var d = spatialDistance({ x: 0, y: 0 }, { x: 3, y: 4 });
  assert.equal(d, 5);
  // Negative coordinates.
  d = spatialDistance({ x: 1, y: 1 }, { x: -2, y: -3 });
  assert.equal(d, 5);   // dx=3, dy=4
});

test('spatial-falloff-math: 3D Euclidean distance with z', () => {
  // 3-4-12 -> sqrt(9+16+144) = sqrt(169) = 13.
  var d = spatialDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 });
  assert.equal(d, 13);
});

test('spatial-falloff-math: undefined z treated as 0', () => {
  // dx=3, dy=4 -> 5. z absent on both should match z=0 on both.
  var withoutZ = spatialDistance({ x: 0, y: 0 }, { x: 3, y: 4 });
  var withZ = spatialDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
  assert.equal(withoutZ, withZ);
});

test('spatial-falloff-math: distance can exceed any finite cull radius (no clamping)', () => {
  // Helper does NOT clamp to maxDistance; that's PannerNode's job.
  var d = spatialDistance({ x: 0, y: 0 }, { x: 1000000, y: 0 });
  assert.equal(d, 1000000);
});

test('spatial-falloff-math: NaN x guards return Infinity (not NaN)', () => {
  var d = spatialDistance({ x: Number.NaN, y: 0 }, { x: 0, y: 0 });
  assert.equal(d, Number.POSITIVE_INFINITY);
  d = spatialDistance({ x: 0, y: 0 }, { x: Number.NaN, y: 0 });
  assert.equal(d, Number.POSITIVE_INFINITY);
});

test('spatial-falloff-math: NaN y guards return Infinity', () => {
  var d = spatialDistance({ x: 0, y: Number.NaN }, { x: 0, y: 0 });
  assert.equal(d, Number.POSITIVE_INFINITY);
});

test('spatial-falloff-math: NaN z guards return Infinity', () => {
  var d = spatialDistance({ x: 0, y: 0, z: Number.NaN }, { x: 0, y: 0, z: 0 });
  assert.equal(d, Number.POSITIVE_INFINITY);
  d = spatialDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: Number.NaN });
  assert.equal(d, Number.POSITIVE_INFINITY);
});
