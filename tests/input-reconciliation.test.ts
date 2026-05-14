// Loom Engine - InputReconciliation tests.
//
// Covers the fixed-point conversion (round-trip, defined rounding,
// overflow), the prediction ring (record/readSlot, strict tick
// ordering, ring recycling), reconcile (slot-stamp validation,
// mispredict detection, aged-out rejection), the SoA-write contract,
// and the static render-only smoothVisual lerp.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  InputReconciliation,
  FIXED_POINT_ONE,
  floatToFixed,
  fixedToFloat,
} from '../src/index.js';

test('input reconciliation: floatToFixed / fixedToFloat round-trip and rounding', () => {
  assert.equal(floatToFixed(1), FIXED_POINT_ONE);
  assert.equal(floatToFixed(0.5), FIXED_POINT_ONE / 2);
  assert.equal(floatToFixed(-2.5), -2.5 * FIXED_POINT_ONE);
  assert.equal(fixedToFloat(FIXED_POINT_ONE), 1);
  assert.equal(fixedToFloat(FIXED_POINT_ONE / 4), 0.25);
  // Rounding is Math.round - half rounds toward +Infinity. 2**-17
  // lands exactly on x.5 once scaled by 2^16.
  assert.equal(floatToFixed(2 ** -17), 1, 'half rounds up');
  assert.equal(floatToFixed(-(2 ** -17)), 0, 'negative half rounds toward +Infinity, normalised to +0');
  // Overflow and non-finite throw at the conversion boundary.
  assert.throws(() => floatToFixed(40000), /overflows/);
  assert.throws(() => floatToFixed(Infinity), /finite/);
  assert.throws(() => floatToFixed(NaN), /finite/);
});

test('input reconciliation: constructor validates capacity', () => {
  const ir = new InputReconciliation(64);
  assert.equal(ir.capacity, 64);
  assert.equal(ir.lastTick, -1, 'a fresh ring has recorded nothing');
  assert.throws(() => new InputReconciliation(0), /capacity/);
  assert.throws(() => new InputReconciliation(-4), /capacity/);
  assert.throws(() => new InputReconciliation(2.5), /capacity/);
  assert.throws(() => new InputReconciliation(1 << 21), /capacity/);
});

test('input reconciliation: record then readSlot round-trips a frame', () => {
  const ir = new InputReconciliation(8);
  ir.record(0, floatToFixed(1.5), floatToFixed(2.5), 0b101);
  assert.equal(ir.lastTick, 0);
  const out = new Int32Array(3);
  assert.equal(ir.readSlot(0, out), true);
  assert.equal(out[0], floatToFixed(1.5));
  assert.equal(out[1], floatToFixed(2.5));
  assert.equal(out[2], 0b101);
  assert.equal(ir.readSlot(5, out), false, 'a never-recorded tick has no slot');
});

test('input reconciliation: record enforces strict tick ordering', () => {
  const ir = new InputReconciliation(4);
  ir.record(100, 0, 0, 0);   // first record - any tick is allowed
  ir.record(101, 0, 0, 0);   // the next tick
  ir.record(102, 0, 0, 0);
  ir.record(103, 0, 0, 0);
  assert.equal(ir.lastTick, 103);
  // Re-recording a tick still inside the ring window is allowed (the
  // re-simulation case) and does not move lastTick backward.
  ir.record(102, floatToFixed(9), 0, 0);
  assert.equal(ir.lastTick, 103);
  // A forward gap throws.
  assert.throws(() => ir.record(105, 0, 0, 0), /forward gap or recycled slot/);
  // Advance the ring, then a write into an already-recycled slot throws.
  ir.record(104, 0, 0, 0);
  ir.record(105, 0, 0, 0);
  ir.record(106, 0, 0, 0);
  ir.record(107, 0, 0, 0);   // lastTick 107, window [104, 108]
  assert.throws(() => ir.record(103, 0, 0, 0), /forward gap or recycled slot/);
});

test('input reconciliation: record validates its arguments', () => {
  const ir = new InputReconciliation(8);
  assert.throws(() => ir.record(-1, 0, 0, 0), /tick/);
  assert.throws(() => ir.record(1.5, 0, 0, 0), /tick/);
  assert.throws(() => ir.record(0, 0x80000000, 0, 0), /xFixed/);
  assert.throws(() => ir.record(0, 0, -0x80000001, 0), /yFixed/);
  assert.throws(() => ir.record(0, 0, 0, 1.5), /inputMask/);
});

test('input reconciliation: reconcile accepts a matching slot, no mispredict', () => {
  const ir = new InputReconciliation(8);
  ir.record(10, floatToFixed(5), floatToFixed(7), 0);
  const r = ir.reconcile(10, floatToFixed(5), floatToFixed(7));
  assert.equal(r.accepted, true);
  assert.equal(r.mispredicted, false, 'prediction matched the server');
});

test('input reconciliation: reconcile detects a mispredict and writes server truth', () => {
  const ir = new InputReconciliation(8);
  ir.record(10, floatToFixed(5), floatToFixed(7), 0);
  const r = ir.reconcile(10, floatToFixed(99), floatToFixed(7));
  assert.equal(r.accepted, true);
  assert.equal(r.mispredicted, true, 'predicted x diverged from server x');
  // The slot now holds the authoritative position - a re-simulation
  // starts from server truth.
  const out = new Int32Array(3);
  ir.readSlot(10, out);
  assert.equal(out[0], floatToFixed(99));
  assert.equal(out[1], floatToFixed(7));
});

