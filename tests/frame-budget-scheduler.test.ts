// Phase 0.36.0 - FrameBudgetScheduler tests.
//
// Strategy: a deterministic clock closure replaces performance.now()
// so tests can simulate budget exhaustion without wall-time waits.
// Each step() advances the clock by a known amount and returns
// done / not-done.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  FrameBudgetScheduler,
  RESOURCE_FRAME_BUDGET_SCHEDULER,
  type FrameBudgetStats,
} from '../src/index.js';

// Build a virtual clock + a step factory that advances the clock by
// `costMs` each invocation and returns true after `iterations` calls.
function makeClock() {
  var t = 0;
  return {
    now: function (): number { return t; },
    advance: function (ms: number): void { t += ms; },
    set: function (ms: number): void { t = ms; },
  };
}

function stepCosting(
  clock: { advance: (ms: number) => void },
  costMs: number,
  iterations: number,
): { step: () => boolean; runs: number[] } {
  var runs: number[] = [];
  var calls = 0;
  return {
    step: function (): boolean {
      calls++;
      runs.push(calls);
      clock.advance(costMs);
      return calls >= iterations;
    },
    runs: runs,
  };
}

test('frame-budget: RESOURCE_FRAME_BUDGET_SCHEDULER is the stable string', () => {
  assert.equal(RESOURCE_FRAME_BUDGET_SCHEDULER, 'frame_budget_scheduler');
});

test('frame-budget: defaults to 8ms budget', () => {
  const sched = FrameBudgetScheduler.create();
  assert.equal(sched.getBudgetMs(), 8);
});

test('frame-budget: empty queue tick returns zeroed stats', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  const stats: FrameBudgetStats = sched.tick();
  assert.equal(stats.ranCount, 0);
  assert.equal(stats.completedCount, 0);
  assert.equal(stats.pendingCount, 0);
  assert.equal(stats.overBudget, false);
});

test('frame-budget: schedule + tick runs the step', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  const t = stepCosting(clock, 1, 1);
  sched.schedule({ id: 'a', step: t.step });
  const stats = sched.tick();
  assert.equal(stats.ranCount, 1);
  assert.equal(stats.completedCount, 1);
  assert.equal(t.runs.length, 1);
  assert.equal(sched.has('a'), false);
});

test('frame-budget: step returning false stays for next tick', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  const t = stepCosting(clock, 1, 3);
  sched.schedule({ id: 'a', step: t.step });
  sched.tick();
  assert.equal(sched.has('a'), true);
  assert.equal(t.runs.length, 1);
  sched.tick();
  assert.equal(t.runs.length, 2);
  sched.tick();
  assert.equal(t.runs.length, 3);
  assert.equal(sched.has('a'), false);
});

test('frame-budget: budget exceeded stops queueing more steps', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 5 });
  // Three tasks each costing 3ms - second step blows the budget.
  const a = stepCosting(clock, 3, 1);
  const b = stepCosting(clock, 3, 1);
  const c = stepCosting(clock, 3, 1);
  sched.schedule({ id: 'a', step: a.step });
  sched.schedule({ id: 'b', step: b.step });
  sched.schedule({ id: 'c', step: c.step });
  const stats = sched.tick();
  // a runs (clock 0 -> 3, still under deadline 5).
  // After a: clock=3, deadline=5 -> b runs (clock 3 -> 6).
  // After b: clock=6, deadline=5 -> over budget; c does not run.
  assert.equal(a.runs.length, 1);
  assert.equal(b.runs.length, 1);
  assert.equal(c.runs.length, 0);
  assert.equal(stats.overBudget, true);
  assert.equal(stats.pendingCount, 1);
});

test('frame-budget: cancel removes pending task + fires onCancel', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now });
  let canceled = false;
  sched.schedule({
    id: 'a',
    step: () => true,
    onCancel: () => { canceled = true; },
  });
  const result = sched.cancel('a');
  assert.equal(result, true);
  assert.equal(canceled, true);
  assert.equal(sched.has('a'), false);
  // Tick: nothing left to run.
  const stats = sched.tick();
  assert.equal(stats.ranCount, 0);
});

test('frame-budget: cancel unknown id returns false', () => {
  const sched = FrameBudgetScheduler.create();
  assert.equal(sched.cancel('missing'), false);
});

test('frame-budget: onComplete fires once when step returns true', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  let completed = 0;
  const t = stepCosting(clock, 1, 1);
  sched.schedule({
    id: 'a',
    step: t.step,
    onComplete: () => { completed++; },
  });
  sched.tick();
  assert.equal(completed, 1);
  // Re-tick: empty queue, no extra fires.
  sched.tick();
  assert.equal(completed, 1);
});

test('frame-budget: priority - higher runs first', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  const order: string[] = [];
  sched.schedule({ id: 'low', priority: 0, step: () => { order.push('low'); return true; } });
  sched.schedule({ id: 'high', priority: 10, step: () => { order.push('high'); return true; } });
  sched.schedule({ id: 'mid', priority: 5, step: () => { order.push('mid'); return true; } });
  sched.tick();
  assert.deepEqual(order, ['high', 'mid', 'low']);
});

