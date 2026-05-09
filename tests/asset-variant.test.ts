// Phase 0.90.0 - AssetVariant tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AssetVariant,
  RESOURCE_ASSET_VARIANT,
} from '../src/index.js';

test('asset-variant: RESOURCE constant', () => {
  assert.equal(RESOURCE_ASSET_VARIANT, 'asset_variant');
});

test('asset-variant: register + has + size', () => {
  const av = AssetVariant.create({ variants: ['en-US'] });
  assert.ok(av.registerAsset({
    id: 'a',
    variants: { 'en-US': '/en/a.mp3', 'fallback': '/a.mp3' },
  }));
  assert.ok(av.has('a'));
  assert.equal(av.size(), 1);
});

test('asset-variant: register rejects invalid + duplicates', () => {
  const av = AssetVariant.create({ variants: [] });
  assert.equal(av.registerAsset({ id: '', variants: { x: '/y' } }), false);
  assert.equal(av.registerAsset({ id: 'a', variants: {} }), false);
  assert.equal(av.registerAsset({ id: 'a', variants: { 'k': '' } }), false);
  av.registerAsset({ id: 'a', variants: { 'k': '/x' } });
  assert.equal(av.registerAsset({ id: 'a', variants: { 'k': '/y' } }), false);
});

test('asset-variant: resolve picks first matching variant in chain', () => {
  const av = AssetVariant.create({
    variants: ['en-US/desktop', 'en-US', 'fallback'],
  });
  av.registerAsset({
    id: 'a',
    variants: {
      'en-US': '/en/a.mp3',
      'fallback': '/a.mp3',
    },
  });
  // chain: en-US/desktop (no match) -> en-US (match)
  assert.equal(av.resolve('a'), '/en/a.mp3');
});

test('asset-variant: resolve respects chain ordering', () => {
  const av = AssetVariant.create({ variants: ['fallback', 'en-US'] });
  av.registerAsset({
    id: 'a',
    variants: {
      'en-US': '/en/a.mp3',
      'fallback': '/a.mp3',
    },
  });
  // fallback first.
  assert.equal(av.resolve('a'), '/a.mp3');
});

test('asset-variant: resolve returns null when no chain match', () => {
  const av = AssetVariant.create({ variants: ['xx-XX'] });
  av.registerAsset({
    id: 'a',
    variants: { 'en-US': '/en/a.mp3' },
  });
  assert.equal(av.resolve('a'), null);
});

test('asset-variant: resolve returns null for unknown asset', () => {
  const av = AssetVariant.create({ variants: ['en-US'] });
  assert.equal(av.resolve('ghost'), null);
});

test('asset-variant: resolveWith uses explicit chain', () => {
  const av = AssetVariant.create({ variants: ['fallback'] });
  av.registerAsset({
    id: 'a',
    variants: { 'th-TH': '/th/a.mp3', 'en-US': '/en/a.mp3' },
  });
  assert.equal(av.resolveWith('a', ['th-TH']), '/th/a.mp3');
  assert.equal(av.resolveWith('a', ['en-US']), '/en/a.mp3');
});

test('asset-variant: setVariants updates current chain', () => {
  const av = AssetVariant.create({ variants: ['en-US'] });
  av.registerAsset({
    id: 'a',
    variants: { 'en-US': '/en/a.mp3', 'th-TH': '/th/a.mp3' },
  });
  assert.equal(av.resolve('a'), '/en/a.mp3');
  av.setVariants(['th-TH']);
  assert.equal(av.resolve('a'), '/th/a.mp3');
});

test('asset-variant: setVariants ignores non-array', () => {
  const av = AssetVariant.create({ variants: ['en-US'] });
  av.registerAsset({ id: 'a', variants: { 'en-US': '/en/a' } });
  av.setVariants('not-array' as unknown as string[]);
  assert.equal(av.resolve('a'), '/en/a'); // unchanged
});

test('asset-variant: getVariants returns defensive copy of chain', () => {
  const av = AssetVariant.create({ variants: ['en-US', 'fallback'] });
  const arr = av.getVariants();
  arr.push('mutated');
  assert.deepEqual(av.getVariants(), ['en-US', 'fallback']);
});

