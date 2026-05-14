// Loom Engine - deterministic binary state snapshot tests.
//
// Covers the SnapshotWriter / SnapshotReader byte primitives, the
// FNV-1a hash, and the StateSnapshot orchestrator round-tripping the
// two real ISnapshotable parts shipped so far (EntityAllocator,
// Entropy) plus a fixture pool that stands in for "pool flags +
// typed-array slices".

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SnapshotWriter,
  SnapshotReader,
  StateSnapshot,
  fnv1a32,
  STATE_SNAPSHOT_VERSION,
  type ISnapshotable,
  EntityAllocator,
  entityIndex,
  createEntropy,
} from '../src/index.js';

// A stand-in component pool: exactly the shape the dossier names -
// "pool flags + typed-array slices" - so the test proves ISnapshotable
// handles a real pool layout without coupling to a production pool.
class MockSnapshotablePool implements ISnapshotable {
  readonly snapshotKey: string = 'test.mock-pool';
  flags: Uint8Array = new Uint8Array(8);
  x: Float32Array = new Float32Array(8);
  hp: Uint32Array = new Uint32Array(8);
  highWaterMark: number = 0;

  snapshotInto(w: SnapshotWriter): void {
    w.writeU32(this.highWaterMark);
    w.writeU8Slice(this.flags, this.highWaterMark);
    w.writeF32Slice(this.x, this.highWaterMark);
    w.writeU32Slice(this.hp, this.highWaterMark);
  }

  restoreFrom(r: SnapshotReader): void {
    this.highWaterMark = r.readU32();
    const f = r.readU8Slice();
    const x = r.readF32Slice();
    const hp = r.readU32Slice();
    this.flags = new Uint8Array(Math.max(8, f.length));
    this.flags.set(f);
    this.x = new Float32Array(Math.max(8, x.length));
    this.x.set(x);
    this.hp = new Uint32Array(Math.max(8, hp.length));
    this.hp.set(hp);
  }
}

// ----- SnapshotWriter / SnapshotReader -----

test('snapshot writer/reader: every scalar round-trips little-endian', () => {
  const w = new SnapshotWriter();
  w.writeU8(0xab);
  w.writeU16(0xbeef);
  w.writeU32(0xdeadbeef);
  w.writeI32(-12345);
  w.writeF32(1.5);
  w.writeF64(Math.PI);

  const r = new SnapshotReader(w.bytes().slice());
  assert.equal(r.readU8(), 0xab);
  assert.equal(r.readU16(), 0xbeef);
  assert.equal(r.readU32(), 0xdeadbeef);
  assert.equal(r.readI32(), -12345);
  assert.equal(r.readF32(), 1.5);
  assert.equal(r.readF64(), Math.PI);
  assert.equal(r.remaining, 0);
});

test('snapshot writer/reader: typed-array slices round-trip', () => {
  const w = new SnapshotWriter();
  const u8 = new Uint8Array([1, 2, 3, 4, 5]);
  const u32 = new Uint32Array([10, 0xffffffff, 30]);
  const f32 = new Float32Array([0.25, -8, 100.5]);
  // Write only a prefix of an over-allocated array, like a real pool
  // serializing [0, highWaterMark).
  const padded = new Uint8Array(16);
  padded.set([9, 8, 7]);
  w.writeU8Slice(u8, u8.length);
  w.writeU32Slice(u32, u32.length);
  w.writeF32Slice(f32, f32.length);
  w.writeU8Slice(padded, 3);

  const r = new SnapshotReader(w.bytes().slice());
  assert.deepEqual(Array.from(r.readU8Slice()), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(r.readU32Slice()), [10, 0xffffffff, 30]);
  assert.deepEqual(Array.from(r.readF32Slice()), [0.25, -8, 100.5]);
  assert.deepEqual(Array.from(r.readU8Slice()), [9, 8, 7]);
  assert.equal(r.remaining, 0);
});

test('snapshot writer: grows past initial capacity, content survives', () => {
  const w = new SnapshotWriter(16);
  for (let i = 0; i < 50; i++) w.writeU32(i * 7);
  assert.equal(w.length, 200);
  const r = new SnapshotReader(w.bytes().slice());
  for (let i = 0; i < 50; i++) assert.equal(r.readU32(), i * 7);
});

test('snapshot writer: reset reuses the buffer', () => {
  const w = new SnapshotWriter();
  w.writeU32(1);
  w.writeU32(2);
  assert.equal(w.length, 8);
  w.reset();
  assert.equal(w.length, 0);
  w.writeU8(42);
  assert.equal(w.length, 1);
  assert.equal(new SnapshotReader(w.bytes().slice()).readU8(), 42);
});

