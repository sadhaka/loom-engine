// Loom Engine - AIBehaviorBuffer (SoA snapshot store) tests.
//
// Covers the ObserverHandle helpers, constructor validation, the
// write / read seqlock round-trip, and the 7 Codex gates:
//   gate 1 - the seqlock publish protocol: versions go even -> odd ->
//            next even, one counter publishes the whole record.
//   gate 2 - a torn / in-progress read is DETECTED: an odd version is
//            rejected (retry, then SNAPSHOT_TORN). White-box-poked via
//            a shared backing buffer since single-thread never tears.
//   gate 3 - readChanged advances lastSeen only after a consistent
//            read; a never-written / torn read leaves it untouched.
//   gate 4 - first-sight version 0: never-written is 0, the first
//            write publishes 2, published versions are even >= 2, and
//            a publish that would wrap onto 0 skips to 2.
//   gate 5 - no allocation: reads return a plain number, copy into a
//            caller out buffer; nothing builds a header array.
//   gate 6 - reads never return a view - they copy into caller-owned
//            out, so there is no shared view to alias.
//   gate 7 - observer handles are generation-stamped and validated;
//            a released or ghost handle throws.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AIBehaviorBuffer,
  makeObserverHandle,
  observerSlot,
  observerGeneration,
  SNAPSHOT_NEVER_WRITTEN,
  SNAPSHOT_TORN,
  SNAPSHOT_UNCHANGED,
} from '../src/index.js';

// Read entity `slot`'s payload into a fresh buffer and return it as a
// plain array, alongside the read's return value.
function readBack(buf: AIBehaviorBuffer, slot: number): { status: number; payload: number[] } {
  const out = new Float32Array(buf.payloadLength);
  const status = buf.readSnapshot(slot, out);
  return { status, payload: Array.from(out) };
}

test('ai behavior buffer: ObserverHandle packs and unpacks slot + generation', () => {
  for (const [slot, gen] of [[0, 0], [3, 1], [63, 200], [0x00ffffff, 0xff]] as const) {
    const h = makeObserverHandle(slot, gen);
    assert.equal(observerSlot(h), slot, 'slot ' + slot);
    assert.equal(observerGeneration(h), gen, 'gen ' + gen);
  }
});

test('ai behavior buffer: constructor validates dimensions and the backing buffer', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  assert.equal(buf.capacity, 8);
  assert.equal(buf.payloadLength, 4);
  assert.equal(buf.stride, 5);
  assert.equal(buf.maxObservers, 4);
  assert.equal(buf.getObserverCount(), 0);
  assert.throws(() => new AIBehaviorBuffer(0, 4, 4), /capacity/);
  assert.throws(() => new AIBehaviorBuffer(2.5, 4, 4), /capacity/);
  assert.throws(() => new AIBehaviorBuffer((1 << 18) + 1, 4, 4), /capacity/);
  assert.throws(() => new AIBehaviorBuffer(8, 0, 4), /payloadLength/);
  assert.throws(() => new AIBehaviorBuffer(8, (1 << 12) + 1, 4), /payloadLength/);
  assert.throws(() => new AIBehaviorBuffer(8, 4, 0), /maxObservers/);
  assert.throws(() => new AIBehaviorBuffer(8, 4, 65), /maxObservers/);
  // capacity * stride product cap.
  assert.throws(() => new AIBehaviorBuffer(1 << 18, 1 << 12, 4), /exceeds the cap/);
  // A caller-supplied buffer must be large enough; 8 * 5 * 4 = 160 bytes.
  assert.throws(() => new AIBehaviorBuffer(8, 4, 4, new ArrayBuffer(16)), /byteLength/);
  assert.doesNotThrow(() => new AIBehaviorBuffer(8, 4, 4, new ArrayBuffer(160)));
  assert.doesNotThrow(() => new AIBehaviorBuffer(8, 4, 4, new ArrayBuffer(4096)), 'a larger buffer is fine');
});

test('ai behavior buffer: write / read round-trip and the version sequence', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  // A never-written slot reads as such (gate 4).
  assert.equal(buf.getVersion(3), 0);
  assert.equal(readBack(buf, 3).status, SNAPSHOT_NEVER_WRITTEN);
  // First write publishes version 2 (gate 4 - never 0).
  assert.equal(buf.writeSnapshot(3, [10, 20, 30, 40]), 2);
  const r = readBack(buf, 3);
  assert.equal(r.status, 2);
  assert.deepEqual(r.payload, [10, 20, 30, 40]);
  // Each write bumps the version by 2 - published versions are even.
  assert.equal(buf.writeSnapshot(3, [1, 2, 3, 4]), 4);
  assert.equal(buf.writeSnapshot(3, [5, 6, 7, 8]), 6);
  assert.equal(buf.getVersion(3), 6);
  assert.deepEqual(readBack(buf, 3).payload, [5, 6, 7, 8]);
  // Other slots are untouched.
  assert.equal(buf.getVersion(0), 0);
});

