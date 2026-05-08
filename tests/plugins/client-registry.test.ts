// Loom Engine - Phase 0.19 client-side plugin SDK tests.
//
// Mirrors the Python smoke surface where the contract crosses both
// runtimes. Covers: register/unregister, dispatch ordering, scope
// gates, tick budget timeouts, ops stat counters, error isolation,
// PluginError retry path, storage cap, describe shape.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ClientPluginRegistry,
  PluginError,
  PluginEntropy,
  CLIENT_PLUGIN_SCOPES,
  type IClientPlugin,
  type ClientPluginContext,
  type ClientEmittedEvents,
  type ZoneEventEnvelope,
  type ClientPeerInfo,
} from '../../src/index.js';
import { setWithTtl, getWithTtlCheck } from '../../src/plugins/client-registry.js';

// ----- Helpers -----

function spawnEnvelope(zoneId: string, bossId: string): ZoneEventEnvelope {
  return {
    id: 1,
    ts: 1000,
    type: 'zone.boss.spawn',
    zone_id: zoneId,
    emitter_id: null,
    data: {
      boss: {
        boss_id: bossId,
        type: 'shadow_warden',
        name: 'Test Boss',
        hp_max: 1000,
        hp_current: 1000,
        dmg: 25,
        x: 0,
        y: 0,
        knot_flavor: 'shadow',
      },
      narrator_line: null,
    },
  };
}

function endEnvelope(zoneId: string, bossId: string, withLoot: boolean): ZoneEventEnvelope {
  return {
    id: 2,
    ts: 2000,
    type: 'zone.boss.end',
    zone_id: zoneId,
    emitter_id: null,
    data: {
      boss_id: bossId,
      outcome: 'killed',
      killer_character_id: 'c1',
      loot: withLoot ? [{ kind: 'shard', amount: 10 }] : [],
      duration_ms: 30000,
    },
  };
}

function tickEnvelope(zoneId: string): ZoneEventEnvelope {
  return {
    id: 3,
    ts: 3000,
    type: 'zone.boss.tick',
    zone_id: zoneId,
    emitter_id: null,
    data: {
      boss_id: 'b1',
      hp_current: 500,
      x: 1,
      y: 2,
      recent_hits: [],
    },
  };
}

// Build a tracing plugin that records every hook invocation into a
// shared trace array. Lets a single test assert dispatch order
// across many plugins without bespoke per-plugin classes.
function tracingPlugin(opts: {
  name: string;
  priority?: number;
  trace: string[];
  tickBudgetMs?: number;
  requiredScopes?: ReadonlyArray<'read_zones' | 'read_characters' | 'read_events'>;
  storageMaxBytes?: number;
  tags?: string[];
  onZoneEvent?: (ctx: ClientPluginContext, env: ZoneEventEnvelope) => Promise<ClientEmittedEvents | void>;
}): IClientPlugin {
  var p: IClientPlugin = {
    name: opts.name,
    version: '0.0.1',
    priority: typeof opts.priority === 'number' ? opts.priority : 50,
    async onZoneEvent(ctx: ClientPluginContext, env: ZoneEventEnvelope): Promise<ClientEmittedEvents | void> {
      opts.trace.push(opts.name + ':' + env.type);
      if (opts.onZoneEvent) {
        return opts.onZoneEvent(ctx, env);
      }
    },
  };
  if (typeof opts.tickBudgetMs === 'number') (p as { tickBudgetMs: number }).tickBudgetMs = opts.tickBudgetMs;
  if (opts.requiredScopes) (p as { requiredScopes: ReadonlyArray<'read_zones' | 'read_characters' | 'read_events'> }).requiredScopes = opts.requiredScopes;
  if (typeof opts.storageMaxBytes === 'number') (p as { storageMaxBytes: number }).storageMaxBytes = opts.storageMaxBytes;
  if (opts.tags) (p as { tags: ReadonlyArray<string> }).tags = opts.tags;
  return p;
}

function noBridgeRegistry(extra?: { peers?: ClientPeerInfo[]; events?: ZoneEventEnvelope[]; state?: Map<string, unknown> }): ClientPluginRegistry {
  return new ClientPluginRegistry({
    eventTarget: null,
    getZonePeers: function () { return (extra && extra.peers) || []; },
    getZoneEventsTail: function () { return (extra && extra.events) || []; },
    getZoneState: function () { return (extra && extra.state) || new Map(); },
  });
}