test('asset-variant: list returns defensive copy', () => {
  const av = AssetVariant.create({ variants: [] });
  av.registerAsset({ id: 'a', variants: { 'k': '/x' } });
  const arr = av.list();
  arr.length = 0;
  assert.equal(av.list().length, 1);
});

test('asset-variant: variantsOf returns keys', () => {
  const av = AssetVariant.create({ variants: [] });
  av.registerAsset({
    id: 'a',
    variants: { 'en-US': '/en/a', 'th-TH': '/th/a', 'fallback': '/a' },
  });
  const keys = av.variantsOf('a');
  assert.deepEqual(keys.sort(), ['en-US', 'fallback', 'th-TH']);
  assert.deepEqual(av.variantsOf('ghost'), []);
});

test('asset-variant: unregisterAsset drops', () => {
  const av = AssetVariant.create({ variants: [] });
  av.registerAsset({ id: 'a', variants: { 'k': '/x' } });
  assert.ok(av.unregisterAsset('a'));
  assert.equal(av.has('a'), false);
});

test('asset-variant: clear empties', () => {
  const av = AssetVariant.create({ variants: [] });
  av.registerAsset({ id: 'a', variants: { 'k': '/x' } });
  av.registerAsset({ id: 'b', variants: { 'k': '/y' } });
  av.clear();
  assert.equal(av.size(), 0);
});

test('asset-variant: dispose locks ops', () => {
  const av = AssetVariant.create({ variants: ['en-US'] });
  av.registerAsset({ id: 'a', variants: { 'en-US': '/x' } });
  av.dispose();
  assert.equal(av.registerAsset({ id: 'b', variants: { 'k': '/y' } }), false);
  assert.equal(av.has('a'), false);
  assert.equal(av.resolve('a'), null);
});

test('asset-variant: spec is defensive copy', () => {
  const av = AssetVariant.create({ variants: ['en-US'] });
  const spec = { id: 'a', variants: { 'en-US': '/x' } };
  av.registerAsset(spec);
  spec.variants['en-US'] = '/mutated';
  assert.equal(av.resolve('a'), '/x');
});

test('asset-variant: realistic multi-locale + multi-platform', () => {
  const av = AssetVariant.create({
    variants: ['en-US/desktop', 'en-US', 'fallback'],
  });
  av.registerAsset({
    id: 'audio:welcome',
    variants: {
      'en-US/desktop': '/audio/en/desktop/welcome.mp3',
      'en-US': '/audio/en/welcome.mp3',
      'th-TH': '/audio/th/welcome.mp3',
      'fallback': '/audio/welcome.mp3',
    },
  });
  // Desktop EN player.
  assert.equal(av.resolve('audio:welcome'), '/audio/en/desktop/welcome.mp3');
  // Switch to mobile EN.
  av.setVariants(['en-US/mobile', 'en-US', 'fallback']);
  assert.equal(av.resolve('audio:welcome'), '/audio/en/welcome.mp3');
  // Switch to TH (no desktop / mobile variants).
  av.setVariants(['th-TH/desktop', 'th-TH', 'fallback']);
  assert.equal(av.resolve('audio:welcome'), '/audio/th/welcome.mp3');
});

test('asset-variant: empty chain resolves to null', () => {
  const av = AssetVariant.create({ variants: [] });
  av.registerAsset({ id: 'a', variants: { 'en-US': '/x' } });
  assert.equal(av.resolve('a'), null);
});

test('asset-variant: empty/non-string url in variants rejected at register', () => {
  const av = AssetVariant.create({ variants: [] });
  assert.equal(av.registerAsset({
    id: 'a', variants: { 'k': 123 as unknown as string },
  }), false);
});

test('asset-variant: getVariants returns non-empty when set', () => {
  const av = AssetVariant.create({ variants: ['a', 'b', 'c'] });
  assert.deepEqual(av.getVariants(), ['a', 'b', 'c']);
});

test('asset-variant: variantsOf returns defensive snapshot (separate Object.keys)', () => {
  const av = AssetVariant.create({ variants: [] });
  av.registerAsset({ id: 'a', variants: { 'en-US': '/x' } });
  const keys = av.variantsOf('a');
  keys.push('mutated');
  assert.equal(av.variantsOf('a').length, 1);
});
