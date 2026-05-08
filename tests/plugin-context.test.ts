// Loom Engine - Phase 16 Track B: PluginContext concrete impls.
//
// Covers MapPluginStorage round-trip + namespacing per plugin name,
// ConsolePluginLogger tagging, storage isolation between plugins,
// buildPluginContext defaults.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MapPluginStorage,
  ConsolePluginLogger,
  buildPluginContext,
  type PeerInfo,
  type CharacterState,
  type PluginLogger,
} from '../src/server/index.js';

// ---------- MapPluginStorage round-trip ----------

test('storage: set/get round-trip returns the stored value', async () => {
  var s = new MapPluginStorage();
  var p = s.forPlugin('plugin-a');
  await p.set('k', { hello: 'world' });
  var v = await p.get('k');
  assert.deepEqual(v, { hello: 'world' });
});

test('storage: get returns undefined for missing key', async () => {
  var s = new MapPluginStorage();
  var p = s.forPlugin('plugin-a');
  var v = await p.get('nope');
  assert.equal(v, undefined);
});

test('storage: delete removes the value', async () => {
  var s = new MapPluginStorage();
  var p = s.forPlugin('plugin-a');
  await p.set('k', 1);
  await p.delete('k');
  assert.equal(await p.get('k'), undefined);
});

test('storage: set overwrites', async () => {
  var s = new MapPluginStorage();
  var p = s.forPlugin('plugin-a');
  await p.set('k', 1);
  await p.set('k', 2);
  assert.equal(await p.get('k'), 2);
});

test('storage: stores arbitrary value types (strings, numbers, objects, arrays, null)', async () => {
  var s = new MapPluginStorage();
  var p = s.forPlugin('a');
  await p.set('s', 'hello');
  await p.set('n', 42);
  await p.set('o', { x: 1 });
  await p.set('arr', [1, 2, 3]);
  await p.set('null', null);
  assert.equal(await p.get('s'), 'hello');
  assert.equal(await p.get('n'), 42);
  assert.deepEqual(await p.get('o'), { x: 1 });
  assert.deepEqual(await p.get('arr'), [1, 2, 3]);
  assert.equal(await p.get('null'), null);
});

// ---------- Namespace isolation ----------

test('storage: two plugins with same key see different values', async () => {
  var s = new MapPluginStorage();
  var a = s.forPlugin('a');
  var b = s.forPlugin('b');
  await a.set('shared-key', 'value-from-a');
  await b.set('shared-key', 'value-from-b');
  assert.equal(await a.get('shared-key'), 'value-from-a');
  assert.equal(await b.get('shared-key'), 'value-from-b');
});

test('storage: delete in one plugin does not affect another', async () => {
  var s = new MapPluginStorage();
  var a = s.forPlugin('a');
  var b = s.forPlugin('b');
  await a.set('k', 'a-val');
  await b.set('k', 'b-val');
  await a.delete('k');
  assert.equal(await a.get('k'), undefined);
  assert.equal(await b.get('k'), 'b-val');
});

test('storage: clearPlugin wipes only that plugin', async () => {
  var s = new MapPluginStorage();
  var a = s.forPlugin('a');
  var b = s.forPlugin('b');
  await a.set('k1', 1);
  await a.set('k2', 2);
  await b.set('k1', 99);
  s.clearPlugin('a');
  assert.equal(await a.get('k1'), undefined);
  assert.equal(await a.get('k2'), undefined);
  assert.equal(await b.get('k1'), 99);
});

test('storage: clearPlugin on empty plugin is a no-op', () => {
  var s = new MapPluginStorage();
  s.clearPlugin('never-registered');
  assert.equal(s.size(), 0);
});

test('storage: size reflects total entries across plugins', async () => {
  var s = new MapPluginStorage();
  await s.forPlugin('a').set('k1', 1);
  await s.forPlugin('a').set('k2', 2);
  await s.forPlugin('b').set('k1', 3);
  assert.equal(s.size(), 3);
  s.clearPlugin('a');
  assert.equal(s.size(), 1);
});

// ---------- ConsolePluginLogger tagging ----------

// Stub console methods so the test asserts what was written without
// polluting test output.
function captureConsole(): {
  restore: () => void;
  info: string[];
  warn: string[];
  error: string[];
} {
  var origInfo = console.info;
  var origWarn = console.warn;
  var origError = console.error;
  var info: string[] = [];
  var warn: string[] = [];
  var error: string[] = [];
  console.info = function (msg: unknown) {
    info.push(String(msg));
  };
  console.warn = function (msg: unknown) {
    warn.push(String(msg));
  };
  console.error = function (msg: unknown) {
    error.push(String(msg));
  };
  return {
    restore() {
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
    },
    info,
    warn,
    error,
  };
}

