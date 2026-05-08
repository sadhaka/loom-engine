// Phase 0.38.0 - PersistentStorage tests.
//
// MemoryStorageBackend is exercised directly. LocalStorageBackend
// is tested with a hand-rolled FakeStorage that satisfies the DOM
// Storage interface without needing jsdom. The PersistentStorage
// facade is then layered on each.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  PersistentStorage,
  MemoryStorageBackend,
  LocalStorageBackend,
  RESOURCE_PERSISTENT_STORAGE,
  type WorldSnapshot,
  type IStorageBackend,
} from '../src/index.js';

class FakeStorage {
  private data: Map<string, string> = new Map();
  get length(): number { return this.data.size; }
  getItem(key: string): string | null {
    var v = this.data.get(key);
    return v === undefined ? null : v;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void { this.data.clear(); }
  key(idx: number): string | null {
    var arr = Array.from(this.data.keys());
    return arr[idx] ?? null;
  }
}

test('persistent-storage: RESOURCE_PERSISTENT_STORAGE is the stable string', () => {
  assert.equal(RESOURCE_PERSISTENT_STORAGE, 'persistent_storage');
});

// ---------- MemoryStorageBackend ----------

test('memory backend: starts empty', async () => {
  const b = new MemoryStorageBackend();
  assert.deepEqual(await b.keys(), []);
  assert.equal(await b.get('missing'), null);
});

test('memory backend: set + get roundtrip', async () => {
  const b = new MemoryStorageBackend();
  await b.set('a', 'hello');
  assert.equal(await b.get('a'), 'hello');
});

test('memory backend: set overwrites existing value', async () => {
  const b = new MemoryStorageBackend();
  await b.set('a', 'first');
  await b.set('a', 'second');
  assert.equal(await b.get('a'), 'second');
});

test('memory backend: remove deletes the key', async () => {
  const b = new MemoryStorageBackend();
  await b.set('a', 'x');
  await b.remove('a');
  assert.equal(await b.get('a'), null);
});

test('memory backend: keys lists all entries', async () => {
  const b = new MemoryStorageBackend();
  await b.set('a', '1');
  await b.set('b', '2');
  const keys = (await b.keys()).sort();
  assert.deepEqual(keys, ['a', 'b']);
});

test('memory backend: clear empties the store', async () => {
  const b = new MemoryStorageBackend();
  await b.set('a', '1');
  await b.set('b', '2');
  await b.clear();
  assert.deepEqual(await b.keys(), []);
});

// ---------- LocalStorageBackend ----------

test('localstorage backend: uses provided Storage object', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  const b = new LocalStorageBackend({ storage: fake });
  assert.equal(b.isLive(), true);
  await b.set('a', 'x');
  assert.equal(await b.get('a'), 'x');
});

test('localstorage backend: prefix scopes keys', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  const b = new LocalStorageBackend({ storage: fake, prefix: 'twt:' });
  await b.set('zone', 'plaza');
  // Underlying storage has the prefixed key.
  assert.equal((fake as unknown as FakeStorage).getItem('twt:zone'), 'plaza');
  // Backend.get strips the prefix transparently.
  assert.equal(await b.get('zone'), 'plaza');
});

test('localstorage backend: keys returns prefix-stripped names only', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  // Pre-populate one out-of-prefix key.
  fake.setItem('other:foo', 'unrelated');
  const b = new LocalStorageBackend({ storage: fake, prefix: 'twt:' });
  await b.set('a', '1');
  await b.set('b', '2');
  const keys = (await b.keys()).sort();
  assert.deepEqual(keys, ['a', 'b']);
});

test('localstorage backend: clear with prefix only clears scoped keys', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  fake.setItem('other:foo', 'unrelated');
  const b = new LocalStorageBackend({ storage: fake, prefix: 'twt:' });
  await b.set('a', '1');
  await b.set('b', '2');
  await b.clear();
  assert.deepEqual((await b.keys()).sort(), []);
  // Out-of-scope key survives.
  assert.equal(fake.getItem('other:foo'), 'unrelated');
});

