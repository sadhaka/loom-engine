// Loom Engine - CognitiveMap (HTN planner) tests.
//
// Covers constructor + capacity validation, the domain definition
// surface (definePrimitive / defineMethod / finalize), state get/set,
// the planner happy path (linear plans, nested decomposition), method
// backtracking with full state rollback (gate 4), the step budget
// (gate 6), the plan generation counter (gate 5), failure provenance
// (gate 7), the goal queue + runScheduler priority order, and a
// realistic crafting capstone.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { CognitiveMap } from '../src/index.js';

// Roomy capacity defaults so individual tests do not have to repeat
// every option.
function generousOpts(taskCount: number, methodCount: number): {
  stateSize: number; taskCount: number; methodCount: number;
  totalMethodSubtasks: number; totalMethodPreconds: number;
  totalPrimPreconds: number; totalPrimEffects: number;
  maxStackDepth: number; maxDecisionDepth: number;
  maxUndoLog: number; maxPlanLength: number;
} {
  return {
    stateSize: 16,
    taskCount: taskCount,
    methodCount: methodCount,
    totalMethodSubtasks: 64,
    totalMethodPreconds: 32,
    totalPrimPreconds: 32,
    totalPrimEffects: 32,
    maxStackDepth: 64,
    maxDecisionDepth: 16,
    maxUndoLog: 64,
    maxPlanLength: 32,
  };
}

test('cognitive map: constructor validates every capacity', () => {
  const m = new CognitiveMap(generousOpts(4, 1));
  assert.equal(m.stateSize, 16);
  assert.equal(m.taskCount, 4);
  assert.equal(m.methodCount, 1);
  assert.equal(m.maxQueuedGoals, 16);
  assert.equal(m.queuedGoalCount(), 0);
  assert.throws(
    () => new CognitiveMap({ ...generousOpts(4, 1), stateSize: 0 }),
    /stateSize/,
  );
  assert.throws(
    () => new CognitiveMap({ ...generousOpts(4, 1), taskCount: -1 }),
    /taskCount/,
  );
  assert.throws(
    () => new CognitiveMap({ ...generousOpts(4, 1), maxStackDepth: 0 }),
    /maxStackDepth/,
  );
});

test('cognitive map: a simple linear method produces the expected plan', () => {
  const m = new CognitiveMap(generousOpts(5, 1));
  for (let i = 0; i < 4; i++) {
    m.definePrimitive(i, { effects: [{ slot: i, value: 1 }] });
  }
  m.defineMethod({ taskId: 4, subtasks: [0, 1, 2, 3] });
  m.finalize();

  const r = m.findPlan(4, 100);
  assert.ok(r.ok);
  assert.equal(r.planLength, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(m.planStep(i), i);
    assert.equal(m.getState(i), 1);
  }
});

test('cognitive map: a primitive whose precondition fails is unplannable', () => {
  const m = new CognitiveMap(generousOpts(2, 0));
  // primitive 0 needs state[0] >= 1; the world is fresh (all zero).
  m.definePrimitive(0, { preconds: [{ slot: 0, value: 1 }] });
  m.finalize();

  const r = m.findPlan(0, 10);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'no_plan');
  assert.equal(r.ok ? -1 : r.failedTaskId, 0);
});

test('cognitive map: nested compound decomposition flattens to a linear plan', () => {
  // compound 5 -> [compound 4, primitive 3]
  // compound 4 -> [primitive 0, primitive 1, primitive 2]
  const m = new CognitiveMap(generousOpts(6, 2));
  for (let i = 0; i < 4; i++) {
    m.definePrimitive(i, { effects: [{ slot: i, value: 1 }] });
  }
  m.defineMethod({ taskId: 4, subtasks: [0, 1, 2] });
  m.defineMethod({ taskId: 5, subtasks: [4, 3] });
  m.finalize();

  const r = m.findPlan(5, 100);
  assert.ok(r.ok);
  assert.equal(r.planLength, 4);
  for (let i = 0; i < 4; i++) assert.equal(m.planStep(i), i);
});

test('cognitive map: method backtracking falls through to a working alternative (gate 4)', () => {
  // setA primitive (no precond, sets state[0])
  // setB primitive (no precond, sets state[1])
  // failOp primitive (precond state[9] >= 1, sets state[2]) - never satisfiable
  // setC primitive (no precond, sets state[3])
  // compound 4: method 0 = [setA, setB, failOp]; method 1 = [setC]
  const m = new CognitiveMap(generousOpts(5, 2));
  m.definePrimitive(0, { effects: [{ slot: 0, value: 1 }] });
  m.definePrimitive(1, { effects: [{ slot: 1, value: 1 }] });
  m.definePrimitive(2, { preconds: [{ slot: 9, value: 1 }], effects: [{ slot: 2, value: 1 }] });
  m.definePrimitive(3, { effects: [{ slot: 3, value: 1 }] });
  m.defineMethod({ taskId: 4, subtasks: [0, 1, 2] });
  m.defineMethod({ taskId: 4, subtasks: [3] });
  m.finalize();

  const r = m.findPlan(4, 100);
  assert.ok(r.ok);
  // Method 1 was used - plan is just setC.
  assert.equal(r.planLength, 1);
  assert.equal(m.planStep(0), 3);
  // setA and setB effects from the failed method 0 were rolled back.
  assert.equal(m.getState(0), 0);
  assert.equal(m.getState(1), 0);
  // setC's effect from method 1 stuck.
  assert.equal(m.getState(3), 1);
});

