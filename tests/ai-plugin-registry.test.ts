// Loom Engine - Phase 16 Track B: AIPluginRegistry tests.
//
// Covers: register/unregister/list/get; dispatch order (lower
// priority first); merged EmittedEvents shape across multiple
// plugins; concatenation in dispatch order; snapshot semantics
// (mutation during dispatch does not affect that dispatch).
//
// Error isolation lives in ai-plugin-error-isolation.test.ts so the
// happy-path file stays focused.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AIPluginRegistry,
  AIPluginDuplicateError,
  MapPluginStorage,
  buildPluginContext,
  type IAIPlugin,
  type EmittedEvents,
  type PluginContext,
  type DirectorEvent,
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

// Builder for a minimal plugin that records every hook call into a
// shared trace array. Lets a single test assert dispatch order across
// many plugins without bespoke per-plugin classes.
function tracingPlugin(opts: {
  name: string;
  priority: number;
  trace: string[];
  emitOnTick?: DirectorEvent[];
  emitZoneOnTick?: import('../src/server/index.js').ZoneEvent[];
}): IAIPlugin {
  return {
    name: opts.name,
    version: '0.0.1',
    priority: opts.priority,
    async onTick(_ctx: PluginContext): Promise<EmittedEvents> {
      opts.trace.push(opts.name);
      var emitted: EmittedEvents = {};
      if (opts.emitOnTick && opts.emitOnTick.length > 0) {
        emitted.characterEvents = opts.emitOnTick;
      }
      if (opts.emitZoneOnTick && opts.emitZoneOnTick.length > 0) {
        emitted.zoneEvents = opts.emitZoneOnTick;
      }
      return emitted;
    },
  };
}

function ctxFor(name: string): PluginContext {
  return buildPluginContext({ pluginName: name, storage: new MapPluginStorage() });
}

// ---------- register / unregister / list / get ----------

test('registry: register stores plugin and lookup returns it', () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  var p = tracingPlugin({ name: 'a', priority: 0, trace });
  r.register(p);
  assert.equal(r.list().length, 1);
  assert.strictEqual(r.get('a'), p);
});

test('registry: register duplicate name throws AIPluginDuplicateError', () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'a', priority: 0, trace }));
  assert.throws(
    () => r.register(tracingPlugin({ name: 'a', priority: 5, trace })),
    AIPluginDuplicateError,
  );
});

test('registry: unregister removes plugin; list shrinks; returns true', async () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'a', priority: 0, trace }));
  r.register(tracingPlugin({ name: 'b', priority: 1, trace }));
  var removed = await r.unregister('a');
  assert.equal(removed, true);
  assert.equal(r.list().length, 1);
  assert.equal(r.get('a'), undefined);
  assert.notEqual(r.get('b'), undefined);
});

test('registry: unregister unknown name returns false', async () => {
  var r = new AIPluginRegistry();
  var removed = await r.unregister('nope');
  assert.equal(removed, false);
});

test('registry: unregister awaits dispose() if defined', async () => {
  var r = new AIPluginRegistry();
  var disposed = false;
  var p: IAIPlugin = {
    name: 'd',
    version: '0.0.1',
    priority: 0,
    async dispose(): Promise<void> {
      disposed = true;
    },
  };
  r.register(p);
  await r.unregister('d');
  assert.equal(disposed, true);
});

test('registry: list returns a fresh array; mutation does not affect registry', () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'a', priority: 0, trace }));
  var arr = r.list();
  // Cast away readonly to test the defensive copy contract.
  (arr as unknown as IAIPlugin[]).pop();
  assert.equal(r.list().length, 1);
});

// ---------- dispatch order ----------

test('registry: dispatchTick runs plugins in ascending priority order', async () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  // Register in shuffled order to prove the registry sorts.
  r.register(tracingPlugin({ name: 'mid', priority: 50, trace }));
  r.register(tracingPlugin({ name: 'low', priority: 10, trace }));
  r.register(tracingPlugin({ name: 'high', priority: 100, trace }));
  await r.dispatchTick(ctxFor('mid'));
  assert.deepEqual(trace, ['low', 'mid', 'high']);
});