test('frame-budget: same priority - FIFO ordering', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  const order: string[] = [];
  sched.schedule({ id: 'a', step: () => { order.push('a'); return true; } });
  sched.schedule({ id: 'b', step: () => { order.push('b'); return true; } });
  sched.schedule({ id: 'c', step: () => { order.push('c'); return true; } });
  sched.tick();
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('frame-budget: schedule without id assigns synthetic monotonic id', () => {
  const sched = FrameBudgetScheduler.create();
  const id1 = sched.schedule({ step: () => true });
  const id2 = sched.schedule({ step: () => true });
  assert.notEqual(id1, id2);
  assert.match(id1, /^task#\d+$/);
  assert.match(id2, /^task#\d+$/);
});

test('frame-budget: re-scheduling an existing id replaces the task', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  let firstRan = false;
  let secondRan = false;
  sched.schedule({ id: 'x', step: () => { firstRan = true; return true; } });
  sched.schedule({ id: 'x', step: () => { secondRan = true; return true; } });
  sched.tick();
  // Only the second registration ran; first was replaced silently.
  assert.equal(firstRan, false);
  assert.equal(secondRan, true);
});

test('frame-budget: setBudgetMs updates the budget for the next tick', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 1 });
  sched.setBudgetMs(50);
  assert.equal(sched.getBudgetMs(), 50);
});

test('frame-budget: setBudgetMs ignores non-positive values', () => {
  const sched = FrameBudgetScheduler.create({ budgetMs: 16 });
  sched.setBudgetMs(0);
  assert.equal(sched.getBudgetMs(), 16);
  sched.setBudgetMs(-5);
  assert.equal(sched.getBudgetMs(), 16);
});

test('frame-budget: stats.spentMs reflects the wall time inside step calls', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 100 });
  sched.schedule({ id: 'a', step: () => { clock.advance(7); return true; } });
  sched.schedule({ id: 'b', step: () => { clock.advance(3); return true; } });
  const stats = sched.tick();
  assert.equal(stats.spentMs, 10);
});

test('frame-budget: throwing step drops the task without onComplete', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  let completedFired = false;
  let cancelFired = false;
  sched.schedule({
    id: 'boom',
    step: () => { throw new Error('boom'); },
    onComplete: () => { completedFired = true; },
    onCancel: () => { cancelFired = true; },
  });
  const stats = sched.tick();
  assert.equal(stats.ranCount, 1);
  assert.equal(sched.has('boom'), false);
  // Neither callback fires - it was neither a clean complete nor a
  // user-driven cancel.
  assert.equal(completedFired, false);
  assert.equal(cancelFired, false);
});

test('frame-budget: flush drains everything ignoring budget', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 1 });
  let aRuns = 0;
  let bRuns = 0;
  sched.schedule({ id: 'a', step: () => { clock.advance(10); aRuns++; return true; } });
  sched.schedule({ id: 'b', step: () => { clock.advance(10); bRuns++; return true; } });
  const stats = sched.flush();
  assert.equal(aRuns, 1);
  assert.equal(bRuns, 1);
  assert.equal(stats.completedCount, 2);
  assert.equal(stats.pendingCount, 0);
  // overBudget is meaningless for flush; it always returns false.
  assert.equal(stats.overBudget, false);
});

test('frame-budget: dispose cancels remaining tasks and stops further work', () => {
  const sched = FrameBudgetScheduler.create();
  let canceledA = false;
  let canceledB = false;
  sched.schedule({ id: 'a', step: () => true, onCancel: () => { canceledA = true; } });
  sched.schedule({ id: 'b', step: () => true, onCancel: () => { canceledB = true; } });
  sched.dispose();
  assert.equal(canceledA, true);
  assert.equal(canceledB, true);
  // Subsequent operations no-op.
  const id = sched.schedule({ id: 'c', step: () => true });
  assert.equal(id, '');
  assert.equal(sched.has('c'), false);
  const stats = sched.tick();
  assert.equal(stats.ranCount, 0);
});

test('frame-budget: progressive task across multiple ticks completes', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  let progress = 0;
  const total = 5;
  sched.schedule({
    id: 'big',
    step: () => {
      clock.advance(2);
      progress++;
      return progress >= total;
    },
  });
  // Each tick advances clock by 2; budget is 16 - plenty of room
  // for one step. Run 5 ticks.
  sched.tick();
  sched.tick();
  sched.tick();
  sched.tick();
  sched.tick();
  assert.equal(progress, total);
  assert.equal(sched.has('big'), false);
});

test('frame-budget: stats.pendingCount reflects queue after the tick', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 1 });
  sched.schedule({ id: 'a', step: () => { clock.advance(2); return true; } });
  sched.schedule({ id: 'b', step: () => { clock.advance(2); return true; } });
  sched.schedule({ id: 'c', step: () => { clock.advance(2); return true; } });
  // First step costs 2ms; deadline = 1ms; second-step gate sees over
  // budget. So one runs, two carry over.
  const stats = sched.tick();
  assert.equal(stats.completedCount, 1);
  assert.equal(stats.pendingCount, 2);
});

test('frame-budget: cancel during next-tick continuation removes step from queue', () => {
  const clock = makeClock();
  const sched = FrameBudgetScheduler.create({ now: clock.now, budgetMs: 16 });
  let count = 0;
  sched.schedule({
    id: 'a',
    step: () => { count++; return false; },
  });
  sched.tick();
  assert.equal(count, 1);
  // Cancel before second tick.
  const ok = sched.cancel('a');
  assert.equal(ok, true);
  sched.tick();
  // Step did not run a second time.
  assert.equal(count, 1);
});

test('frame-budget: completed task is not in byId map post-tick', () => {
  const sched = FrameBudgetScheduler.create();
  sched.schedule({ id: 'fin', step: () => true });
  assert.equal(sched.has('fin'), true);
  sched.tick();
  assert.equal(sched.has('fin'), false);
});

test('frame-budget: pendingCount reflects count regardless of priority', () => {
  const sched = FrameBudgetScheduler.create();
  sched.schedule({ id: 'a', priority: 1, step: () => false });
  sched.schedule({ id: 'b', priority: 2, step: () => false });
  sched.schedule({ id: 'c', priority: 3, step: () => false });
  assert.equal(sched.pendingCount(), 3);
});