test('cognitive map: a no_plan failure leaves the world bit-identical (gate 4)', () => {
  // The only method requires a primitive whose precond can never be met,
  // so backtracking exhausts and the world must be restored to the
  // pre-call snapshot.
  const m = new CognitiveMap(generousOpts(3, 1));
  m.definePrimitive(0, { effects: [{ slot: 0, value: 7 }] });             // sets slot 0 to 7
  m.definePrimitive(1, { preconds: [{ slot: 5, value: 1 }] });           // unsatisfiable
  m.defineMethod({ taskId: 2, subtasks: [0, 1] });                        // applies 0 then trips 1
  m.finalize();

  m.setState(0, 3);   // pre-existing state we want preserved
  const r = m.findPlan(2, 100);
  assert.equal(r.ok, false);
  // World restored: slot 0 is back to 3, not 7.
  assert.equal(m.getState(0), 3);
});

test('cognitive map: backtracking unwinds an inner decomposition past a failed sibling', () => {
  // compound 5 -> [compound 4, fail]   (method 0)
  // compound 5 -> [doneFlag]           (method 1)
  // compound 4 -> [pA, pB]             (the inner decomposition that runs first)
  // After the inner runs and the outer's `fail` trips, backtracking
  // must roll back BOTH inner primitives' effects AND retry compound 5
  // with method 1.
  const m = new CognitiveMap(generousOpts(6, 3));
  m.definePrimitive(0, { effects: [{ slot: 0, value: 1 }] });            // pA
  m.definePrimitive(1, { effects: [{ slot: 1, value: 1 }] });            // pB
  m.definePrimitive(2, { preconds: [{ slot: 9, value: 1 }] });           // fail (unsatisfiable)
  m.definePrimitive(3, { effects: [{ slot: 3, value: 1 }] });            // doneFlag
  m.defineMethod({ taskId: 4, subtasks: [0, 1] });                        // inner
  m.defineMethod({ taskId: 5, subtasks: [4, 2] });                        // outer method 0
  m.defineMethod({ taskId: 5, subtasks: [3] });                           // outer method 1
  m.finalize();

  const r = m.findPlan(5, 100);
  assert.ok(r.ok);
  assert.equal(r.planLength, 1);
  assert.equal(m.planStep(0), 3);
  // pA and pB were rolled back through the inner decomposition.
  assert.equal(m.getState(0), 0);
  assert.equal(m.getState(1), 0);
  assert.equal(m.getState(3), 1);
});