test('localstorage backend: falls back to in-memory when no localStorage available', async () => {
  // Pass storage:null-ish - constructor falls back to memory.
  const b = new LocalStorageBackend({});
  // Whether isLive is true depends on environment; in Node test
  // there's no globalThis.localStorage so should be false.
  if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
    assert.equal(b.isLive(), false);
  }
  // Either way, set/get should work via the fallback.
  await b.set('k', 'v');
  assert.equal(await b.get('k'), 'v');
});

test('localstorage backend: get on missing key returns null', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  const b = new LocalStorageBackend({ storage: fake });
  assert.equal(await b.get('nope'), null);
});

test('localstorage backend: remove on missing key is a no-op', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  const b = new LocalStorageBackend({ storage: fake });
  await b.remove('nope'); // should not throw
  assert.equal(await b.get('nope'), null);
});

// ---------- PersistentStorage facade ----------

test('persistent-storage: save + load roundtrip with object payload', async () => {
  const b = new MemoryStorageBackend();
  const ps = PersistentStorage.create({ backend: b });
  await ps.save('hero', { name: 'Misha', level: 7, alive: true });
  const out = await ps.load('hero') as { name: string; level: number; alive: boolean };
  assert.equal(out.name, 'Misha');
  assert.equal(out.level, 7);
  assert.equal(out.alive, true);
});

test('persistent-storage: load missing key returns null', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  assert.equal(await ps.load('missing'), null);
});

test('persistent-storage: load corrupted JSON returns null instead of throwing', async () => {
  const b = new MemoryStorageBackend();
  await b.set('bad', 'this is not json{');
  const ps = PersistentStorage.create({ backend: b });
  assert.equal(await ps.load('bad'), null);
});

test('persistent-storage: hasKey reports presence', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  assert.equal(await ps.hasKey('a'), false);
  await ps.save('a', 1);
  assert.equal(await ps.hasKey('a'), true);
});

test('persistent-storage: remove drops the key', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  await ps.save('a', 1);
  await ps.remove('a');
  assert.equal(await ps.load('a'), null);
});

test('persistent-storage: namespacing isolates two facades on the same backend', async () => {
  const b = new MemoryStorageBackend();
  const a = PersistentStorage.create({ backend: b, namespace: 'aaa:' });
  const c = PersistentStorage.create({ backend: b, namespace: 'ccc:' });
  await a.save('hero', 'A');
  await c.save('hero', 'C');
  assert.equal(await a.load('hero'), 'A');
  assert.equal(await c.load('hero'), 'C');
  // Backend has two separate keys.
  const allKeys = (await b.keys()).sort();
  assert.deepEqual(allKeys, ['aaa:hero', 'ccc:hero']);
});

test('persistent-storage: listKeys returns namespace-stripped facade keys', async () => {
  const b = new MemoryStorageBackend();
  // Pre-populate a backend key OUTSIDE the namespace.
  await b.set('foreign:x', '1');
  const ps = PersistentStorage.create({ backend: b, namespace: 'twt:' });
  await ps.save('a', 1);
  await ps.save('b', 2);
  const keys = (await ps.listKeys()).sort();
  assert.deepEqual(keys, ['a', 'b']);
});

test('persistent-storage: clearAll within namespace leaves foreign keys alone', async () => {
  const b = new MemoryStorageBackend();
  await b.set('foreign:x', 'keep');
  const ps = PersistentStorage.create({ backend: b, namespace: 'twt:' });
  await ps.save('a', 1);
  await ps.save('b', 2);
  await ps.clearAll();
  assert.deepEqual(await ps.listKeys(), []);
  assert.equal(await b.get('foreign:x'), 'keep');
});

test('persistent-storage: dispose makes save/load/remove no-ops', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  await ps.save('a', 1);
  ps.dispose();
  await ps.save('a', 2); // no-op
  assert.equal(await ps.load('a'), null); // disposed -> returns null directly
});

