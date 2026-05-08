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

export interface FrameBudgetTaskDef {
  // Optional explicit id. If omitted, the scheduler assigns a
  // monotonic synthetic id ("task#NNN").
  id?: string;
  // Optional priority. Higher runs first. Same priority -> FIFO.
  priority?: number;
  // Run one slice of work. Return true to mark the task done (it is
  // removed from the queue and onComplete fires). Return false to
  // keep the task queued for the next tick().
  step: () => boolean;
  // Fired exactly once when the step returns true. Errors are
  // swallowed so a misbehaving callback never takes down the
  // scheduler.
  onComplete?: () => void;
  // Fired exactly once if cancel(id) removes the task before it
  // completed. Errors are swallowed.
  onCancel?: () => void;
}

export interface FrameBudgetStats {
  // The budget in ms that applied to this tick.
  budgetMs: number;
  // Wall time in ms spent inside step() calls during this tick.
  spentMs: number;
  // Number of step() invocations during this tick.
  ranCount: number;
  // Number of tasks that completed (returned true) during this tick.
  completedCount: number;
  // Tasks remaining in the queue after this tick.
  pendingCount: number;
  // True if budget was exceeded mid-tick (pending tasks still in
  // queue because there was no time left to run them).
  overBudget: boolean;
}

export interface FrameBudgetSchedulerOptions {
  // Soft budget per tick() in ms. Defaults to 8ms (~half a frame at
  // 60fps, leaving headroom for rendering + simulation).
  budgetMs?: number;
  // Time source. Defaults to performance.now() with Date.now()
  // fallback.
  now?: () => number;
}

interface ScheduledTask {
  id: string;
  priority: number;
  insertSeq: number;
  step: () => boolean;
  onComplete: (() => void) | undefined;
  onCancel: (() => void) | undefined;
}

const DEFAULT_BUDGET_MS = 8;

function defaultNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function safeFire(cb: (() => void) | undefined): void {
  if (!cb) return;
  try { cb(); } catch {
    // Best-effort: a misbehaving callback never takes down the scheduler.
  }
}

export class FrameBudgetScheduler {
  private budgetMs: number;
  private nowMs: () => number;
  private queue: ScheduledTask[] = [];
  private byId: Map<string, ScheduledTask> = new Map();
  private synthCounter: number = 0;
  private insertCounter: number = 0;
  private disposed: boolean = false;

  private constructor(opts: FrameBudgetSchedulerOptions) {
    this.budgetMs = opts.budgetMs !== undefined && opts.budgetMs > 0
      ? opts.budgetMs
      : DEFAULT_BUDGET_MS;
    this.nowMs = opts.now ?? defaultNowMs;
  }

  static create(opts?: FrameBudgetSchedulerOptions): FrameBudgetScheduler {
    return new FrameBudgetScheduler(opts ?? {});
  }

  // Submit a task. Returns the assigned id (the supplied one if
  // given, else a synthetic). Re-using an existing id replaces that
  // task wholesale (previous task drops without onCancel - if you
  // want cancellation semantics, call cancel(id) first).
  schedule(task: FrameBudgetTaskDef): string {
    if (this.disposed) return '';
    var id = task.id !== undefined && task.id !== ''
      ? task.id
      : 'task#' + (++this.synthCounter);
    var existing = this.byId.get(id);
    if (existing) {
      // Replace in place: drop the old entry from the queue, push
      // the new one with a fresh insertSeq.
      var idx = this.queue.indexOf(existing);
      if (idx >= 0) this.queue.splice(idx, 1);
    }
    var scheduled: ScheduledTask = {
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
  cancel(id: string): boolean {
    if (this.disposed) return false;
    var t = this.byId.get(id);
    if (!t) return false;
    this.byId.delete(id);
    var idx = this.queue.indexOf(t);
    if (idx >= 0) this.queue.splice(idx, 1);
    safeFire(t.onCancel);
    return true;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  pendingCount(): number {
    return this.queue.length;
  }

  setBudgetMs(ms: number): void {
    if (ms > 0) this.budgetMs = ms;
  }

  getBudgetMs(): number {
    return this.budgetMs;
  }

  // Run as many tasks as fit inside this tick's budget. Tasks are
  // sorted by priority (high first) then by insert order (FIFO at
  // ties). A step that returns true is removed; one that returns
  // false stays in the queue for the next tick. The currently-
  // executing step is NEVER preempted - if a step blows past the
  // budget, the scheduler simply stops queueing more after it
  // returns.
  tick(): FrameBudgetStats {
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
      if (a.priority !== b.priority) return b.priority - a.priority;
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
    var carryOver: ScheduledTask[] = [];
    var i = 0;
    while (i < this.queue.length) {
      var t = this.queue[i] as ScheduledTask;
      i++;
      if (this.nowMs() >= deadline) {
        // Budget exhausted: the rest of the queue carries over.
        overBudget = true;
        carryOver.push(t);
        // Fall through to copy the remaining tasks into carryOver.
        while (i < this.queue.length) {
          carryOver.push(this.queue[i] as ScheduledTask);
          i++;
        }
        break;
      }
      ranCount++;
      var done = false;
      var threw = false;
      try {
        done = t.step();
      } catch {
        // A throwing step is dropped silently: avoid an infinite
        // re-run loop, but neither onComplete nor onCancel fires
        // (it was neither a clean completion nor a user-driven
        // cancellation). Diagnostics in production typically wrap
        // step() with the consumer's error logger.
        threw = true;
      }
      if (threw) {
        this.byId.delete(t.id);
      } else if (done) {
        completedCount++;
        this.byId.delete(t.id);
        safeFire(t.onComplete);
      } else {
        carryOver.push(t);
      }
    }

    this.queue = carryOver;
    var spentMs = this.nowMs() - start;
    if (spentMs < 0) spentMs = 0;

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
  flush(): FrameBudgetStats {
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
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.insertSeq - b.insertSeq;
    });
    var start = this.nowMs();
    var ranCount = 0;
    var completedCount = 0;
    var carryOver: ScheduledTask[] = [];
    for (var i = 0; i < this.queue.length; i++) {
      var t = this.queue[i] as ScheduledTask;
      ranCount++;
      var done = false;
      var threw = false;
      try {
        done = t.step();
      } catch {
        threw = true;
      }
      if (threw) {
        this.byId.delete(t.id);
      } else if (done) {
        completedCount++;
        this.byId.delete(t.id);
        safeFire(t.onComplete);
      } else {
        carryOver.push(t);
      }
    }
    this.queue = carryOver;
    var spentMs = this.nowMs() - start;
    if (spentMs < 0) spentMs = 0;
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
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    var remaining = this.queue.slice();
    this.queue.length = 0;
    this.byId.clear();
    for (var i = 0; i < remaining.length; i++) {
      safeFire((remaining[i] as ScheduledTask).onCancel);
    }
  }
}

// Resource key for the world's resource registry. Engine consumers
// register a FrameBudgetScheduler instance under this key; systems
// read it via world.resources.get().
export const RESOURCE_FRAME_BUDGET_SCHEDULER = 'frame_budget_scheduler';
