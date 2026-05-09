// DialogTree - branching dialog with conditions + actions.
//
// 0.61.0 enabling primitive. Most dialog systems are some flavor of:
// nodes with text + a list of choices, each choice has an optional
// `if` predicate and optional `do` action, and points to a next
// node. DialogTree is that machinery as a small generic state
// container - the engine doesn't care what your conditions or
// actions are, only that they're functions you registered.
//
//   var tree = DialogTree.create({
//     start: 'greeting',
//     nodes: {
//       greeting: {
//         text: 'Hello, traveler!',
//         choices: [
//           { label: 'Hi.', next: 'farewell' },
//           { label: 'Got quests?', next: 'quest_offer', if: 'isLevel5+' },
//         ],
//       },
//       quest_offer: { text: '...', choices: [...] },
//       farewell:    { text: 'Safe travels.', choices: [] },
//     },
//   });
//   tree.start();
//   var node = tree.current();
//   var visible = tree.visibleChoices();   // filtered by `if` predicates
//   tree.choose(0);                         // advances + fires `do`
//
// Code style: var-only in browser source.

export interface DialogChoice {
  // Text shown to the player.
  label: string;
  // Next node id to jump to. Use 'end' (or any unknown id) to
  // terminate the dialog.
  next: string;
  // Optional predicate name. Looked up in the predicates map at
  // visibleChoices() time. Choices whose predicate returns false
  // are hidden.
  if?: string;
  // Optional action name. Looked up in the actions map at
  // choose() time. Fires before the node transition.
  do?: string;
  // Optional structured payload available to predicate / action
  // (e.g. quest id, item id).
  data?: Record<string, unknown>;
}

export interface DialogNode {
  text: string;
  choices: DialogChoice[];
  // Optional onEnter action name. Fires when the node becomes
  // current.
  onEnter?: string;
}

export type Predicate = (data?: Record<string, unknown>) => boolean;
export type Action = (data?: Record<string, unknown>) => void;

export interface DialogTreeOptions {
  start: string;
  nodes: Record<string, DialogNode>;
  // Map of predicate-name -> function. Choices reference these by
  // name so trees can serialize cleanly.
  predicates?: Record<string, Predicate>;
  // Map of action-name -> function.
  actions?: Record<string, Action>;
  // Callback fired when the dialog ends (next node missing).
  onEnd?: () => void;
}

export class DialogTree {
  private nodes: Record<string, DialogNode>;
  private predicates: Record<string, Predicate>;
  private actions: Record<string, Action>;
  private startNode: string;
  private currentNode: string | null = null;
  private onEnd: (() => void) | null;
  private disposed: boolean = false;

  private constructor(opts: DialogTreeOptions) {
    if (typeof opts.start !== 'string' || opts.start.length === 0) {
      throw new Error('DialogTree: start node required');
    }
    if (!opts.nodes || typeof opts.nodes !== 'object') {
      throw new Error('DialogTree: nodes map required');
    }
    if (!Object.prototype.hasOwnProperty.call(opts.nodes, opts.start)) {
      throw new Error('DialogTree: start node "' + opts.start + '" not in nodes map');
    }
    this.nodes = opts.nodes;
    this.predicates = opts.predicates ?? {};
    this.actions = opts.actions ?? {};
    this.startNode = opts.start;
    this.onEnd = opts.onEnd ?? null;
  }

  static create(opts: DialogTreeOptions): DialogTree {
    return new DialogTree(opts);
  }

  // Begin (or restart) the dialog at the start node. Fires the
  // start node's onEnter action.
  start(): void {
    if (this.disposed) return;
    this.currentNode = this.startNode;
    this.fireOnEnter(this.startNode);
  }

  // Currently-active node id; null if not started or ended.
  currentId(): string | null { return this.currentNode; }

  // Currently-active node. null if not started or ended.
  current(): DialogNode | null {
    if (!this.currentNode) return null;
    return this.nodes[this.currentNode] ?? null;
  }

  isActive(): boolean {
    return this.currentNode !== null;
  }

  // Visible choices on the current node. Choices whose `if`
  // predicate is registered AND returns false are filtered out.
  // Choices with no `if` are always shown. Throwing predicates
  // hide their choice (defensive).
  visibleChoices(): DialogChoice[] {
    var node = this.current();
    if (!node) return [];
    var out: DialogChoice[] = [];
    for (var i = 0; i < node.choices.length; i++) {
      var c = node.choices[i] as DialogChoice;
      if (c.if) {
        var pred = this.predicates[c.if];
        if (!pred) continue;
        var passed = false;
        try { passed = !!pred(c.data); } catch { passed = false; }
        if (!passed) continue;
      }
      out.push(c);
    }
    return out;
  }

  // Pick a choice from `visibleChoices()` by index. Fires the
  // choice's `do` action then transitions to `next`. Returns true
  // on success; false if not active / index out of range / disposed.
  choose(index: number): boolean {
    if (this.disposed || !this.currentNode) return false;
    var visible = this.visibleChoices();
    if (index < 0 || index >= visible.length) return false;
    var choice = visible[index] as DialogChoice;
    if (choice.do) {
      var act = this.actions[choice.do];
      if (act) {
        try { act(choice.data); } catch {
          // Best-effort.
        }
      }
    }
    var next = choice.next;
    if (!Object.prototype.hasOwnProperty.call(this.nodes, next)) {
      // Dialog ends.
      this.currentNode = null;
      if (this.onEnd) {
        try { this.onEnd(); } catch { /* ignore */ }
      }
      return true;
    }
    this.currentNode = next;
    this.fireOnEnter(next);
    return true;
  }

  // End the dialog immediately without firing any action.
  end(): void {
    if (this.disposed) return;
    if (this.currentNode === null) return;
    this.currentNode = null;
    if (this.onEnd) {
      try { this.onEnd(); } catch { /* ignore */ }
    }
  }

  // Register / replace predicates + actions at runtime. Useful when
  // the dialog catalog is loaded before the consumer's quest /
  // skill systems are available.
  setPredicate(name: string, fn: Predicate): void {
    this.predicates[name] = fn;
  }

  setAction(name: string, fn: Action): void {
    this.actions[name] = fn;
  }

  dispose(): void {
    this.currentNode = null;
    this.onEnd = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private fireOnEnter(nodeId: string): void {
    var node = this.nodes[nodeId];
    if (!node || !node.onEnter) return;
    var act = this.actions[node.onEnter];
    if (!act) return;
    try { act(); } catch { /* ignore */ }
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_DIALOG_TREE = 'dialog_tree';