test('ai behavior buffer: writeSnapshot validates slot and count', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  assert.throws(() => buf.writeSnapshot(-1, [1]), /slot/);
  assert.throws(() => buf.writeSnapshot(8, [1]), /slot/);
  assert.throws(() => buf.writeSnapshot(1.5, [1]), /slot/);
  // count beyond payloadLength.
  assert.throws(() => buf.writeSnapshot(0, [1, 2, 3, 4, 5], 5), /payloadLength/);
  // count beyond what values provides.
  assert.throws(() => buf.writeSnapshot(0, [1, 2], 3), /values\.length/);
  assert.throws(() => buf.writeSnapshot(0, [1], -1), /count/);
  // values longer than payloadLength, no explicit count -> rejected.
  assert.throws(() => buf.writeSnapshot(0, [1, 2, 3, 4, 5]), /payloadLength/);
});

test('ai behavior buffer: partial writes leave higher payload slots intact', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  buf.writeSnapshot(0, [1, 2, 3, 4]);
  // Write only the first two slots - slots 2 and 3 keep their values.
  buf.writeSnapshot(0, [9, 8], 2);
  assert.deepEqual(readBack(buf, 0).payload, [9, 8, 3, 4]);
  // count 0 is a valid "touched, no payload delta" publish.
  const v = buf.writeSnapshot(0, []);
  assert.equal(v, 6);
  assert.deepEqual(readBack(buf, 0).payload, [9, 8, 3, 4], 'payload unchanged by a count-0 write');
});

test('ai behavior buffer: readSnapshot truncates to the shorter of out / payloadLength', () => {
  const buf = new AIBehaviorBuffer(8, 6, 4);
  buf.writeSnapshot(0, [1, 2, 3, 4, 5, 6]);
  // out shorter than payloadLength: copy is truncated, version still returned.
  const shortOut = new Float32Array(3);
  assert.equal(buf.readSnapshot(0, shortOut), 2);
  assert.deepEqual(Array.from(shortOut), [1, 2, 3]);
  // out longer than payloadLength: only payloadLength slots written.
  const longOut = new Float32Array(10).fill(-1);
  assert.equal(buf.readSnapshot(0, longOut), 2);
  assert.deepEqual(Array.from(longOut), [1, 2, 3, 4, 5, 6, -1, -1, -1, -1]);
});

test('ai behavior buffer: readSnapshot and getVersion validate arguments', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const out = new Float32Array(4);
  assert.throws(() => buf.readSnapshot(-1, out), /slot/);
  assert.throws(() => buf.readSnapshot(8, out), /slot/);
  assert.throws(() => buf.readSnapshot(0, out, 0), /attempts/);
  assert.throws(() => buf.readSnapshot(0, out, 65), /attempts/);
  assert.throws(() => buf.readSnapshot(0, out, 1.5), /attempts/);
  assert.throws(() => buf.getVersion(8), /slot/);
});

test('ai behavior buffer: writeSnapshot accepts a Float32Array as values', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  buf.writeSnapshot(2, new Float32Array([0.5, 1.5, 2.5, 3.5]));
  assert.deepEqual(readBack(buf, 2).payload, [0.5, 1.5, 2.5, 3.5]);
});

test('ai behavior buffer: the aliased backing buffer is shareable across instances', () => {
  // The Gemini single-buffer SoA shape: two AIBehaviorBuffers over the
  // same backing buffer see each other's writes - one writes, the
  // other reads, because the u32/f32 views alias the same bytes.
  const writer = new AIBehaviorBuffer(8, 4, 4);
  assert.equal(writer.buffer.byteLength, 8 * 5 * 4);
  const reader = new AIBehaviorBuffer(8, 4, 4, writer.buffer);
  writer.writeSnapshot(5, [11, 22, 33, 44]);
  const r = readBack(reader, 5);
  assert.equal(r.status, 2);
  assert.deepEqual(r.payload, [11, 22, 33, 44]);
});

test('ai behavior buffer: a publish that would wrap u32 onto 0 skips to 2 (gate 4)', () => {
  // White-box: poke the version slot near the u32 ceiling through the
  // shared backing buffer, then write - the publish must skip 0 so
  // never-written stays uniquely 0.
  const backing = new ArrayBuffer(8 * 5 * 4);
  const buf = new AIBehaviorBuffer(8, 4, 4, backing);
  const probe = new Uint32Array(backing);
  const versionIdx = 0 * buf.stride + buf.payloadLength;
  probe[versionIdx] = 0xfffffffe;   // the last natural even version
  assert.equal(buf.writeSnapshot(0, [1, 2, 3, 4]), 2, 'publish skipped 0, landed on 2');
  assert.equal(buf.getVersion(0), 2);
  assert.deepEqual(readBack(buf, 0).payload, [1, 2, 3, 4]);
});

