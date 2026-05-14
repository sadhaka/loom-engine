// Loom Engine - DeltaCompressor (Loom-Wire) tests.
//
// Covers the per-record binary delta codec: encode/decode round-trips
// across partial / none / all / 1-wide / 32-wide records, the Codex
// strict-decoder gates (bad magic, version skew, record-width
// mismatch, an out-of-range mask bit, a payloadLength that disagrees
// with the mask, a truncated stream), the Base64 SSE-transport
// boundary, and that encoding is deterministic.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DeltaCompressor,
  DELTA_WIRE_MAGIC,
  DELTA_WIRE_VERSION,
  deltaFrameToBase64,
  deltaFrameFromBase64,
  SnapshotWriter,
  SnapshotReader,
} from '../src/index.js';

test('delta compressor: encode/decode round-trips a partial change', () => {
  const prev = new Uint32Array([10, 20, 30, 40, 50]);
  const curr = new Uint32Array([10, 99, 30, 77, 50]);   // columns 1 and 3 changed
  const w = new SnapshotWriter();
  const changed = DeltaCompressor.encode(prev, curr, 100, 99, w);
  assert.equal(changed, 2);

  const out = new Uint32Array(5);
  const info = DeltaCompressor.decode(prev, new SnapshotReader(w.bytes().slice()), out);
  assert.deepEqual(Array.from(out), Array.from(curr));
  assert.equal(info.tick, 100);
  assert.equal(info.baselineTick, 99);
});

test('delta compressor: an unchanged record encodes to just the header', () => {
  const prev = new Uint32Array([1, 2, 3, 4]);
  const curr = new Uint32Array([1, 2, 3, 4]);
  const w = new SnapshotWriter();
  const changed = DeltaCompressor.encode(prev, curr, 5, 4, w);
  assert.equal(changed, 0);
  assert.equal(w.length, 24, 'header only, no value payload');
  const out = new Uint32Array(4);
  DeltaCompressor.decode(prev, new SnapshotReader(w.bytes().slice()), out);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4]);
});

test('delta compressor: a fully-changed record round-trips', () => {
  const prev = new Uint32Array([0, 0, 0]);
  const curr = new Uint32Array([111, 222, 333]);
  const w = new SnapshotWriter();
  const changed = DeltaCompressor.encode(prev, curr, 2, 1, w);
  assert.equal(changed, 3);
  assert.equal(w.length, 24 + 12);
  const out = new Uint32Array(3);
  DeltaCompressor.decode(prev, new SnapshotReader(w.bytes().slice()), out);
  assert.deepEqual(Array.from(out), [111, 222, 333]);
});

test('delta compressor: a 32-column record exercises the full mask', () => {
  // Width 32 hits the mask's bit 31 and the columnCount === 32 path
  // that skips the unknown-bit check (every bit is valid).
  const prev = new Uint32Array(32);
  const curr = new Uint32Array(32);
  for (let i = 0; i < 32; i++) curr[i] = i + 1;   // every column differs
  const w = new SnapshotWriter();
  assert.equal(DeltaCompressor.encode(prev, curr, 7, 6, w), 32);
  const out = new Uint32Array(32);
  DeltaCompressor.decode(prev, new SnapshotReader(w.bytes().slice()), out);
  assert.deepEqual(Array.from(out), Array.from(curr));
});

test('delta compressor: a single-column record round-trips', () => {
  const prev = new Uint32Array([42]);
  const curr = new Uint32Array([43]);
  const w = new SnapshotWriter();
  assert.equal(DeltaCompressor.encode(prev, curr, 1, 0, w), 1);
  const out = new Uint32Array(1);
  DeltaCompressor.decode(prev, new SnapshotReader(w.bytes().slice()), out);
  assert.equal(out[0], 43);
});

test('delta compressor: encode validates record width and ticks', () => {
  const w = new SnapshotWriter();
  // Width out of [1, 32].
  assert.throws(() => DeltaCompressor.encode(new Uint32Array(0), new Uint32Array(0), 1, 0, w), /record width/);
  assert.throws(() => DeltaCompressor.encode(new Uint32Array(33), new Uint32Array(33), 1, 0, w), /record width/);
  // prev / curr width mismatch.
  assert.throws(() => DeltaCompressor.encode(new Uint32Array(4), new Uint32Array(5), 1, 0, w), /curr width/);
  // tick / baselineTick must be a valid u32.
  assert.throws(() => DeltaCompressor.encode(new Uint32Array(2), new Uint32Array(2), -1, 0, w), /tick/);
  assert.throws(() => DeltaCompressor.encode(new Uint32Array(2), new Uint32Array(2), 1.5, 0, w), /tick/);
  assert.throws(() => DeltaCompressor.encode(new Uint32Array(2), new Uint32Array(2), 0, 0x1_0000_0000, w), /baselineTick/);
});

test('delta compressor: decode rejects a bad magic', () => {
  const w = new SnapshotWriter();
  w.writeU32(0xdeadbeef);   // wrong magic
  assert.throws(
    () => DeltaCompressor.decode(new Uint32Array(2), new SnapshotReader(w.bytes().slice()), new Uint32Array(2)),
    /bad magic/,
  );
});

