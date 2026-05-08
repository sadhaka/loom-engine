// MusicDirector - Phase 17 Track B unit tests.
//
// Mocks: AudioBus is duck-typed - we expose ctx.createBufferSource +
// ctx.createGain + ctx.currentTime + audioBus.input('music'). The
// fade timing is verified via the recorded calls on the gain's
// AudioParam, not by waiting for real audio.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MusicDirector,
  RESOURCE_MUSIC_DIRECTOR,
} from '../src/audio/music-director.js';
import { AudioAssetCache } from '../src/audio/audio-asset-cache.js';
import type { AudioBus } from '../src/audio/audio-bus.js';

function fakeBuffer(label: string): AudioBuffer {
  return {
    duration: 30,
    sampleRate: 48000,
    length: 30 * 48000,
    numberOfChannels: 2,
    __label: label,
  } as unknown as AudioBuffer;
}

interface RampEvent {
  kind: 'setValueAtTime' | 'linearRampToValueAtTime' | 'cancelScheduledValues';
  value?: number;
  time: number;
}

class FakeAudioParam {
  value: number = 1;
  events: RampEvent[] = [];

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ kind: 'setValueAtTime', value: value, time: time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ kind: 'linearRampToValueAtTime', value: value, time: time });
  }

  cancelScheduledValues(time: number): void {
    this.events.push({ kind: 'cancelScheduledValues', time: time });
  }
}

class FakeGainNode {
  gain: FakeAudioParam = new FakeAudioParam();
  connections: unknown[] = [];
  disconnected: number = 0;

  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnected++;
  }
}

class FakeBufferSource {
  buffer: AudioBuffer | null = null;
  loop: boolean = false;
  playbackRate: { value: number } = { value: 1 };
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  disconnected: number = 0;
  connections: unknown[] = [];

  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnected++;
  }
  start(t?: number): void {
    this.startedAt = t ?? 0;
  }
  stop(t?: number): void {
    this.stoppedAt = t ?? 0;
  }
}

interface FakeBusHooks {
  audioBus: AudioBus;
  ctx: { currentTime: number };
  musicBusInput: FakeGainNode;
  sourcesCreated: FakeBufferSource[];
  gainsCreated: FakeGainNode[];
}

function fakeAudioBus(): FakeBusHooks {
  var sources: FakeBufferSource[] = [];
  var gains: FakeGainNode[] = [];
  var musicInput = new FakeGainNode();
  var ctx = {
    currentTime: 0,
    createBufferSource: function (): FakeBufferSource {
      var s = new FakeBufferSource();
      sources.push(s);
      return s;
    },
    createGain: function (): FakeGainNode {
      var g = new FakeGainNode();
      gains.push(g);
      return g;
    },
  };
  var bus = {
    ctx: ctx,
    input: function (name: string): FakeGainNode {
      assert.equal(name, 'music', 'MusicDirector should only request the music bus');
      return musicInput;
    },
  } as unknown as AudioBus;
  return {
    audioBus: bus,
    ctx: ctx,
    musicBusInput: musicInput,
    sourcesCreated: sources,
    gainsCreated: gains,
  };
}

test('music director: RESOURCE_MUSIC_DIRECTOR is stable string', () => {
  assert.equal(RESOURCE_MUSIC_DIRECTOR, 'music_director');
});

test('music director: starts silent (currentMusic === null)', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  var dir = MusicDirector.create(hooks.audioBus, cache);
  assert.equal(dir.currentMusic(), null);
});

test('music director: playMusic with no asset cached is a no-op', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('absent');
  assert.equal(dir.currentMusic(), null);
  assert.equal(hooks.sourcesCreated.length, 0);
  assert.equal(hooks.gainsCreated.length, 0);
});

