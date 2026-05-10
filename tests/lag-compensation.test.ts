// Phase 1.7.4 - LagCompensation tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LagCompensation,
  RESOURCE_LAG_COMPENSATION,
} from '../src/index.js';

test('lc: RESOURCE_LAG_COMPENSATION is the stable string', () => {
  assert.equal(RESOURCE_LAG_COMPENSATION, 'lag_compensation');
});

test('lc: starts empty', () => {
  const lc = LagCompensation.create();
  assert.equal(lc.snapshotCount(), 0);
  assert.equal(lc.inputCount(), 0);
  assert.equal(lc.oldestSnapshotTick(), null);
  assert.equal(lc.newestSnapshotTick(), null);
});

test('lc: recordState appends snapshot', () => {
  const lc = LagCompensation.create<{ x: number }>();
  lc.recordState(10, { x: 100 });
  lc.recordState(11, { x: 110 });
  lc.recordState(12, { x: 120 });
  assert.equal(lc.snapshotCount(), 3);
  assert.equal(lc.oldestSnapshotTick(), 10);
  assert.equal(lc.newestSnapshotTick(), 12);
});

test('lc: recordState replaces same-tick snapshot', () => {
  const lc = LagCompensation.create<{ x: number }>();
  lc.recordState(10, { x: 100 });
  lc.recordState(10, { x: 999 });
  assert.equal(lc.snapshotCount(), 1);
  const r = lc.rewind(10);
  assert.equal(r!.snapshot.state.x, 999);
});

test('lc: recordState rejects invalid tick', () => {
  const lc = LagCompensation.create();
  lc.recordState(NaN, {});
  assert.equal(lc.snapshotCount(), 0);
});

test('lc: recordInput appends input', () => {
  const lc = LagCompensation.create<unknown, { jump: boolean }>();
  lc.recordInput(10, { jump: true });
  lc.recordInput(11, { jump: false });
  assert.equal(lc.inputCount(), 2);
  assert.equal(lc.newestInputTick(), 11);
});

test('lc: recordInput allows multiple inputs at same tick', () => {
  const lc = LagCompensation.create<unknown, { key: string }>();
  lc.recordInput(10, { key: 'a' });
  lc.recordInput(10, { key: 'b' });
  lc.recordInput(10, { key: 'c' });
  assert.equal(lc.inputCount(), 3);
});

test('lc: recordInput sorts out-of-order arrivals', () => {
  const lc = LagCompensation.create<unknown, { v: number }>();
  lc.recordInput(15, { v: 15 });
  lc.recordInput(12, { v: 12 });  // arrived late
  lc.recordInput(13, { v: 13 });
  // Newest should be tick 15 (sorted)
  assert.equal(lc.newestInputTick(), 15);
});

test('lc: rewind returns snapshot at-or-before tick + later inputs', () => {
  const lc = LagCompensation.create<{ x: number }, { dir: string }>();
  lc.recordState(10, { x: 100 });
  lc.recordState(15, { x: 150 });
  lc.recordState(20, { x: 200 });
  lc.recordInput(11, { dir: 'right' });
  lc.recordInput(13, { dir: 'left' });
  lc.recordInput(16, { dir: 'right' });
  lc.recordInput(18, { dir: 'jump' });
  lc.recordInput(22, { dir: 'down' });

  const r = lc.rewind(15);
  assert.ok(r);
  assert.equal(r!.snapshot.tick, 15);
  assert.equal(r!.snapshot.state.x, 150);
  // Inputs after tick 15: 16, 18, 22
  assert.deepEqual(r!.inputs.map(i => i.tick), [16, 18, 22]);
});

test('lc: rewind returns largest snapshot tick <= request', () => {
  const lc = LagCompensation.create<{ x: number }>();
  lc.recordState(10, { x: 100 });
  lc.recordState(20, { x: 200 });
  lc.recordState(30, { x: 300 });
  // Rewind to 25 should return snapshot at tick 20 (largest <= 25)
  const r = lc.rewind(25);
  assert.equal(r!.snapshot.tick, 20);
  assert.equal(r!.snapshot.state.x, 200);
});

test('lc: rewind returns null when no snapshot at-or-before', () => {
  const lc = LagCompensation.create<{ x: number }>();
  lc.recordState(50, { x: 500 });
  // Rewind to 10 (before any snapshot)
  assert.equal(lc.rewind(10), null);
});

test('lc: rewind rejects invalid tick', () => {
  const lc = LagCompensation.create();
  lc.recordState(10, {});
  assert.equal(lc.rewind(NaN), null);
});

