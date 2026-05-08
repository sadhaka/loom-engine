// Phase 0.47.0 - TweenChain tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TweenChain,
  RESOURCE_TWEEN_CHAIN,
} from '../src/index.js';

test('tween-chain: RESOURCE_TWEEN_CHAIN is the stable string', () => {
  assert.equal(RESOURCE_TWEEN_CHAIN, 'tween_chain');
});

test('tween-chain: starts inactive; update before start is a no-op', () => {
  const chain = TweenChain.create();
  let updateCalls = 0;
  chain.to(0, 100, 1, () => updateCalls++);
  chain.update(0.5);
  assert.equal(updateCalls, 0);
  assert.equal(chain.isActive(), false);
});

test('tween-chain: single tween step animates 0 -> end across updates', () => {
  const chain = TweenChain.create();
  const samples: number[] = [];
  chain.to(0, 100, 1, (v) => samples.push(v));
  chain.start();
  chain.update(0.5);
  chain.update(0.5);
  // Last sample should be 100 (end).
  assert.equal(samples[samples.length - 1], 100);
  assert.equal(chain.hasCompleted(), true);
});

test('tween-chain: midpoint sample matches linear interpolation', () => {
  const chain = TweenChain.create();
  const samples: number[] = [];
  chain.to(0, 100, 1, (v) => samples.push(v));
  chain.start();
  chain.update(0.5);
  // Linear at 0.5 -> 50.
  assert.ok(Math.abs(samples[samples.length - 1]! - 50) < 1e-9);
});

test('tween-chain: easing applied to sample value', () => {
  const chain = TweenChain.create();
  const samples: number[] = [];
  chain.to(0, 100, 1, (v) => samples.push(v), 'easeInOutQuad');
  chain.start();
  chain.update(0.25);
  // easeInOutQuad(0.25) = 2 * 0.25^2 = 0.125 -> value = 12.5.
  assert.ok(Math.abs(samples[samples.length - 1]! - 12.5) < 1e-9);
});

test('tween-chain: delay holds before next tween', () => {
  const chain = TweenChain.create();
  const samples: number[] = [];
  chain.to(0, 50, 0.5, (v) => samples.push(v));
  chain.delay(0.5);
  chain.to(50, 100, 0.5, (v) => samples.push(v));
  chain.start();
  // First tween completes (samples to 50)
  chain.update(0.5);
  // Delay starts; samples shouldn't change during delay.
  const beforeDelayLen = samples.length;
  chain.update(0.4); // mid-delay
  assert.equal(samples.length, beforeDelayLen);
  chain.update(0.5); // delay ends, second tween advances
  // Second tween partial sample at t=0.4 since 0.1 was used finishing delay.
  // Final tween sample > 50 < 100.
  const last = samples[samples.length - 1]!;
  assert.ok(last > 50 && last < 100);
});

test('tween-chain: callback step fires once at correct cursor position', () => {
  const chain = TweenChain.create();
  let cbFired = 0;
  chain.to(0, 1, 0.5, () => {});
  chain.call(() => { cbFired++; });
  chain.to(1, 2, 0.5, () => {});
  chain.start();
  chain.update(0.5); // first tween completes; callback fires
  assert.equal(cbFired, 1);
  // Subsequent updates do not re-fire.
  chain.update(0.5);
  chain.update(0.5);
  assert.equal(cbFired, 1);
});

test('tween-chain: onComplete fires once when chain finishes', () => {
  const chain = TweenChain.create();
  let completedCount = 0;
  chain.to(0, 100, 1, () => {});
  chain.start({ onComplete: () => { completedCount++; } });
  chain.update(1);
  assert.equal(completedCount, 1);
  // Extra updates don't re-fire.
  chain.update(1);
  assert.equal(completedCount, 1);
});

test('tween-chain: cancel mid-chain stops execution + onComplete does NOT fire', () => {
  const chain = TweenChain.create();
  let completedCount = 0;
  let updateCalls = 0;
  chain.to(0, 100, 1, () => updateCalls++);
  chain.start({ onComplete: () => { completedCount++; } });
  chain.update(0.3);
  const callsBefore = updateCalls;
  chain.cancel();
  chain.update(1.0);
  assert.equal(updateCalls, callsBefore); // no further updates
  assert.equal(completedCount, 0);
  assert.equal(chain.isActive(), false);
});

test('tween-chain: empty chain completes on first update + onComplete fires', () => {
  const chain = TweenChain.create();
  let completedCount = 0;
  chain.start({ onComplete: () => { completedCount++; } });
  chain.update(0.1);
  assert.equal(chain.hasCompleted(), true);
  assert.equal(completedCount, 1);
});

test('tween-chain: totalDuration sums tween + delay durations (callbacks excluded)', () => {
  const chain = TweenChain.create()
    .to(0, 1, 0.5, () => {})
    .delay(0.3)
    .call(() => {})
    .to(1, 2, 0.7, () => {});
  // 0.5 + 0.3 + 0 + 0.7 = 1.5
  assert.ok(Math.abs(chain.totalDuration() - 1.5) < 1e-9);
});

test('tween-chain: stepCount reflects added steps', () => {
  const chain = TweenChain.create()
    .to(0, 1, 0.5, () => {})
    .delay(0.3)
    .call(() => {})
    .to(1, 2, 0.7, () => {});
  assert.equal(chain.stepCount(), 4);
});

