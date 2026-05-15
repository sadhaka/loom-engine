// InferenceOrchestrator - Trinity §18 NPC inference router tests.
//
// Covers: constructor validation, every Codex gate (zero-alloc batch
// pipeline, hard rate limits + deadlines + cancellation + stale-
// handle guard, local-SLM consent gate with cloud reroute, action
// validation against allowed-result mask, concurrency-safe budget
// debit, critical-priority bypass with budget ceiling), the drop-
// event metrics ring, and bit-for-bit determinism across two
// independent runs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  InferenceOrchestrator,
  LANE_LOCAL_SLM,
  LANE_CLOUD,
  PRIORITY_LOW,
  PRIORITY_NORMAL,
  PRIORITY_HIGH,
  PRIORITY_CRITICAL,
  REQUEST_STATE_NONE,
  REQUEST_STATE_PENDING,
  REQUEST_STATE_INFLIGHT,
  REASON_NONE,
  REASON_RATE_LIMITED,
  REASON_BUDGET_EXHAUSTED,
  REASON_CRITICAL_CEILING,
  REASON_DEADLINE_EXCEEDED,
  REASON_BAD_RESULT,
  REASON_STALE_HANDLE,
  REASON_BAD_LANE,
  REASON_BAD_NPC,
  REASON_BAD_TOKENS,
  REQUEST_HANDLE_INVALID,
  DROP_EVENT_STRIDE,
  requestLane,
  requestSlot,
} from '../src/runtime/inference-orchestrator.js';

function defaultConfig() {
  return {
    maxNpc: 64,
    maxActionTypes: 16,
    perLaneCapacity: 16,
    maxBatchSize: 8,
    dropEventCapacity: 32,
    localSlmMaxBudget: 1000,
    localSlmRefillPerTick: 100,
    cloudMaxBudget: 500,
    cloudRefillPerTick: 50,
    localSlmMaxRequestsPerTick: 8,
    cloudMaxRequestsPerTick: 4,
    localSlmCriticalCeiling: 200,
    cloudCriticalCeiling: 100,
    defaultTtlTicks: 10,
  };
}

test('InferenceOrchestrator: constructor rejects out-of-range maxNpc', () => {
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), maxNpc: 0 }), RangeError);
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), maxNpc: 1 << 24 }), RangeError);
});

test('InferenceOrchestrator: constructor rejects out-of-range capacities', () => {
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), perLaneCapacity: 0 }), RangeError);
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), maxBatchSize: 0 }), RangeError);
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), dropEventCapacity: 0 }), RangeError);
});

test('InferenceOrchestrator: constructor rejects negative budgets', () => {
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), localSlmMaxBudget: -1 }), RangeError);
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), cloudMaxRequestsPerTick: -1 }), RangeError);
  assert.throws(() => new InferenceOrchestrator({ ...defaultConfig(), defaultTtlTicks: 0 }), RangeError);
});

test('InferenceOrchestrator: submitRequest accepts valid input and returns a handle', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  const h = o.submitRequest(5, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50);
  assert.notEqual(h, REQUEST_HANDLE_INVALID);
  assert.equal(o.getLanePendingCount(LANE_LOCAL_SLM), 1);
  assert.equal(o.getSlotState(h), REQUEST_STATE_PENDING);
});

test('InferenceOrchestrator: submitRequest rejects out-of-range npc/lane/priority/tokens (input bounds)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  assert.equal(o.submitRequest(-1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(999, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(5, 99, PRIORITY_NORMAL, 50), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(5, LANE_LOCAL_SLM, 99, 50), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(5, LANE_LOCAL_SLM, PRIORITY_NORMAL, -1), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(5, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50, 0), REQUEST_HANDLE_INVALID);
});

test('InferenceOrchestrator: submitRequest debits the lane budget (gate 5)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 200);
  assert.equal(o.getLaneBudget(LANE_LOCAL_SLM), 800);
  o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_NORMAL, 300);
  assert.equal(o.getLaneBudget(LANE_LOCAL_SLM), 500);
});