test('cognitive map: stepBudget caps iterations and rolls state back (gate 6)', () => {
  const opts = generousOpts(11, 1);
  opts.stateSize = 10;
  opts.totalMethodSubtasks = 10;
  opts.totalPrimEffects = 10;
  const m = new CognitiveMap(opts);
  for (let i = 0; i < 10; i++) {
    m.definePrimitive(i, { effects: [{ slot: i, value: 1 }] });
  }
  m.defineMethod({ taskId: 10, subtasks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  m.finalize();

  // Budget too small to finish.
  const r = m.findPlan(10, 5);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'over_budget');
  // World restored - no slot was left set.
  for (let i = 0; i < 10; i++) assert.equal(m.getState(i), 0);

  // Generous budget succeeds.
  const r2 = m.findPlan(10, 100);
  assert.ok(r2.ok);
  assert.equal(r2.planLength, 10);
  for (let i = 0; i < 10; i++) assert.equal(m.getState(i), 1);
});

test('cognitive map: planGen monotonically increments per findPlan (gate 5)', () => {
  const m = new CognitiveMap(generousOpts(1, 0));
  m.definePrimitive(0, {});
  m.finalize();
  assert.equal(m.planGen(), 0);
  const r1 = m.findPlan(0, 10);
  assert.equal(m.planGen(), 1);
  assert.ok(r1.ok);
  assert.equal(r1.planGen, 1);
  m.findPlan(0, 10);
  assert.equal(m.planGen(), 2);
});

test('cognitive map: a failure result carries failedTaskId, depth, and planGen (gate 7)', () => {
  // compound 0 -> [primitive 1] where 1 is unsatisfiable.
  const m = new CognitiveMap(generousOpts(2, 1));
  m.definePrimitive(1, { preconds: [{ slot: 0, value: 1 }] });
  m.defineMethod({ taskId: 0, subtasks: [1] });
  m.finalize();

  const r = m.findPlan(0, 50);
  assert.equal(r.ok, false);
  if (r.ok) return;   // type narrowing
  assert.equal(r.failedTaskId, 1);
  assert.equal(r.planGen, 1);
  assert.ok(r.depth >= 0);
  // The accessor surface mirrors the result.
  assert.equal(m.failedTaskId(), 1);
  assert.equal(m.planGen(), 1);
});

test('cognitive map: redefining a task or planning before finalize throws', () => {
  const m = new CognitiveMap(generousOpts(2, 1));
  m.definePrimitive(0, {});
  assert.throws(() => m.definePrimitive(0, {}), /already defined/);
  assert.throws(
    () => m.defineMethod({ taskId: 0, subtasks: [0] }),
    /primitive/,
  );
  // findPlan before finalize.
  assert.throws(() => m.findPlan(0, 10), /finalize/);
  m.finalize();
  // After finalize, define throws.
  assert.throws(() => m.definePrimitive(1, {}), /finalized/);
  assert.throws(
    () => m.defineMethod({ taskId: 1, subtasks: [0] }),
    /finalized/,
  );
});

test('cognitive map: domain capacity overflow throws RangeError (gate 1 sizing)', () => {
  // totalPrimPreconds = 1, but two primitives want preconds.
  const opts = generousOpts(3, 1);
  opts.totalPrimPreconds = 1;
  opts.totalPrimEffects = 0;
  const m = new CognitiveMap(opts);
  m.definePrimitive(0, { preconds: [{ slot: 0, value: 1 }] });
  assert.throws(
    () => m.definePrimitive(1, { preconds: [{ slot: 0, value: 1 }] }),
    /totalPrimPreconds/,
  );
});

test('cognitive map: planner stack and decision bounds are enforced (gate 2)', () => {
  // A method whose subtask count alone exceeds the stack cap.
  const opts = generousOpts(5, 1);
  opts.maxStackDepth = 2;
  opts.totalMethodSubtasks = 8;
  opts.totalPrimEffects = 4;
  const m = new CognitiveMap(opts);
  for (let i = 0; i < 4; i++) m.definePrimitive(i, { effects: [{ slot: i, value: 1 }] });
  // 4 subtasks but maxStackDepth is 2 - tryMethod will refuse and the
  // plan fails (no other method available).
  m.defineMethod({ taskId: 4, subtasks: [0, 1, 2, 3] });
  m.finalize();
  const r = m.findPlan(4, 100);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'no_plan');
});

test('cognitive map: planner is deterministic across identical builds', () => {
  function build(): CognitiveMap {
    const m = new CognitiveMap(generousOpts(5, 2));
    for (let i = 0; i < 4; i++) m.definePrimitive(i, { effects: [{ slot: i, value: 1 }] });
    m.defineMethod({ taskId: 4, subtasks: [0, 1, 2, 3] });
    m.defineMethod({ taskId: 4, subtasks: [3, 2, 1, 0] });
    m.finalize();
    return m;
  }
  const a = build();
  const b = build();
  const ra = a.findPlan(4, 100);
  const rb = b.findPlan(4, 100);
  assert.deepEqual(ra, rb);
  assert.equal(a.planLength(), b.planLength());
  for (let i = 0; i < a.planLength(); i++) {
    assert.equal(a.planStep(i), b.planStep(i));
  }
});

test('cognitive map: runScheduler picks the highest-priority queued goal (gate 6)', () => {
  const m = new CognitiveMap(generousOpts(3, 0));
  m.definePrimitive(0, { effects: [{ slot: 0, value: 1 }] });
  m.definePrimitive(1, { effects: [{ slot: 1, value: 1 }] });
  m.definePrimitive(2, { effects: [{ slot: 2, value: 1 }] });
  m.finalize();

  assert.equal(m.enqueueGoal(0, 1), true);
  assert.equal(m.enqueueGoal(1, 9), true);
  assert.equal(m.enqueueGoal(2, 5), true);
  assert.equal(m.queuedGoalCount(), 3);

  // Highest priority (9) runs first - goal 1.
  const r1 = m.runScheduler(20);
  assert.ok(r1 && r1.ok);
  assert.equal(m.getState(1), 1);
  assert.equal(m.queuedGoalCount(), 2);

  // Then priority 5 - goal 2.
  const r2 = m.runScheduler(20);
  assert.ok(r2 && r2.ok);
  assert.equal(m.getState(2), 1);

  // Then priority 1 - goal 0.
  const r3 = m.runScheduler(20);
  assert.ok(r3 && r3.ok);
  assert.equal(m.getState(0), 1);

  // Empty queue returns null.
  assert.equal(m.runScheduler(20), null);
});

