// Loom Engine - Phase 17 ZoneAudioSystem tests (Track C engine shell).
//
// Coverage:
//   - registerMapping wiring (size, replace-on-duplicate, hasMapping)
//   - dispatch on event drain (handler called, cue play forwarded)
//   - missing mapping is silent skip (no throw, other mappings still
//     fire)
//   - missing CueCatalog is silent skip (handler still runs so music
//     side-effects work; cue play evaporates)
//   - multi-zone: localZone filter drains only local
//   - no localZone => drains every zone in the log
//   - already-processed events are not re-dispatched on subsequent
//     ticks (per-zone lastProcessedId)
//   - mapping handler throwing does not poison subsequent events
//   - music-only mappings (handler returns null but calls ctx.music)

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // v2 zone events
  MockZoneBridge,
  ZoneEventSystem,
  RESOURCE_ZONE_EVENT_BRIDGE,
  RESOURCE_ZONE_EVENT_LOG,
  createZoneEventLog,
  // Phase 17 audio
  ZoneAudioSystem,
  RESOURCE_CUE_CATALOG_STUB,
  RESOURCE_MUSIC_DIRECTOR_STUB,
  RESOURCE_AUDIO_LISTENER_STUB,
  // World plumbing
  RESOURCE_TIME,
  createTimeResource,
  SYSTEM_PHASE_INPUT,
  type ZoneEvent,
  type ZoneEventEnvelope,
  type ZoneAudioMapping,
  type CueCatalogStub,
  type MusicDirectorStub,
  type AudioListenerResourceStub,
} from '../src/index.js';

// ----- Helpers -----

function ev<T extends ZoneEvent['type']>(
  id: number,
  type: T,
  zone_id: string,
  data: Extract<ZoneEvent, { type: T }>['data'],
  emitter_id: string | null = null,
): ZoneEventEnvelope<T> {
  return { id, ts: 1700000000000 + id, type, zone_id, emitter_id, data };
}

function bossSpawn(id: number, zone: string, bossId: string, x: number, y: number): ZoneEvent {
  return ev(id, 'zone.boss.spawn', zone, {
    boss: {
      boss_id: bossId,
      type: 'iron_titan',
      name: 'Iron Titan',
      hp_max: 1000,
      hp_current: 1000,
      dmg: 50,
      x, y,
      knot_flavor: 'str',
    },
    narrator_line: null,
  });
}

function bossEnd(id: number, zone: string, bossId: string, outcome: 'killed' | 'despawned' | 'fled'): ZoneEvent {
  return ev(id, 'zone.boss.end', zone, {
    boss_id: bossId,
    outcome,
    killer_character_id: null,
    loot: [],
    duration_ms: 5000,
  });
}

interface CueCall {
  cue: string;
  options: unknown;
}
interface MusicCall {
  kind: 'play' | 'stop' | 'crossfade';
  name?: string;
  fadeMs?: number;
}

function makeMockCues(): { cues: CueCatalogStub; calls: CueCall[] } {
  const calls: CueCall[] = [];
  const cues: CueCatalogStub = {
    play: function (name, options) {
      calls.push({ cue: name, options: options || null });
      return null;
    },
  };
  return { cues, calls };
}

function makeMockMusic(): { music: MusicDirectorStub; calls: MusicCall[] } {
  const calls: MusicCall[] = [];
  let current: string | null = null;
  const music: MusicDirectorStub = {
    playMusic: function (name, fadeMs) {
      calls.push({ kind: 'play', name, fadeMs });
      current = name;
    },
    stopMusic: function (fadeMs) {
      calls.push({ kind: 'stop', fadeMs });
      current = null;
    },
    crossfadeMusic: function (name, fadeMs) {
      calls.push({ kind: 'crossfade', name, fadeMs });
      current = name;
    },
    currentMusic: function () { return current; },
  };
  return { music, calls };
}

// ----- Tests -----