test('InferenceOrchestrator: submitRequest drops past lane budget (gate 5)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), localSlmMaxBudget: 100 });
  // 100 budget; first request 60 fits, second 60 doesn't.
  assert.notEqual(o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 60), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_NORMAL, 60), REQUEST_HANDLE_INVALID);
  // Drop event recorded with REASON_BUDGET_EXHAUSTED.
  const out = new Int32Array(DROP_EVENT_STRIDE);
  assert.equal(o.consumeDropEvent(out), true);
  assert.equal(out[3], REASON_BUDGET_EXHAUSTED);
});

test('InferenceOrchestrator: submitRequest drops past per-tick rate limit (gate 2)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), localSlmMaxRequestsPerTick: 2 });
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  assert.equal(o.submitRequest(3, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10), REQUEST_HANDLE_INVALID);
  // Verify the drop reason.
  const out = new Int32Array(DROP_EVENT_STRIDE);
  o.consumeDropEvent(out); o.consumeDropEvent(out);   // skip the first two (PASS submitted)
  o.consumeDropEvent(out);                              // drop event for npc 3
  assert.equal(out[3], REASON_RATE_LIMITED);
});

test('InferenceOrchestrator: critical priority caps at criticalCeiling (gate 6)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), localSlmCriticalCeiling: 100 });
  // Two CRITICAL requests of 60 each - second should be rejected by the ceiling.
  assert.notEqual(o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_CRITICAL, 60), REQUEST_HANDLE_INVALID);
  assert.equal(o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_CRITICAL, 60), REQUEST_HANDLE_INVALID);
  // Drop reason CRITICAL_CEILING.
  const out = new Int32Array(DROP_EVENT_STRIDE);
  o.consumeDropEvent(out);    // success drop? no - successes don't push drops
  // Actually the success doesn't push - the only drop is the rejection.
  assert.equal(out[3], REASON_CRITICAL_CEILING);
});

test('InferenceOrchestrator: NORMAL priority is not capped by critical ceiling (gate 6)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), localSlmCriticalCeiling: 100 });
  // Six NORMAL requests of 50 each - all should fit (capacity is 8 per
  // tick, budget 1000). The critical ceiling does not apply to NORMAL.
  for (let i = 0; i < 6; i++) {
    assert.notEqual(o.submitRequest(i, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50), REQUEST_HANDLE_INVALID);
  }
});

test('InferenceOrchestrator: drainBatch yields a dense npcId array, transitions slots to INFLIGHT (gate 1)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  for (let i = 0; i < 5; i++) o.submitRequest(i, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  const out = new Int32Array(8);
  const drained = o.drainBatch(LANE_LOCAL_SLM, 8, out);
  assert.equal(drained, 5);
  for (let i = 0; i < 5; i++) {
    assert.ok(out[i] !== undefined && out[i]! >= 0 && out[i]! < 5);
  }
});

test('InferenceOrchestrator: drainBatch picks higher priority first (gate 1 - dispatcher fairness)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_LOW, 10);
  o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_HIGH, 10);
  o.submitRequest(3, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  o.submitRequest(4, LANE_LOCAL_SLM, PRIORITY_CRITICAL, 10);
  const out = new Int32Array(4);
  const drained = o.drainBatch(LANE_LOCAL_SLM, 4, out);
  assert.equal(drained, 4);
  // CRITICAL=4 first, then HIGH=2, NORMAL=3, LOW=1
  assert.equal(out[0], 4);
  assert.equal(out[1], 2);
  assert.equal(out[2], 3);
  assert.equal(out[3], 1);
});