// ----- Tests -----

test('client-registry: register stores plugin; lookup returns it', function () {
  var r = noBridgeRegistry();
  var trace: string[] = [];
  var p = tracingPlugin({ name: 'a', priority: 10, trace });
  r.register(p);
  assert.equal(r.list().length, 1);
  assert.strictEqual(r.get('a'), p);
});

test('client-registry: re-registering same name replaces previous', async function () {
  var r = noBridgeRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'dup', priority: 0, trace }));
  var second: IClientPlugin = {
    name: 'dup',
    version: '0.0.2',
    priority: 0,
    async onZoneEvent(_ctx) {
      trace.push('second');
    },
  };
  r.register(second);
  assert.equal(r.list().length, 1);
  assert.strictEqual(r.get('dup'), second);
  // The replacement is the one that runs.
  await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
  assert.deepEqual(trace, ['second']);
});

test('client-registry: dispatchZoneEvent runs plugins in priority order (lower first)', async function () {
  var r = noBridgeRegistry();
  var trace: string[] = [];
  r.register(tracingPlugin({ name: 'mid', priority: 50, trace }));
  r.register(tracingPlugin({ name: 'low', priority: 10, trace }));
  r.register(tracingPlugin({ name: 'high', priority: 100, trace }));
  await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
  // Each plugin gets onZoneEvent (catch-all) AND onBossSpawn (narrow).
  // Catch-all runs first per plugin; narrow only fires for plugins
  // that implement it - none here implement onBossSpawn, so trace
  // only has the catch-all entries in priority order.
  assert.deepEqual(trace, [
    'low:zone.boss.spawn',
    'mid:zone.boss.spawn',
    'high:zone.boss.spawn',
  ]);
});

test('client-registry: onBossSpawn narrow hook fires AFTER onZoneEvent for same plugin', async function () {
  var r = noBridgeRegistry();
  var trace: string[] = [];
  var p: IClientPlugin = {
    name: 'narrow',
    version: '0.0.1',
    priority: 50,
    async onZoneEvent(_ctx, env) {
      trace.push('catchall:' + env.type);
    },
    async onBossSpawn(_ctx, zoneId, boss) {
      trace.push('narrow:' + zoneId + ':' + boss.boss_id);
    },
  };
  r.register(p);
  await r.dispatchZoneEvent(spawnEnvelope('z1', 'b1'));
  assert.deepEqual(trace, ['catchall:zone.boss.spawn', 'narrow:z1:b1']);
});

test('client-registry: onLootDrop fires only when boss-end carries loot', async function () {
  var r = noBridgeRegistry();
  var lootHits: string[] = [];
  var p: IClientPlugin = {
    name: 'looter',
    version: '0.0.1',
    priority: 0,
    async onLootDrop(_ctx, _zone, bossId, items) {
      lootHits.push(bossId + ':' + items.length);
    },
  };
  r.register(p);
  await r.dispatchZoneEvent(endEnvelope('z', 'bad-boss', false));
  assert.deepEqual(lootHits, []);
  await r.dispatchZoneEvent(endEnvelope('z', 'lootful', true));
  assert.deepEqual(lootHits, ['lootful:1']);
});

test('client-registry: error in one plugin does not break others (error isolation)', async function () {
  var r = noBridgeRegistry();
  var trace: string[] = [];
  // Silence the error logger noise for this test.
  var prevError = console.error;
  console.error = function () { /* swallow */ };
  try {
    r.register({
      name: 'thrower',
      version: '0.0.1',
      priority: 0,
      async onZoneEvent() {
        throw new Error('boom');
      },
    });
    r.register(tracingPlugin({ name: 'survivor', priority: 1, trace }));
    var emitted = await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
    assert.equal(emitted.zoneEvents, undefined);
    assert.deepEqual(trace, ['survivor:zone.boss.spawn']);
    var stats = r.statsFor('thrower');
    assert.equal(stats?.hook_error_count, 1);
  } finally {
    console.error = prevError;
  }
});

