// Loom Engine - LoomChrono (rewind / replay log) tests.
//
// Covers constructor + capacity validation, the snapshot copy contract
// (gate 1), the generation + validity handle contract (gates 2, 3),
// the input-log accessors and eviction detection, invalidateAfter
// branch surgery, the findReplayPlan happy path + every typed failure
// reason, and a realistic rewind-and-replay capstone that proves the
// chrono drives a deterministic forward replay to the same final
// state.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { LoomChrono, chronoSlot, chronoGeneration } from '../src/index.js';

test('loom chrono: constructor validates options', () => {
  const c = new LoomChrono({ keyframeBytes: 16, maxKeyframes: 4, inputWords: 4, maxInputs: 16 });
  assert.equal(c.keyframeBytes, 16);
  assert.equal(c.maxKeyframes, 4);
  assert.equal(c.inputWords, 4);
  assert.equal(c.maxInputs, 16);
  assert.throws(
    () => new LoomChrono({ keyframeBytes: 0, maxKeyframes: 4, inputWords: 4, maxInputs: 16 }),
    /keyframeBytes/,
  );
  assert.throws(
    () => new LoomChrono({ keyframeBytes: (1 << 20) + 1, maxKeyframes: 4, inputWords: 4, maxInputs: 16 }),
    /keyframeBytes/,
  );
  assert.throws(
    () => new LoomChrono({ keyframeBytes: 16, maxKeyframes: 0, inputWords: 4, maxInputs: 16 }),
    /maxKeyframes/,
  );
  assert.throws(
    () => new LoomChrono({ keyframeBytes: 16, maxKeyframes: 257, inputWords: 4, maxInputs: 16 }),
    /maxKeyframes/,
  );
  assert.throws(
    () => new LoomChrono({ keyframeBytes: 16, maxKeyframes: 4, inputWords: 0, maxInputs: 16 }),
    /inputWords/,
  );
});

test('loom chrono: snapshot + getKeyframe round-trip', () => {
  const c = new LoomChrono({ keyframeBytes: 8, maxKeyframes: 4, inputWords: 4, maxInputs: 16 });
  const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const handle = c.snapshot(100, src);
  const dst = new Uint8Array(8);
  assert.equal(c.getKeyframe(handle, dst), true);
  assert.deepEqual(Array.from(dst), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(c.getKeyframeTick(handle), 100);
  assert.equal(c.isKeyframeValid(handle), true);
  assert.equal(c.snapshotCount(), 1);
  assert.equal(c.validKeyframeCount(), 1);
});

test('loom chrono: snapshot rejects malformed args', () => {
  const c = new LoomChrono({ keyframeBytes: 8, maxKeyframes: 4, inputWords: 4, maxInputs: 16 });
  assert.throws(() => c.snapshot(0, new Uint8Array(7)), /byteLength/);
  assert.throws(() => c.snapshot(0, new Uint8Array(9)), /byteLength/);
  assert.throws(() => c.snapshot(NaN, new Uint8Array(8)), /tick/);
  assert.throws(() => c.snapshot(Infinity, new Uint8Array(8)), /tick/);
});

test('loom chrono: snapshot accepts any ArrayBufferView (gate 1 byte-level copy)', () => {
  const c = new LoomChrono({ keyframeBytes: 8, maxKeyframes: 4, inputWords: 4, maxInputs: 16 });
  // Two int32s = 8 bytes. The chrono copies bytes regardless of view type.
  const src = new Int32Array([0x01020304, 0x05060708]);
  const handle = c.snapshot(0, src);
  const dst = new Int32Array(2);
  assert.equal(c.getKeyframe(handle, dst), true);
  assert.equal(dst[0], 0x01020304);
  assert.equal(dst[1], 0x05060708);
});

test('loom chrono: snapshot is a copy - mutating the source after snapshot does not affect the slot (gate 1)', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 4, maxInputs: 16 });
  const src = new Uint8Array([10, 20, 30, 40]);
  const handle = c.snapshot(0, src);
  src[0] = 99;
  src[3] = 99;
  const dst = new Uint8Array(4);
  c.getKeyframe(handle, dst);
  assert.deepEqual(Array.from(dst), [10, 20, 30, 40]);
});