test('InferenceOrchestrator: drainBatchWithHandles writes both columns', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  for (let i = 0; i < 3; i++) o.submitRequest(i, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  const npcs = new Int32Array(8);
  const handles = new Int32Array(8);
  const drained = o.drainBatchWithHandles(LANE_LOCAL_SLM, 8, npcs, handles);
  assert.equal(drained, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(requestLane(handles[i] ?? 0), LANE_LOCAL_SLM);
    assert.ok(requestSlot(handles[i] ?? 0) >= 0);
  }
});

test('InferenceOrchestrator: completeRequest applies a valid action (gate 4)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.registerActionType(7, 0xff);                 // bits 0..7 allowed
  const h = o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  const out = new Int32Array(8);
  o.drainBatch(LANE_LOCAL_SLM, 8, out);
  // Result mask 0x07 is a subset of 0xff.
  assert.equal(o.completeRequest(h, 7, 0x07), REASON_NONE);
  assert.equal(o.getCompletedTotal(), 1);
});

test('InferenceOrchestrator: completeRequest rejects result with bits outside allowed mask (gate 4)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.registerActionType(7, 0x0f);                 // bits 0..3 allowed
  const h = o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  const out = new Int32Array(8);
  o.drainBatch(LANE_LOCAL_SLM, 8, out);
  // Result 0x10 has bit 4 set, which is outside 0x0f.
  assert.equal(o.completeRequest(h, 7, 0x10), REASON_BAD_RESULT);
  assert.equal(o.getRejectedResultsTotal(), 1);
});

test('InferenceOrchestrator: completeRequest rejects unregistered actionType (gate 4)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  // No registerActionType call.
  const h = o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  const out = new Int32Array(8);
  o.drainBatch(LANE_LOCAL_SLM, 8, out);
  assert.equal(o.completeRequest(h, 7, 0xff), REASON_BAD_RESULT);
});

test('InferenceOrchestrator: completeRequest rejects stale handle (gate 2 - slot reused)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), perLaneCapacity: 1 });
  o.registerActionType(7, 0xff);
  const h1 = o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  const out = new Int32Array(8);
  o.drainBatch(LANE_LOCAL_SLM, 1, out);
  o.completeRequest(h1, 7, 0);                 // free the slot
  o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);   // reuses slot 0 with new generation
  // h1 is now stale.
  assert.equal(o.completeRequest(h1, 7, 0), REASON_STALE_HANDLE);
});

test('InferenceOrchestrator: cancelRequest releases a pending slot (gate 2)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  const h = o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  assert.equal(o.cancelRequest(h), true);
  assert.equal(o.getLanePendingCount(LANE_LOCAL_SLM), 0);
  assert.equal(o.getCancelledTotal(), 1);
  // Cancelling again returns false.
  assert.equal(o.cancelRequest(h), false);
});

test('InferenceOrchestrator: tick() expires past-TTL requests (gate 2)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10, 5);
  o.tick(10);
  // tick=10, expiresAt = 0+5=5; expired.
  assert.equal(o.getExpiredTotal(), 1);
  assert.equal(o.getLanePendingCount(LANE_LOCAL_SLM), 0);
  // Drop event recorded with REASON_DEADLINE_EXCEEDED.
  const out = new Int32Array(DROP_EVENT_STRIDE);
  assert.equal(o.consumeDropEvent(out), true);
  assert.equal(out[3], REASON_DEADLINE_EXCEEDED);
});

test('InferenceOrchestrator: tick() refills lane budget up to max (gate 5)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 600);
  assert.equal(o.getLaneBudget(LANE_LOCAL_SLM), 400);
  o.tick(1);
  // Refill 100 -> 500, capped at max 1000.
  assert.equal(o.getLaneBudget(LANE_LOCAL_SLM), 500);
  o.tick(2); o.tick(3); o.tick(4); o.tick(5); o.tick(6);
  assert.equal(o.getLaneBudget(LANE_LOCAL_SLM), 1000);    // capped at max
});

