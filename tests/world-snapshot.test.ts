// Phase 0.26.0 - WorldSnapshot tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  serializeWorldSnapshot,
  deserializeWorldSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  type IPersistableResource,
} from '../src/runtime/world-snapshot.js';
import { ResourceRegistry } from '../src/resources.js';

// Helpers.

class CounterResource implements IPersistableResource {
  count: number = 0;
  serialize(): unknown { return { count: this.count }; }
  deserialize(data: unknown): void {
    var d = data as { count?: number };
    if (d && typeof d.count === 'number') this.count = d.count;
  }
}

class NamedResource implements IPersistableResource {
  // Custom persistKey survives even if registry key changes.
  persistKey: string = 'stable-name';
  name: string = '';
  serialize(): unknown { return { name: this.name }; }
  deserialize(data: unknown): void {
    var d = data as { name?: string };
    if (d && typeof d.name === 'string') this.name = d.name;
  }
}


// ----- serialize -----

test('world-snapshot: serialize collects only persistable resources', function () {
  var reg = new ResourceRegistry();
  var counter = new CounterResource();
  counter.count = 7;
  reg.set('counter', counter);
  reg.set('plain', { value: 42 });  // no serialize() -> skipped

  var snap = serializeWorldSnapshot(reg, '0.26.0');
  assert.equal(snap.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snap.engineVersion, '0.26.0');
  assert.equal(typeof snap.capturedAtMs, 'number');
  assert.deepEqual(snap.resources, { counter: { count: 7 } });
});

test('world-snapshot: persistKey overrides registry key in envelope', function () {
  var reg = new ResourceRegistry();
  var named = new NamedResource();
  named.name = 'hello';
  reg.set('whatever-key', named);

  var snap = serializeWorldSnapshot(reg, '0.26.0');
  // Envelope uses persistKey, not the registry key.
  assert.deepEqual(snap.resources, { 'stable-name': { name: 'hello' } });
});

test('world-snapshot: nowFn injected for deterministic capturedAtMs', function () {
  var reg = new ResourceRegistry();
  reg.set('c', new CounterResource());
  var snap = serializeWorldSnapshot(reg, '0.26.0', function () { return 12345; });
  assert.equal(snap.capturedAtMs, 12345);
});

test('world-snapshot: serialize() that throws is logged + skipped', function () {
  var reg = new ResourceRegistry();
  var bad: IPersistableResource = {
    serialize() { throw new Error('boom'); },
  };
  reg.set('bad', bad);
  // Must not throw.
  var snap = serializeWorldSnapshot(reg, '0.26.0');
  // Bad resource simply doesn't appear in the envelope.
  assert.equal(Object.keys(snap.resources).length, 0);
});


// ----- deserialize -----

test('world-snapshot: deserialize restores counter state', function () {
  var reg = new ResourceRegistry();
  var counter = new CounterResource();
  reg.set('counter', counter);

  var snap = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion: '0.26.0',
    capturedAtMs: 0,
    resources: { counter: { count: 99 } },
  };
  var restored = deserializeWorldSnapshot(reg, snap);
  assert.equal(restored, 1);
  assert.equal(counter.count, 99);
});

test('world-snapshot: deserialize uses persistKey to match envelope -> resource', function () {
  var reg = new ResourceRegistry();
  var named = new NamedResource();
  reg.set('whatever-key', named);

  var snap = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion: '0.26.0',
    capturedAtMs: 0,
    resources: { 'stable-name': { name: 'restored' } },
  };
  var restored = deserializeWorldSnapshot(reg, snap);
  assert.equal(restored, 1);
  assert.equal(named.name, 'restored');
});

test('world-snapshot: missing persistKey in envelope leaves resource alone', function () {
  var reg = new ResourceRegistry();
  var counter = new CounterResource();
  counter.count = 5;
  reg.set('counter', counter);

  var snap = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion: '0.26.0',
    capturedAtMs: 0,
    resources: {},  // empty - resource not covered
  };
  var restored = deserializeWorldSnapshot(reg, snap);
  assert.equal(restored, 0);
  // Counter retains its current state.
  assert.equal(counter.count, 5);
});

test('world-snapshot: deserialize that throws is caught + counted out', function () {
  var reg = new ResourceRegistry();
  var bad: IPersistableResource = {
    deserialize() { throw new Error('boom'); },
    serialize() { return { x: 1 }; },
  };
  reg.set('bad', bad);

  var snap = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion: '0.26.0',
    capturedAtMs: 0,
    resources: { bad: { x: 2 } },
  };
  // Must not throw; restored count is 0.
  var restored = deserializeWorldSnapshot(reg, snap);
  assert.equal(restored, 0);
});

test('world-snapshot: serialize -> deserialize round-trip preserves state', function () {
  var reg = new ResourceRegistry();
  var counter = new CounterResource();
  counter.count = 42;
  var named = new NamedResource();
  named.name = 'original';
  reg.set('c', counter);
  reg.set('n', named);

  var snap = serializeWorldSnapshot(reg, '0.26.0');

  // Mutate state.
  counter.count = 0;
  named.name = '';

  var restored = deserializeWorldSnapshot(reg, snap);
  assert.equal(restored, 2);
  assert.equal(counter.count, 42);
  assert.equal(named.name, 'original');
});

test('world-snapshot: malformed snapshot envelope returns 0 restored', function () {
  var reg = new ResourceRegistry();
  reg.set('c', new CounterResource());
  // Various malformed envelopes shouldn't crash.
  assert.equal(deserializeWorldSnapshot(reg, null as never), 0);
  assert.equal(deserializeWorldSnapshot(reg, undefined as never), 0);
  assert.equal(deserializeWorldSnapshot(reg, {} as never), 0);
  assert.equal(deserializeWorldSnapshot(reg, {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion: '0.26.0',
    capturedAtMs: 0,
    // resources missing
  } as never), 0);
});
