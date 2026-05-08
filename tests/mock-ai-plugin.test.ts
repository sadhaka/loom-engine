// Loom Engine - Phase 16 Track B: MockAIPlugin tests.
//
// Per LOOM-DIRECTOR-PROTOCOL-V2 §5.4: deterministic synthetic events
// keyed by tick number. Constructor-injected script is consulted on
// each onTick(); entries whose atTick matches the current count fire.
// Verifies determinism, multi-tick replay, missed-tick behavior, and
// multi-instance support via the `name` override.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AIPluginRegistry,
  MapPluginStorage,
  buildPluginContext,
  MockAIPlugin,
  type DirectorEvent,
  type ZoneEvent,
  type PluginContext,
} from '../src/server/index.js';

// ---------- Helpers ----------

function makeNarratorEvent(id: number, line: string): DirectorEvent {
  return {
    id,
    ts: 1000 + id,
    type: 'narrator.line',
    character_id: 'c_test',
    encounter_id: null,
    data: { line, voice: 'ambient', ttl_ms: 4000 },
  };
}

function makeZoneNarrator(id: number, zone: string): ZoneEvent {
  return {
    id,
    ts: 5000 + id,
    type: 'zone.narrator',
    zone_id: zone,
    emitter_id: null,
    data: { line: 'zone says hi', voice: 'ambient', ttl_ms: 3000 },
  };
}

function ctx(): PluginContext {
  return buildPluginContext({ pluginName: 'mock', storage: new MapPluginStorage() });
}

// ---------- Determinism ----------

test('mock plugin: emits scripted events at matching tick', async () => {
  var p = new MockAIPlugin({
    script: [
      { atTick: 1, characterEvents: [makeNarratorEvent(1, 'tick 1')] },
    ],
  });
  var emitted = await p.onTick(ctx());
  assert.equal(emitted.characterEvents?.length, 1);
  assert.equal(
    (emitted.characterEvents?.[0]?.data as { line: string }).line,
    'tick 1',
  );
});

test('mock plugin: emits nothing on a tick not in the script', async () => {
  var p = new MockAIPlugin({
    script: [{ atTick: 5, characterEvents: [makeNarratorEvent(5, 'late')] }],
  });
  // Ticks 1-4 should be silent.
  for (var i = 1; i <= 4; i++) {
    var e = await p.onTick(ctx());
    assert.equal(e.characterEvents, undefined, 'tick ' + i + ' should be silent');
  }
  var fifth = await p.onTick(ctx());
  assert.equal(fifth.characterEvents?.length, 1);
});

test('mock plugin: empty script never emits', async () => {
  var p = new MockAIPlugin({ script: [] });
  for (var i = 0; i < 10; i++) {
    var e = await p.onTick(ctx());
    assert.equal(e.characterEvents, undefined);
    assert.equal(e.zoneEvents, undefined);
  }
});

test('mock plugin: multiple entries at same tick all fire', async () => {
  var p = new MockAIPlugin({
    script: [
      { atTick: 1, characterEvents: [makeNarratorEvent(1, 'first')] },
      { atTick: 1, characterEvents: [makeNarratorEvent(2, 'second')] },
      { atTick: 1, zoneEvents: [makeZoneNarrator(10, 'z1')] },
    ],
  });
  var e = await p.onTick(ctx());
  assert.equal(e.characterEvents?.length, 2);
  assert.equal(e.zoneEvents?.length, 1);
  assert.equal(
    (e.characterEvents?.[0]?.data as { line: string }).line,
    'first',
  );
  assert.equal(
    (e.characterEvents?.[1]?.data as { line: string }).line,
    'second',
  );
});

test('mock plugin: emits zone events when scripted', async () => {
  var p = new MockAIPlugin({
    script: [{ atTick: 2, zoneEvents: [makeZoneNarrator(99, 'iron_reach')] }],
  });
  await p.onTick(ctx());
  var second = await p.onTick(ctx());
  assert.equal(second.zoneEvents?.length, 1);
  assert.equal(second.zoneEvents?.[0]?.zone_id, 'iron_reach');
});

// ---------- Tick counter mechanics ----------

test('mock plugin: currentTick reflects number of onTick calls', async () => {
  var p = new MockAIPlugin({ script: [] });
  assert.equal(p.currentTick(), 0);
  await p.onTick(ctx());
  await p.onTick(ctx());
  await p.onTick(ctx());
  assert.equal(p.currentTick(), 3);
});