test('zone audio: registerMapping/unregisterMapping/hasMapping/mappingCount', async () => {
  const sys = new ZoneAudioSystem();
  assert.equal(sys.mappingCount(), 0);
  assert.equal(sys.hasMapping('zone.boss.spawn'), false);

  const m: ZoneAudioMapping = {
    eventType: 'zone.boss.spawn',
    handle: function () { return null; },
  };
  sys.registerMapping(m);
  assert.equal(sys.mappingCount(), 1);
  assert.equal(sys.hasMapping('zone.boss.spawn'), true);

  // Re-register replaces.
  sys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function () { return null; },
  });
  assert.equal(sys.mappingCount(), 1, 're-register on same eventType replaces');

  sys.unregisterMapping('zone.boss.spawn');
  assert.equal(sys.mappingCount(), 0);
  assert.equal(sys.hasMapping('zone.boss.spawn'), false);

  // Unregistering a nonexistent type is a no-op.
  sys.unregisterMapping('zone.boss.spawn');
  assert.equal(sys.mappingCount(), 0);

  // Garbage mappings rejected.
  // @ts-expect-error - intentional bad input
  sys.registerMapping(null);
  // @ts-expect-error - intentional bad input
  sys.registerMapping({ eventType: 123 });
  // @ts-expect-error - intentional bad input
  sys.registerMapping({ eventType: 'zone.boss.spawn' });
  assert.equal(sys.mappingCount(), 0);
});

test('zone audio: dispatch on drain - mapped event fires cue play', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();
  const { music } = makeMockMusic();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_MUSIC_DIRECTOR_STUB, music);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossSpawn(1, 'plaza', 'b1', 7, 3));

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function (event) {
      if (event.type !== 'zone.boss.spawn') return null;
      return {
        cue: 'boss_spawn',
        options: { x: event.data.boss.x, y: event.data.boss.y },
      };
    },
  });

  // ZoneEventSystem ingests the event into the log; ZoneAudioSystem
  // drains it the same tick.
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cue, 'boss_spawn');
  const opts = calls[0]?.options as { x: number; y: number } | null;
  assert.equal(opts?.x, 7);
  assert.equal(opts?.y, 3);
});

test('zone audio: missing mapping is silent skip - other mappings still fire', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  // Two events: spawn (mapping registered) and end (NO mapping).
  bridge.enqueueAll([
    bossSpawn(1, 'plaza', 'b1', 0, 0),
    bossEnd(2, 'plaza', 'b1', 'killed'),
  ]);

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function () {
      return { cue: 'spawn_cue' };
    },
  });
  // No mapping for zone.boss.end - should silently skip.

  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cue, 'spawn_cue');
});

test('zone audio: missing cue catalog is silent skip - handler still runs (music side-effects work)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { music, calls: musicCalls } = makeMockMusic();

  // NO cue catalog resource.
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_MUSIC_DIRECTOR_STUB, music);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossEnd(1, 'plaza', 'b1', 'killed'));

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  let handlerRan = false;
  audioSys.registerMapping({
    eventType: 'zone.boss.end',
    handle: function (event, ctx) {
      handlerRan = true;
      // Music-only mapping: trigger crossfade, return null cue.
      if (ctx.music) {
        ctx.music.crossfadeMusic('victory_brief', 800);
      }
      return null;
    },
  });

  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  // Should not throw.
  w.update(0.016);

  assert.equal(handlerRan, true, 'handler ran despite missing cue catalog');
  assert.equal(musicCalls.length, 1, 'music side-effect happened');
  assert.equal(musicCalls[0]?.kind, 'crossfade');
  assert.equal(musicCalls[0]?.name, 'victory_brief');
});

test('zone audio: handler returning a cue with no catalog still keeps system stable', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();

  // No catalog, no music director.
  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossSpawn(1, 'plaza', 'b1', 5, 5));

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function () { return { cue: 'boss_spawn' }; },
  });
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);   // should not throw
});

test('zone audio: tolerates missing ZoneEventLog (no-op)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  // Nothing registered.
  const audioSys = new ZoneAudioSystem();
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function () { return { cue: 'should_never_fire' }; },
  });
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);   // should not throw
});

test('zone audio: localZone filter - drains only the local zone', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    bossSpawn(1, 'plaza', 'b_local', 1, 1),
    bossSpawn(1, 'wilds', 'b_remote', 9, 9),
  ]);

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function (event) {
      if (event.type !== 'zone.boss.spawn') return null;
      return { cue: event.data.boss.boss_id };
    },
  });
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cue, 'b_local');
});

test('zone audio: no localZone filter - drains every zone in log', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    bossSpawn(1, 'plaza', 'b_a', 0, 0),
    bossSpawn(1, 'wilds', 'b_b', 0, 0),
  ]);

  const audioSys = new ZoneAudioSystem();   // no currentZone
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function (event) {
      if (event.type !== 'zone.boss.spawn') return null;
      return { cue: event.data.boss.boss_id };
    },
  });
  // ZoneEventSystem with no currentZone treats every event as local.
  w.addSystem(new ZoneEventSystem(), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.equal(calls.length, 2);
  const fired = calls.map(function (c) { return c.cue; }).sort();
  assert.deepEqual(fired, ['b_a', 'b_b']);
});

