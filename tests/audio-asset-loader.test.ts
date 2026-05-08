// AudioAssetLoader - Phase 17 Track B unit tests.
//
// Mocks: globalThis.fetch is replaced per-test; AudioBus is replaced
// with a duck-typed object that exposes ctx.decodeAudioData. The cache
// is the real AudioAssetCache (already covered by its own test).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioAssetLoader,
  type AudioAssetManifest,
} from '../src/audio/audio-asset-loader.js';
import { AudioAssetCache } from '../src/audio/audio-asset-cache.js';
import type { AudioBus } from '../src/audio/audio-bus.js';

// Hand-built AudioBuffer sentinel. The loader treats decoded buffers
// as opaque; only reference identity matters.
function fakeBuffer(label: string): AudioBuffer {
  return {
    duration: 1,
    sampleRate: 48000,
    length: 48000,
    numberOfChannels: 2,
    __label: label,
  } as unknown as AudioBuffer;
}

interface FakeBusOptions {
  decode?: (buf: ArrayBuffer) => Promise<AudioBuffer>;
}

function fakeAudioBus(opts: FakeBusOptions = {}): AudioBus {
  var defaultDecode = function (_buf: ArrayBuffer): Promise<AudioBuffer> {
    return Promise.resolve(fakeBuffer('default'));
  };
  return {
    ctx: {
      decodeAudioData: opts.decode ?? defaultDecode,
    },
  } as unknown as AudioBus;
}

interface FakeFetchEntry {
  status?: number;
  body?: ArrayBuffer;
  reject?: Error;
}

// Replace globalThis.fetch with a routing fake. Returns a teardown.
function installFakeFetch(routes: Map<string, FakeFetchEntry>): () => void {
  var prior = globalThis.fetch;
  (globalThis as unknown as { fetch: (url: string) => Promise<Response> }).fetch =
    function (url: string): Promise<Response> {
      var entry = routes.get(url);
      if (!entry) {
        return Promise.reject(new Error('fake fetch: no route for ' + url));
      }
      if (entry.reject) {
        return Promise.reject(entry.reject);
      }
      var status = entry.status ?? 200;
      var body = entry.body ?? new ArrayBuffer(8);
      var resp: Partial<Response> = {
        ok: status >= 200 && status < 300,
        status: status,
        arrayBuffer: function (): Promise<ArrayBuffer> {
          return Promise.resolve(body);
        },
      };
      return Promise.resolve(resp as Response);
    };
  return function () {
    (globalThis as unknown as { fetch: typeof prior }).fetch = prior;
  };
}

test('audio asset loader: load() resolves with decoded AudioBuffer and stores in cache', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/sfx/boss_spawn.ogg', { status: 200, body: new ArrayBuffer(16) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var decoded = fakeBuffer('boss_spawn');
    var bus = fakeAudioBus({
      decode: function () { return Promise.resolve(decoded); },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    var buf = await loader.load('/sfx/boss_spawn.ogg');
    assert.equal(buf, decoded, 'load resolves with the decoded buffer');
    // Default name = basename without extension.
    assert.equal(cache.get('boss_spawn'), decoded, 'cache stored under basename');
  } finally {
    teardown();
  }
});

test('audio asset loader: explicit name overrides URL-basename default', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('https://cdn.example.com/path/track.mp3', { status: 200, body: new ArrayBuffer(8) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var decoded = fakeBuffer('explicit');
    var bus = fakeAudioBus({
      decode: function () { return Promise.resolve(decoded); },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    await loader.load('https://cdn.example.com/path/track.mp3', 'plaza_ambient');
    assert.equal(cache.has('plaza_ambient'), true, 'explicit name wins');
    assert.equal(cache.has('track'), false, 'basename not used when name provided');
  } finally {
    teardown();
  }
});

test('audio asset loader: load() rejection does NOT pollute cache', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/bad.ogg', { reject: new Error('network down') });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var bus = fakeAudioBus();
    var loader = AudioAssetLoader.create(bus, cache);
    await assert.rejects(function () { return loader.load('/bad.ogg', 'broken'); });
    assert.equal(cache.has('broken'), false, 'failed load left no cache entry');
    assert.equal(cache.list().length, 0);
  } finally {
    teardown();
  }
});

test('audio asset loader: non-OK HTTP status rejects without cache write', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/missing.mp3', { status: 404, body: new ArrayBuffer(0) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var bus = fakeAudioBus();
    var loader = AudioAssetLoader.create(bus, cache);
    await assert.rejects(function () { return loader.load('/missing.mp3', 'gone'); });
    assert.equal(cache.has('gone'), false);
  } finally {
    teardown();
  }
});

test('audio asset loader: decode failure rejects without cache write', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/corrupt.wav', { status: 200, body: new ArrayBuffer(16) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var bus = fakeAudioBus({
      decode: function () { return Promise.reject(new Error('decode boom')); },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    await assert.rejects(function () { return loader.load('/corrupt.wav', 'corrupt'); });
    assert.equal(cache.has('corrupt'), false);
  } finally {
    teardown();
  }
});