test('input reconciliation: reconcile rejects an aged-out or unrecorded tick', () => {
  const ir = new InputReconciliation(4);
  // Never recorded.
  let r = ir.reconcile(5, 0, 0);
  assert.equal(r.accepted, false);
  assert.equal(r.mispredicted, false);
  // Record 0..7 on a 4-slot ring; ticks 0-3 are recycled away.
  for (let t = 0; t <= 7; t++) ir.record(t, floatToFixed(t), 0, 0);
  r = ir.reconcile(0, 0, 0);
  assert.equal(r.accepted, false, 'tick 0 has been recycled out of the ring');
  r = ir.reconcile(7, floatToFixed(7), 0);
  assert.equal(r.accepted, true, 'the most recent tick is still live');
  assert.equal(r.mispredicted, false);
});

test('input reconciliation: reconcile validates its arguments', () => {
  const ir = new InputReconciliation(8);
  assert.throws(() => ir.reconcile(-1, 0, 0), /serverTick/);
  assert.throws(() => ir.reconcile(0, 0x80000000, 0), /serverXFixed/);
});

test('input reconciliation: readSlot needs a 3-wide buffer and leaves it untouched on a miss', () => {
  const ir = new InputReconciliation(8);
  ir.record(5, floatToFixed(1), floatToFixed(2), 3);
  assert.throws(() => ir.readSlot(5, new Int32Array(2)), /at least 3/);
  const out = new Int32Array(3).fill(-99);
  assert.equal(ir.readSlot(6, out), false);
  assert.deepEqual(Array.from(out), [-99, -99, -99], 'a miss does not write out');
});

test('input reconciliation: the ring recycles slots as ticks advance', () => {
  const ir = new InputReconciliation(4);
  for (let t = 0; t <= 4; t++) ir.record(t, floatToFixed(t), 0, 0);
  const out = new Int32Array(3);
  // tick 4 took slot 0, overwriting tick 0.
  assert.equal(ir.readSlot(0, out), false, 'tick 0 was recycled');
  assert.equal(ir.readSlot(4, out), true);
  assert.equal(out[0], floatToFixed(4));
});

test('input reconciliation: clear empties the ring', () => {
  const ir = new InputReconciliation(8);
  ir.record(3, floatToFixed(1), floatToFixed(1), 0);
  ir.record(4, floatToFixed(2), floatToFixed(2), 0);
  ir.clear();
  assert.equal(ir.lastTick, -1);
  const out = new Int32Array(3);
  assert.equal(ir.readSlot(3, out), false);
  assert.equal(ir.readSlot(4, out), false);
});

test('input reconciliation: smoothVisual lerps client toward server and clamps', () => {
  const out = new Int32Array(2);
  const c = floatToFixed(0);
  const sx = floatToFixed(10);
  const sy = floatToFixed(20);
  // lerp 0 -> the client position.
  InputReconciliation.smoothVisual(c, c, sx, sy, 0, out);
  assert.equal(out[0], c);
  assert.equal(out[1], c);
  // lerp 1.0 -> the server position.
  InputReconciliation.smoothVisual(c, c, sx, sy, FIXED_POINT_ONE, out);
  assert.equal(out[0], sx);
  assert.equal(out[1], sy);
  // lerp 0.5 -> the midpoint.
  InputReconciliation.smoothVisual(c, c, sx, sy, FIXED_POINT_ONE / 2, out);
  assert.equal(out[0], floatToFixed(5));
  assert.equal(out[1], floatToFixed(10));
  // lerp out of [0, 1] clamps.
  InputReconciliation.smoothVisual(c, c, sx, sy, FIXED_POINT_ONE * 3, out);
  assert.equal(out[0], sx, 'lerp > 1 clamps to the server position');
  InputReconciliation.smoothVisual(c, c, sx, sy, -100, out);
  assert.equal(out[0], c, 'lerp < 0 clamps to the client position');
});

test('input reconciliation: smoothVisual validates its arguments', () => {
  const out = new Int32Array(2);
  assert.throws(() => InputReconciliation.smoothVisual(0x80000000, 0, 0, 0, 0, out), /clientXFixed/);
  assert.throws(() => InputReconciliation.smoothVisual(0, 0, 0, 0, 1.5, out), /lerpFixed/);
  assert.throws(() => InputReconciliation.smoothVisual(0, 0, 0, 0, 0, new Int32Array(1)), /at least 2/);
});

test('input reconciliation: an identical record + reconcile sequence is deterministic', () => {
  function run(): number[] {
    const ir = new InputReconciliation(16);
    for (let t = 0; t < 10; t++) {
      ir.record(t, floatToFixed(t * 1.5), floatToFixed(t * -0.25), t & 0xff);
    }
    ir.reconcile(4, floatToFixed(999), floatToFixed(4));
    const out = new Int32Array(3);
    const dump: number[] = [];
    for (let t = 0; t < 10; t++) {
      if (ir.readSlot(t, out)) dump.push(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0);
    }
    return dump;
  }
  assert.deepEqual(run(), run(), 'fixed-point integer math is bit-identical across runs');
});