test('snapshot reader: an over-read throws instead of returning garbage', () => {
  const r = new SnapshotReader(new Uint8Array(2));
  r.readU8();
  assert.throws(() => r.readU32(), /over-read/);
});

// ----- FNV-1a -----

test('fnv1a32: empty input is the offset basis', () => {
  // No bytes mixed -> the hash is exactly the FNV offset basis.
  assert.equal(fnv1a32(new Uint8Array(0)), 0x811c9dc5);
});

test('fnv1a32: deterministic and sensitive to content, order, length', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const same = new Uint8Array([1, 2, 3, 4]);
  const flipped = new Uint8Array([1, 2, 3, 5]);   // one byte differs
  const reordered = new Uint8Array([1, 2, 4, 3]); // same bytes, swapped
  const longer = new Uint8Array([1, 2, 3, 4, 0]); // trailing zero added

  assert.equal(fnv1a32(a), fnv1a32(same), 'identical bytes hash identically');
  assert.notEqual(fnv1a32(a), fnv1a32(flipped), 'one changed byte changes the hash');
  assert.notEqual(fnv1a32(a), fnv1a32(reordered), 'byte order changes the hash');
  assert.notEqual(fnv1a32(a), fnv1a32(longer), 'length changes the hash');
  // Offset / length window is honoured.
  assert.equal(fnv1a32(longer, 0, 4), fnv1a32(a));
});

// ----- EntityAllocator as ISnapshotable -----

test('entity allocator: snapshot/restore reproduces a recycled-slot history', () => {
  // Build a non-trivial allocator state: live slots, a bumped
  // generation, and a populated free list.
  const a = new EntityAllocator();
  const h1 = a.create();
  const h2 = a.create();
  const h3 = a.create();
  a.destroy(h2);                       // h2's slot -> free list, gen bumped
  a.destroyByLiveIndex(entityIndex(h3));
  const h4 = a.create();               // recycles a freed slot

  const w = new SnapshotWriter();
  a.snapshotInto(w);
  const bytes = w.bytes().slice();

  // Restore into a fresh allocator.
  const b = new EntityAllocator();
  b.restoreFrom(new SnapshotReader(bytes));

  // Observable state matches.
  assert.equal(b.count(), a.count());
  assert.equal(b.capacity(), a.capacity());
  assert.equal(b.isAlive(h1), a.isAlive(h1));
  assert.equal(b.isAlive(h2), a.isAlive(h2));
  assert.equal(b.isAlive(h3), a.isAlive(h3));
  assert.equal(b.isAlive(h4), a.isAlive(h4));

  // And behaviour matches: the next creates / destroys move in
  // lockstep, which can only happen if the free list + generations
  // were restored exactly.
  assert.equal(b.create(), a.create());
  assert.equal(b.create(), a.create());
  const x = a.create();
  const y = b.create();
  assert.equal(y, x);
  assert.equal(b.destroy(x), a.destroy(x));
  assert.equal(b.count(), a.count());
});

// ----- Entropy as ISnapshotable -----

test('entropy: snapshot/restore resumes the stream exactly', () => {
  const e = createEntropy(0x12345);
  for (let i = 0; i < 17; i++) e.random();   // advance to a non-trivial state

  const w = new SnapshotWriter();
  e.snapshotInto(w);
  const bytes = w.bytes().slice();

  // Record the next 8 draws from the live stream.
  const expected: number[] = [];
  for (let i = 0; i < 8; i++) expected.push(e.random());

  // A fresh entropy restored from the snapshot must produce the same
  // 8 draws.
  const restored = createEntropy(0);
  restored.restoreFrom(new SnapshotReader(bytes));
  for (let i = 0; i < 8; i++) {
    assert.equal(restored.random(), expected[i], 'draw ' + i + ' diverged');
  }
});

// ----- MockSnapshotablePool: flags + typed-array slices -----

