// CueCatalog - Phase 17 Track B unit tests.
//
// Mocks AudioBus.playOneShot and SpatialAudioBus.playPositional via
// duck-typed objects with call-recording shims. Cache is real.
// Cooldown tests use real performance.now() with intentionally small
// cooldownMs values + setTimeout sleeps where needed.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CueCatalog,
  RESOURCE_CUE_CATALOG,
  type CueDefinition,
  type SpatialAudioBus,
  type SpatialSourceHandle,
  type PositionalPlayOptions,
} from '../src/audio/cue-catalog.js';
import { AudioAssetCache } from '../src/audio/audio-asset-cache.js';
import type { AudioBus } from '../src/audio/audio-bus.js';

function fakeBuffer(label: string): AudioBuffer {
  return {
    duration: 1,
    sampleRate: 48000,
    length: 48000,
    numberOfChannels: 2,
    __label: label,
  } as unknown as AudioBuffer;
}

interface OneShotCall {
  bus: string;
  buffer: AudioBuffer;
  options: { rate?: number; gain?: number };
}

interface FakeBusHooks {
  audioBus: AudioBus;
  oneShotCalls: OneShotCall[];
}

function fakeAudioBus(): FakeBusHooks {
  var calls: OneShotCall[] = [];
  var bus = {
    playOneShot: function (
      busName: string,
      buffer: AudioBuffer,
      options: { rate?: number; gain?: number } = {},
    ): unknown {
      calls.push({ bus: busName, buffer: buffer, options: options });
      return { dummy: true };
    },
  } as unknown as AudioBus;
  return { audioBus: bus, oneShotCalls: calls };
}

interface PositionalCall {
  buffer: AudioBuffer;
  options: PositionalPlayOptions;
  handle: FakeSpatialHandle;
}

class FakeSpatialHandle implements SpatialSourceHandle {
  stopped: boolean = false;
  position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  stop(): void {
    this.stopped = true;
  }

  setPosition(x: number, y: number, z?: number): void {
    this.position = { x: x, y: y, z: z ?? 0 };
  }

  async fadeOut(_durationMs: number): Promise<void> {
    this.stopped = true;
  }

  isPlaying(): boolean {
    return !this.stopped;
  }
}

interface FakeSpatialHooks {
  spatialBus: SpatialAudioBus;
  positionalCalls: PositionalCall[];
  // If set, the next playPositional returns null.
  forceNull: { value: boolean };
}

function fakeSpatialBus(): FakeSpatialHooks {
  var calls: PositionalCall[] = [];
  var forceNull = { value: false };
  var bus: SpatialAudioBus = {
    playPositional: function (
      buffer: AudioBuffer,
      options: PositionalPlayOptions,
    ): SpatialSourceHandle | null {
      if (forceNull.value) return null;
      var h = new FakeSpatialHandle();
      calls.push({ buffer: buffer, options: options, handle: h });
      return h;
    },
  };
  return { spatialBus: bus, positionalCalls: calls, forceNull: forceNull };
}

function makeCatalog(cache?: AudioAssetCache) {
  var c = cache ?? new AudioAssetCache();
  var ab = fakeAudioBus();
  var sb = fakeSpatialBus();
  var cat = CueCatalog.create(ab.audioBus, sb.spatialBus, c);
  return { catalog: cat, cache: c, audio: ab, spatial: sb };
}

// ---------- registration surface ----------

test('cue catalog: register + has + list', () => {
  var ctx = makeCatalog();
  ctx.catalog.register('boss_spawn', { asset: 'boss_spawn_buf' });
  ctx.catalog.register('ui_click', { asset: 'ui_click_buf', bus: 'ui' });
  assert.equal(ctx.catalog.has('boss_spawn'), true);
  assert.equal(ctx.catalog.has('ui_click'), true);
  assert.equal(ctx.catalog.has('nope'), false);
  var names = ctx.catalog.list();
  assert.equal(names.length, 2);
  assert.ok(names.includes('boss_spawn'));
  assert.ok(names.includes('ui_click'));
});