test('registry: equal priority resolves in registration order', async () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'first', priority: 50, trace }));
  r.register(tracingPlugin({ name: 'second', priority: 50, trace }));
  r.register(tracingPlugin({ name: 'third', priority: 50, trace }));
  await r.dispatchTick(ctxFor('first'));
  assert.deepEqual(trace, ['first', 'second', 'third']);
});

test('registry: list() reflects priority-sorted order', () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'high', priority: 100, trace }));
  r.register(tracingPlugin({ name: 'low', priority: 10, trace }));
  r.register(tracingPlugin({ name: 'mid', priority: 50, trace }));
  var names = r.list().map(function (p) {
    return p.name;
  });
  assert.deepEqual(names, ['low', 'mid', 'high']);
});

// ---------- merged EmittedEvents ----------

test('registry: dispatchTick concatenates characterEvents from multiple plugins in priority order', async () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(
    tracingPlugin({
      name: 'low',
      priority: 10,
      trace,
      emitOnTick: [makeNarratorEvent(1, 'low says hi')],
    }),
  );
  r.register(
    tracingPlugin({
      name: 'high',
      priority: 100,
      trace,
      emitOnTick: [makeNarratorEvent(2, 'high says hi')],
    }),
  );
  var emitted = await r.dispatchTick(ctxFor('test'));
  assert.equal(emitted.characterEvents?.length, 2);
  // Lower priority emits first, so its events appear first in merged.
  assert.equal(
    (emitted.characterEvents?.[0]?.data as { line: string }).line,
    'low says hi',
  );
  assert.equal(
    (emitted.characterEvents?.[1]?.data as { line: string }).line,
    'high says hi',
  );
});

test('registry: dispatchTick concatenates zoneEvents from multiple plugins', async () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  r.register(
    tracingPlugin({
      name: 'a',
      priority: 0,
      trace,
      emitZoneOnTick: [
        {
          id: 1,
          ts: 1,
          type: 'zone.narrator',
          zone_id: 'z',
          emitter_id: null,
          data: {},
        },
      ],
    }),
  );
  r.register(
    tracingPlugin({
      name: 'b',
      priority: 1,
      trace,
      emitZoneOnTick: [
        {
          id: 2,
          ts: 2,
          type: 'zone.narrator',
          zone_id: 'z',
          emitter_id: null,
          data: {},
        },
      ],
    }),
  );
  var emitted = await r.dispatchTick(ctxFor('test'));
  assert.equal(emitted.zoneEvents?.length, 2);
  assert.equal(emitted.zoneEvents?.[0]?.id, 1);
  assert.equal(emitted.zoneEvents?.[1]?.id, 2);
});

test('registry: dispatchTick on empty registry returns empty object', async () => {
  var r = new AIPluginRegistry();
  var emitted = await r.dispatchTick(ctxFor('test'));
  assert.equal(emitted.characterEvents, undefined);
  assert.equal(emitted.zoneEvents, undefined);
});

test('registry: plugin without onTick is skipped without error', async () => {
  var r = new AIPluginRegistry();
  // No onTick implementation - registry must skip silently.
  r.register({
    name: 'nohook',
    version: '0.0.1',
    priority: 0,
  });
  var emitted = await r.dispatchTick(ctxFor('test'));
  assert.equal(emitted.characterEvents, undefined);
});

// ---------- dispatch variants ----------

test('registry: dispatchPeerJoin invokes onPeerJoin with PeerInfo', async () => {
  var r = new AIPluginRegistry();
  var seen: { name: string; peer: string } | null = null;
  r.register({
    name: 'pj',
    version: '0.0.1',
    priority: 0,
    async onPeerJoin(_ctx, peer): Promise<EmittedEvents> {
      seen = { name: peer.name ?? '', peer: peer.characterId };
      return {};
    },
  });
  await r.dispatchPeerJoin(ctxFor('test'), {
    characterId: 'c1',
    userId: 'u1',
    zone: 'z1',
    x: 0,
    y: 0,
    name: 'Misha',
  });
  assert.deepEqual(seen, { name: 'Misha', peer: 'c1' });
});

