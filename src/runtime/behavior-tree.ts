// BehaviorTree - pluggable AI decision tree.
//
// 1.1.2 enabling primitive (Wave 1.1 combat depth). StateMachine
// (0.51) handles "agent is in state X, transition on event Y" -
// great for finite, hand-authored flows. BehaviorTree is the
// hierarchical / composite pattern instead: build complex AI from
// small reusable nodes (sequence, selector, condition, action,
// inverter, repeat, cooldown). Standard model in modern game AI.
//
//   var tree = BehaviorTree.create({
//     blackboard: { hp: 100, target: null },
//     root: {
//       kind: 'selector', children: [
//         // Priority 1: flee at low HP.
//         { kind: 'sequence', children: [
//           { kind: 'condition', predicate: (ctx) => ctx.blackboard.hp < 30 },
//           { kind: 'action',    run: fleeRun },
//         ]},
//         // Priority 2: attack if a target is in sight.
//         { kind: 'sequence', children: [
//           { kind: 'condition', predicate: hasTarget },
//           { kind: 'action',    run: attackRun },
//         ]},
//         // Default: patrol.
//         { kind: 'action', run: patrolRun },
//       ],
//     },
//   });
//   each frame: tree.tick(dtMs);
//
// Node taxonomy:
//   - sequence  - run children in order; fail on first failure;
//                 success if all succeed; running while one is.
//   - selector  - try children in order; succeed on first success;
//                 fail if all fail.
//   - parallel  - run all children each tick; configurable
//                 success/failure thresholds.
//   - inverter  - flip success <-> failure; running passes through.
//   - repeat    - run child N times (or -1 = forever).
//   - cooldown  - rate-limit child; configurable status during
//                 cooldown window.
//   - condition - leaf; predicate -> success/failure.
//   - action    - leaf; runner -> success/failure/running.
//
// Pairs with StateMachine (0.51) for finite states; AggroTable
// (0.78) for threat ledger; Coroutine (0.69) for multi-frame
// action sequences.
//
// Code style: var-only in browser source.

export type BTStatus = 'success' | 'failure' | 'running';

export interface BTContext {
  // Shared blackboard the consumer mutates from actions / reads
  // from conditions. Engine does not interpret.
  blackboard: Record<string, unknown>;
  // dt of the current tick in ms. NaN / negative dt is clamped to 0.
  dtMs: number;
}

export type BTConditionFn = (ctx: BTContext) => boolean;
export type BTActionFn = (ctx: BTContext) => BTStatus;

interface BTNodeBase {
  // Optional human-readable name for diagnostics.
  name?: string;
}

export interface BTSequenceNode extends BTNodeBase {
  kind: 'sequence';
  children: BTNode[];
}

export interface BTSelectorNode extends BTNodeBase {
  kind: 'selector';
  children: BTNode[];
}

export interface BTParallelNode extends BTNodeBase {
  kind: 'parallel';
  children: BTNode[];
  // Number of children that must succeed for this node to succeed.
  // Default = children.length (i.e. all).
  successThreshold?: number;
  // Number of children that must fail for this node to fail.
  // Default 1.
  failureThreshold?: number;
}

export interface BTInverterNode extends BTNodeBase {
  kind: 'inverter';
  child: BTNode;
}

export interface BTRepeatNode extends BTNodeBase {
  kind: 'repeat';
  child: BTNode;
  // Number of times to run the child. -1 = forever (returns
  // running each tick).
  count: number;
  // Stop on first child failure? Default true. When false, the
  // repeat keeps iterating regardless of child outcomes (and
  // eventually returns success after `count` iterations).
  stopOnFailure?: boolean;
}

export interface BTCooldownNode extends BTNodeBase {
  kind: 'cooldown';
  child: BTNode;
  // ms of cooldown after each successful child run.
  cooldownMs: number;
  // Status to return while the cooldown is active. Default 'failure'.
  cooldownStatus?: BTStatus;
}

export interface BTConditionNode extends BTNodeBase {
  kind: 'condition';
  predicate: BTConditionFn;
}

export interface BTActionNode extends BTNodeBase {
  kind: 'action';
  run: BTActionFn;
}

export type BTNode =
  | BTSequenceNode
  | BTSelectorNode
  | BTParallelNode
  | BTInverterNode
  | BTRepeatNode
  | BTCooldownNode
  | BTConditionNode
  | BTActionNode;

interface NodeState {
  childCursor: number;
  iterationCount: number;
  cooldownRemainingMs: number;
}

export interface BehaviorTreeOptions {
  root: BTNode;
  // Optional initial blackboard. Engine does not interpret keys.
  blackboard?: Record<string, unknown>;
  // Fired after each tick with the root status.
  onStatus?: (status: BTStatus) => void;
}

function newNodeState(): NodeState {
  return { childCursor: 0, iterationCount: 0, cooldownRemainingMs: 0 };
}

export class BehaviorTree {
  private root: BTNode;
  private blackboard: Record<string, unknown>;
  private states: WeakMap<BTNode, NodeState> = new WeakMap();
  private onStatus: ((s: BTStatus) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: BehaviorTreeOptions) {
    this.root = opts.root;
    this.blackboard = opts.blackboard ? { ...opts.blackboard } : {};
    this.onStatus = opts.onStatus ?? null;
  }

  static create(opts: BehaviorTreeOptions): BehaviorTree {
    return new BehaviorTree(opts);
  }

