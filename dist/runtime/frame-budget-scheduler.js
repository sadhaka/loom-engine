// FrameBudgetScheduler - soft-deadline task queue for off-frame work.
//
// 0.36.0 enabling primitive. The engine routinely needs to run heavy
// work that does not fit in a single 16ms frame: precomputing
// occlusion grids, baking nav-mesh tiles, processing a long event
// queue, hydrating snapshot data, JIT-loading sprite atlases. Doing
// it all on the main thread freezes the frame and surfaces as a
// hitch in the browser.
//
// FrameBudgetScheduler accepts step functions and runs as many as
// fit in `budgetMs` per tick(). Each step returns true to mark the
// task done (drops out of the queue), or false to keep it queued
// for next frame. The scheduler stops queueing more steps once the
// frame budget is consumed - the in-flight step is NOT preempted
// (a step that takes 50ms when budget was 16ms still completes;
// the scheduler simply stops calling more steps that frame).
//
// Priority: higher numbers run first; ties resolve FIFO. Default
// priority is 0.
//
// Time source: defaults to performance.now() / Date.now() for
// browser + Node, but consumers can pass `now` for deterministic
// replays - typically a closure that reads TimeResource.elapsed *
// 1000 from the world.
//
// Code style: var-only in browser source.
const DEFAULT_BUDGET_MS = 8;
function defaultNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
function safeFire(cb) {
    if (!cb)
        return;
    try {
        cb();
    }
    catch {
        // Best-effort: a misbehaving callback never takes down the scheduler.
    }
}
export class FrameBudgetScheduler {
    budgetMs;
    nowMs;
    queue = [];
    byId = new Map();
    synthCounter = 0;
    insertCounter = 0;
    disposed = false;
    constructor(opts) {
        this.budgetMs = opts.budgetMs !== undefined && opts.budgetMs > 0
            ? opts.budgetMs
            : DEFAULT_BUDGET_MS;
        this.nowMs = opts.now ?? defaultNowMs;
    }
    static create(opts) {
        return new FrameBudgetScheduler(opts ?? {});
    }
    // Submit a task. Returns the assigned id (the supplied one if
    // given, else a synthetic). Re-using an existing id replaces that
    // task wholesale (previous task drops without onCancel - if you
    // want cancellation semantics, call cancel(id) first).
    schedule(task) {
        if (this.disposed)
            return '';
        var id = task.id !== undefined && task.id !== ''
            ? task.id
            : 'task#' + (++this.synthCounter);
        var existing = this.byId.get(id);
        if (existing) {
            // Replace in place: drop the old entry from the queue, push
            // the new one with a fresh insertSeq.
            var idx = this.queue.indexOf(existing);
            if (idx >= 0)
                this.queue.splice(idx, 1);
        }
        var scheduled = {
            id: id,
            priority: task.priority ?? 0,
            insertSeq: ++this.insertCounter,
            step: task.step,
            onComplete: task.onComplete,
            onCancel: task.onCancel,
        };
        this.byId.set(id, scheduled);
        this.queue.push(scheduled);
        return id;
    }
    // Remove a task by id. Returns true if the task was found and
    // removed (firing onCancel); false if no task had that id.
    cancel(id) {
        if (this.disposed)
            return false;
        var t = this.byId.get(id);
        if (!t)
            return false;
        this.byId.delete(id);
        var idx = this.queue.indexOf(t);
        if (idx >= 0)
            this.queue.splice(idx, 1);
        safeFire(t.onCancel);
        return true;
    }
    has(id) {
        return this.byId.has(id);
    }
    pendingCount() {
        return this.queue.length;
    }
    setBudgetMs(ms) {
        if (ms > 0)
            this.budgetMs = ms;
    }
    getBudgetMs() {
        return this.budgetMs;
    }
    // Run as many tasks as fit inside this tick's budget. Tasks are
    // sorted by priority (high first) then by insert order (FIFO at
    // ties). A step that returns true is removed; one that returns
    // false stays in the queue for the next tick. The currently-
    // executing step is NEVER preempted - if a step blows past the
    // budget, the scheduler simply stops queueing more after it
    // returns.
    tick() {
        if (this.disposed) {
            return {
                budgetMs: this.budgetMs,
                spentMs: 0,
                ranCount: 0,
                completedCount: 0,
                pendingCount: 0,
                overBudget: false,
            };
        }
        if (this.queue.length === 0) {
            return {
                budgetMs: this.budgetMs,
                spentMs: 0,
                ranCount: 0,
                completedCount: 0,
                pendingCount: 0,
                overBudget: false,
            };
        }
        // Sort: priority desc, insertSeq asc (stable). Array.sort is
        // stable in V8 / SpiderMonkey / JSC since 2018 so this preserves
        // FIFO order at equal priorities even without the explicit tie-
        // break; we still keep insertSeq in the comparator for clarity
        // + portability.
        this.queue.sort(function (a, b) {
            if (a.priority !== b.priority)
                return b.priority - a.priority;
            return a.insertSeq - b.insertSeq;
        });
        var start = this.nowMs();
        var deadline = start + this.budgetMs;
        var ranCount = 0;
        var completedCount = 0;
        var overBudget = false;
        // Drain in priority order. Re-queue tasks that aren't done; drop
        // those that completed. Stop when we run out of time. The
        // currently-running step always finishes - we only check the
        // budget BEFORE invoking the next step.
        var carryOver = [];
        var i = 0;
        while (i < this.queue.length) {
            var t = this.queue[i];
            i++;
            if (this.nowMs() >= deadline) {
                // Budget exhausted: the rest of the queue carries over.
                overBudget = true;
                carryOver.push(t);
                // Fall through to copy the remaining tasks into carryOver.
                while (i < this.queue.length) {
                    carryOver.push(this.queue[i]);
                    i++;
                }
                break;
            }
            ranCount++;
            var done = false;
            var threw = false;
            try {
                done = t.step();
            }
            catch {
                // A throwing step is dropped silently: avoid an infinite
                // re-run loop, but neither onComplete nor onCancel fires
                // (it was neither a clean completion nor a user-driven
                // cancellation). Diagnostics in production typically wrap
                // step() with the consumer's error logger.
                threw = true;
            }
            if (threw) {
                this.byId.delete(t.id);
            }
            else if (done) {
                completedCount++;
                this.byId.delete(t.id);
                safeFire(t.onComplete);
            }
            else {
                carryOver.push(t);
            }
        }
        this.queue = carryOver;
        var spentMs = this.nowMs() - start;
        if (spentMs < 0)
            spentMs = 0;
        return {
            budgetMs: this.budgetMs,
            spentMs: spentMs,
            ranCount: ranCount,
            completedCount: completedCount,
            pendingCount: this.queue.length,
            overBudget: overBudget,
        };
    }
    // Drain the entire queue ignoring the budget. Useful at shutdown
    // (final loading screen) or when a consumer has already verified
    // there is no per-task latency cost. Returns combined stats.
    flush() {
        if (this.disposed || this.queue.length === 0) {
            return {
                budgetMs: this.budgetMs,
                spentMs: 0,
                ranCount: 0,
                completedCount: 0,
                pendingCount: 0,
                overBudget: false,
            };
        }
        this.queue.sort(function (a, b) {
            if (a.priority !== b.priority)
                return b.priority - a.priority;
            return a.insertSeq - b.insertSeq;
        });
        var start = this.nowMs();
        var ranCount = 0;
        var completedCount = 0;
        var carryOver = [];
        for (var i = 0; i < this.queue.length; i++) {
            var t = this.queue[i];
            ranCount++;
            var done = false;
            var threw = false;
            try {
                done = t.step();
            }
            catch {
                threw = true;
            }
            if (threw) {
                this.byId.delete(t.id);
            }
            else if (done) {
                completedCount++;
                this.byId.delete(t.id);
                safeFire(t.onComplete);
            }
            else {
                carryOver.push(t);
            }
        }
        this.queue = carryOver;
        var spentMs = this.nowMs() - start;
        if (spentMs < 0)
            spentMs = 0;
        return {
            budgetMs: this.budgetMs,
            spentMs: spentMs,
            ranCount: ranCount,
            completedCount: completedCount,
            pendingCount: this.queue.length,
            overBudget: false,
        };
    }
    // Tear down. Cancels any remaining tasks (fires onCancel for each)
    // and makes subsequent operations no-ops.
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        var remaining = this.queue.slice();
        this.queue.length = 0;
        this.byId.clear();
        for (var i = 0; i < remaining.length; i++) {
            safeFire(remaining[i].onCancel);
        }
    }
}
// Resource key for the world's resource registry. Engine consumers
// register a FrameBudgetScheduler instance under this key; systems
// read it via world.resources.get().
export const RESOURCE_FRAME_BUDGET_SCHEDULER = 'frame_budget_scheduler';
//# sourceMappingURL=frame-budget-scheduler.js.map