test('lc: stateSerialize deep-clones snapshots', () => {
  const lc = LagCompensation.create<{ pos: { x: number } }>({
    stateSerialize: (s) => JSON.parse(JSON.stringify(s)),
  });
  const original = { pos: { x: 100 } };
  lc.recordState(10, original);
  // Mutate original AFTER recording
  original.pos.x = 999;
  const r = lc.rewind(10)!;
  // Snapshot is the cloned version; not affected
  assert.equal(r.snapshot.state.pos.x, 100);
});

test('lc: resync drops old snapshots + inputs, returns survivors', () => {
  const lc = LagCompensation.create<{ x: number }, { v: number }>();
  lc.recordState(10, { x: 100 });
  lc.recordState(15, { x: 150 });
  lc.recordInput(11, { v: 11 });
  lc.recordInput(13, { v: 13 });
  lc.recordInput(16, { v: 16 });
  lc.recordInput(20, { v: 20 });

  const surviving = lc.resync(15, { x: 9999 });
  // Snapshots: only the new one (at 15) + nothing older
  assert.equal(lc.snapshotCount(), 1);
  assert.equal(lc.newestSnapshotTick(), 15);
  // Inputs at or before 15 dropped: only 16, 20 survive
  assert.deepEqual(surviving.map(i => i.tick), [16, 20]);
  // Authoritative state visible via rewind
  const r = lc.rewind(15)!;
  assert.equal(r.snapshot.state.x, 9999);
});

test('lc: resync rejects invalid tick', () => {
  const lc = LagCompensation.create();
  assert.deepEqual(lc.resync(NaN, {}), []);
});

test('lc: historySize evicts oldest entries on overflow', () => {
  const lc = LagCompensation.create<{ x: number }>({ historySize: 3 });
  // Tick 100: with historySize 3, retain ticks > 97
  lc.recordState(100, { x: 100 });
  lc.recordState(101, { x: 101 });
  lc.recordState(102, { x: 102 });
  lc.recordState(103, { x: 103 });
  // currentTick=103, minTick=100, so tick 100 still retained
  assert.equal(lc.snapshotCount(), 4);
  // Push to tick 110: minTick=107, evicts 100,101,102,103
  lc.recordState(110, { x: 110 });
  assert.equal(lc.snapshotCount(), 1);
  assert.equal(lc.oldestSnapshotTick(), 110);
});

test('lc: historySize evicts old inputs too', () => {
  const lc = LagCompensation.create<unknown, { v: number }>({ historySize: 2 });
  lc.recordInput(10, { v: 10 });
  lc.recordInput(11, { v: 11 });
  lc.recordInput(12, { v: 12 });
  lc.recordInput(20, { v: 20 });  // currentTick=20, minTick=18 -> evict 10,11,12
  assert.equal(lc.inputCount(), 1);
});

test('lc: setHistorySize re-applies eviction', () => {
  const lc = LagCompensation.create<{ x: number }>({ historySize: 100 });
  for (let i = 0; i < 50; i++) lc.recordState(i, { x: i });
  assert.equal(lc.snapshotCount(), 50);
  lc.setHistorySize(10);
  // After shrink, ticks >= (49 - 10) = 39 retained -> 39..49 = 11 entries
  assert.equal(lc.snapshotCount(), 11);
  assert.equal(lc.oldestSnapshotTick(), 39);
});

test('lc: clear empties everything', () => {
  const lc = LagCompensation.create();
  lc.recordState(10, {});
  lc.recordInput(11, {});
  lc.clear();
  assert.equal(lc.snapshotCount(), 0);
  assert.equal(lc.inputCount(), 0);
});

test('lc: rewind to current tick returns 0 inputs after', () => {
  const lc = LagCompensation.create<{ x: number }, { v: number }>();
  lc.recordState(10, { x: 100 });
  lc.recordInput(10, { v: 10 });
  lc.recordInput(11, { v: 11 });
  const r = lc.rewind(15)!;  // no snapshot AT 15, but 10 is the newest <= 15
  assert.equal(r.snapshot.tick, 10);
  // Inputs after tick 10: just the input at tick 11
  assert.deepEqual(r.inputs.map(i => i.tick), [11]);
});

test('lc: out-of-order recordInput preserves chronological rewind', () => {
  const lc = LagCompensation.create<{ x: number }, { v: number }>();
  lc.recordState(10, { x: 100 });
  // Inputs arrive out of order
  lc.recordInput(15, { v: 15 });
  lc.recordInput(12, { v: 12 });
  lc.recordInput(14, { v: 14 });
  lc.recordInput(13, { v: 13 });
  const r = lc.rewind(10)!;
  // Should be chronological
  assert.deepEqual(r.inputs.map(i => i.tick), [12, 13, 14, 15]);
});