test('mock plugin: resetTick rewinds counter for replay', async () => {
  var p = new MockAIPlugin({
    script: [{ atTick: 1, characterEvents: [makeNarratorEvent(1, 'replay')] }],
  });
  await p.onTick(ctx()); // tick 1 -> emits
  await p.onTick(ctx()); // tick 2 -> silent
  p.resetTick();
  var e = await p.onTick(ctx()); // back to tick 1
  assert.equal(e.characterEvents?.length, 1);
});

// ---------- Determinism across multiple runs ----------

test('mock plugin: two instances with identical scripts emit identical sequences', async () => {
  var script = [
    { atTick: 1, characterEvents: [makeNarratorEvent(1, 'a')] },
    { atTick: 3, characterEvents: [makeNarratorEvent(3, 'b')] },
  ];
  var p1 = new MockAIPlugin({ name: 'm1', script });
  var p2 = new MockAIPlugin({ name: 'm2', script });
  for (var i = 1; i <= 4; i++) {
    var e1 = await p1.onTick(ctx());
    var e2 = await p2.onTick(ctx());
    assert.equal(e1.characterEvents?.length ?? 0, e2.characterEvents?.length ?? 0);
  }
});

// ---------- name override + multi-instance ----------

test('mock plugin: default name is "mock"', () => {
  var p = new MockAIPlugin({ script: [] });
  assert.equal(p.name, 'mock');
});

test('mock plugin: name override allows multiple instances in one registry', () => {
  var r = new AIPluginRegistry();
  r.register(new MockAIPlugin({ name: 'mock-a', script: [] }));
  r.register(new MockAIPlugin({ name: 'mock-b', script: [] }));
  assert.equal(r.list().length, 2);
});

test('mock plugin: registering two with default name throws (duplicate)', () => {
  var r = new AIPluginRegistry();
  r.register(new MockAIPlugin({ script: [] }));
  assert.throws(function () {
    r.register(new MockAIPlugin({ script: [] }));
  });
});

test('mock plugin: priority override controls dispatch order', async () => {
  var r = new AIPluginRegistry();
  // Two mocks with explicit priorities and distinct names.
  r.register(
    new MockAIPlugin({
      name: 'late',
      priority: 100,
      script: [{ atTick: 1, characterEvents: [makeNarratorEvent(2, 'late')] }],
    }),
  );
  r.register(
    new MockAIPlugin({
      name: 'early',
      priority: 0,
      script: [{ atTick: 1, characterEvents: [makeNarratorEvent(1, 'early')] }],
    }),
  );
  var emitted = await r.dispatchTick(
    buildPluginContext({ pluginName: 'test', storage: new MapPluginStorage() }),
  );
  assert.equal(emitted.characterEvents?.length, 2);
  assert.equal(
    (emitted.characterEvents?.[0]?.data as { line: string }).line,
    'early',
  );
  assert.equal(
    (emitted.characterEvents?.[1]?.data as { line: string }).line,
    'late',
  );
});

test('mock plugin: default priority is 999 (low; runs late)', () => {
  var p = new MockAIPlugin({ script: [] });
  assert.equal(p.priority, 999);
});

// ---------- Sparse script (gaps in atTick) ----------

test('mock plugin: missed atTick (advanced past it) does not back-fire', async () => {
  var p = new MockAIPlugin({
    script: [
      { atTick: 1, characterEvents: [makeNarratorEvent(1, 'a')] },
      { atTick: 5, characterEvents: [makeNarratorEvent(5, 'e')] },
    ],
  });
  // Manually advance the tick counter past 1 by calling onTick three
  // times without checking output, then continue.
  await p.onTick(ctx()); // 1 fires
  var t2 = await p.onTick(ctx()); // 2 silent
  assert.equal(t2.characterEvents, undefined);
  var t3 = await p.onTick(ctx()); // 3 silent
  assert.equal(t3.characterEvents, undefined);
  var t4 = await p.onTick(ctx()); // 4 silent
  assert.equal(t4.characterEvents, undefined);
  var t5 = await p.onTick(ctx()); // 5 fires
  assert.equal(t5.characterEvents?.length, 1);
});