  // Tick the tree from the root. Returns the root's status.
  tick(dtMs: number): BTStatus {
    if (this.disposed) return 'failure';
    var dt = +dtMs;
    if (!isFinite(dt) || dt < 0) dt = 0;
    var ctx: BTContext = { blackboard: this.blackboard, dtMs: dt };
    var status = this.run(this.root, ctx);
    if (this.onStatus) {
      try { this.onStatus(status); } catch { /* ignore */ }
    }
    return status;
  }

  // Clear all running-node state. Next tick starts each node from
  // its initial position.
  reset(): void {
    this.states = new WeakMap();
  }

  setBlackboardEntry(key: string, value: unknown): void {
    if (this.disposed) return;
    if (typeof key !== 'string' || key.length === 0) return;
    this.blackboard[key] = value;
  }

  getBlackboardEntry(key: string): unknown {
    return this.blackboard[key];
  }

  getBlackboard(): Record<string, unknown> {
    return { ...this.blackboard };
  }

  dispose(): void {
    this.disposed = true;
    this.states = new WeakMap();
    this.onStatus = null;
  }

  // ---------- private ----------

  private run(node: BTNode, ctx: BTContext): BTStatus {
    var state = this.getState(node);
    switch (node.kind) {
      case 'sequence':
        return this.runSequence(node, state, ctx);
      case 'selector':
        return this.runSelector(node, state, ctx);
      case 'parallel':
        return this.runParallel(node, ctx);
      case 'inverter':
        return this.runInverter(node, ctx);
      case 'repeat':
        return this.runRepeat(node, state, ctx);
      case 'cooldown':
        return this.runCooldown(node, state, ctx);
      case 'condition': {
        var ok = false;
        try { ok = !!node.predicate(ctx); } catch { ok = false; }
        return ok ? 'success' : 'failure';
      }
      case 'action': {
        try { return node.run(ctx); } catch { return 'failure'; }
      }
    }
    return 'failure';
  }

  private getState(node: BTNode): NodeState {
    var s = this.states.get(node);
    if (!s) {
      s = newNodeState();
      this.states.set(node, s);
    }
    return s;
  }

  private runSequence(node: BTSequenceNode, state: NodeState, ctx: BTContext): BTStatus {
    while (state.childCursor < node.children.length) {
      var child = node.children[state.childCursor] as BTNode;
      var s = this.run(child, ctx);
      if (s === 'running') return 'running';
      if (s === 'failure') {
        state.childCursor = 0;
        return 'failure';
      }
      state.childCursor++;
    }
    state.childCursor = 0;
    return 'success';
  }

  private runSelector(node: BTSelectorNode, state: NodeState, ctx: BTContext): BTStatus {
    while (state.childCursor < node.children.length) {
      var child = node.children[state.childCursor] as BTNode;
      var s = this.run(child, ctx);
      if (s === 'running') return 'running';
      if (s === 'success') {
        state.childCursor = 0;
        return 'success';
      }
      state.childCursor++;
    }
    state.childCursor = 0;
    return 'failure';
  }

  private runParallel(node: BTParallelNode, ctx: BTContext): BTStatus {
    var successThreshold = node.successThreshold !== undefined
        && isFinite(node.successThreshold) && node.successThreshold > 0
      ? Math.floor(node.successThreshold)
      : node.children.length;
    var failureThreshold = node.failureThreshold !== undefined
        && isFinite(node.failureThreshold) && node.failureThreshold > 0
      ? Math.floor(node.failureThreshold) : 1;
    var successes = 0;
    var failures = 0;
    for (var i = 0; i < node.children.length; i++) {
      var s = this.run(node.children[i] as BTNode, ctx);
      if (s === 'success') successes++;
      else if (s === 'failure') failures++;
    }
    if (successes >= successThreshold) return 'success';
    if (failures >= failureThreshold) return 'failure';
    return 'running';
  }

  private runInverter(node: BTInverterNode, ctx: BTContext): BTStatus {
    var s = this.run(node.child, ctx);
    if (s === 'success') return 'failure';
    if (s === 'failure') return 'success';
    return 'running';
  }

  private runRepeat(node: BTRepeatNode, state: NodeState, ctx: BTContext): BTStatus {
    var stopOnFail = node.stopOnFailure !== false;
    var maxCount = node.count;
    if (maxCount < 0) {
      // Forever: run once per tick, never report success.
      var s = this.run(node.child, ctx);
      if (s === 'failure' && stopOnFail) return 'failure';
      return 'running';
    }
    while (state.iterationCount < maxCount) {
      var s2 = this.run(node.child, ctx);
      if (s2 === 'running') return 'running';
      if (s2 === 'failure' && stopOnFail) {
        state.iterationCount = 0;
        return 'failure';
      }
      state.iterationCount++;
    }
    state.iterationCount = 0;
    return 'success';
  }

  private runCooldown(node: BTCooldownNode, state: NodeState, ctx: BTContext): BTStatus {
    if (state.cooldownRemainingMs > 0) {
      state.cooldownRemainingMs -= ctx.dtMs;
      if (state.cooldownRemainingMs > 0) {
        return node.cooldownStatus ?? 'failure';
      }
      state.cooldownRemainingMs = 0;
    }
    var s = this.run(node.child, ctx);
    if (s === 'success') {
      state.cooldownRemainingMs = node.cooldownMs;
    }
    return s;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_BEHAVIOR_TREE = 'behavior_tree';
