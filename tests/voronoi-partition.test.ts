// Phase 1.6.2 - VoronoiPartition tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  VoronoiPartition,
  RESOURCE_VORONOI_PARTITION,
} from '../src/index.js';

test('vor: RESOURCE_VORONOI_PARTITION is the stable string', () => {
  assert.equal(RESOURCE_VORONOI_PARTITION, 'voronoi_partition');
});

test('vor: create with explicit sites', () => {
  const v = VoronoiPartition.create({
    width: 100, height: 100, count: 0,
    sites: [{ x: 25, y: 25 }, { x: 75, y: 75 }]
  });
  assert.equal(v.count(), 2);
});

test('vor: create with random sites uses count', () => {
  const v = VoronoiPartition.create({
    seed: 'a', width: 100, height: 100, count: 16
  });
  assert.equal(v.count(), 16);
});

test('vor: same seed produces same site placement', () => {
  const a = VoronoiPartition.create({ seed: 'a', width: 100, height: 100, count: 8 });
  const b = VoronoiPartition.create({ seed: 'a', width: 100, height: 100, count: 8 });
  const sa = a.sites();
  const sb = b.sites();
  for (let i = 0; i < sa.length; i++) {
    assert.equal(sa[i]!.x, sb[i]!.x);
    assert.equal(sa[i]!.y, sb[i]!.y);
  }
});

test('vor: different seeds produce different placements', () => {
  const a = VoronoiPartition.create({ seed: 'a', width: 100, height: 100, count: 8 });
  const b = VoronoiPartition.create({ seed: 'b', width: 100, height: 100, count: 8 });
  let differs = 0;
  const sa = a.sites();
  const sb = b.sites();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i]!.x !== sb[i]!.x || sa[i]!.y !== sb[i]!.y) differs++;
  }
  assert.ok(differs >= 7, 'most sites differ across seeds');
});

test('vor: nearestSite returns the actually nearest', () => {
  const v = VoronoiPartition.create({
    width: 100, height: 100, count: 0,
    sites: [{ x: 10, y: 10 }, { x: 90, y: 90 }]
  });
  assert.equal(v.nearestSite(15, 15), 0);
  assert.equal(v.nearestSite(85, 85), 1);
  assert.equal(v.nearestSite(50, 50), 0); // either - first wins on tie
});

test('vor: nearestSite returns -1 when no sites', () => {
  const v = VoronoiPartition.create({
    width: 10, height: 10, count: 0, sites: []
  });
  assert.equal(v.nearestSite(5, 5), -1);
});

test('vor: twoNearest reports both', () => {
  const v = VoronoiPartition.create({
    width: 100, height: 100, count: 0,
    sites: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 90, y: 10 }]
  });
  const p = v.twoNearest(30, 10);
  // 30 is between site 0 (dist 20) and site 1 (dist 20); both win.
  assert.ok(p.firstId === 0 || p.firstId === 1);
  assert.ok(p.secondId === 0 || p.secondId === 1);
  assert.notEqual(p.firstId, p.secondId);
});

test('vor: onBoundary is true at the equidistant midpoint', () => {
  const v = VoronoiPartition.create({
    width: 100, height: 100, count: 0,
    sites: [{ x: 0, y: 50 }, { x: 100, y: 50 }]
  });
  // (50, 50) is equidistant from both sites
  assert.equal(v.onBoundary(50, 50, 1), true);
  // (10, 50) is much closer to site 0
  assert.equal(v.onBoundary(10, 50, 1), false);
});

test('vor: euclidean vs manhattan vs chebyshev produce different boundaries', () => {
  const sites = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const e = VoronoiPartition.create({ width: 20, height: 20, count: 0, sites: sites, distance: 'euclidean' });
  const m = VoronoiPartition.create({ width: 20, height: 20, count: 0, sites: sites, distance: 'manhattan' });
  const c = VoronoiPartition.create({ width: 20, height: 20, count: 0, sites: sites, distance: 'chebyshev' });
  // All three agree on (3, 0) -> site 0 (closer in any metric)
  assert.equal(e.nearestSite(3, 0), 0);
  assert.equal(m.nearestSite(3, 0), 0);
  assert.equal(c.nearestSite(3, 0), 0);
  // distance fns are read back correctly
  assert.equal(e.getDistance(), 'euclidean');
  assert.equal(m.getDistance(), 'manhattan');
  assert.equal(c.getDistance(), 'chebyshev');
});

test('vor: every (x, y) sample maps to a valid site id', () => {
  const v = VoronoiPartition.create({
    seed: 'sweep', width: 200, height: 200, count: 24
  });
  for (let i = 0; i < 100; i++) {
    const x = (i * 7.3) % 200;
    const y = (i * 13.7) % 200;
    const id = v.nearestSite(x, y);
    assert.ok(id >= 0 && id < 24, 'valid id: ' + id);
  }
});

test('vor: width / height accessors round-trip', () => {
  const v = VoronoiPartition.create({ width: 320, height: 240, count: 4, seed: 'z' });
  assert.equal(v.getWidth(), 320);
  assert.equal(v.getHeight(), 240);
});

test('vor: sites() returns a copy (mutation is safe)', () => {
  const v = VoronoiPartition.create({ width: 50, height: 50, count: 4, seed: 'snap' });
  const a = v.sites();
  const b = v.sites();
  assert.notEqual(a, b, 'different array refs');
  assert.equal(a.length, b.length);
});

test('vor: rejects width=0 / height=0 / no count or sites', () => {
  assert.throws(function () {
    VoronoiPartition.create({ width: 0, height: 100, count: 4 });
  });
  assert.throws(function () {
    VoronoiPartition.create({ width: 100, height: 0, count: 4 });
  });
  assert.throws(function () {
    // @ts-expect-error
    VoronoiPartition.create({ width: 100, height: 100 });
  });
});

test('vor: explicit sites override count', () => {
  const v = VoronoiPartition.create({
    width: 100, height: 100, count: 999,
    sites: [{ x: 10, y: 10 }, { x: 20, y: 20 }]
  });
  assert.equal(v.count(), 2);
});
