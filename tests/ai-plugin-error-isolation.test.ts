// Loom Engine - Phase 16 Track B: error isolation tests.
//
// Per LOOM-DIRECTOR-PROTOCOL-V2 §5.3 + open question 8.3: if a
// plugin's hook throws (sync) or rejects (async), the registry logs
// via that plugin's logger, drops that plugin's contribution for THIS
// dispatch, and continues with the next plugin. The dispatch never
// throws to the caller. This file exercises that contract end-to-end.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AIPluginRegistry,
  MapPluginStorage,
  buildPluginContext,
  type IAIPlugin,
  type EmittedEvents,
  type PluginContext,
  type PluginLogger,
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

// Capturing logger that buffers calls so tests can assert what was
// logged + which plugin name appeared in meta.
class CapturingLogger implements PluginLogger {
  readonly logs: { level: 'info' | 'warn' | 'error'; msg: string; meta?: Record<string, unknown> }[] = [];
  info(msg: string, meta?: Record<string, unknown>): void {
    this.logs.push({ level: 'info', msg, ...(meta ? { meta } : {}) });
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.logs.push({ level: 'warn', msg, ...(meta ? { meta } : {}) });
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.logs.push({ level: 'error', msg, ...(meta ? { meta } : {}) });
  }
}

function ctxWith(logger: PluginLogger): PluginContext {
  return buildPluginContext({
    pluginName: 'test-ctx',
    storage: new MapPluginStorage(),
    logger,
  });
}

// ---------- Sync throw ----------

test('error isolation: sync throw in onTick drops contribution; later plugin still runs', async () => {
  var r = new AIPluginRegistry();
  var logger = new CapturingLogger();
  var laterRan = false;
  r.register({
    name: 'thrower',
    version: '0.0.1',
    priority: 0,
    onTick(_ctx: PluginContext): Promise<EmittedEvents> {
      throw new Error('sync boom');
    },
  });
  r.register({
    name: 'survivor',
    version: '0.0.1',
    priority: 1,
    async onTick(_ctx): Promise<EmittedEvents> {
      laterRan = true;
      return { characterEvents: [makeNarratorEvent(1, 'I survived')] };
    },
  });
  var emitted = await r.dispatchTick(ctxWith(logger));
  assert.equal(laterRan, true, 'lower-priority survivor must still run');
  assert.equal(emitted.characterEvents?.length, 1);
  assert.equal(
    (emitted.characterEvents?.[0]?.data as { line: string }).line,
    'I survived',
  );
  // Logger captured the failure with the hook name.
  var errorLogs = logger.logs.filter(function (l) {
    return l.level === 'error';
  });
  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0]?.msg ?? '', /onTick/);
});

// ---------- Async reject ----------

test('error isolation: async rejection drops contribution; later plugin still runs', async () => {
  var r = new AIPluginRegistry();
  var logger = new CapturingLogger();
  var laterRan = false;
  r.register({
    name: 'rejecter',
    version: '0.0.1',
    priority: 0,
    async onTick(_ctx): Promise<EmittedEvents> {
      throw new Error('async boom');
    },
  });
  r.register({
    name: 'survivor',
    version: '0.0.1',
    priority: 1,
    async onTick(_ctx): Promise<EmittedEvents> {
      laterRan = true;
      return { characterEvents: [makeNarratorEvent(1, 'survived async')] };
    },
  });
  var emitted = await r.dispatchTick(ctxWith(logger));
  assert.equal(laterRan, true);
  assert.equal(emitted.characterEvents?.length, 1);
  assert.equal(logger.logs.filter(function (l) { return l.level === 'error'; }).length, 1);
});

// ---------- Partial failure across hooks ----------

test('error isolation: plugin throws in onTick but not in onPeerJoin', async () => {
  var r = new AIPluginRegistry();
  var logger = new CapturingLogger();
  var joinFired = false;
  r.register({
    name: 'partial',
    version: '0.0.1',
    priority: 0,
    async onTick(_ctx): Promise<EmittedEvents> {
      throw new Error('tick fails');
    },
    async onPeerJoin(_ctx, _peer): Promise<EmittedEvents> {
      joinFired = true;
      return {};
    },
  });
  // Tick fails -> logged + dropped.
  await r.dispatchTick(ctxWith(logger));
  // Same plugin's onPeerJoin still works in subsequent dispatch.
  await r.dispatchPeerJoin(
    ctxWith(logger),
    { characterId: 'c', userId: 'u', zone: 'z', x: 0, y: 0, name: null },
  );
  assert.equal(joinFired, true);
});

