// AudioAssetCache - Phase 17 Track B unit tests.
//
// Pure data structure: no AudioContext required. We hand-build a
// sentinel "AudioBuffer" object and just verify the cache stores and
// retrieves it by reference.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioAssetCache,
  createAudioAssetCache,
  RESOURCE_AUDIO_ASSET_CACHE,
} from '../src/audio/audio-asset-cache.js';

// Hand-build an AudioBuffer-shaped object. The cache treats it as
// opaque; only reference identity matters for tests.
function fakeBuffer(durationSec: number = 1): AudioBuffer {
  return {
    duration: durationSec,
    sampleRate: 48000,
    length: Math.round(durationSec * 48000),
    numberOfChannels: 2,
  } as unknown as AudioBuffer;
}

test('audio asset cache: get/has on empty cache returns null/false', () => {
  const cache = new AudioAssetCache();
  assert.equal(cache.get('absent'), null);
  assert.equal(cache.has('absent'), false);
  assert.deepEqual(cache.list(), []);
});

test('audio asset cache: set + get round-trip preserves reference', () => {
  const cache = new AudioAssetCache();
  const buf = fakeBuffer(0.5);
  cache.set('boss_spawn', buf);
  assert.equal(cache.has('boss_spawn'), true);
  // Reference equality - cache must not clone the buffer.
  assert.equal(cache.get('boss_spawn'), buf);
});

test('audio asset cache: list returns all registered names', () => {
  const cache = new AudioAssetCache();
  cache.set('a', fakeBuffer());
  cache.set('b', fakeBuffer());
  cache.set('c', fakeBuffer());
  const names = cache.list();
  assert.equal(names.length, 3);
  assert.ok(names.includes('a'));
  assert.ok(names.includes('b'));
  assert.ok(names.includes('c'));
});

test('audio asset cache: drop removes only the named entry', () => {
  const cache = new AudioAssetCache();
  cache.set('keep', fakeBuffer());
  cache.set('toss', fakeBuffer());
  cache.drop('toss');
  assert.equal(cache.has('keep'), true);
  assert.equal(cache.has('toss'), false);
  assert.equal(cache.get('toss'), null);
});

test('audio asset cache: drop on non-existent name is a no-op', () => {
  const cache = new AudioAssetCache();
  cache.set('present', fakeBuffer());
  // Must not throw.
  cache.drop('absent');
  assert.equal(cache.has('present'), true);
  assert.equal(cache.list().length, 1);
});

test('audio asset cache: clear empties the whole map', () => {
  const cache = new AudioAssetCache();
  cache.set('a', fakeBuffer());
  cache.set('b', fakeBuffer());
  cache.clear();
  assert.deepEqual(cache.list(), []);
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), false);
});

test('audio asset cache: name collision overwrites prior buffer', () => {
  const cache = new AudioAssetCache();
  const first = fakeBuffer(0.1);
  const second = fakeBuffer(2.5);
  cache.set('boss_spawn', first);
  cache.set('boss_spawn', second);
  assert.equal(cache.get('boss_spawn'), second);
  // List is still 1 entry - overwrite, not append.
  assert.equal(cache.list().length, 1);
});

test('audio asset cache: createAudioAssetCache factory returns fresh instance', () => {
  const a = createAudioAssetCache();
  const b = createAudioAssetCache();
  a.set('x', fakeBuffer());
  // Independent instances - mutations to one do not leak.
  assert.equal(a.has('x'), true);
  assert.equal(b.has('x'), false);
});

test('audio asset cache: resource key is stable string', () => {
  assert.equal(RESOURCE_AUDIO_ASSET_CACHE, 'audio_asset_cache');
});

test('audio asset cache: cache survives drop+re-add cycle', () => {
  const cache = new AudioAssetCache();
  const buf1 = fakeBuffer(0.3);
  const buf2 = fakeBuffer(0.7);
  cache.set('cue', buf1);
  cache.drop('cue');
  cache.set('cue', buf2);
  assert.equal(cache.get('cue'), buf2);
  assert.equal(cache.has('cue'), true);
});