test('cue catalog: unregister removes the cue', () => {
  var ctx = makeCatalog();
  ctx.catalog.register('cue', { asset: 'a' });
  assert.equal(ctx.catalog.has('cue'), true);
  ctx.catalog.unregister('cue');
  assert.equal(ctx.catalog.has('cue'), false);
});

test('cue catalog: register overwrites existing definition', () => {
  var ctx = makeCatalog();
  ctx.catalog.register('cue', { asset: 'first' });
  ctx.catalog.register('cue', { asset: 'second', bus: 'voice' });
  assert.equal(ctx.catalog.list().length, 1);
  // Setup buffer under 'second' so play succeeds and verify the new
  // bus is used.
  ctx.cache.set('second', fakeBuffer('second'));
  ctx.catalog.play('cue');
  assert.equal(ctx.audio.oneShotCalls.length, 1);
  assert.equal(ctx.audio.oneShotCalls[0]!.bus, 'voice', 'overwritten def applied');
});

test('cue catalog: RESOURCE_CUE_CATALOG is stable string', () => {
  assert.equal(RESOURCE_CUE_CATALOG, 'cue_catalog');
});

// ---------- play() routing ----------

test('cue catalog: non-spatial cue routes through AudioBus.playOneShot on default sfx', () => {
  var ctx = makeCatalog();
  var buf = fakeBuffer('boss_spawn_buf');
  ctx.cache.set('boss_spawn_buf', buf);
  ctx.catalog.register('cue', { asset: 'boss_spawn_buf' });
  var result = ctx.catalog.play('cue');
  // Non-spatial returns null even on success.
  assert.equal(result, null);
  assert.equal(ctx.audio.oneShotCalls.length, 1);
  assert.equal(ctx.audio.oneShotCalls[0]!.bus, 'sfx', 'default bus = sfx');
  assert.equal(ctx.audio.oneShotCalls[0]!.buffer, buf);
  // Spatial bus untouched.
  assert.equal(ctx.spatial.positionalCalls.length, 0);
});

test('cue catalog: non-spatial cue with explicit bus uses that bus', () => {
  var ctx = makeCatalog();
  ctx.cache.set('chime', fakeBuffer('chime'));
  ctx.catalog.register('narrator', { asset: 'chime', bus: 'voice' });
  ctx.catalog.play('narrator');
  assert.equal(ctx.audio.oneShotCalls[0]!.bus, 'voice');
});

test('cue catalog: spatial cue routes through SpatialAudioBus.playPositional', () => {
  var ctx = makeCatalog();
  var buf = fakeBuffer('boom');
  ctx.cache.set('boom', buf);
  ctx.catalog.register('boss_spawn', {
    asset: 'boom',
    spatial: true,
    defaults: { refDistance: 2, maxDistance: 24 },
  });
  var handle = ctx.catalog.play('boss_spawn', { x: 5, y: 7 });
  assert.ok(handle, 'spatial play returns handle');
  assert.equal(ctx.spatial.positionalCalls.length, 1);
  var call = ctx.spatial.positionalCalls[0]!;
  assert.equal(call.buffer, buf);
  assert.equal(call.options.x, 5);
  assert.equal(call.options.y, 7);
  // Defaults flowed through.
  assert.equal(call.options.refDistance, 2);
  assert.equal(call.options.maxDistance, 24);
  // Audio bus one-shot NOT called.
  assert.equal(ctx.audio.oneShotCalls.length, 0);
});

test('cue catalog: defaults merge with play() options - options win on conflict', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', {
    asset: 'buf',
    spatial: true,
    defaults: { refDistance: 2, maxDistance: 24, gain: 0.5 },
  });
  ctx.catalog.play('cue', { x: 1, y: 2, gain: 1.0, maxDistance: 32 });
  var call = ctx.spatial.positionalCalls[0]!;
  // Explicit options override.
  assert.equal(call.options.gain, 1.0);
  assert.equal(call.options.maxDistance, 32);
  // Default still applied where options didn't specify.
  assert.equal(call.options.refDistance, 2);
});

test('cue catalog: spatial cue without x/y returns null without dispatching', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', { asset: 'buf', spatial: true });
  var h = ctx.catalog.play('cue');
  assert.equal(h, null);
  assert.equal(ctx.spatial.positionalCalls.length, 0);
});

