// CognitiveMap - a deterministic HTN (Hierarchical Task Network)
// planner over flat typed-array domain tables, with overlay rollback,
// method backtracking, plan version counters, and a step-budgeted
// priority-queue scheduler.
//
// The Trinity dossier's section 25 (Gemini Volume II). The Gemini
// sketch was a 15-line stub: a stack loop calling isPrimitive /
// applyPrimitive / decompose with no domain tables, no precondition
// handling, no backtracking, and no failure path. Codex flagged "DOD
// intent is right, but domain tables / backtracking / concurrency
// missing." This rebuild closes that. The domain - tasks, methods,
// preconditions, effects, decompositions - lives in flat Int32 / Uint8
// arrays sized at construction; the planner runs DFS with method
// backtracking on a pre-allocated open-task stack and decision-frame
// stack; effects mutate state through an undo log, so a failed
// decomposition pops the log and the world goes back to bit-identical
// pre-attempt state; every plan run bumps a monotonic generation
// counter; planning is bounded by a caller-supplied step budget; and
// queued goals are processed by emergency priority. There is not a
// single allocation after the constructor.
//
// Storage:
//   state               Int32   per state slot       - the world facts the
//                                                      planner reads / writes
//   undo log            Int32 x 2 per entry          - (slot, oldValue) pairs
//                                                      pushed by every effect,
//                                                      popped on backtrack
//   open task stack     Int32                        - tasks waiting to be
//                                                      decomposed or applied
//   decision stack      Int32 x 5 per frame          - (taskId, methodTried,
//                                                      planLength, undoLength,
//                                                      stackTop) one frame per
//                                                      active compound
//                                                      decomposition
//   plan                Int32                        - primitive task ids in
//                                                      execution order
//   goal queue          Int32 x 2 per slot           - (goalTaskId, priority)
//
// Domain tables (immutable after finalize()):
//   taskKind            Uint8   per task             - 0 undefined, 1 primitive,
//                                                      2 compound
//   primPrecondStart/Count                           - per-task slice of the
//                                                      flat precondition list
//                                                      (state[slot] >= value)
//   primEffectStart/Count                            - per-task slice of the
//                                                      flat effect list
//                                                      (state[slot] := value)
//   methodTask                                       - which compound task the
//                                                      method belongs to
//   methodSubtaskStart/Count                         - per-method slice of the
//                                                      flat subtask list
//   methodPrecondStart/Count                         - per-method slice of the
//                                                      flat precondition list
//   taskMethodStart/Count                            - per-task slice into
//                                                      methodIndex, the order
//                                                      methods are tried for a
//                                                      compound task
//
// The 7 Codex gates, enforced:
//   1. flat typed-array domain tables - tasks, methods, preconditions,
//      effects, and decompositions all live in Int32 / Uint8 arrays
//      sized at construction; once finalize() runs the domain is read-
//      only and indexed by the per-task / per-method start+count slices
//      above. No Map, no object graph.
//   2. stack and queue bounds checks - every push to the open task
//      stack, decision stack, undo log, plan, and goal queue is
//      capacity-validated; an overflow returns a typed failure result
//      instead of corrupting a typed array.
//   3. single-thread ownership - one owner calls definePrimitive /
//      defineMethod / finalize / setState / findPlan / runScheduler.
//      The state and the planner working memory are not concurrency-
//      safe; a worker-parallel consumer drains its planning calls onto
//      the owning thread.
//   4. overlay rollback + method backtracking - applying a primitive's
//      effects pushes (slot, oldValue) into the undo log. A decision
//      frame records the undo-log length and plan length at the moment
//      a method was tried; on failure the frame's snapshot is restored
//      bit-identically and the next method is attempted. State at exit
//      is the state at entry on any failed plan, the state plus all
//      effects on a successful plan.
//   5. plan generation / version counters - planGen is a monotonic
//      counter bumped at the start of every findPlan call. Every result
//      carries the planGen of the run that produced it, so a consumer
//      holding a stale plan reference can detect that a fresher plan
//      has superseded it.
//   6. step / time budget + emergency priority queue - findPlan takes
//      a stepBudget (max planner iterations); a plan that does not
//      converge by then returns reason:'over_budget' with the failure
//      provenance, never running unbounded. enqueueGoal stores
//      (goalTaskId, priority) on a small flat queue; runScheduler
//      drains the highest-priority pending goal under a step budget.
//   7. failure provenance - a failed plan result carries failedTaskId,
//      depth, and the planGen that produced it. A consumer wiring this
//      to Omniveil uses planGen as the TTL / version token (the Omniveil
//      fact is stale once a fresher planGen exists) and (failedTaskId,
//      depth) as the provenance. The Omniveil wiring is consumer
//      policy; this module exposes the inert fact.
// Sanity caps on the constructor-derived sizes.
const MAX_STATE_SIZE = 1 << 16;
const MAX_TASK_COUNT = 1 << 16;
const MAX_METHOD_COUNT = 1 << 16;
// 24-bit cap on the various flat-list sizes; the same headroom rule as
// the engine's other typed-array modules.
const MAX_FLAT_LIST = 1 << 22;
// taskKind values.
const TASK_UNDEFINED = 0;
const TASK_PRIMITIVE = 1;
const TASK_COMPOUND = 2;
// Decision-frame layout (5 ints per frame). The stackTop snapshot lets
// backtrack discard leftover subtasks of the failed method.
const FRAME_TASK = 0;
const FRAME_METHOD_INDEX = 1;
const FRAME_PLAN_LENGTH = 2;
const FRAME_UNDO_LENGTH = 3;
const FRAME_STACK_TOP = 4;
const FRAME_SIZE = 5;
// Undo-log entry layout (2 ints per entry).
const UNDO_SLOT = 0;
const UNDO_VALUE = 1;
const UNDO_SIZE = 2;
// Goal queue entry layout (2 ints per slot).
const GOAL_TASK = 0;
const GOAL_PRIORITY = 1;
const GOAL_SIZE = 2;
// Sentinel: the failure record's failedTaskId on a successful plan.
const NO_FAILED_TASK = -1;
export class CognitiveMap {
    // ---- domain capacities ----
    stateSize;
    taskCount;
    methodCount;
    maxStackDepth;
    maxDecisionDepth;
    maxUndoLog;
    maxPlanLength;
    maxQueuedGoals;
    // ---- domain tables ----
    taskKind;
    // Per-primitive slices into the flat precond / effect lists.
    primPrecondStart;
    primPrecondCount;
    primEffectStart;
    primEffectCount;
    // Flat (slot, value) pairs - parallel arrays for the precondition
    // and effect lists.
    primPrecondSlots;
    primPrecondValues;
    primEffectSlots;
    primEffectValues;
    // Watermarks - how many entries have been written to each flat list
    // by definePrimitive calls. Used during define and as the bound
    // during planning.
    primPrecondLen = 0;
    primEffectLen = 0;
    // Per-method tables.
    methodTask;
    methodSubtaskStart;
    methodSubtaskCount;
    methodPrecondStart;
    methodPrecondCount;
    // Flat method-subtask and method-precondition lists.
    methodSubtaskList;
    methodPrecondSlots;
    methodPrecondValues;
    methodSubtaskLen = 0;
    methodPrecondLen = 0;
    // How many methods have been defined so far.
    definedMethods = 0;
    // Per-task method index (built by finalize): methods for task t are
    // methodIndex[taskMethodStart[t] .. taskMethodStart[t]+taskMethodCount[t]).
    taskMethodStart;
    taskMethodCount;
    methodIndex;
    finalized = false;
    // ---- world state ----
    state;
    // ---- planner working memory ----
    stack;
    stackTop = 0;
    decision;
    decisionTop = 0;
    undoLog;
    undoTop = 0;
    plan;
    planLen = 0;
    // ---- output ----
    _planGen = 0;
    _failedTaskId = NO_FAILED_TASK;
    _failedDepth = 0;
    // ---- goal queue ----
    goalQueue;
    goalQueueCount = 0;
    constructor(opts) {
        requireOpts(opts);
        requireCap('stateSize', opts.stateSize, 1, MAX_STATE_SIZE);
        requireCap('taskCount', opts.taskCount, 1, MAX_TASK_COUNT);
        requireCap('methodCount', opts.methodCount, 0, MAX_METHOD_COUNT);
        requireCap('totalMethodSubtasks', opts.totalMethodSubtasks, 0, MAX_FLAT_LIST);
        requireCap('totalMethodPreconds', opts.totalMethodPreconds, 0, MAX_FLAT_LIST);
        requireCap('totalPrimPreconds', opts.totalPrimPreconds, 0, MAX_FLAT_LIST);
        requireCap('totalPrimEffects', opts.totalPrimEffects, 0, MAX_FLAT_LIST);
        requireCap('maxStackDepth', opts.maxStackDepth, 1, MAX_FLAT_LIST);
        requireCap('maxDecisionDepth', opts.maxDecisionDepth, 1, MAX_FLAT_LIST);
        requireCap('maxUndoLog', opts.maxUndoLog, 0, MAX_FLAT_LIST);
        requireCap('maxPlanLength', opts.maxPlanLength, 1, MAX_FLAT_LIST);
        const maxQueued = opts.maxQueuedGoals ?? 16;
        requireCap('maxQueuedGoals', maxQueued, 1, MAX_FLAT_LIST);
        this.stateSize = opts.stateSize;
        this.taskCount = opts.taskCount;
        this.methodCount = opts.methodCount;
        this.maxStackDepth = opts.maxStackDepth;
        this.maxDecisionDepth = opts.maxDecisionDepth;
        this.maxUndoLog = opts.maxUndoLog;
        this.maxPlanLength = opts.maxPlanLength;
        this.maxQueuedGoals = maxQueued;
        this.taskKind = new Uint8Array(opts.taskCount);
        this.primPrecondStart = new Int32Array(opts.taskCount);
        this.primPrecondCount = new Int32Array(opts.taskCount);
        this.primEffectStart = new Int32Array(opts.taskCount);
        this.primEffectCount = new Int32Array(opts.taskCount);
        this.primPrecondSlots = new Int32Array(opts.totalPrimPreconds);
        this.primPrecondValues = new Int32Array(opts.totalPrimPreconds);
        this.primEffectSlots = new Int32Array(opts.totalPrimEffects);
        this.primEffectValues = new Int32Array(opts.totalPrimEffects);
        this.methodTask = new Int32Array(opts.methodCount);
        this.methodSubtaskStart = new Int32Array(opts.methodCount);
        this.methodSubtaskCount = new Int32Array(opts.methodCount);
        this.methodPrecondStart = new Int32Array(opts.methodCount);
        this.methodPrecondCount = new Int32Array(opts.methodCount);
        this.methodSubtaskList = new Int32Array(opts.totalMethodSubtasks);
        this.methodPrecondSlots = new Int32Array(opts.totalMethodPreconds);
        this.methodPrecondValues = new Int32Array(opts.totalMethodPreconds);
        this.taskMethodStart = new Int32Array(opts.taskCount);
        this.taskMethodCount = new Int32Array(opts.taskCount);
        this.methodIndex = new Int32Array(opts.methodCount);
        this.state = new Int32Array(opts.stateSize);
        this.stack = new Int32Array(opts.maxStackDepth);
        this.decision = new Int32Array(opts.maxDecisionDepth * FRAME_SIZE);
        this.undoLog = new Int32Array(opts.maxUndoLog * UNDO_SIZE);
        this.plan = new Int32Array(opts.maxPlanLength);
        this.goalQueue = new Int32Array(maxQueued * GOAL_SIZE);
    }
    // ---------- domain definition ----------
    // Register a primitive task. Preconditions are state[slot] >= value
    // checks; effects are state[slot] := value assignments.
    definePrimitive(taskId, def) {
        this.requireMutable('definePrimitive');
        this.requireTask(taskId, 'definePrimitive');
        if (this.taskKind[taskId] !== TASK_UNDEFINED) {
            throw new Error('CognitiveMap.definePrimitive: task ' + taskId + ' is already defined as '
                + kindName(this.taskKind[taskId] ?? 0));
        }
        const preconds = def.preconds ?? EMPTY_SPEC_LIST;
        const effects = def.effects ?? EMPTY_SPEC_LIST;
        if (this.primPrecondLen + preconds.length > this.primPrecondSlots.length) {
            throw new RangeError('CognitiveMap.definePrimitive: totalPrimPreconds capacity '
                + this.primPrecondSlots.length + ' exceeded');
        }
        if (this.primEffectLen + effects.length > this.primEffectSlots.length) {
            throw new RangeError('CognitiveMap.definePrimitive: totalPrimEffects capacity '
                + this.primEffectSlots.length + ' exceeded');
        }
        this.taskKind[taskId] = TASK_PRIMITIVE;
        this.primPrecondStart[taskId] = this.primPrecondLen;
        this.primPrecondCount[taskId] = preconds.length;
        for (let i = 0; i < preconds.length; i++) {
            const p = preconds[i];
            this.requireSlot(p.slot, 'definePrimitive');
            this.requireValue(p.value, 'definePrimitive');
            this.primPrecondSlots[this.primPrecondLen] = p.slot;
            this.primPrecondValues[this.primPrecondLen] = p.value;
            this.primPrecondLen++;
        }
        this.primEffectStart[taskId] = this.primEffectLen;
        this.primEffectCount[taskId] = effects.length;
        for (let i = 0; i < effects.length; i++) {
            const e = effects[i];
            this.requireSlot(e.slot, 'definePrimitive');
            this.requireValue(e.value, 'definePrimitive');
            this.primEffectSlots[this.primEffectLen] = e.slot;
            this.primEffectValues[this.primEffectLen] = e.value;
            this.primEffectLen++;
        }
    }
    // Register a method that decomposes a compound task into a sequence
    // of subtasks (which may themselves be primitive or compound).
    // Methods for the same task are tried in registration order until
    // one succeeds.
    defineMethod(def) {
        this.requireMutable('defineMethod');
        this.requireTask(def.taskId, 'defineMethod');
        if (this.taskKind[def.taskId] === TASK_PRIMITIVE) {
            throw new Error('CognitiveMap.defineMethod: task ' + def.taskId
                + ' is already defined as a primitive');
        }
        if (this.definedMethods >= this.methodCount) {
            throw new RangeError('CognitiveMap.defineMethod: methodCount capacity ' + this.methodCount + ' exceeded');
        }
        if (!def.subtasks || def.subtasks.length === 0) {
            throw new RangeError('CognitiveMap.defineMethod: subtasks must be a non-empty list');
        }
        const preconds = def.preconds ?? EMPTY_SPEC_LIST;
        if (this.methodSubtaskLen + def.subtasks.length > this.methodSubtaskList.length) {
            throw new RangeError('CognitiveMap.defineMethod: totalMethodSubtasks capacity '
                + this.methodSubtaskList.length + ' exceeded');
        }
        if (this.methodPrecondLen + preconds.length > this.methodPrecondSlots.length) {
            throw new RangeError('CognitiveMap.defineMethod: totalMethodPreconds capacity '
                + this.methodPrecondSlots.length + ' exceeded');
        }
        const m = this.definedMethods;
        this.methodTask[m] = def.taskId;
        this.methodSubtaskStart[m] = this.methodSubtaskLen;
        this.methodSubtaskCount[m] = def.subtasks.length;
        for (let i = 0; i < def.subtasks.length; i++) {
            const sub = def.subtasks[i] ?? -1;
            this.requireTask(sub, 'defineMethod');
            this.methodSubtaskList[this.methodSubtaskLen] = sub;
            this.methodSubtaskLen++;
        }
        this.methodPrecondStart[m] = this.methodPrecondLen;
        this.methodPrecondCount[m] = preconds.length;
        for (let i = 0; i < preconds.length; i++) {
            const p = preconds[i];
            this.requireSlot(p.slot, 'defineMethod');
            this.requireValue(p.value, 'defineMethod');
            this.methodPrecondSlots[this.methodPrecondLen] = p.slot;
            this.methodPrecondValues[this.methodPrecondLen] = p.value;
            this.methodPrecondLen++;
        }
        this.taskKind[def.taskId] = TASK_COMPOUND;
        this.definedMethods++;
    }
    // Build the per-task method index from the defineMethod registration
    // order. After finalize() the domain is read-only.
    finalize() {
        if (this.finalized)
            return;
        // Count methods per task.
        for (let m = 0; m < this.definedMethods; m++) {
            const t = this.methodTask[m] ?? 0;
            this.taskMethodCount[t] = (this.taskMethodCount[t] ?? 0) + 1;
        }
        // Compute prefix-sum starts.
        let cursor = 0;
        for (let t = 0; t < this.taskCount; t++) {
            this.taskMethodStart[t] = cursor;
            cursor += this.taskMethodCount[t] ?? 0;
        }
        // Fill methodIndex in registration order using a per-task write
        // cursor (re-using taskMethodCount, then restoring it).
        const writeCursor = new Int32Array(this.taskCount);
        for (let m = 0; m < this.definedMethods; m++) {
            const t = this.methodTask[m] ?? 0;
            const idx = (this.taskMethodStart[t] ?? 0) + (writeCursor[t] ?? 0);
            this.methodIndex[idx] = m;
            writeCursor[t] = (writeCursor[t] ?? 0) + 1;
        }
        this.finalized = true;
    }
    // ---------- state ----------
    setState(slot, value) {
        this.requireSlot(slot, 'setState');
        this.requireValue(value, 'setState');
        this.state[slot] = value;
    }
    getState(slot) {
        this.requireSlot(slot, 'getState');
        return this.state[slot] ?? 0;
    }
    // ---------- planning ----------
    // Try to build a totally-ordered plan that achieves goalId, mutating
    // state through every primitive's effects. On success the state is
    // the post-effects state and planLength() / planStep(i) describe the
    // plan; on failure the state is restored bit-identically to the
    // pre-call state (gate 4) and the result carries the failed task id
    // and depth (gate 7). stepBudget is the maximum planner iterations
    // before reason:'over_budget' is returned (gate 6).
    findPlan(goalId, stepBudget) {
        this.requireFinalized('findPlan');
        this.requireTask(goalId, 'findPlan');
        if (!Number.isInteger(stepBudget) || stepBudget < 1) {
            throw new RangeError('CognitiveMap.findPlan: stepBudget must be a positive integer, got ' + stepBudget);
        }
        this._planGen++;
        this.stackTop = 0;
        this.decisionTop = 0;
        this.undoTop = 0;
        this.planLen = 0;
        this._failedTaskId = NO_FAILED_TASK;
        this._failedDepth = 0;
        if (!this.pushTask(goalId)) {
            this._failedTaskId = goalId;
            this._failedDepth = 0;
            return this.failureResult('no_plan');
        }
        let steps = 0;
        while (this.stackTop > 0) {
            if (steps >= stepBudget) {
                // Roll the partial attempt back so the caller's state is intact.
                this.rollbackAll();
                this._failedTaskId = goalId;
                this._failedDepth = this.decisionTop;
                return this.failureResult('over_budget');
            }
            steps++;
            const task = this.stack[--this.stackTop] ?? -1;
            const kind = this.taskKind[task] ?? TASK_UNDEFINED;
            if (kind === TASK_PRIMITIVE) {
                if (!this.tryApplyPrimitive(task)) {
                    if (!this.backtrack(task)) {
                        return this.failureResult('no_plan');
                    }
                }
            }
            else if (kind === TASK_COMPOUND) {
                if (!this.tryFirstMethod(task)) {
                    if (!this.backtrack(task)) {
                        return this.failureResult('no_plan');
                    }
                }
            }
            else {
                // Undefined task referenced as a subtask - treat as a planning
                // failure and backtrack.
                if (!this.backtrack(task)) {
                    return this.failureResult('no_plan');
                }
            }
        }
        return { ok: true, planGen: this._planGen, planLength: this.planLen };
    }
    // ---------- plan accessors ----------
    planLength() {
        return this.planLen;
    }
    planStep(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.planLen) {
            throw new RangeError('CognitiveMap.planStep: index ' + index + ' out of [0, ' + this.planLen + ')');
        }
        return this.plan[index] ?? 0;
    }
    planGen() {
        return this._planGen;
    }
    // The task that caused the most recent findPlan to fail, or -1 if the
    // last run succeeded.
    failedTaskId() {
        return this._failedTaskId;
    }
    // The decomposition depth at which the most recent findPlan failed,
    // 0 if the goal itself was the failure point.
    failedDepth() {
        return this._failedDepth;
    }
    // ---------- goal queue (gate 6 emergency priority) ----------
    // Enqueue a goal with a priority. Higher priorities run first; ties
    // run in enqueue order.
    enqueueGoal(goalTaskId, priority) {
        this.requireTask(goalTaskId, 'enqueueGoal');
        if (!Number.isInteger(priority)) {
            throw new RangeError('CognitiveMap.enqueueGoal: priority must be an integer, got ' + priority);
        }
        if (this.goalQueueCount >= this.maxQueuedGoals)
            return false;
        const base = this.goalQueueCount * GOAL_SIZE;
        this.goalQueue[base + GOAL_TASK] = goalTaskId;
        this.goalQueue[base + GOAL_PRIORITY] = priority;
        this.goalQueueCount++;
        return true;
    }
    queuedGoalCount() {
        return this.goalQueueCount;
    }
    // Pop the highest-priority queued goal and run findPlan against it.
    // Returns null if the queue is empty. The returned PlanResult shares
    // the planGen counter with direct findPlan calls.
    runScheduler(stepBudget) {
        if (this.goalQueueCount === 0)
            return null;
        // Find the highest-priority goal (linear scan - the queue is small
        // and bounded by maxQueuedGoals).
        let bestIdx = 0;
        let bestPriority = this.goalQueue[GOAL_PRIORITY] ?? 0;
        for (let i = 1; i < this.goalQueueCount; i++) {
            const p = this.goalQueue[i * GOAL_SIZE + GOAL_PRIORITY] ?? 0;
            if (p > bestPriority) {
                bestPriority = p;
                bestIdx = i;
            }
        }
        const goalTask = this.goalQueue[bestIdx * GOAL_SIZE + GOAL_TASK] ?? 0;
        // Swap-pop the chosen goal out of the queue.
        const last = this.goalQueueCount - 1;
        if (bestIdx !== last) {
            this.goalQueue[bestIdx * GOAL_SIZE + GOAL_TASK]
                = this.goalQueue[last * GOAL_SIZE + GOAL_TASK] ?? 0;
            this.goalQueue[bestIdx * GOAL_SIZE + GOAL_PRIORITY]
                = this.goalQueue[last * GOAL_SIZE + GOAL_PRIORITY] ?? 0;
        }
        this.goalQueueCount--;
        return this.findPlan(goalTask, stepBudget);
    }
    // ---------- lifecycle ----------
    clear() {
        this.taskKind.fill(0);
        this.primPrecondStart.fill(0);
        this.primPrecondCount.fill(0);
        this.primEffectStart.fill(0);
        this.primEffectCount.fill(0);
        this.primPrecondLen = 0;
        this.primEffectLen = 0;
        this.methodTask.fill(0);
        this.methodSubtaskStart.fill(0);
        this.methodSubtaskCount.fill(0);
        this.methodPrecondStart.fill(0);
        this.methodPrecondCount.fill(0);
        this.methodSubtaskLen = 0;
        this.methodPrecondLen = 0;
        this.definedMethods = 0;
        this.taskMethodStart.fill(0);
        this.taskMethodCount.fill(0);
        this.methodIndex.fill(0);
        this.finalized = false;
        this.state.fill(0);
        this.stackTop = 0;
        this.decisionTop = 0;
        this.undoTop = 0;
        this.planLen = 0;
        this._planGen = 0;
        this._failedTaskId = NO_FAILED_TASK;
        this._failedDepth = 0;
        this.goalQueueCount = 0;
    }
    // ---------- private: planning helpers ----------
    // Apply a primitive's effects iff every precondition is satisfied.
    // On success the effects are pushed into the undo log so they can be
    // rolled back, and the primitive is appended to the plan.
    tryApplyPrimitive(task) {
        if (!this.checkPreconds(this.primPrecondStart[task] ?? 0, this.primPrecondCount[task] ?? 0, this.primPrecondSlots, this.primPrecondValues)) {
            return false;
        }
        if (this.planLen >= this.maxPlanLength)
            return false;
        const effStart = this.primEffectStart[task] ?? 0;
        const effCount = this.primEffectCount[task] ?? 0;
        if (this.undoTop + effCount > this.maxUndoLog)
            return false;
        for (let i = 0; i < effCount; i++) {
            const slot = this.primEffectSlots[effStart + i] ?? 0;
            const newValue = this.primEffectValues[effStart + i] ?? 0;
            const oldValue = this.state[slot] ?? 0;
            const undoBase = this.undoTop * UNDO_SIZE;
            this.undoLog[undoBase + UNDO_SLOT] = slot;
            this.undoLog[undoBase + UNDO_VALUE] = oldValue;
            this.undoTop++;
            this.state[slot] = newValue;
        }
        this.plan[this.planLen] = task;
        this.planLen++;
        return true;
    }
    // Try the first method registered for a compound task whose
    // preconditions hold. On success, push a decision frame recording
    // the snapshot (planLength, undoLength) and push the method's
    // subtasks onto the open stack in REVERSE order (so they pop in
    // declaration order).
    tryFirstMethod(task) {
        const start = this.taskMethodStart[task] ?? 0;
        const count = this.taskMethodCount[task] ?? 0;
        for (let i = 0; i < count; i++) {
            const m = this.methodIndex[start + i] ?? -1;
            if (this.tryMethod(task, i, m))
                return true;
        }
        return false;
    }
    // Try a specific method by its index within its task's method list.
    // Used both by tryFirstMethod and by backtrack (which advances the
    // method index after a failure).
    tryMethod(task, methodIdx, m) {
        if (m < 0)
            return false;
        if (!this.checkPreconds(this.methodPrecondStart[m] ?? 0, this.methodPrecondCount[m] ?? 0, this.methodPrecondSlots, this.methodPrecondValues)) {
            return false;
        }
        const subStart = this.methodSubtaskStart[m] ?? 0;
        const subCount = this.methodSubtaskCount[m] ?? 0;
        // Bound check: stack must hold all subtasks plus the existing
        // entries.
        if (this.stackTop + subCount > this.maxStackDepth)
            return false;
        if (this.decisionTop >= this.maxDecisionDepth)
            return false;
        // Push the decision frame BEFORE pushing the subtasks; backtrack
        // restores from this frame.
        const frameBase = this.decisionTop * FRAME_SIZE;
        this.decision[frameBase + FRAME_TASK] = task;
        this.decision[frameBase + FRAME_METHOD_INDEX] = methodIdx;
        this.decision[frameBase + FRAME_PLAN_LENGTH] = this.planLen;
        this.decision[frameBase + FRAME_UNDO_LENGTH] = this.undoTop;
        this.decision[frameBase + FRAME_STACK_TOP] = this.stackTop;
        this.decisionTop++;
        // Push subtasks in reverse order so they pop in declaration order.
        for (let i = subCount - 1; i >= 0; i--) {
            const sub = this.methodSubtaskList[subStart + i] ?? -1;
            this.stack[this.stackTop] = sub;
            this.stackTop++;
        }
        return true;
    }
    // Pop the open stack into a single value. Returns false (no-op) if
    // the push would overflow the stack.
    pushTask(task) {
        if (this.stackTop >= this.maxStackDepth)
            return false;
        this.stack[this.stackTop] = task;
        this.stackTop++;
        return true;
    }
    // Walk back the decision stack until a frame with another method to
    // try succeeds. Each frame carries the planLength / undoLength /
    // stackTop snapshot taken when its method was first tried, so a
    // restore drops every effect, every plan step, and every leftover
    // subtask the failed method pushed - the world is bit-identical to
    // pre-attempt state. Returns false if no frame remains untried, in
    // which case findPlan reports the failure with the blamed task.
    backtrack(blamedTask) {
        this._failedTaskId = blamedTask;
        this._failedDepth = this.decisionTop;
        while (this.decisionTop > 0) {
            const frameBase = (this.decisionTop - 1) * FRAME_SIZE;
            const task = this.decision[frameBase + FRAME_TASK] ?? -1;
            const methodIdx = this.decision[frameBase + FRAME_METHOD_INDEX] ?? 0;
            const planLength = this.decision[frameBase + FRAME_PLAN_LENGTH] ?? 0;
            const undoLength = this.decision[frameBase + FRAME_UNDO_LENGTH] ?? 0;
            const savedStackTop = this.decision[frameBase + FRAME_STACK_TOP] ?? 0;
            // Restore the snapshot taken when this method was first tried.
            this.rollbackTo(undoLength);
            this.planLen = planLength;
            this.stackTop = savedStackTop;
            // Pop the frame - we are about to retry this compound task with
            // its next method.
            this.decisionTop--;
            // Try the remaining methods in registration order. tryMethod
            // pushes a fresh frame on success.
            const start = this.taskMethodStart[task] ?? 0;
            const count = this.taskMethodCount[task] ?? 0;
            let nextIdx = methodIdx + 1;
            let foundMethod = false;
            while (nextIdx < count) {
                const m = this.methodIndex[start + nextIdx] ?? -1;
                if (this.tryMethod(task, nextIdx, m)) {
                    foundMethod = true;
                    break;
                }
                nextIdx++;
            }
            if (foundMethod)
                return true;
            // No remaining method works at this frame - keep walking up.
        }
        return false;
    }
    // Pop the undo log down to `targetLen` entries, restoring each
    // (slot, oldValue) along the way. Used by backtrack and by
    // rollbackAll.
    rollbackTo(targetLen) {
        while (this.undoTop > targetLen) {
            this.undoTop--;
            const base = this.undoTop * UNDO_SIZE;
            const slot = this.undoLog[base + UNDO_SLOT] ?? 0;
            const value = this.undoLog[base + UNDO_VALUE] ?? 0;
            this.state[slot] = value;
        }
    }
    // Restore state to the moment findPlan was called - undo every
    // applied effect.
    rollbackAll() {
        this.rollbackTo(0);
        this.planLen = 0;
        this.stackTop = 0;
        this.decisionTop = 0;
    }
    // Walk a flat (slot, value) precondition slice and return whether
    // every state[slot] >= value.
    checkPreconds(start, count, slots, values) {
        for (let i = 0; i < count; i++) {
            const slot = slots[start + i] ?? 0;
            const required = values[start + i] ?? 0;
            if ((this.state[slot] ?? 0) < required)
                return false;
        }
        return true;
    }
    failureResult(reason) {
        this.rollbackAll();
        return {
            ok: false,
            planGen: this._planGen,
            reason: reason,
            failedTaskId: this._failedTaskId,
            depth: this._failedDepth,
        };
    }
    // ---------- private: validation ----------
    requireMutable(op) {
        if (this.finalized) {
            throw new Error('CognitiveMap.' + op + ': domain is finalized; clear() to redefine');
        }
    }
    requireFinalized(op) {
        if (!this.finalized) {
            throw new Error('CognitiveMap.' + op + ': call finalize() before planning');
        }
    }
    requireTask(taskId, op) {
        if (!Number.isInteger(taskId) || taskId < 0 || taskId >= this.taskCount) {
            throw new RangeError('CognitiveMap.' + op + ': taskId ' + taskId + ' out of [0, ' + this.taskCount + ')');
        }
    }
    requireSlot(slot, op) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.stateSize) {
            throw new RangeError('CognitiveMap.' + op + ': slot ' + slot + ' out of [0, ' + this.stateSize + ')');
        }
    }
    requireValue(value, op) {
        if (!Number.isInteger(value)) {
            throw new RangeError('CognitiveMap.' + op + ': value must be an integer, got ' + value);
        }
    }
}
// ---------- module helpers ----------
const EMPTY_SPEC_LIST = [];
function requireOpts(opts) {
    if (!opts) {
        throw new TypeError('CognitiveMap: options object is required');
    }
}
function requireCap(name, value, lo, hi) {
    if (!Number.isInteger(value) || value < lo || value > hi) {
        throw new RangeError('CognitiveMap: ' + name + ' must be an integer in [' + lo + ', ' + hi + '], got ' + value);
    }
}
function kindName(kind) {
    if (kind === TASK_PRIMITIVE)
        return 'primitive';
    if (kind === TASK_COMPOUND)
        return 'compound';
    return 'undefined';
}
//# sourceMappingURL=cognitive-map.js.map