test('loom chrono: a stale handle (overwritten by ring rotation) fails (gates 2, 3)', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 2, inputWords: 4, maxInputs: 16 });
  const h0 = c.snapshot(0, new Uint8Array([1, 1, 1, 1]));
  const h1 = c.snapshot(1, new Uint8Array([2, 2, 2, 2]));
  // The next snapshot wraps and overwrites slot 0.
  const h2 = c.snapshot(2, new Uint8Array([3, 3, 3, 3]));
  assert.equal(c.isKeyframeValid(h0), false);
  const dst = new Uint8Array(4);
  assert.equal(c.getKeyframe(h0, dst), false);
  // h1 and h2 still validate.
  assert.equal(c.isKeyframeValid(h1), true);
  assert.equal(c.isKeyframeValid(h2), true);
  // The new occupant at slot 0 holds h2's payload.
  c.getKeyframe(h2, dst);
  assert.deepEqual(Array.from(dst), [3, 3, 3, 3]);
});

test('loom chrono: getKeyframe rejects an undersized destination', () => {
  const c = new LoomChrono({ keyframeBytes: 8, maxKeyframes: 4, inputWords: 4, maxInputs: 16 });
  const h = c.snapshot(0, new Uint8Array(8));
  assert.equal(c.getKeyframe(h, new Uint8Array(4)), false);
  assert.equal(c.getKeyframe(h, new Uint8Array(8)), true);
});

test('loom chrono: chronoSlot / chronoGeneration decode handles', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 8 });
  const h0 = c.snapshot(0, new Uint8Array(4));
  assert.equal(chronoSlot(h0), 0);
  assert.equal(chronoGeneration(h0), 0);
  // Fill the ring then wrap - slot 0's gen bumps.
  c.snapshot(1, new Uint8Array(4));
  c.snapshot(2, new Uint8Array(4));
  c.snapshot(3, new Uint8Array(4));
  const h4 = c.snapshot(4, new Uint8Array(4));
  assert.equal(chronoSlot(h4), 0);
  assert.equal(chronoGeneration(h4), 1);
});

test('loom chrono: logInput + accessors round-trip', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 3, maxInputs: 8 });
  const idx = c.logInput(50, [10, 20, 30]);
  assert.equal(idx, 0);
  assert.equal(c.inputTickAt(0), 50);
  assert.equal(c.inputWordAt(0, 0), 10);
  assert.equal(c.inputWordAt(0, 1), 20);
  assert.equal(c.inputWordAt(0, 2), 30);
  assert.equal(c.inputWriteCount(), 1);
  assert.equal(c.validInputCount(), 1);
});

test('loom chrono: logInput rejects malformed args', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 4, maxInputs: 8 });
  assert.throws(() => c.logInput(NaN, [1, 2, 3, 4]), /tick/);
  assert.throws(() => c.logInput(0, [1, 2, 3]), /words/);
});

test('loom chrono: an evicted input fails accessors and isInputValid (gate 2)', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 4 });
  for (let i = 0; i < 6; i++) c.logInput(i, [i]);
  // Inputs 0 and 1 were evicted (ring is 4, we wrote 6).
  assert.equal(c.inputWriteCount(), 6);
  assert.equal(c.isInputValid(0), false);
  assert.equal(c.isInputValid(1), false);
  assert.equal(c.isInputValid(2), true);
  assert.equal(c.isInputValid(5), true);
  assert.throws(() => c.inputTickAt(0), /evicted/);
  assert.equal(c.inputTickAt(2), 2);
  assert.equal(c.inputWordAt(2, 0), 2);
  assert.throws(() => c.inputWordAt(2, 5), /wordIdx/);
});