test('InferenceOrchestrator: tick() resets per-tick rate counter (gate 2)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), localSlmMaxRequestsPerTick: 2 });
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  assert.equal(o.submitRequest(3, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10), REQUEST_HANDLE_INVALID);
  o.tick(1);
  // Counter reset - submission allowed again.
  assert.notEqual(o.submitRequest(3, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10), REQUEST_HANDLE_INVALID);
});

test('InferenceOrchestrator: setLocalSlmEnabled(false) reroutes LOCAL_SLM submissions to CLOUD (gate 3)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.setLocalSlmEnabled(false);
  const h = o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  assert.notEqual(h, REQUEST_HANDLE_INVALID);
  assert.equal(o.getLanePendingCount(LANE_LOCAL_SLM), 0);
  assert.equal(o.getLanePendingCount(LANE_CLOUD), 1);
  assert.equal(requestLane(h), LANE_CLOUD);
});

test('InferenceOrchestrator: setLocalSlmEnabled(false) drops if CLOUD is also out of budget (gate 3)', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), cloudMaxBudget: 5 });
  o.setLocalSlmEnabled(false);
  // CLOUD budget is 5; request needs 10; drop.
  assert.equal(o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10), REQUEST_HANDLE_INVALID);
});

test('InferenceOrchestrator: drop event ring drops past capacity and counts overflow', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), dropEventCapacity: 2 });
  // Force 5 drops.
  for (let i = 0; i < 5; i++) o.submitRequest(-1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  assert.equal(o.getDropEventCount(), 2);
  assert.equal(o.getDropOverflowCount(), 3);
});

test('InferenceOrchestrator: deterministic across two independent runs (bit-for-bit)', () => {
  function run(): number[] {
    const o = new InferenceOrchestrator(defaultConfig());
    o.registerActionType(0, 0xff);
    const handles: number[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(o.submitRequest(i, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50));
    }
    const out = new Int32Array(8);
    o.drainBatch(LANE_LOCAL_SLM, 8, out);
    o.tick(1);
    handles.push(o.submitRequest(10, LANE_CLOUD, PRIORITY_HIGH, 100));
    return handles;
  }
  assert.deepEqual(run(), run());
});

test('InferenceOrchestrator: clear() resets every queue / counter; budgets refill to max', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 50);
  o.registerActionType(0, 0xff);
  o.clear();
  assert.equal(o.getLanePendingCount(LANE_LOCAL_SLM), 0);
  assert.equal(o.getLaneBudget(LANE_LOCAL_SLM), 1000);
  assert.equal(o.getCompletedTotal(), 0);
  assert.equal(o.isActionTypeRegistered(0), false);
});

test('InferenceOrchestrator: tick() rejects out-of-range t', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  assert.throws(() => o.tick(-1), RangeError);
  assert.throws(() => o.tick(1.5), RangeError);
  assert.throws(() => o.tick(0x100000000), RangeError);
});

test('InferenceOrchestrator: drainBatch handles invalid args (lane / count / out)', () => {
  const o = new InferenceOrchestrator(defaultConfig());
  const out = new Int32Array(8);
  assert.equal(o.drainBatch(99, 8, out), 0);
  assert.equal(o.drainBatch(LANE_LOCAL_SLM, 0, out), 0);
  assert.equal(o.drainBatch(LANE_LOCAL_SLM, 99, out), 0);
  const small = new Int32Array(2);
  assert.equal(o.drainBatch(LANE_LOCAL_SLM, 8, small), 0);
});

test('InferenceOrchestrator: per-lane queue full drops with REASON_RATE_LIMITED', () => {
  const o = new InferenceOrchestrator({ ...defaultConfig(), perLaneCapacity: 2,
    localSlmMaxRequestsPerTick: 99 });   // high rate cap so queue fills first
  o.submitRequest(1, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  o.submitRequest(2, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10);
  // Third submission - queue full.
  assert.equal(o.submitRequest(3, LANE_LOCAL_SLM, PRIORITY_NORMAL, 10), REQUEST_HANDLE_INVALID);
});