test('music director: playMusic creates a buffer source + gain, connects to music bus', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  var buf = fakeBuffer('plaza');
  cache.set('plaza_ambient', buf);
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('plaza_ambient', 200);
  assert.equal(dir.currentMusic(), 'plaza_ambient');
  assert.equal(hooks.sourcesCreated.length, 1);
  assert.equal(hooks.gainsCreated.length, 1);
  var src = hooks.sourcesCreated[0]!;
  var gn = hooks.gainsCreated[0]!;
  assert.equal(src.buffer, buf);
  assert.equal(src.loop, true, 'music tracks loop by default');
  assert.equal(src.startedAt, 0, 'source started');
  // source.connect(gain).connect(musicInput)
  assert.deepEqual(src.connections, [gn]);
  assert.deepEqual(gn.connections, [hooks.musicBusInput]);
});

test('music director: playMusic schedules fade-in ramp 0 -> 1 over fadeInMs', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('track', fakeBuffer('track'));
  hooks.ctx.currentTime = 5; // arbitrary baseline
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('track', 200);
  var gn = hooks.gainsCreated[0]!;
  // setValueAtTime(0, now) + linearRampToValueAtTime(1, now + 0.2)
  assert.equal(gn.gain.events.length, 2);
  assert.equal(gn.gain.events[0]!.kind, 'setValueAtTime');
  assert.equal(gn.gain.events[0]!.value, 0);
  assert.equal(gn.gain.events[0]!.time, 5);
  assert.equal(gn.gain.events[1]!.kind, 'linearRampToValueAtTime');
  assert.equal(gn.gain.events[1]!.value, 1);
  assert.equal(Math.abs(gn.gain.events[1]!.time - 5.2) < 1e-9, true);
});

test('music director: playMusic with fadeInMs=0 sets gain to 1 immediately, no ramp', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('track', fakeBuffer('track'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('track', 0);
  var gn = hooks.gainsCreated[0]!;
  assert.equal(gn.gain.value, 1);
  assert.equal(gn.gain.events.length, 0, 'no ramp scheduled');
});

test('music director: playMusic stops prior immediately (no fade)', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('a', fakeBuffer('a'));
  cache.set('b', fakeBuffer('b'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('a');
  var firstSrc = hooks.sourcesCreated[0]!;
  assert.equal(firstSrc.stoppedAt, null);
  dir.playMusic('b');
  assert.equal(firstSrc.stoppedAt !== null, true, 'prior source stopped on new playMusic');
  assert.ok(firstSrc.disconnected > 0, 'prior source disconnected');
  assert.equal(dir.currentMusic(), 'b');
});

test('music director: stopMusic with no track is a safe no-op promise', async () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  var dir = MusicDirector.create(hooks.audioBus, cache);
  await dir.stopMusic(100);
  assert.equal(dir.currentMusic(), null);
});

test('music director: stopMusic schedules fade-out ramp current -> 0', async () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('track', fakeBuffer('track'));
  hooks.ctx.currentTime = 0;
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('track', 0); // gain=1 immediately, no ramp scheduled
  hooks.ctx.currentTime = 10; // simulate 10s later
  // Fire and don't await yet so we can inspect ramp scheduling first.
  var p = dir.stopMusic(500);
  var gn = hooks.gainsCreated[0]!;
  // Last two events should be setValueAtTime(1, 10) +
  // linearRampToValueAtTime(0, 10.5). cancelScheduledValues may have
  // been called first; we just check the tail of the events list.
  var events = gn.gain.events;
  assert.ok(events.length >= 2);
  var last = events[events.length - 1]!;
  var prior = events[events.length - 2]!;
  assert.equal(last.kind, 'linearRampToValueAtTime');
  assert.equal(last.value, 0);
  assert.ok(Math.abs(last.time - 10.5) < 1e-9);
  assert.equal(prior.kind, 'setValueAtTime');
  // currentMusic clears synchronously on stopMusic (the rampdown is
  // fire-and-forget for the consumer-visible state).
  assert.equal(dir.currentMusic(), null);
  await p;
  // After fade completes, source stop + disconnect happened.
  assert.equal(hooks.sourcesCreated[0]!.stoppedAt !== null, true);
});