test('delta compressor: decode rejects a version mismatch', () => {
  const w = new SnapshotWriter();
  w.writeU32(DELTA_WIRE_MAGIC);
  w.writeU16(DELTA_WIRE_VERSION + 1);   // wrong version
  assert.throws(
    () => DeltaCompressor.decode(new Uint32Array(2), new SnapshotReader(w.bytes().slice()), new Uint32Array(2)),
    /version/,
  );
});

test('delta compressor: decode rejects a prev/out width mismatch', () => {
  const prev = new Uint32Array([1, 2, 3]);
  const curr = new Uint32Array([1, 9, 3]);
  const w = new SnapshotWriter();
  DeltaCompressor.encode(prev, curr, 1, 0, w);   // frame width 3
  const frame = w.bytes().slice();
  // prev too short for the frame's width.
  assert.throws(
    () => DeltaCompressor.decode(new Uint32Array(2), new SnapshotReader(frame), new Uint32Array(3)),
    /prev width/,
  );
  // out the wrong width.
  assert.throws(
    () => DeltaCompressor.decode(new Uint32Array(3), new SnapshotReader(frame), new Uint32Array(4)),
    /out width/,
  );
});

test('delta compressor: decode rejects a mask bit beyond the record width', () => {
  // Hand-craft a frame: width 4, but the mask sets bit 5.
  const w = new SnapshotWriter();
  w.writeU32(DELTA_WIRE_MAGIC);
  w.writeU16(DELTA_WIRE_VERSION);
  w.writeU16(4);          // columnCount
  w.writeU32(10);         // tick
  w.writeU32(9);          // baselineTick
  w.writeU32(0b100000);   // mask - bit 5 set, beyond width 4
  assert.throws(
    () => DeltaCompressor.decode(new Uint32Array(4), new SnapshotReader(w.bytes().slice()), new Uint32Array(4)),
    /beyond record width/,
  );
});

test('delta compressor: decode rejects a payloadLength that disagrees with the mask', () => {
  // Hand-craft a frame: the mask says 1 column changed, but
  // payloadLength claims 8 bytes (would be 2 columns).
  const w = new SnapshotWriter();
  w.writeU32(DELTA_WIRE_MAGIC);
  w.writeU16(DELTA_WIRE_VERSION);
  w.writeU16(4);          // columnCount
  w.writeU32(1);          // tick
  w.writeU32(0);          // baselineTick
  w.writeU32(0b0010);     // mask - bit 1 set, popcount 1
  w.writeU32(8);          // payloadLength - wrong, should be 4
  assert.throws(
    () => DeltaCompressor.decode(new Uint32Array(4), new SnapshotReader(w.bytes().slice()), new Uint32Array(4)),
    /payloadLength/,
  );
});

test('delta compressor: decode rejects a truncated frame', () => {
  const prev = new Uint32Array([1, 2, 3]);
  const curr = new Uint32Array([1, 9, 8]);   // columns 1 and 2 changed
  const w = new SnapshotWriter();
  DeltaCompressor.encode(prev, curr, 1, 0, w);   // 24 header + 8 payload
  const full = w.bytes().slice();
  // Cut off the last value - SnapshotReader.need() throws the over-read.
  const truncated = full.slice(0, full.length - 2);
  assert.throws(
    () => DeltaCompressor.decode(prev, new SnapshotReader(truncated), new Uint32Array(3)),
    /over-read/,
  );
});

test('delta compressor: deltaFrameTo/FromBase64 round-trip every length residue', () => {
  // Cover every length mod 3 - the Base64 padding cases.
  for (let len = 0; len <= 9; len++) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
    const back = deltaFrameFromBase64(deltaFrameToBase64(bytes));
    assert.deepEqual(Array.from(back), Array.from(bytes), 'len ' + len);
  }
});

test('delta compressor: deltaFrameFromBase64 throws on malformed input', () => {
  // atob rejects characters outside the Base64 alphabet.
  assert.throws(() => deltaFrameFromBase64('@@@@'));
});

test('delta compressor: full pipeline - encode, Base64, back, decode', () => {
  const prev = new Uint32Array([100, 200, 300, 400]);
  const curr = new Uint32Array([100, 999, 300, 401]);
  const w = new SnapshotWriter();
  DeltaCompressor.encode(prev, curr, 50, 49, w);
  // Cross the SSE text boundary and back.
  const bytes = deltaFrameFromBase64(deltaFrameToBase64(w.bytes()));
  const out = new Uint32Array(4);
  const info = DeltaCompressor.decode(prev, new SnapshotReader(bytes), out);
  assert.deepEqual(Array.from(out), Array.from(curr));
  assert.equal(info.tick, 50);
  assert.equal(info.baselineTick, 49);
});

test('delta compressor: encoding identical inputs produces byte-identical frames', () => {
  const prev = new Uint32Array([1, 2, 3, 4, 5]);
  const curr = new Uint32Array([1, 7, 3, 8, 5]);
  const a = new SnapshotWriter();
  const b = new SnapshotWriter();
  DeltaCompressor.encode(prev, curr, 12, 11, a);
  DeltaCompressor.encode(prev, curr, 12, 11, b);
  assert.deepEqual(Array.from(a.bytes()), Array.from(b.bytes()));
});
