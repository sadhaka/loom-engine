// Phase 0.84.0 - AssetManifest tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AssetManifest,
  RESOURCE_ASSET_MANIFEST,
  type AssetEntry,
} from '../src/index.js';

test('asset-manifest: RESOURCE constant', () => {
  assert.equal(RESOURCE_ASSET_MANIFEST, 'asset_manifest');
});

test('asset-manifest: add + has + size + remove', () => {
  const m = AssetManifest.create();
  assert.ok(m.add({ id: 'a', type: 'image', url: '/a.png' }));
  assert.ok(m.has('a'));
  assert.equal(m.size(), 1);
  assert.ok(m.remove('a'));
  assert.equal(m.has('a'), false);
});

test('asset-manifest: rejects invalid entries', () => {
  const m = AssetManifest.create();
  assert.equal(m.add({ id: '', type: 'image', url: '/a.png' }), false);
  assert.equal(m.add({ id: 'x', type: '', url: '/a.png' }), false);
  assert.equal(m.add({ id: 'x', type: 'image', url: '' }), false);
  assert.equal(m.add({ id: 'x', type: 'image', url: '/a', deps: [''] } as AssetEntry), false);
});

test('asset-manifest: rejects duplicate id', () => {
  const m = AssetManifest.create();
  m.add({ id: 'a', type: 'image', url: '/a.png' });
  assert.equal(m.add({ id: 'a', type: 'image', url: '/a2.png' }), false);
});

test('asset-manifest: get returns defensive copy', () => {
  const m = AssetManifest.create();
  m.add({ id: 'a', type: 'image', url: '/a.png', deps: ['x'] });
  const got = m.get('a');
  got!.deps!.push('mutated');
  const fresh = m.get('a');
  assert.equal(fresh!.deps!.length, 1);
});

test('asset-manifest: list returns defensive copy', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'a', type: 'image', url: '/a.png' },
      { id: 'b', type: 'image', url: '/b.png' },
    ],
  });
  const arr = m.list();
  assert.equal(arr.length, 2);
  arr.length = 0;
  assert.equal(m.list().length, 2);
});

test('asset-manifest: resolve handles no-deps manifest', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'a', type: 'image', url: '/a.png' },
      { id: 'b', type: 'image', url: '/b.png' },
    ],
  });
  const r = m.resolve();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.order.length, 2);
});

test('asset-manifest: resolve orders deps before dependents', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'atlas', type: 'image', url: '/atlas.png' },
      { id: 'sheet', type: 'image', url: '/sheet.png', deps: ['atlas'] },
      { id: 'anim', type: 'json', url: '/anim.json', deps: ['sheet'] },
    ],
  });
  const r = m.resolve();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.order, ['atlas', 'sheet', 'anim']);
});

test('asset-manifest: resolve detects cycle', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'a', type: 'json', url: '/a.json', deps: ['b'] },
      { id: 'b', type: 'json', url: '/b.json', deps: ['c'] },
      { id: 'c', type: 'json', url: '/c.json', deps: ['a'] },
    ],
  });
  const r = m.resolve();
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'cycle');
  assert.equal(r.offenders.length, 3);
});

test('asset-manifest: resolve detects missing dep', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'a', type: 'image', url: '/a.png', deps: ['missing'] },
    ],
  });
  const r = m.resolve();
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'missing_dep');
  assert.deepEqual(r.offenders, ['missing']);
});

test('asset-manifest: resolveFor returns just the subgraph', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'atlas', type: 'image', url: '/atlas.png' },
      { id: 'sheet', type: 'image', url: '/sheet.png', deps: ['atlas'] },
      { id: 'anim', type: 'json', url: '/anim.json', deps: ['sheet'] },
      { id: 'unrelated', type: 'audio', url: '/unrelated.mp3' },
    ],
  });
  const r = m.resolveFor('anim');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.order.sort(), ['anim', 'atlas', 'sheet']);
});

test('asset-manifest: resolveFor returns unknown_id for absent', () => {
  const m = AssetManifest.create();
  const r = m.resolveFor('ghost');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'unknown_id');
});

test('asset-manifest: resolveFor surfaces transitive missing dep', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'a', type: 'image', url: '/a.png', deps: ['ghost'] },
    ],
  });
  const r = m.resolveFor('a');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'missing_dep');
  assert.deepEqual(r.offenders, ['ghost']);
});