test('ai behavior buffer: an in-progress (odd) version is detected and rejected (gate 2)', () => {
  // White-box: poke an odd version (a write "in progress") through the
  // shared buffer. readSnapshot must detect it, retry, and - since it
  // stays odd - return SNAPSHOT_TORN rather than reading a torn record.
  const backing = new ArrayBuffer(8 * 5 * 4);
  const buf = new AIBehaviorBuffer(8, 4, 4, backing);
  const probe = new Uint32Array(backing);
  const versionIdx = 0 * buf.stride + buf.payloadLength;
  probe[versionIdx] = 3;   // odd - a write is "in progress"
  const out = new Float32Array(4);
  assert.equal(buf.readSnapshot(0, out, 4), SNAPSHOT_TORN);
});

test('ai behavior buffer: observer create / isObserver / release / count', () => {
  const buf = new AIBehaviorBuffer(8, 4, 2);
  const o1 = buf.createObserver();
  assert.equal(buf.isObserver(o1), true);
  assert.equal(buf.getObserverCount(), 1);
  const o2 = buf.createObserver();
  assert.equal(buf.getObserverCount(), 2);
  // Registry full (maxObservers = 2).
  assert.throws(() => buf.createObserver(), /registry full/);
  // Release frees a slot and invalidates the handle.
  assert.equal(buf.releaseObserver(o1), true);
  assert.equal(buf.isObserver(o1), false);
  assert.equal(buf.getObserverCount(), 1);
  assert.equal(buf.releaseObserver(o1), false, 'releasing a dead handle is a no-op');
  // The freed slot is reused with a bumped generation - old handle stays dead.
  const o3 = buf.createObserver();
  assert.equal(observerSlot(o3), observerSlot(o1), 'slot reused');
  assert.notEqual(o3, o1, 'generation bumped');
  assert.equal(buf.isObserver(o3), true);
  assert.equal(buf.isObserver(o1), false);
  // A handle with the wrong generation for a live slot is not valid,
  // nor is one whose slot is out of range.
  assert.equal(buf.isObserver(makeObserverHandle(observerSlot(o2), 7)), false, 'wrong generation');
  assert.equal(buf.isObserver(makeObserverHandle(999, 0)), false, 'slot out of range');
  assert.equal(buf.isObserver(o2), true, 'o2 is still alive at its slot');
  assert.notEqual(o2, o3);
});

test('ai behavior buffer: readChanged advances lastSeen only after a consistent read (gate 3)', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const obs = buf.createObserver();
  const out = new Float32Array(4);
  // Never-written slot: no change, lastSeen stays 0.
  assert.equal(buf.readChanged(obs, 1, out), SNAPSHOT_NEVER_WRITTEN);
  assert.equal(buf.getLastSeen(obs, 1), 0);
  // First write -> readChanged sees it, fills out, advances lastSeen.
  buf.writeSnapshot(1, [7, 7, 7, 7]);
  assert.equal(buf.readChanged(obs, 1, out), 2);
  assert.deepEqual(Array.from(out), [7, 7, 7, 7]);
  assert.equal(buf.getLastSeen(obs, 1), 2);
  // Immediately again -> nothing new.
  out.fill(-1);
  assert.equal(buf.readChanged(obs, 1, out), SNAPSHOT_UNCHANGED);
  assert.deepEqual(Array.from(out), [-1, -1, -1, -1], 'UNCHANGED leaves out untouched');
  // A new write -> changed again.
  buf.writeSnapshot(1, [9, 9, 9, 9]);
  assert.equal(buf.readChanged(obs, 1, out), 4);
  assert.deepEqual(Array.from(out), [9, 9, 9, 9]);
  assert.equal(buf.getLastSeen(obs, 1), 4);
});

test('ai behavior buffer: observer-taking methods reject an invalid handle (gate 7)', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const obs = buf.createObserver();
  const out = new Float32Array(4);
  buf.releaseObserver(obs);
  // Every observer-taking method validates the handle's generation + bounds.
  assert.throws(() => buf.readChanged(obs, 0, out), /observer handle/);
  assert.throws(() => buf.hasChanged(obs, 0), /observer handle/);
  assert.throws(() => buf.getLastSeen(obs, 0), /observer handle/);
  assert.throws(() => buf.resetObserver(obs), /observer handle/);
  // A ghost handle for an out-of-range slot too.
  assert.throws(() => buf.hasChanged(makeObserverHandle(999, 0), 0), /observer handle/);
});