// ---------- All plugins throw ----------

test('error isolation: every plugin throws -> dispatch returns empty merged result', async () => {
  var r = new AIPluginRegistry();
  var logger = new CapturingLogger();
  r.register({
    name: 'a',
    version: '0.0.1',
    priority: 0,
    onTick(): Promise<EmittedEvents> {
      throw new Error('a fails');
    },
  });
  r.register({
    name: 'b',
    version: '0.0.1',
    priority: 1,
    async onTick(): Promise<EmittedEvents> {
      throw new Error('b fails');
    },
  });
  var emitted = await r.dispatchTick(ctxWith(logger));
  assert.equal(emitted.characterEvents, undefined);
  assert.equal(emitted.zoneEvents, undefined);
  // Both failures logged.
  assert.equal(logger.logs.filter(function (l) { return l.level === 'error'; }).length, 2);
});

// ---------- Logger itself throws ----------

test('error isolation: logger that throws does not break dispatch', async () => {
  var r = new AIPluginRegistry();
  var laterRan = false;
  // Plugin that throws.
  r.register({
    name: 'thrower',
    version: '0.0.1',
    priority: 0,
    onTick(): Promise<EmittedEvents> {
      throw new Error('hook fails');
    },
  });
  // Survivor.
  r.register({
    name: 'survivor',
    version: '0.0.1',
    priority: 1,
    async onTick(): Promise<EmittedEvents> {
      laterRan = true;
      return {};
    },
  });
  // Logger whose error() throws.
  var hostileLogger: PluginLogger = {
    info() {},
    warn() {},
    error(): void {
      throw new Error('logger boom');
    },
  };
  var emitted = await r.dispatchTick(
    buildPluginContext({
      pluginName: 'test',
      storage: new MapPluginStorage(),
      logger: hostileLogger,
    }),
  );
  assert.equal(laterRan, true);
  assert.equal(emitted.characterEvents, undefined);
});

// ---------- Dispose throws ----------

test('error isolation: dispose() throwing does not break unregister', async () => {
  var r = new AIPluginRegistry();
  var p: IAIPlugin = {
    name: 'bad-dispose',
    version: '0.0.1',
    priority: 0,
    async dispose(): Promise<void> {
      throw new Error('dispose boom');
    },
  };
  r.register(p);
  var removed = await r.unregister('bad-dispose');
  assert.equal(removed, true);
  assert.equal(r.list().length, 0);
});

// ---------- Non-Error throw values ----------

test('error isolation: throwing a string (non-Error) is still isolated', async () => {
  var r = new AIPluginRegistry();
  var logger = new CapturingLogger();
  var laterRan = false;
  r.register({
    name: 'string-thrower',
    version: '0.0.1',
    priority: 0,
    onTick(): Promise<EmittedEvents> {
      throw 'just a string'; // eslint-disable-line @typescript-eslint/no-throw-literal
    },
  });
  r.register({
    name: 'survivor',
    version: '0.0.1',
    priority: 1,
    async onTick(): Promise<EmittedEvents> {
      laterRan = true;
      return {};
    },
  });
  await r.dispatchTick(ctxWith(logger));
  assert.equal(laterRan, true);
  // Logger meta should still capture something.
  var errs = logger.logs.filter(function (l) { return l.level === 'error'; });
  assert.equal(errs.length, 1);
});

// ---------- Earlier plugin's events preserved when later throws ----------

test('error isolation: earlier plugin events kept when later plugin throws', async () => {
  var r = new AIPluginRegistry();
  var logger = new CapturingLogger();
  r.register({
    name: 'good',
    version: '0.0.1',
    priority: 0,
    async onTick(): Promise<EmittedEvents> {
      return { characterEvents: [makeNarratorEvent(1, 'good event')] };
    },
  });
  r.register({
    name: 'bad',
    version: '0.0.1',
    priority: 1,
    onTick(): Promise<EmittedEvents> {
      throw new Error('I am bad');
    },
  });
  var emitted = await r.dispatchTick(ctxWith(logger));
  assert.equal(emitted.characterEvents?.length, 1);
  assert.equal(
    (emitted.characterEvents?.[0]?.data as { line: string }).line,
    'good event',
  );
});