test('loom chrono: invalidateAfter clears keyframes and inputs past the tick (gate 3)', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 8 });
  const h0 = c.snapshot(10, new Uint8Array(4));
  const h1 = c.snapshot(20, new Uint8Array(4));
  const h2 = c.snapshot(30, new Uint8Array(4));
  c.logInput(15, [1]);
  c.logInput(25, [2]);
  c.logInput(35, [3]);

  const n = c.invalidateAfter(22);
  // h2 (tick 30), input @25, input @35 - three invalidations.
  assert.equal(n, 3);
  assert.equal(c.isKeyframeValid(h0), true);
  assert.equal(c.isKeyframeValid(h1), true);
  assert.equal(c.isKeyframeValid(h2), false);
  assert.equal(c.isInputValid(0), true);   // tick 15
  assert.equal(c.isInputValid(1), false);  // tick 25
  assert.equal(c.isInputValid(2), false);  // tick 35
  // The latest pointer now points at h1 (tick 20), the highest
  // surviving keyframe.
  const latest = c.latestKeyframeHandle();
  assert.notEqual(latest, -1);
  assert.equal(c.getKeyframeTick(latest), 20);
});

test('loom chrono: findReplayPlan picks latest keyframe + inputs in (K, target] (gate 4)', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 16 });
  c.snapshot(0, new Uint8Array(4));
  c.snapshot(10, new Uint8Array(4));
  c.snapshot(50, new Uint8Array(4));
  // Inputs at 5, 15, 20, 30, 60, 70 - 60 and 70 are past the target.
  c.logInput(5, [101]);
  c.logInput(15, [102]);
  c.logInput(20, [103]);
  c.logInput(30, [104]);
  c.logInput(60, [105]);
  c.logInput(70, [106]);

  const out = new Int32Array(16);
  const plan = c.findReplayPlan(40, out);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  // Latest keyframe <= 40 is the one at tick 10.
  assert.equal(plan.keyframeTick, 10);
  // Inputs in (10, 40] are 15, 20, 30 - three of them, in tick order.
  assert.equal(plan.inputCount, 3);
  assert.equal(c.inputTickAt(out[0] ?? 0), 15);
  assert.equal(c.inputTickAt(out[1] ?? 0), 20);
  assert.equal(c.inputTickAt(out[2] ?? 0), 30);
  // The keyframeHandle resolves.
  assert.equal(c.isKeyframeValid(plan.keyframeHandle), true);
  assert.equal(c.getKeyframeTick(plan.keyframeHandle), 10);
});

test('loom chrono: findReplayPlan returns no_keyframe when target predates everything', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 16 });
  c.snapshot(50, new Uint8Array(4));
  c.snapshot(100, new Uint8Array(4));
  const out = new Int32Array(16);
  const plan = c.findReplayPlan(10, out);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.reason, 'no_keyframe');
});

test('loom chrono: findReplayPlan detects an inputs_evicted gap', () => {
  // Small input ring - log enough inputs to evict the early ones, but
  // the keyframe predates the evicted inputs. Replay would silently
  // miss those inputs; the chrono returns inputs_evicted instead.
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 4 });
  c.snapshot(10, new Uint8Array(4));   // keyframe at tick 10
  c.logInput(15, [1]);
  c.logInput(20, [2]);
  c.logInput(25, [3]);
  c.logInput(30, [4]);
  c.logInput(35, [5]);   // evicts the input at tick 15
  c.logInput(40, [6]);   // evicts the input at tick 20
  // Last evicted tick is 20.
  assert.equal(c.evictedInputTickHigh(), 20);
  // The keyframe at tick 10 predates evicted inputs - replay forward
  // would miss them.
  const out = new Int32Array(16);
  const plan = c.findReplayPlan(50, out);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.reason, 'inputs_evicted');
});