test('ai behavior buffer: hasChanged and getLastSeen track the observer feed', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const obs = buf.createObserver();
  const out = new Float32Array(4);
  // Never written - nothing to see.
  assert.equal(buf.hasChanged(obs, 2), false);
  assert.equal(buf.getLastSeen(obs, 2), 0);
  // Written but not yet seen by this observer.
  buf.writeSnapshot(2, [1, 2, 3, 4]);
  assert.equal(buf.hasChanged(obs, 2), true);
  // After a readChanged consumes it.
  buf.readChanged(obs, 2, out);
  assert.equal(buf.hasChanged(obs, 2), false);
  assert.equal(buf.getLastSeen(obs, 2), 2);
  // A fresh write makes it changed again.
  buf.writeSnapshot(2, [5, 6, 7, 8]);
  assert.equal(buf.hasChanged(obs, 2), true);
});

test('ai behavior buffer: resetObserver re-sees every entity', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const obs = buf.createObserver();
  const out = new Float32Array(4);
  buf.writeSnapshot(0, [1, 1, 1, 1]);
  buf.writeSnapshot(1, [2, 2, 2, 2]);
  buf.readChanged(obs, 0, out);
  buf.readChanged(obs, 1, out);
  assert.equal(buf.hasChanged(obs, 0), false);
  assert.equal(buf.hasChanged(obs, 1), false);
  // Reset -> the observer's lastSeen clears, so both read as changed again.
  buf.resetObserver(obs);
  assert.equal(buf.hasChanged(obs, 0), true);
  assert.equal(buf.hasChanged(obs, 1), true);
  assert.equal(buf.readChanged(obs, 0, out), 2);
});

test('ai behavior buffer: observers have independent change-feeds', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const a = buf.createObserver();
  const b = buf.createObserver();
  const out = new Float32Array(4);
  buf.writeSnapshot(0, [3, 3, 3, 3]);
  // Observer A consumes the change; B has not seen it yet.
  assert.equal(buf.readChanged(a, 0, out), 2);
  assert.equal(buf.hasChanged(a, 0), false);
  assert.equal(buf.hasChanged(b, 0), true, 'B is independent of A');
  assert.equal(buf.readChanged(b, 0, out), 2);
  assert.equal(buf.hasChanged(b, 0), false);
  // Resetting A does not touch B.
  buf.writeSnapshot(0, [4, 4, 4, 4]);
  buf.readChanged(a, 0, out);
  buf.readChanged(b, 0, out);
  buf.resetObserver(a);
  assert.equal(buf.hasChanged(a, 0), true);
  assert.equal(buf.hasChanged(b, 0), false, 'B unaffected by A reset');
});

test('ai behavior buffer: clear resets versions, payload, and observers', () => {
  const buf = new AIBehaviorBuffer(8, 4, 4);
  const obs = buf.createObserver();
  buf.writeSnapshot(0, [1, 2, 3, 4]);
  buf.writeSnapshot(1, [5, 6, 7, 8]);
  assert.equal(buf.getObserverCount(), 1);
  buf.clear();
  // Versions back to 0 (never written), payload zeroed.
  assert.equal(buf.getVersion(0), 0);
  assert.equal(readBack(buf, 0).status, SNAPSHOT_NEVER_WRITTEN);
  assert.deepEqual(readBack(buf, 1).payload, [0, 0, 0, 0]);
  // Observers released - old handle is void.
  assert.equal(buf.getObserverCount(), 0);
  assert.equal(buf.isObserver(obs), false);
  // The buffer is reusable after clear().
  const obs2 = buf.createObserver();
  buf.writeSnapshot(0, [9, 9, 9, 9]);
  const out = new Float32Array(4);
  assert.equal(buf.readChanged(obs2, 0, out), 2);
  assert.deepEqual(Array.from(out), [9, 9, 9, 9]);
});

test('ai behavior buffer: write / read is deterministic - identical runs match', () => {
  function run(): number[] {
    const buf = new AIBehaviorBuffer(16, 4, 2);
    const out: number[] = [];
    for (let pass = 0; pass < 5; pass++) {
      for (let slot = 0; slot < 12; slot++) {
        const v = buf.writeSnapshot(slot, [slot + pass, slot * pass, pass, slot]);
        out.push(v);
      }
    }
    const probe = new Float32Array(4);
    for (let slot = 0; slot < 12; slot++) {
      buf.readSnapshot(slot, probe);
      out.push(probe[0] ?? 0, probe[1] ?? 0, probe[2] ?? 0, probe[3] ?? 0);
    }
    return out;
  }
  assert.deepEqual(run(), run(), 'no RNG, no clock - the snapshot store is fully reproducible');
});