test('logger: info/warn/error tag with plugin name', () => {
  var cap = captureConsole();
  try {
    var l = new ConsolePluginLogger('twt-loom');
    l.info('starting');
    l.warn('latency high');
    l.error('rpc failed');
    assert.equal(cap.info.length, 1);
    assert.equal(cap.warn.length, 1);
    assert.equal(cap.error.length, 1);
    assert.match(cap.info[0] ?? '', /\[plugin: twt-loom\]/);
    assert.match(cap.info[0] ?? '', /starting/);
    assert.match(cap.warn[0] ?? '', /\[plugin: twt-loom\]/);
    assert.match(cap.error[0] ?? '', /\[plugin: twt-loom\]/);
  } finally {
    cap.restore();
  }
});

test('logger: meta is JSON-serialized into the line', () => {
  var cap = captureConsole();
  try {
    var l = new ConsolePluginLogger('p');
    l.info('event', { tick: 7, target: 'boss' });
    var line = cap.info[0] ?? '';
    assert.match(line, /\[plugin: p\]/);
    assert.match(line, /event/);
    assert.match(line, /"tick":7/);
    assert.match(line, /"target":"boss"/);
  } finally {
    cap.restore();
  }
});

test('logger: circular meta does not throw', () => {
  var cap = captureConsole();
  try {
    var l = new ConsolePluginLogger('p');
    var circ: Record<string, unknown> = {};
    circ['self'] = circ;
    // Should not throw despite circular ref.
    l.info('msg', circ);
    assert.equal(cap.info.length, 1);
    assert.match(cap.info[0] ?? '', /\[meta-not-serializable\]/);
  } finally {
    cap.restore();
  }
});

test('logger: omitted meta does not append empty braces', () => {
  var cap = captureConsole();
  try {
    var l = new ConsolePluginLogger('p');
    l.info('plain');
    var line = cap.info[0] ?? '';
    assert.equal(line.endsWith('plain'), true);
  } finally {
    cap.restore();
  }
});

// ---------- buildPluginContext defaults ----------

test('context builder: default getZonePeers returns empty array', () => {
  var ctx = buildPluginContext({
    pluginName: 'p',
    storage: new MapPluginStorage(),
  });
  assert.deepEqual(ctx.getZonePeers('any-zone'), []);
});

test('context builder: default getZoneState returns empty Map', () => {
  var ctx = buildPluginContext({
    pluginName: 'p',
    storage: new MapPluginStorage(),
  });
  var s = ctx.getZoneState('any-zone');
  assert.equal(s.size, 0);
});

test('context builder: default getCharacterState returns minimal shape', () => {
  var ctx = buildPluginContext({
    pluginName: 'p',
    storage: new MapPluginStorage(),
  });
  var st = ctx.getCharacterState('c1');
  assert.equal(st.characterId, 'c1');
  assert.equal(st.hp_current, 0);
  assert.equal(st.hp_max, 0);
});

test('context builder: custom views are passed through', () => {
  var peers: PeerInfo[] = [
    { characterId: 'c1', userId: 'u1', zone: 'z', x: 1, y: 2, name: 'A' },
  ];
  var charState: CharacterState = {
    characterId: 'c1',
    zone: 'iron_reach',
    x: 5,
    y: 6,
    hp_current: 80,
    hp_max: 100,
  };
  var zoneMap = new Map<string, unknown>([['fire_lit', true]]);
  var ctx = buildPluginContext({
    pluginName: 'p',
    storage: new MapPluginStorage(),
    getZonePeers: function () { return peers; },
    getCharacterState: function () { return charState; },
    getZoneState: function () { return zoneMap; },
    now: function () { return 12345; },
  });
  assert.deepEqual(ctx.getZonePeers('z'), peers);
  assert.deepEqual(ctx.getCharacterState('c1'), charState);
  assert.equal(ctx.getZoneState('z').get('fire_lit'), true);
  assert.equal(ctx.now(), 12345);
});

test('context builder: custom logger is wired through', () => {
  var got: string[] = [];
  var logger: PluginLogger = {
    info(msg) { got.push('i:' + msg); },
    warn(msg) { got.push('w:' + msg); },
    error(msg) { got.push('e:' + msg); },
  };
  var ctx = buildPluginContext({
    pluginName: 'p',
    storage: new MapPluginStorage(),
    logger,
  });
  ctx.logger.info('one');
  ctx.logger.warn('two');
  ctx.logger.error('three');
  assert.deepEqual(got, ['i:one', 'w:two', 'e:three']);
});

test('context builder: storage facade scopes to the pluginName', async () => {
  var storage = new MapPluginStorage();
  var ctxA = buildPluginContext({ pluginName: 'a', storage });
  var ctxB = buildPluginContext({ pluginName: 'b', storage });
  await ctxA.storage.set('shared', 'A');
  await ctxB.storage.set('shared', 'B');
  assert.equal(await ctxA.storage.get('shared'), 'A');
  assert.equal(await ctxB.storage.get('shared'), 'B');
});

test('context builder: now defaults to a real clock returning a positive number', () => {
  var ctx = buildPluginContext({
    pluginName: 'p',
    storage: new MapPluginStorage(),
  });
  var t = ctx.now();
  assert.equal(typeof t, 'number');
  assert.ok(t > 0);
});
