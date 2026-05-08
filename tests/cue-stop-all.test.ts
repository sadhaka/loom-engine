// CueCatalog.stopAll - Phase 17 Track B unit tests.
//
// Focused on the live-handle-tracking + cleanup contract:
// - stopAll(name) invalidates handles for THAT cue
// - sibling cues unaffected
// - stopAll on a cue with no live handles is a no-op
// - multiple plays of the same cue all get stopped together

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CueCatalog,
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

class FakeSpatialHandle implements SpatialSourceHandle {
  stopped: boolean = false;
  stop(): void { this.stopped = true; }
  setPosition(_x: number, _y: number, _z?: number): void { /* no-op */ }
  async fadeOut(_durationMs: number): Promise<void> { this.stopped = true; }
  isPlaying(): boolean { return !this.stopped; }
}

function fakeBuses(): {
  audioBus: AudioBus;
  spatialBus: SpatialAudioBus;
  handlesIssued: FakeSpatialHandle[];
} {
  var handles: FakeSpatialHandle[] = [];
  var audioBus = {
    playOneShot: function (): null { return null; },
  } as unknown as AudioBus;
  var spatialBus: SpatialAudioBus = {
    playPositional: function (
      _buffer: AudioBuffer,
      _options: PositionalPlayOptions,
    ): SpatialSourceHandle | null {
      var h = new FakeSpatialHandle();
      handles.push(h);
      return h;
    },
  };
  return { audioBus: audioBus, spatialBus: spatialBus, handlesIssued: handles };
}

test('cue stop all: stopAll invalidates all live handles for the named cue', () => {
  var bus = fakeBuses();
  var cache = new AudioAssetCache();
  cache.set('buf', fakeBuffer('buf'));
  var cat = CueCatalog.create(bus.audioBus, bus.spatialBus, cache);
  cat.register('boss_combat', { asset: 'buf', spatial: true });
  var h1 = cat.play('boss_combat', { x: 1, y: 1 }) as FakeSpatialHandle;
  var h2 = cat.play('boss_combat', { x: 2, y: 2 }) as FakeSpatialHandle;
  var h3 = cat.play('boss_combat', { x: 3, y: 3 }) as FakeSpatialHandle;
  assert.equal(h1.stopped, false);
  assert.equal(h2.stopped, false);
  assert.equal(h3.stopped, false);
  cat.stopAll('boss_combat');
  assert.equal(h1.stopped, true, 'h1 stopped');
  assert.equal(h2.stopped, true, 'h2 stopped');
  assert.equal(h3.stopped, true, 'h3 stopped');
});

test('cue stop all: stopAll(name) leaves OTHER cues running', () => {
  var bus = fakeBuses();
  var cache = new AudioAssetCache();
  cache.set('a', fakeBuffer('a'));
  cache.set('b', fakeBuffer('b'));
  var cat = CueCatalog.create(bus.audioBus, bus.spatialBus, cache);
  cat.register('boss_combat', { asset: 'a', spatial: true });
  cat.register('ambient_drone', { asset: 'b', spatial: true });
  var bossHandle = cat.play('boss_combat', { x: 0, y: 0 }) as FakeSpatialHandle;
  var ambientHandle = cat.play('ambient_drone', { x: 5, y: 5 }) as FakeSpatialHandle;
  cat.stopAll('boss_combat');
  assert.equal(bossHandle.stopped, true, 'targeted cue stopped');
  assert.equal(ambientHandle.stopped, false, 'sibling cue still running');
});

test('cue stop all: stopAll on cue with no live handles is a no-op', () => {
  var bus = fakeBuses();
  var cache = new AudioAssetCache();
  var cat = CueCatalog.create(bus.audioBus, bus.spatialBus, cache);
  cat.register('cue_never_played', { asset: 'absent', spatial: true });
  // Must not throw.
  cat.stopAll('cue_never_played');
  // Also no-op for unknown cue names.
  cat.stopAll('completely_unknown');
});

test('cue stop all: stopAll clears tracked handles - subsequent stopAll is no-op', () => {
  var bus = fakeBuses();
  var cache = new AudioAssetCache();
  cache.set('buf', fakeBuffer('buf'));
  var cat = CueCatalog.create(bus.audioBus, bus.spatialBus, cache);
  cat.register('cue', { asset: 'buf', spatial: true });
  var h = cat.play('cue', { x: 0, y: 0 }) as FakeSpatialHandle;
  cat.stopAll('cue');
  assert.equal(h.stopped, true);
  // Second stopAll should not re-stop or throw.
  cat.stopAll('cue');
  assert.equal(h.stopped, true);
});

test('cue stop all: tolerates a handle whose stop() throws - other handles still stop', () => {
  var bus = fakeBuses();
  var cache = new AudioAssetCache();
  cache.set('buf', fakeBuffer('buf'));
  var cat = CueCatalog.create(bus.audioBus, bus.spatialBus, cache);
  cat.register('cue', { asset: 'buf', spatial: true });
  // Issue two handles, then poison the first one's stop() to throw.
  var h1 = cat.play('cue', { x: 0, y: 0 }) as FakeSpatialHandle;
  var h2 = cat.play('cue', { x: 1, y: 1 }) as FakeSpatialHandle;
  var origStop = h1.stop.bind(h1);
  h1.stop = function () {
    throw new Error('handle stop boom');
  };
  cat.stopAll('cue');
  // h2 should still be marked stopped despite h1's poisoned stop.
  assert.equal(h2.stopped, true, 'sibling handle stopped despite earlier throw');
  // Restore h1 (cleanup).
  origStop();
});

test('cue stop all: new plays AFTER stopAll get fresh tracking', () => {
  var bus = fakeBuses();
  var cache = new AudioAssetCache();
  cache.set('buf', fakeBuffer('buf'));
  var cat = CueCatalog.create(bus.audioBus, bus.spatialBus, cache);
  cat.register('cue', { asset: 'buf', spatial: true });
  var h1 = cat.play('cue', { x: 0, y: 0 }) as FakeSpatialHandle;
  cat.stopAll('cue');
  assert.equal(h1.stopped, true);
  var h2 = cat.play('cue', { x: 1, y: 1 }) as FakeSpatialHandle;
  assert.equal(h2.stopped, false, 'fresh play not affected by prior stopAll');
  cat.stopAll('cue');
  assert.equal(h2.stopped, true, 'new handle now stopped by next stopAll');
});