test('music director: stopMusic resolves AFTER the fade window elapses', async () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('track', fakeBuffer('track'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('track', 0);
  var t0 = Date.now();
  await dir.stopMusic(50);
  var elapsed = Date.now() - t0;
  // Allow generous slack but enforce a non-trivial wait.
  assert.ok(elapsed >= 40, 'awaited approximately fade duration; got ' + String(elapsed));
});

test('music director: crossfadeMusic launches new track and fades prior', async () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('plaza', fakeBuffer('plaza'));
  cache.set('combat', fakeBuffer('combat'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('plaza', 0);
  hooks.ctx.currentTime = 5;
  var priorSrc = hooks.sourcesCreated[0]!;
  var priorGain = hooks.gainsCreated[0]!;
  dir.crossfadeMusic('combat', 100);
  assert.equal(dir.currentMusic(), 'combat');
  // 2 sources + 2 gains total now.
  assert.equal(hooks.sourcesCreated.length, 2);
  assert.equal(hooks.gainsCreated.length, 2);
  var newSrc = hooks.sourcesCreated[1]!;
  var newGain = hooks.gainsCreated[1]!;
  // New track started, prior NOT yet stopped (fade in flight).
  assert.equal(newSrc.startedAt, 0);
  assert.equal(priorSrc.stoppedAt, null);
  // Prior gain should have a ramp-to-0 scheduled.
  var priorEvents = priorGain.gain.events;
  var priorTail = priorEvents[priorEvents.length - 1]!;
  assert.equal(priorTail.kind, 'linearRampToValueAtTime');
  assert.equal(priorTail.value, 0);
  // New gain should ramp 0 -> 1.
  assert.equal(newGain.gain.events[0]!.kind, 'setValueAtTime');
  assert.equal(newGain.gain.events[0]!.value, 0);
  assert.equal(newGain.gain.events[1]!.kind, 'linearRampToValueAtTime');
  assert.equal(newGain.gain.events[1]!.value, 1);
  // Wait for the fade window so the prior cleanup completes.
  await new Promise(function (r) { setTimeout(r, 130); });
  assert.equal(priorSrc.stoppedAt !== null, true, 'prior source stopped after fade');
});

test('music director: crossfadeMusic with nothing playing is equivalent to playMusic', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('combat', fakeBuffer('combat'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.crossfadeMusic('combat', 100);
  assert.equal(dir.currentMusic(), 'combat');
  // Only 1 source + 1 gain - no prior to fade out.
  assert.equal(hooks.sourcesCreated.length, 1);
});

test('music director: crossfadeMusic with no asset cached is no-op (current keeps playing)', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('plaza', fakeBuffer('plaza'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('plaza', 0);
  dir.crossfadeMusic('not_loaded', 200);
  assert.equal(dir.currentMusic(), 'plaza', 'current track unchanged on missing asset');
  assert.equal(hooks.sourcesCreated.length, 1);
});

test('music director: multiple consecutive playMusic calls each replace the prior', () => {
  var hooks = fakeAudioBus();
  var cache = new AudioAssetCache();
  cache.set('a', fakeBuffer('a'));
  cache.set('b', fakeBuffer('b'));
  cache.set('c', fakeBuffer('c'));
  var dir = MusicDirector.create(hooks.audioBus, cache);
  dir.playMusic('a', 0);
  dir.playMusic('b', 0);
  dir.playMusic('c', 0);
  assert.equal(dir.currentMusic(), 'c');
  // First two sources stopped; only the third should still be live.
  assert.equal(hooks.sourcesCreated[0]!.stoppedAt !== null, true);
  assert.equal(hooks.sourcesCreated[1]!.stoppedAt !== null, true);
  assert.equal(hooks.sourcesCreated[2]!.stoppedAt, null);
});