test('persistent-storage: save throws on non-JSON-serializable payload', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  // Circular reference -> JSON.stringify throws.
  const bad: { self?: object } = {};
  bad.self = bad;
  await assert.rejects(() => ps.save('cycle', bad), /JSON\.stringify failed/);
});

// ---------- WorldSnapshot helpers ----------

test('persistent-storage: saveSnapshot + loadSnapshot roundtrip preserves envelope', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  const snap: WorldSnapshot = {
    schemaVersion: 1,
    engineVersion: '0.38.0',
    capturedAtMs: 1234567,
    resources: { time: { elapsed: 42 }, knot: { palette: 'plaza' } },
  };
  await ps.saveSnapshot('autosave', snap);
  const back = await ps.loadSnapshot('autosave');
  assert.ok(back !== null);
  assert.equal((back as WorldSnapshot).schemaVersion, 1);
  assert.equal((back as WorldSnapshot).engineVersion, '0.38.0');
  assert.equal((back as WorldSnapshot).capturedAtMs, 1234567);
  assert.deepEqual((back as WorldSnapshot).resources, snap.resources);
});

test('persistent-storage: loadSnapshot returns null for missing key', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  assert.equal(await ps.loadSnapshot('never-saved'), null);
});

test('persistent-storage: loadSnapshot returns null for non-snapshot payload', async () => {
  const ps = PersistentStorage.create({ backend: new MemoryStorageBackend() });
  await ps.save('not-a-snapshot', { foo: 'bar' });
  assert.equal(await ps.loadSnapshot('not-a-snapshot'), null);
});

test('persistent-storage: loadSnapshot rejects payload with wrong field types', async () => {
  const b = new MemoryStorageBackend();
  // schemaVersion as string instead of number.
  await b.set('bad', JSON.stringify({
    schemaVersion: 'one',
    engineVersion: '0.38.0',
    capturedAtMs: 100,
    resources: {},
  }));
  const ps = PersistentStorage.create({ backend: b });
  assert.equal(await ps.loadSnapshot('bad'), null);
});

test('persistent-storage: works against LocalStorageBackend with FakeStorage', async () => {
  const fake = new FakeStorage() as unknown as Storage;
  const backend = new LocalStorageBackend({ storage: fake, prefix: 'engine:' });
  const ps = PersistentStorage.create({ backend, namespace: 'snap:' });
  const snap: WorldSnapshot = {
    schemaVersion: 1,
    engineVersion: '0.38.0',
    capturedAtMs: 7,
    resources: { x: 1 },
  };
  await ps.saveSnapshot('save1', snap);
  // Underlying storage uses prefix + namespace.
  assert.equal(typeof (fake as unknown as FakeStorage).getItem('engine:snap:save1'), 'string');
  const back = await ps.loadSnapshot('save1');
  assert.equal((back as WorldSnapshot).engineVersion, '0.38.0');
});

test('persistent-storage: typing - IStorageBackend can be implemented externally', async () => {
  // This test asserts the interface shape by having a custom impl.
  class Counter implements IStorageBackend {
    public calls: { op: string; key: string }[] = [];
    private inner: Map<string, string> = new Map();
    async get(key: string): Promise<string | null> {
      this.calls.push({ op: 'get', key });
      return this.inner.get(key) ?? null;
    }
    async set(key: string, value: string): Promise<void> {
      this.calls.push({ op: 'set', key });
      this.inner.set(key, value);
    }
    async remove(key: string): Promise<void> {
      this.calls.push({ op: 'remove', key });
      this.inner.delete(key);
    }
    async keys(): Promise<string[]> {
      this.calls.push({ op: 'keys', key: '' });
      return Array.from(this.inner.keys());
    }
    async clear(): Promise<void> {
      this.calls.push({ op: 'clear', key: '' });
      this.inner.clear();
    }
  }
  const c = new Counter();
  const ps = PersistentStorage.create({ backend: c });
  await ps.save('a', 1);
  await ps.load('a');
  assert.equal(c.calls.length, 2);
  assert.equal(c.calls[0]!.op, 'set');
  assert.equal(c.calls[1]!.op, 'get');
});