test('client-registry: PluginError(retryable=true) is retried once before dropping', async function () {
  var r = noBridgeRegistry();
  var attempts = 0;
  var prevError = console.error;
  var prevWarn = console.warn;
  console.error = function () { /* swallow */ };
  console.warn = function () { /* swallow */ };
  try {
    r.register({
      name: 'flaky',
      version: '0.0.1',
      priority: 0,
      async onZoneEvent() {
        attempts += 1;
        throw new PluginError('rate_limit', true);
      },
    });
    await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
    assert.equal(attempts, 2, 'expected 1 initial + 1 retry');
    var stats = r.statsFor('flaky');
    assert.equal(stats?.hook_retry_count, 1);
    assert.equal(stats?.hook_error_count, 1);
  } finally {
    console.error = prevError;
    console.warn = prevWarn;
  }
});

test('client-registry: tick budget timeout drops the plugin and bumps timeout counter', async function () {
  var r = noBridgeRegistry();
  var prevWarn = console.warn;
  console.warn = function () { /* swallow */ };
  try {
    r.register({
      name: 'slow',
      version: '0.0.1',
      priority: 0,
      tickBudgetMs: 25,
      async onZoneEvent() {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve({}); }, 200);
        });
      },
    });
    await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
    var stats = r.statsFor('slow');
    assert.equal(stats?.hook_timeout_count, 1);
  } finally {
    console.warn = prevWarn;
  }
});

test('client-registry: required_scopes gate accessor returns', async function () {
  var peers: ClientPeerInfo[] = [{ characterId: 'c1', userId: 'u1', zone: 'z', x: 0, y: 0, name: 'a' }];
  var events: ZoneEventEnvelope[] = [tickEnvelope('z')];
  var r = new ClientPluginRegistry({
    eventTarget: null,
    getZonePeers: function () { return peers; },
    getZoneEventsTail: function () { return events; },
  });

  var captured: { zonesPeers: number; events: number } = { zonesPeers: 0, events: 0 };
  // Plugin with read_events ONLY - getZonePeers must return [].
  r.register({
    name: 'events-only',
    version: '0.0.1',
    priority: 0,
    requiredScopes: ['read_events'],
    async onZoneEvent(ctx) {
      captured.zonesPeers = ctx.getZonePeers('z').length;
      captured.events = ctx.getZoneEventsTail('z', 5).length;
    },
  });
  await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
  assert.equal(captured.zonesPeers, 0);
  assert.equal(captured.events, 1);
});

test('client-registry: storage cap rejects oversize set with PluginError', async function () {
  var r = noBridgeRegistry();
  var caught: PluginError | null = null;
  r.register({
    name: 'fat',
    version: '0.0.1',
    priority: 0,
    storageMaxBytes: 64,
    async onZoneEvent(ctx) {
      try {
        await ctx.storage.set('big', 'x'.repeat(200));
      } catch (err) {
        if (err instanceof PluginError) caught = err;
      }
    },
  });
  await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
  assert.notEqual(caught, null);
  // Type narrowing: assigning to typed local for assertion.
  var pe: PluginError = caught as unknown as PluginError;
  assert.equal(pe.code, 'storage_quota_exceeded');
  var stats = r.statsFor('fat');
  assert.equal(stats?.storage_caps_rejected, 1);
});

test('client-registry: ops counters track set/get/delete', async function () {
  var r = noBridgeRegistry();
  r.register({
    name: 'opsy',
    version: '0.0.1',
    priority: 0,
    async onZoneEvent(ctx) {
      await ctx.storage.set('k', 'v');
      await ctx.storage.get('k');
      await ctx.storage.delete('k');
    },
  });
  await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
  var stats = r.statsFor('opsy');
  assert.equal(stats?.storage_set_count, 1);
  assert.equal(stats?.storage_get_count, 1);
  assert.equal(stats?.storage_delete_count, 1);
  assert.equal(stats?.hook_call_count, 1);
});