test('registry: dispatchPeerLeave invokes onPeerLeave', async () => {
  var r = new AIPluginRegistry();
  var leftId: string | null = null;
  r.register({
    name: 'pl',
    version: '0.0.1',
    priority: 0,
    async onPeerLeave(_ctx, peer): Promise<EmittedEvents> {
      leftId = peer.characterId;
      return {};
    },
  });
  await r.dispatchPeerLeave(ctxFor('test'), {
    characterId: 'c2',
    userId: 'u2',
    zone: 'z',
    x: 0,
    y: 0,
    name: null,
  });
  assert.equal(leftId, 'c2');
});

test('registry: dispatchZoneEnter passes fromZone (null on first entry)', async () => {
  var r = new AIPluginRegistry();
  var captured: { from: string | null; to: string } | null = null;
  r.register({
    name: 'ze',
    version: '0.0.1',
    priority: 0,
    async onZoneEnter(_ctx, peer, fromZone): Promise<EmittedEvents> {
      captured = { from: fromZone, to: peer.zone };
      return {};
    },
  });
  await r.dispatchZoneEnter(
    ctxFor('test'),
    { characterId: 'c', userId: 'u', zone: 'z2', x: 0, y: 0, name: null },
    null,
  );
  assert.deepEqual(captured, { from: null, to: 'z2' });
});

test('registry: dispatchPlayerAction passes action through', async () => {
  var r = new AIPluginRegistry();
  var seenKind: string | null = null;
  var seenPayload: Record<string, unknown> | null = null;
  r.register({
    name: 'pa',
    version: '0.0.1',
    priority: 0,
    async onPlayerAction(_ctx, _peer, action): Promise<EmittedEvents> {
      seenKind = action.kind;
      seenPayload = action.payload;
      return {};
    },
  });
  await r.dispatchPlayerAction(
    ctxFor('test'),
    { characterId: 'c', userId: 'u', zone: 'z', x: 0, y: 0, name: null },
    { kind: 'damage', payload: { target: 'boss', amount: 42 } },
  );
  assert.equal(seenKind, 'damage');
  assert.deepEqual(seenPayload, { target: 'boss', amount: 42 });
});

// ---------- snapshot semantics during dispatch ----------

test('registry: mutation during dispatch does not change current dispatch', async () => {
  var r = new AIPluginRegistry();
  var trace: string[] = [];
  // Plugin "early" registers another plugin "late" mid-dispatch. The
  // late plugin must not run for THIS dispatch (snapshot taken at
  // dispatch start), only subsequent ones.
  r.register({
    name: 'early',
    version: '0.0.1',
    priority: 0,
    async onTick(_ctx): Promise<EmittedEvents> {
      trace.push('early');
      r.register({
        name: 'late',
        version: '0.0.1',
        priority: 1,
        async onTick(_c): Promise<EmittedEvents> {
          trace.push('late');
          return {};
        },
      });
      return {};
    },
  });
  await r.dispatchTick(ctxFor('test'));
  // Only 'early' runs in the first dispatch.
  assert.deepEqual(trace, ['early']);
  // Second dispatch sees both.
  await r.dispatchTick(ctxFor('test'));
  assert.deepEqual(trace, ['early', 'early', 'late']);
});

// ---------- empty-array EmittedEvents normalization ----------

test('registry: plugin returning empty arrays does not allocate merged arrays', async () => {
  var r = new AIPluginRegistry();
  r.register({
    name: 'empty',
    version: '0.0.1',
    priority: 0,
    async onTick(_ctx): Promise<EmittedEvents> {
      return { characterEvents: [], zoneEvents: [] };
    },
  });
  var emitted = await r.dispatchTick(ctxFor('test'));
  // Empty contributions stay undefined to keep the merged shape lean.
  assert.equal(emitted.characterEvents, undefined);
  assert.equal(emitted.zoneEvents, undefined);
});