test('cue catalog: play() returns null when cue not registered', () => {
  var ctx = makeCatalog();
  var h = ctx.catalog.play('absent');
  assert.equal(h, null);
  assert.equal(ctx.audio.oneShotCalls.length, 0);
  assert.equal(ctx.spatial.positionalCalls.length, 0);
});

test('cue catalog: play() returns null when asset not in cache', () => {
  var ctx = makeCatalog();
  ctx.catalog.register('cue', { asset: 'never_loaded' });
  var h = ctx.catalog.play('cue');
  assert.equal(h, null);
  assert.equal(ctx.audio.oneShotCalls.length, 0);
});

test('cue catalog: spatial cue returns null when SpatialAudioBus returns null', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', { asset: 'buf', spatial: true });
  ctx.spatial.forceNull.value = true;
  var h = ctx.catalog.play('cue', { x: 1, y: 1 });
  assert.equal(h, null);
});

test('cue catalog: rate + gain forwarded to AudioBus.playOneShot for non-spatial', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', {
    asset: 'buf',
    bus: 'ui',
    defaults: { rate: 1.2, gain: 0.4 },
  });
  ctx.catalog.play('cue');
  var call = ctx.audio.oneShotCalls[0]!;
  assert.equal(call.options.rate, 1.2);
  assert.equal(call.options.gain, 0.4);
});

// ---------- cooldown ----------

test('cue catalog: cooldownMs blocks rapid back-to-back play', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('boss_hit', {
    asset: 'buf',
    spatial: true,
    cooldownMs: 100,
  });
  var h1 = ctx.catalog.play('boss_hit', { x: 0, y: 0 });
  assert.ok(h1, 'first play succeeds');
  var h2 = ctx.catalog.play('boss_hit', { x: 0, y: 0 });
  assert.equal(h2, null, 'second play within cooldown returns null');
  // Only one positional call landed on the bus.
  assert.equal(ctx.spatial.positionalCalls.length, 1);
});

test('cue catalog: cooldown elapsed allows next play', async () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', {
    asset: 'buf',
    spatial: true,
    cooldownMs: 20,
  });
  ctx.catalog.play('cue', { x: 0, y: 0 });
  // Sleep > cooldown.
  await new Promise(function (r) { setTimeout(r, 40); });
  var h2 = ctx.catalog.play('cue', { x: 0, y: 0 });
  assert.ok(h2, 'play after cooldown succeeds');
  assert.equal(ctx.spatial.positionalCalls.length, 2);
});

test('cue catalog: cooldown 0 (or absent) never blocks', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', { asset: 'buf', spatial: true });
  ctx.catalog.play('cue', { x: 0, y: 0 });
  ctx.catalog.play('cue', { x: 0, y: 0 });
  ctx.catalog.play('cue', { x: 0, y: 0 });
  assert.equal(ctx.spatial.positionalCalls.length, 3);
});

test('cue catalog: failed play does NOT advance cooldown timer', async () => {
  var ctx = makeCatalog();
  // Asset NOT in cache - play fails.
  ctx.catalog.register('cue', {
    asset: 'absent',
    spatial: true,
    cooldownMs: 200,
  });
  // Multiple "failed" attempts.
  ctx.catalog.play('cue', { x: 0, y: 0 });
  ctx.catalog.play('cue', { x: 0, y: 0 });
  // Now load and try - should succeed because no successful play has
  // ever happened (cooldown was never armed).
  ctx.cache.set('absent', fakeBuffer('buf'));
  var h = ctx.catalog.play('cue', { x: 0, y: 0 });
  assert.ok(h, 'first successful play after failures still works');
});

// ---------- unregister stops live handles ----------

test('cue catalog: unregister stops any live spatial handles for the cue', () => {
  var ctx = makeCatalog();
  ctx.cache.set('buf', fakeBuffer('buf'));
  ctx.catalog.register('cue', { asset: 'buf', spatial: true });
  var h = ctx.catalog.play('cue', { x: 0, y: 0 }) as FakeSpatialHandle;
  assert.equal(h.stopped, false);
  ctx.catalog.unregister('cue');
  assert.equal(h.stopped, true, 'unregister tore down the live handle');
});