test('client-registry: describe surfaces metadata + hook list', function () {
  var r = noBridgeRegistry();
  r.register({
    name: 'meta',
    version: '0.2.3',
    priority: 7,
    requiresProtocol: 'loom-director-v3',
    description: 'Test plugin',
    tags: ['hud', 'demo'],
    requiredScopes: ['read_zones'],
    storageMaxBytes: 2048,
    tickBudgetMs: 250,
    async onZoneEvent() { /* noop */ },
    async onBossSpawn() { /* noop */ },
  });
  var rows = r.describe();
  assert.equal(rows.length, 1);
  var row = rows[0];
  if (!row) throw new Error('describe row missing');
  assert.equal(row.name, 'meta');
  assert.equal(row.version, '0.2.3');
  assert.equal(row.priority, 7);
  assert.equal(row.requires_protocol, 'loom-director-v3');
  assert.deepEqual(row.tags, ['hud', 'demo']);
  assert.deepEqual(row.scopes, ['read_zones']);
  assert.equal(row.tick_budget_ms, 250);
  assert.equal(row.storage_max_bytes, 2048);
  assert.ok(row.hooks.indexOf('onZoneEvent') >= 0);
  assert.ok(row.hooks.indexOf('onBossSpawn') >= 0);
});

test('client-registry: unregister awaits dispose() and drops state', async function () {
  var r = noBridgeRegistry();
  var disposed = false;
  r.register({
    name: 'd',
    version: '0.0.1',
    priority: 0,
    async dispose() { disposed = true; },
  });
  var removed = await r.unregister('d');
  assert.equal(removed, true);
  assert.equal(disposed, true);
  assert.equal(r.list().length, 0);
});

test('client-registry: bridge routes window CustomEvent through dispatchZoneEvent', async function () {
  // Use a MessageChannel-like polyfill: a simple in-process EventTarget.
  // Modern Node ships EventTarget globally - we can use it directly.
  var bus = new EventTarget();
  var r = new ClientPluginRegistry({ eventTarget: bus });
  var hits: string[] = [];
  r.register({
    name: 'listener',
    version: '0.0.1',
    priority: 0,
    async onZoneEvent(_ctx, env) { hits.push(env.type); },
  });
  bus.dispatchEvent(new CustomEvent('arpg:zone-boss-spawn', { detail: spawnEnvelope('z', 'b') }));
  // Microtask flush: dispatchZoneEvent is async; await a turn.
  await new Promise(function (r2) { setTimeout(r2, 10); });
  assert.deepEqual(hits, ['zone.boss.spawn']);
  await r.dispose();
});

test('client-registry: peersInRadius + nearestPeer compute Euclidean correctly', async function () {
  var peers: ClientPeerInfo[] = [
    { characterId: 'a', userId: 'u', zone: 'z', x: 0, y: 0, name: null },
    { characterId: 'b', userId: 'u', zone: 'z', x: 5, y: 0, name: null },
    { characterId: 'c', userId: 'u', zone: 'z', x: 0, y: 100, name: null },
  ];
  var r = new ClientPluginRegistry({
    eventTarget: null,
    getZonePeers: function () { return peers; },
  });
  var inRadius: number = -1;
  var nearest: { peer: ClientPeerInfo; distance: number } | null = null;
  r.register({
    name: 'spatial',
    version: '0.0.1',
    priority: 0,
    async onZoneEvent(ctx) {
      inRadius = ctx.peersInRadius('z', 0, 0, 6).length;
      nearest = ctx.nearestPeer('z', 1, 0);
    },
  });
  await r.dispatchZoneEvent(spawnEnvelope('z', 'b'));
  assert.equal(inRadius, 2); // a + b within radius 6 of (0,0)
  assert.notEqual(nearest, null);
  // Type-narrow via cast since assert doesn't refine.
  var n: { peer: ClientPeerInfo; distance: number } = nearest as unknown as { peer: ClientPeerInfo; distance: number };
  assert.equal(n.peer.characterId, 'a');
});

test('PluginEntropy: seeded RNG is deterministic; pick + intRange in range', function () {
  var e1 = new PluginEntropy(42);
  var e2 = new PluginEntropy(42);
  var seq1: number[] = [];
  var seq2: number[] = [];
  for (var i = 0; i < 8; i++) {
    seq1.push(e1.random());
    seq2.push(e2.random());
  }
  assert.deepEqual(seq1, seq2, 'same seed must produce same stream');
  var picked = e1.pick(['a', 'b', 'c']);
  assert.ok(picked === 'a' || picked === 'b' || picked === 'c');
  for (var k = 0; k < 50; k++) {
    var n = e1.intRange(3, 7);
    assert.ok(n >= 3 && n <= 7);
  }
});