test('cognitive map: enqueueGoal rejects past the queue cap', () => {
  const opts = generousOpts(2, 0);
  const m = new CognitiveMap({ ...opts, maxQueuedGoals: 2 });
  m.definePrimitive(0, {});
  m.finalize();
  assert.equal(m.enqueueGoal(0, 1), true);
  assert.equal(m.enqueueGoal(0, 2), true);
  assert.equal(m.enqueueGoal(0, 3), false);
});

test('cognitive map: clear resets domain, state, and counters', () => {
  const m = new CognitiveMap(generousOpts(2, 0));
  m.definePrimitive(0, { effects: [{ slot: 0, value: 1 }] });
  m.finalize();
  m.findPlan(0, 10);
  assert.equal(m.planGen(), 1);
  assert.equal(m.getState(0), 1);

  m.clear();
  assert.equal(m.planGen(), 0);
  assert.equal(m.getState(0), 0);
  // Re-define with a different shape.
  m.definePrimitive(0, { effects: [{ slot: 1, value: 5 }] });
  m.finalize();
  m.findPlan(0, 10);
  assert.equal(m.getState(1), 5);
});

test('cognitive map: realistic example - a craft-a-house plan with backtracking', () => {
  // World slots: 0=wood, 1=stone, 2=hammer, 3=house, 4=gold
  // primitives:
  //   0 gatherWood        - effect wood = 1
  //   1 gatherStone       - effect stone = 1
  //   2 craftHammer       - precond wood >= 1; effect hammer = 1
  //   3 buildHouse        - precond wood >= 1, stone >= 1, hammer >= 1; effect house = 1
  //   4 buyHouse          - precond gold >= 1; effect house = 1 (the rich path)
  // compound 5 BUILD_HOUSE: method 0 = [buyHouse]; method 1 =
  //   [gatherWood, gatherStone, craftHammer, buildHouse]
  // With no gold, method 0 fails its precond and the planner falls
  // through to method 1 - the long honest path.
  const m = new CognitiveMap(generousOpts(6, 2));
  m.definePrimitive(0, { effects: [{ slot: 0, value: 1 }] });
  m.definePrimitive(1, { effects: [{ slot: 1, value: 1 }] });
  m.definePrimitive(2, { preconds: [{ slot: 0, value: 1 }], effects: [{ slot: 2, value: 1 }] });
  m.definePrimitive(3, {
    preconds: [
      { slot: 0, value: 1 },
      { slot: 1, value: 1 },
      { slot: 2, value: 1 },
    ],
    effects: [{ slot: 3, value: 1 }],
  });
  m.definePrimitive(4, { preconds: [{ slot: 4, value: 1 }], effects: [{ slot: 3, value: 1 }] });
  m.defineMethod({ taskId: 5, subtasks: [4] });
  m.defineMethod({ taskId: 5, subtasks: [0, 1, 2, 3] });
  m.finalize();

  // No gold - the planner takes the long path.
  const r1 = m.findPlan(5, 200);
  assert.ok(r1.ok);
  assert.equal(r1.planLength, 4);
  assert.equal(m.planStep(0), 0);
  assert.equal(m.planStep(1), 1);
  assert.equal(m.planStep(2), 2);
  assert.equal(m.planStep(3), 3);
  assert.equal(m.getState(3), 1);   // house built

  // Reset, hand the planner some gold - it takes the short path.
  m.clear();
  // Re-define identically.
  m.definePrimitive(0, { effects: [{ slot: 0, value: 1 }] });
  m.definePrimitive(1, { effects: [{ slot: 1, value: 1 }] });
  m.definePrimitive(2, { preconds: [{ slot: 0, value: 1 }], effects: [{ slot: 2, value: 1 }] });
  m.definePrimitive(3, {
    preconds: [
      { slot: 0, value: 1 },
      { slot: 1, value: 1 },
      { slot: 2, value: 1 },
    ],
    effects: [{ slot: 3, value: 1 }],
  });
  m.definePrimitive(4, { preconds: [{ slot: 4, value: 1 }], effects: [{ slot: 3, value: 1 }] });
  m.defineMethod({ taskId: 5, subtasks: [4] });
  m.defineMethod({ taskId: 5, subtasks: [0, 1, 2, 3] });
  m.finalize();
  m.setState(4, 1);   // we have gold

  const r2 = m.findPlan(5, 200);
  assert.ok(r2.ok);
  assert.equal(r2.planLength, 1);
  assert.equal(m.planStep(0), 4);   // bought a house
  assert.equal(m.getState(3), 1);
});