test('tween-chain: zero-duration tween snaps to end value immediately', () => {
  const chain = TweenChain.create();
  let lastValue = -1;
  chain.to(0, 100, 0, (v) => { lastValue = v; });
  chain.start();
  chain.update(0.001);
  assert.equal(lastValue, 100);
  assert.equal(chain.hasCompleted(), true);
});

test('tween-chain: zero-duration delay is skipped instantly', () => {
  const chain = TweenChain.create();
  chain.to(0, 1, 0.5, () => {});
  chain.delay(0);
  chain.to(1, 2, 0.5, () => {});
  chain.start();
  chain.update(1);
  assert.equal(chain.hasCompleted(), true);
});

test('tween-chain: loop=true repeats indefinitely', () => {
  const chain = TweenChain.create();
  let completes = 0;
  let lastValue = -1;
  chain.to(0, 100, 1, (v) => { lastValue = v; });
  chain.start({ loop: true, onComplete: () => { completes++; } });
  // Run 10 full cycles; should never call onComplete.
  for (var i = 0; i < 10; i++) chain.update(1);
  assert.equal(completes, 0);
  assert.ok(chain.isActive());
  assert.equal(lastValue, 100);
});

test('tween-chain: loop=N repeats N additional times', () => {
  const chain = TweenChain.create();
  let lastValue = -1;
  let runStart = 0;
  chain.to(0, 100, 1, (v) => { lastValue = v; if (v === 0) runStart++; });
  chain.start({ loop: 2 }); // total 3 runs
  // Each run is 1 second; advance through all 3.
  chain.update(1); // run 1 completes; loop -> run 2 begins
  chain.update(1); // run 2 completes; loop -> run 3 begins
  chain.update(1); // run 3 completes; chain ends
  assert.equal(chain.hasCompleted(), true);
});

test('tween-chain: cancel after start can be re-started', () => {
  const chain = TweenChain.create();
  let lastValue = -1;
  chain.to(0, 100, 1, (v) => { lastValue = v; });
  chain.start();
  chain.update(0.3);
  chain.cancel();
  chain.start(); // re-start
  chain.update(1);
  assert.equal(lastValue, 100);
  assert.equal(chain.hasCompleted(), true);
});

test('tween-chain: throwing onUpdate does not break the chain', () => {
  const chain = TweenChain.create();
  let secondReached = false;
  chain.to(0, 1, 0.5, () => { throw new Error('boom'); });
  chain.to(1, 2, 0.5, () => { secondReached = true; });
  chain.start();
  chain.update(0.5);
  chain.update(0.5);
  assert.equal(secondReached, true);
});

test('tween-chain: throwing call step does not break the chain', () => {
  const chain = TweenChain.create();
  let afterCall = 0;
  chain.call(() => { throw new Error('boom'); });
  chain.to(0, 1, 0.5, () => { afterCall++; });
  chain.start();
  chain.update(0.5);
  assert.ok(afterCall > 0);
});

test('tween-chain: step advances span the dt across multiple steps', () => {
  const chain = TweenChain.create();
  const samples: { idx: number; v: number }[] = [];
  chain.to(0, 1, 0.1, (v) => samples.push({ idx: 0, v }));
  chain.to(1, 2, 0.1, (v) => samples.push({ idx: 1, v }));
  chain.to(2, 3, 0.1, (v) => samples.push({ idx: 2, v }));
  chain.start();
  chain.update(0.35); // larger than total 0.3 - wraps
  assert.equal(chain.hasCompleted(), true);
  // We saw all three steps progress.
  const idxs = samples.map((s) => s.idx);
  assert.ok(idxs.indexOf(0) >= 0);
  assert.ok(idxs.indexOf(1) >= 0);
  assert.ok(idxs.indexOf(2) >= 0);
});

test('tween-chain: chained API returns the same instance for fluency', () => {
  const chain = TweenChain.create();
  const result = chain
    .to(0, 1, 0.5, () => {})
    .delay(0.5)
    .call(() => {})
    .to(1, 0, 0.5, () => {});
  assert.equal(result, chain);
});

test('tween-chain: NaN dt is ignored', () => {
  const chain = TweenChain.create();
  let calls = 0;
  chain.to(0, 1, 0.5, () => calls++);
  chain.start();
  chain.update(NaN);
  assert.equal(calls, 0);
});

test('tween-chain: negative dt is ignored', () => {
  const chain = TweenChain.create();
  let calls = 0;
  chain.to(0, 1, 0.5, () => calls++);
  chain.start();
  chain.update(-1);
  assert.equal(calls, 0);
});

test('tween-chain: re-start resets callback fired state so callbacks fire again', () => {
  const chain = TweenChain.create();
  let cbFires = 0;
  chain.call(() => { cbFires++; });
  chain.to(0, 1, 0.5, () => {});
  chain.start();
  chain.update(0.5);
  assert.equal(cbFires, 1);
  chain.start();
  chain.update(0.5);
  assert.equal(cbFires, 2);
});

test('tween-chain: tween after delay starts at correct from value', () => {
  const chain = TweenChain.create();
  const samples: number[] = [];
  chain.delay(0.5);
  chain.to(0, 100, 0.5, (v) => samples.push(v));
  chain.start();
  chain.update(0.5); // delay ends
  chain.update(0.5); // tween completes
  assert.equal(samples[samples.length - 1], 100);
});