test('loom chrono: findReplayPlan reports buffer_too_small', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 16 });
  c.snapshot(0, new Uint8Array(4));
  for (let i = 1; i <= 10; i++) c.logInput(i, [i]);
  const out = new Int32Array(3);   // far too small for 10 inputs
  const plan = c.findReplayPlan(20, out);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.reason, 'buffer_too_small');
});

test('loom chrono: findReplayPlan picks the keyframe with the largest tick <= target', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 16 });
  c.snapshot(10, new Uint8Array(4));
  c.snapshot(30, new Uint8Array(4));
  c.snapshot(50, new Uint8Array(4));
  const out = new Int32Array(16);
  // Target between 30 and 50 - pick 30.
  let plan = c.findReplayPlan(40, out);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.keyframeTick, 30);
  // Target exactly equals a keyframe tick - that keyframe wins.
  plan = c.findReplayPlan(50, out);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.keyframeTick, 50);
});

test('loom chrono: clear invalidates outstanding handles and resets counters', () => {
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 4, inputWords: 1, maxInputs: 16 });
  const h = c.snapshot(0, new Uint8Array([1, 2, 3, 4]));
  c.logInput(0, [1]);
  c.clear();
  assert.equal(c.isKeyframeValid(h), false);
  assert.equal(c.snapshotCount(), 0);
  assert.equal(c.inputWriteCount(), 0);
  assert.equal(c.validKeyframeCount(), 0);
  assert.equal(c.validInputCount(), 0);
  assert.equal(c.latestKeyframeHandle(), -1);
  assert.equal(c.evictedInputTickHigh(), -Infinity);
  // Usable again after clear.
  const h2 = c.snapshot(0, new Uint8Array([9, 9, 9, 9]));
  assert.equal(c.isKeyframeValid(h2), true);
});

test('loom chrono: realistic example - rewind + replay reaches the same final state', () => {
  // A tiny game whose state is one Int32 ("score"). Forward simulation:
  //   t=0: score=0;  snapshot
  //   t=5: input +3
  //   t=10: score=3; snapshot
  //   t=15: input +5
  //   t=20: score=8; snapshot
  //   t=25: input +2
  //   t=28: input +1
  //
  // Rewind to t=28: best keyframe is t=20 (score=8), replay inputs at
  // t=25 and t=28 -> final score = 8 + 2 + 1 = 11.
  const c = new LoomChrono({ keyframeBytes: 4, maxKeyframes: 8, inputWords: 1, maxInputs: 16 });
  const stateBuf = new Int32Array([0]);
  const stateView = new Uint8Array(stateBuf.buffer);

  stateBuf[0] = 0;
  c.snapshot(0, stateView);
  c.logInput(5, [3]);
  stateBuf[0] = 3;
  c.snapshot(10, stateView);
  c.logInput(15, [5]);
  stateBuf[0] = 8;
  c.snapshot(20, stateView);
  c.logInput(25, [2]);
  c.logInput(28, [1]);

  const out = new Int32Array(16);
  const plan = c.findReplayPlan(28, out);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.keyframeTick, 20);
  assert.equal(plan.inputCount, 2);

  // Restore the keyframe and re-apply each input on top.
  const restored = new Int32Array(1);
  const restoredBytes = new Uint8Array(restored.buffer);
  assert.equal(c.getKeyframe(plan.keyframeHandle, restoredBytes), true);
  let score = restored[0] ?? 0;
  for (let i = 0; i < plan.inputCount; i++) {
    const idx = out[i] ?? 0;
    score += c.inputWordAt(idx, 0);
  }
  assert.equal(score, 11);

  // Same plan is bit-identical when rebuilt - the chrono is
  // deterministic in its replay-plan output for a given history.
  const out2 = new Int32Array(16);
  const plan2 = c.findReplayPlan(28, out2);
  assert.deepEqual(plan2, plan);
  for (let i = 0; i < plan.inputCount; i++) {
    assert.equal(out2[i], out[i]);
  }
});