test('mock pool: flags + typed-array slices round-trip', () => {
  const p = new MockSnapshotablePool();
  p.highWaterMark = 5;
  p.flags.set([1, 0, 3, 0, 7]);
  p.x.set([1.5, 2.5, -3.5, 0, 9.25]);
  p.hp.set([100, 0, 4294967295, 1, 50]);

  const w = new SnapshotWriter();
  p.snapshotInto(w);

  const q = new MockSnapshotablePool();
  q.restoreFrom(new SnapshotReader(w.bytes().slice()));

  assert.equal(q.highWaterMark, 5);
  assert.deepEqual(Array.from(q.flags.subarray(0, 5)), [1, 0, 3, 0, 7]);
  assert.deepEqual(Array.from(q.x.subarray(0, 5)), [1.5, 2.5, -3.5, 0, 9.25]);
  assert.deepEqual(Array.from(q.hp.subarray(0, 5)), [100, 0, 4294967295, 1, 50]);
});

// ----- StateSnapshot orchestrator -----

function buildWorld(seed: number, creates: number, destroyEvery: number): {
  alloc: EntityAllocator;
  entropy: ReturnType<typeof createEntropy>;
  pool: MockSnapshotablePool;
  snap: StateSnapshot;
} {
  const alloc = new EntityAllocator();
  const entropy = createEntropy(seed);
  const pool = new MockSnapshotablePool();
  const handles: number[] = [];
  for (let i = 0; i < creates; i++) {
    handles.push(alloc.create());
    if (i % destroyEvery === destroyEvery - 1 && handles.length > 0) {
      alloc.destroy(handles.shift()!);
    }
    entropy.random();
  }
  pool.highWaterMark = Math.min(8, creates);
  for (let i = 0; i < pool.highWaterMark; i++) {
    pool.flags[i] = i & 0xff;
    pool.x[i] = i * 1.25;
    pool.hp[i] = i * 1000;
  }
  const snap = new StateSnapshot();
  snap.register(alloc);
  snap.register(entropy);
  snap.register(pool);
  return { alloc, entropy, pool, snap };
}

test('state snapshot: serialize -> restore -> re-serialize is byte-identical', () => {
  const a = buildWorld(99, 40, 4);
  const bytesA = a.snap.serialize().slice();

  // Fresh, empty parts; restore the frame into them.
  const b = buildWorld(1, 0, 1);   // different seed, no history
  b.snap.restore(bytesA);
  const bytesB = b.snap.serialize().slice();

  assert.deepEqual(Array.from(bytesB), Array.from(bytesA),
    'restoring then re-serializing must reproduce the exact frame');
});

test('state snapshot: hash is stable for identical state, diverges on mutation', () => {
  const a = buildWorld(0xC0FFEE, 30, 3);
  const b = buildWorld(0xC0FFEE, 30, 3);
  assert.equal(a.snap.hash(), b.snap.hash(),
    'identical construction must hash identically');

  // Mutate one entity in world B - one extra allocation.
  b.alloc.create();
  assert.notEqual(a.snap.hash(), b.snap.hash(),
    'a single extra entity must change the hash');
});

test('state snapshot: STATE_SNAPSHOT_VERSION is a stable constant', () => {
  assert.equal(STATE_SNAPSHOT_VERSION, 1);
});

test('state snapshot: register rejects a duplicate snapshotKey', () => {
  const snap = new StateSnapshot();
  snap.register(new MockSnapshotablePool());
  assert.throws(() => snap.register(new MockSnapshotablePool()), /duplicate snapshotKey/);
});

test('state snapshot: restore rejects bad magic and a part-count mismatch', () => {
  const snap = new StateSnapshot();
  snap.register(new EntityAllocator());
  // 20 zero bytes -> magic reads as 0.
  assert.throws(() => snap.restore(new Uint8Array(20)), /bad magic/);

  // A valid 1-part frame restored into a 2-part snapshot.
  const oneFrame = (() => {
    const s = new StateSnapshot();
    s.register(new EntityAllocator());
    return s.serialize().slice();
  })();
  const twoPart = new StateSnapshot();
  twoPart.register(new EntityAllocator());
  twoPart.register(new MockSnapshotablePool());
  assert.throws(() => twoPart.restore(oneFrame), /1 parts, 2 registered/);
});

test('state snapshot: restore rejects a part that under-reads its blob', () => {
  // snapshotInto writes 8 bytes; restoreFrom only consumes 4. The
  // blob-length frame catches the 4 leftover bytes.
  const lazy: ISnapshotable = {
    snapshotKey: 'test.lazy',
    snapshotInto(w: SnapshotWriter): void { w.writeU32(1); w.writeU32(2); },
    restoreFrom(r: SnapshotReader): void { r.readU32(); },
  };
  const snap = new StateSnapshot();
  snap.register(lazy);
  const bytes = snap.serialize().slice();
  assert.throws(() => snap.restore(bytes), /left 4 of 8 bytes unconsumed/);
});