test('zone audio: events processed once - subsequent ticks do not re-fire', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossSpawn(1, 'plaza', 'b1', 0, 0));

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function () { return { cue: 'spawn_cue' }; },
  });
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);

  w.update(0.016);
  assert.equal(calls.length, 1);

  // Second tick with no new events - cue must not re-fire.
  w.update(0.016);
  assert.equal(calls.length, 1, 'no re-dispatch of already-processed event');

  // New event arrives - should fire.
  bridge.enqueueIncoming(bossEnd(2, 'plaza', 'b1', 'killed'));
  audioSys.registerMapping({
    eventType: 'zone.boss.end',
    handle: function () { return { cue: 'end_cue' }; },
  });
  w.update(0.016);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.cue, 'end_cue');
});

test('zone audio: throwing handler does not poison subsequent events', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    bossSpawn(1, 'plaza', 'b1', 0, 0),
    bossEnd(2, 'plaza', 'b1', 'killed'),
  ]);

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function () { throw new Error('handler boom'); },
  });
  audioSys.registerMapping({
    eventType: 'zone.boss.end',
    handle: function () { return { cue: 'end_cue' }; },
  });
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  // The throwing handler is silently isolated; the second mapping
  // still fires.
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cue, 'end_cue');
});

test('zone audio: listener pose passed to handler context (defaults to zero pose if no resource)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueIncoming(bossSpawn(1, 'plaza', 'b1', 0, 0));

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  let observedListener: { x: number; y: number } | null = null;
  audioSys.registerMapping({
    eventType: 'zone.boss.spawn',
    handle: function (_event, ctx) {
      observedListener = { x: ctx.listener.x, y: ctx.listener.y };
      return null;
    },
  });
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.deepEqual(observedListener, { x: 0, y: 0 });

  // Now register an AudioListener resource and add another event;
  // pose should propagate.
  const listenerRes: AudioListenerResourceStub = {
    pose: { x: 12, y: -4 },
    lastUpdateFrame: 1,
  };
  w.resources.set(RESOURCE_AUDIO_LISTENER_STUB, listenerRes);
  bridge.enqueueIncoming(bossEnd(2, 'plaza', 'b1', 'killed'));
  audioSys.registerMapping({
    eventType: 'zone.boss.end',
    handle: function (_event, ctx) {
      observedListener = { x: ctx.listener.x, y: ctx.listener.y };
      return null;
    },
  });
  w.update(0.016);
  assert.deepEqual(observedListener, { x: 12, y: -4 });
});

test('zone audio: chronological dispatch order - oldest event first within tick', async () => {
  // ZoneEventLog stores newest-first; the audio system reverses for
  // dispatch so handlers see the temporal order. Verify with a
  // counter mapping.
  const { World } = await import('../src/world.js');
  const w = new World();
  const bridge = new MockZoneBridge();
  bridge.start();
  const log = createZoneEventLog();
  const { cues, calls } = makeMockCues();

  w.resources.set(RESOURCE_ZONE_EVENT_BRIDGE, bridge);
  w.resources.set(RESOURCE_ZONE_EVENT_LOG, log);
  w.resources.set(RESOURCE_CUE_CATALOG_STUB, cues);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  bridge.enqueueAll([
    ev(1, 'zone.narrator', 'plaza', { line: 'first', voice: 'ambient', ttl_ms: 1000 }),
    ev(2, 'zone.narrator', 'plaza', { line: 'second', voice: 'ambient', ttl_ms: 1000 }),
    ev(3, 'zone.narrator', 'plaza', { line: 'third', voice: 'ambient', ttl_ms: 1000 }),
  ]);

  const audioSys = new ZoneAudioSystem({ currentZone: () => 'plaza' });
  audioSys.registerMapping({
    eventType: 'zone.narrator',
    handle: function (event) {
      if (event.type !== 'zone.narrator') return null;
      return { cue: event.data.line };
    },
  });
  w.addSystem(new ZoneEventSystem({ currentZone: () => 'plaza' }), SYSTEM_PHASE_INPUT);
  w.addSystem(audioSys, SYSTEM_PHASE_INPUT);
  w.update(0.016);

  assert.deepEqual(
    calls.map(function (c) { return c.cue; }),
    ['first', 'second', 'third'],
  );
});