test('audio asset loader: preload() success path writes ALL entries to cache', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/a.mp3', { status: 200, body: new ArrayBuffer(4) });
  routes.set('/b.mp3', { status: 200, body: new ArrayBuffer(4) });
  routes.set('/c.mp3', { status: 200, body: new ArrayBuffer(4) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var perCallBuffers: AudioBuffer[] = [
      fakeBuffer('a'), fakeBuffer('b'), fakeBuffer('c'),
    ];
    var idx = 0;
    var bus = fakeAudioBus({
      decode: function () {
        var b = perCallBuffers[idx]!;
        idx++;
        return Promise.resolve(b);
      },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    var manifest: AudioAssetManifest = {
      'a': '/a.mp3',
      'b': '/b.mp3',
      'c': '/c.mp3',
    };
    await loader.preload(manifest);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), true);
    assert.equal(cache.has('c'), true);
    assert.equal(cache.list().length, 3);
  } finally {
    teardown();
  }
});

test('audio asset loader: preload() rejects on first failure', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/ok.mp3', { status: 200, body: new ArrayBuffer(4) });
  routes.set('/fail.mp3', { reject: new Error('boom') });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var bus = fakeAudioBus();
    var loader = AudioAssetLoader.create(bus, cache);
    await assert.rejects(function () {
      return loader.preload({ 'ok': '/ok.mp3', 'fail': '/fail.mp3' });
    });
    // 'fail' did not land. 'ok' may or may not have completed before
    // the rejection raced; either is acceptable per spec.
    assert.equal(cache.has('fail'), false);
  } finally {
    teardown();
  }
});

test('audio asset loader: empty manifest preload resolves immediately', async () => {
  var cache = new AudioAssetCache();
  var bus = fakeAudioBus();
  var loader = AudioAssetLoader.create(bus, cache);
  await loader.preload({});
  assert.equal(cache.list().length, 0);
});

test('audio asset loader: inflightCount tracks pending operations', async () => {
  // Build a decode that we control via deferred resolvers so we can
  // observe the counter mid-flight.
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/slow.mp3', { status: 200, body: new ArrayBuffer(8) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var resolve!: (b: AudioBuffer) => void;
    var pending = new Promise<AudioBuffer>(function (res) { resolve = res; });
    var bus = fakeAudioBus({
      decode: function () { return pending; },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    assert.equal(loader.inflightCount(), 0, 'starts at zero');
    var p = loader.load('/slow.mp3', 'slow');
    // Yield once to let fetch+arrayBuffer microtasks run; decode is
    // still pending so the counter should still be 1.
    await new Promise(function (r) { setImmediate(r); });
    assert.equal(loader.inflightCount(), 1, 'inflight while decode pending');
    resolve(fakeBuffer('slow'));
    await p;
    assert.equal(loader.inflightCount(), 0, 'decremented after resolve');
  } finally {
    teardown();
  }
});

test('audio asset loader: inflightCount decrements on rejection too', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/bad.mp3', { reject: new Error('nope') });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var bus = fakeAudioBus();
    var loader = AudioAssetLoader.create(bus, cache);
    var p = loader.load('/bad.mp3').catch(function () { /* swallow */ });
    await p;
    assert.equal(loader.inflightCount(), 0, 'counter reset after rejection');
  } finally {
    teardown();
  }
});

test('audio asset loader: basename strips query string and fragment', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/audio/track.ogg?v=42#frag', { status: 200, body: new ArrayBuffer(4) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var decoded = fakeBuffer('track');
    var bus = fakeAudioBus({
      decode: function () { return Promise.resolve(decoded); },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    await loader.load('/audio/track.ogg?v=42#frag');
    assert.equal(cache.has('track'), true, 'basename excludes query + hash');
  } finally {
    teardown();
  }
});

test('audio asset loader: re-loading same name overwrites in cache', async () => {
  var routes = new Map<string, FakeFetchEntry>();
  routes.set('/v1.mp3', { status: 200, body: new ArrayBuffer(4) });
  routes.set('/v2.mp3', { status: 200, body: new ArrayBuffer(4) });
  var teardown = installFakeFetch(routes);
  try {
    var cache = new AudioAssetCache();
    var first = fakeBuffer('v1');
    var second = fakeBuffer('v2');
    var which = 0;
    var bus = fakeAudioBus({
      decode: function () {
        which++;
        return Promise.resolve(which === 1 ? first : second);
      },
    });
    var loader = AudioAssetLoader.create(bus, cache);
    await loader.load('/v1.mp3', 'cue');
    assert.equal(cache.get('cue'), first);
    await loader.load('/v2.mp3', 'cue');
    assert.equal(cache.get('cue'), second, 'overwrite under same name');
    assert.equal(cache.list().length, 1);
  } finally {
    teardown();
  }
});