test('TTL helpers: set_with_ttl + get_with_ttl_check expire on read', async function () {
  var registry = noBridgeRegistry();
  registry.register({
    name: 'ttl',
    version: '0.0.1',
    priority: 0,
    async onZoneEvent(ctx) {
      var fakeNow = 1000;
      await setWithTtl(ctx.storage, 'k', 'v', 50, function () { return fakeNow; });
      var live = await getWithTtlCheck(ctx.storage, 'k', function () { return fakeNow + 25; });
      assert.equal(live, 'v', 'unexpired value should round-trip');
      var dead = await getWithTtlCheck(ctx.storage, 'k', function () { return fakeNow + 200; });
      assert.equal(dead, undefined, 'expired value should return undefined');
    },
  });
  await registry.dispatchZoneEvent(spawnEnvelope('z', 'b'));
});

test('CLIENT_PLUGIN_SCOPES contains the 3 documented scopes', function () {
  assert.deepEqual(CLIENT_PLUGIN_SCOPES.slice().sort(), ['read_characters', 'read_events', 'read_zones']);
});

// 0.19.1 regression: hooks may return null / undefined / a value
// synchronously. Mirrors the Python Optional[EmittedEvents] shape;
// pre-fix the registry called `.then()` on the raw return value and
// threw "Cannot read properties of null (reading 'then')". The
// safeCall path now wraps the return value via Promise.resolve, and
// withTimeout no longer fires its setTimeout when the hook resolved
// synchronously.
test('client-registry: sync hook returning null is safe + fast (0.19.1 regression)', async function () {
  var registry = new ClientPluginRegistry({ eventTarget: null });
  var calls = 0;

  // NOTE: not async - this returns null synchronously, exactly like
  // the user's hud-probe plugin in production.
  registry.register({
    name: 'sync-null',
    version: '1.0.0',
    priority: 100,
    onBossSpawn: function (
      _ctx: ClientPluginContext,
      _zoneId: string,
      _boss: unknown,
    ): ClientEmittedEvents | null {
      calls += 1;
      return null;
    },
  } as unknown as IClientPlugin);

  var t0 = Date.now();
  await registry.dispatchBossSpawn('z', {
    boss_id: 'b1', type: 't', name: 'n', hp_max: 1, hp_current: 1,
    dmg: 0, x: 0, y: 0, knot_flavor: 'umbral',
  });
  var elapsed = Date.now() - t0;
  assert.equal(calls, 1, 'hook should fire exactly once');
  assert.ok(elapsed < 200, 'sync hook returning null should resolve fast (<200ms); got ' + String(elapsed) + 'ms');

  // Stats: hook_call_count bumped, NO timeout, NO error.
  var stats = registry.statsFor('sync-null');
  assert.ok(stats, 'stats should exist');
  assert.equal(stats!.hook_call_count, 1);
  assert.equal(stats!.hook_timeout_count, 0,
    'sync return-null must NOT trigger a tick-budget timeout');
  assert.equal(stats!.hook_error_count, 0,
    'sync return-null must NOT trigger an error');
});

test('client-registry: sync hook returning a value resolves correctly', async function () {
  var registry = new ClientPluginRegistry({ eventTarget: null });

  registry.register({
    name: 'sync-value',
    version: '1.0.0',
    priority: 100,
    onBossSpawn: function (): ClientEmittedEvents {
      return { zoneEvents: [{ type: 'zone.test.sync', data: {} } as unknown as ZoneEventEnvelope['data']] };
    },
  } as unknown as IClientPlugin);

  var emitted = await registry.dispatchBossSpawn('z', {
    boss_id: 'b2', type: 't', name: 'n', hp_max: 1, hp_current: 1,
    dmg: 0, x: 0, y: 0, knot_flavor: 'umbral',
  });
  assert.ok(emitted.zoneEvents);
  assert.equal((emitted.zoneEvents as unknown[]).length, 1);
  var stats = registry.statsFor('sync-value');
  assert.equal(stats!.hook_timeout_count, 0);
});