test('asset-manifest: clear empties', () => {
  const m = AssetManifest.create({
    entries: [{ id: 'a', type: 'image', url: '/a.png' }],
  });
  m.clear();
  assert.equal(m.size(), 0);
});

test('asset-manifest: dispose locks ops', () => {
  const m = AssetManifest.create();
  m.add({ id: 'a', type: 'image', url: '/a.png' });
  m.dispose();
  assert.equal(m.add({ id: 'b', type: 'image', url: '/b.png' }), false);
  assert.equal(m.has('a'), false);
});

test('asset-manifest: constructor entries dedupe by id', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'a', type: 'image', url: '/a.png' },
      { id: 'a', type: 'image', url: '/a-dup.png' }, // ignored
    ],
  });
  assert.equal(m.size(), 1);
  assert.equal(m.get('a')!.url, '/a.png');
});

test('asset-manifest: complex DAG resolves deterministically', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'r', type: 'json', url: '/r' },
      { id: 'a', type: 'json', url: '/a', deps: ['r'] },
      { id: 'b', type: 'json', url: '/b', deps: ['r'] },
      { id: 'c', type: 'json', url: '/c', deps: ['a', 'b'] },
    ],
  });
  const r1 = m.resolve();
  const r2 = m.resolve();
  if (!r1.ok || !r2.ok) {
    assert.fail('expected ok');
    return;
  }
  // Repeatable order.
  assert.deepEqual(r1.order, r2.order);
  // r before a/b; a/b before c.
  assert.ok(r1.order.indexOf('r') < r1.order.indexOf('a'));
  assert.ok(r1.order.indexOf('r') < r1.order.indexOf('b'));
  assert.ok(r1.order.indexOf('a') < r1.order.indexOf('c'));
  assert.ok(r1.order.indexOf('b') < r1.order.indexOf('c'));
});

test('asset-manifest: resolveFor includes deps not in subset', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'shared', type: 'image', url: '/s.png' },
      { id: 'a', type: 'json', url: '/a', deps: ['shared'] },
    ],
  });
  const r = m.resolveFor('a');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.order.indexOf('shared') < r.order.indexOf('a'));
});

test('asset-manifest: data passthrough preserved', () => {
  const m = AssetManifest.create();
  m.add({ id: 'a', type: 'image', url: '/a.png', data: { tag: 'hero' } });
  assert.deepEqual(m.get('a')!.data, { tag: 'hero' });
});

test('asset-manifest: realistic preload pipeline', () => {
  const m = AssetManifest.create({
    entries: [
      { id: 'fonts:main', type: 'font', url: '/f.woff2' },
      { id: 'atlas:env', type: 'image', url: '/env.png' },
      { id: 'atlas:chars', type: 'image', url: '/chars.png' },
      { id: 'sheet:hero', type: 'image', url: '/hero.png', deps: ['atlas:chars'] },
      { id: 'anim:hero-walk', type: 'json', url: '/walk.json', deps: ['sheet:hero'] },
      { id: 'tile:grass', type: 'json', url: '/grass.json', deps: ['atlas:env'] },
    ],
  });
  const full = m.resolve();
  assert.ok(full.ok);
  if (!full.ok) return;
  // Hero subgraph.
  const hero = m.resolveFor('anim:hero-walk');
  assert.ok(hero.ok);
  if (!hero.ok) return;
  // Hero subgraph includes atlas:chars + sheet:hero + anim:hero-walk;
  // does NOT include atlas:env or tile:grass.
  assert.ok(hero.order.indexOf('atlas:chars') >= 0);
  assert.ok(hero.order.indexOf('sheet:hero') >= 0);
  assert.ok(hero.order.indexOf('anim:hero-walk') >= 0);
  assert.equal(hero.order.indexOf('atlas:env'), -1);
});

test('asset-manifest: empty manifest resolves to empty order', () => {
  const m = AssetManifest.create();
  const r = m.resolve();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.order, []);
});

test('asset-manifest: self-loop counts as a cycle', () => {
  const m = AssetManifest.create({
    entries: [{ id: 'a', type: 'json', url: '/a', deps: ['a'] }],
  });
  const r = m.resolve();
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'cycle');
});
