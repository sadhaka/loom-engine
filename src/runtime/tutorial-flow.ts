// TutorialFlow - sequenced UI hints with anchor-target tracking.
//
// 0.88.0 enabling primitive. New-player tutorials are a sequence of
// hints that point at parts of the UI: "click here to open inventory,"
// "drag this item into that slot," "press space to attack." Each step
// has an anchor (a UI element id), a message, and a condition that
// gates when the step should appear. TutorialFlow owns the sequence
// + persistence (so first-time tutorials don't replay every session).
//
//   var tut = TutorialFlow.create({
//     steps: [
//       { id: 'open-bag', anchorId: 'inv-button', message: 'Open your bag.' },
//       { id: 'equip', anchorId: 'slot-3', message: 'Drag the sword here.' },
//       { id: 'attack', anchorId: 'attack-btn', message: 'Press to attack.' },
//     ],
//     persist: { save: store.set, load: store.get },
//     onStepChanged: (next, prev) => hud.showHint(next),
//   });
//   tut.loadLocal();
//   render(tut.currentStep());
//   on player did the thing: tut.advance();
//
// Pairs with PersistentStorage (0.38) and ToastQueue (0.65) (the
// renderer typically pumps onStepChanged into a toast or overlay).
//
// Code style: var-only in browser source.

export interface TutorialStep {
  id: string;
  anchorId: string;
  message: string;
  // Optional condition. The step is "visible" only when this returns
  // true. The flow auto-skips steps whose condition is false at the
  // time advance() / currentStep() is called.
  condition?: () => boolean;
  onShow?: (step: TutorialStep) => void;
  onComplete?: (step: TutorialStep) => void;
  data?: Record<string, unknown>;
}

export interface TutorialPersistAdapter {
  save: (completedIds: string[]) => void;
  load: () => string[];
}

export interface TutorialFlowOptions {
  steps: TutorialStep[];
  persist?: TutorialPersistAdapter;
  onStepChanged?: (current: TutorialStep | null, prev: TutorialStep | null) => void;
  onFlowComplete?: () => void;
}

export class TutorialFlow {
  private steps: TutorialStep[];
  private completed: Set<string> = new Set();
  private persist: TutorialPersistAdapter | null;
  private onStepChanged: ((c: TutorialStep | null, p: TutorialStep | null) => void) | null;
  private onFlowComplete: (() => void) | null;
  private lastShownId: string | null = null;
  private flowCompleteFired: boolean = false;
  private disposed: boolean = false;

  private constructor(opts: TutorialFlowOptions) {
    this.steps = (opts.steps || []).map(cloneStep);
    this.persist = opts.persist ?? null;
    this.onStepChanged = opts.onStepChanged ?? null;
    this.onFlowComplete = opts.onFlowComplete ?? null;
  }

  static create(opts: TutorialFlowOptions): TutorialFlow {
    return new TutorialFlow(opts);
  }

  // The current visible step: first incomplete step whose condition
  // passes. Returns null if every step is done or condition-locked.
  // Calling currentStep() also pumps onStepChanged when the visible
  // step changed since the last call, and fires onShow for new step.
  currentStep(): TutorialStep | null {
    if (this.disposed) return null;
    var next = this.findCurrent();
    if (next === null) {
      this.flushChange(null);
      this.maybeFireFlowComplete();
      return null;
    }
    var prev = this.lastShownId;
    if (next.id !== prev) {
      this.flushChange(next);
      if (next.onShow) {
        try { next.onShow(next); } catch { /* ignore */ }
      }
    }
    return cloneStep(next);
  }

  // Mark current step complete + advance.
  advance(): boolean {
    if (this.disposed) return false;
    var current = this.findCurrent();
    if (!current) return false;
    this.completed.add(current.id);
    if (current.onComplete) {
      try { current.onComplete(current); } catch { /* ignore */ }
    }
    // Fire onStepChanged for the new state.
    var next = this.findCurrent();
    if (!next) {
      this.flushChange(null);
      this.maybeFireFlowComplete();
    } else if (next.id !== current.id) {
      this.flushChange(next);
      if (next.onShow) {
        try { next.onShow(next); } catch { /* ignore */ }
      }
    }
    return true;
  }

  // Mark a specific step complete (e.g. player did the thing
  // out-of-order). Returns false if id unknown / disposed.
  completeStep(id: string): boolean {
    if (this.disposed) return false;
    var step = this.findStep(id);
    if (!step) return false;
    if (this.completed.has(id)) return true;
    this.completed.add(id);
    if (step.onComplete) {
      try { step.onComplete(step); } catch { /* ignore */ }
    }
    // Pump current.
    void this.currentStep();
    return true;
  }

  // Mark every step complete.
  skipAll(): void {
    if (this.disposed) return;
    for (var i = 0; i < this.steps.length; i++) {
      var s = this.steps[i] as TutorialStep;
      this.completed.add(s.id);
    }
    this.flushChange(null);
    this.maybeFireFlowComplete();
  }

  // Reset all completion state.
  restart(): void {
    if (this.disposed) return;
    this.completed.clear();
    this.lastShownId = null;
    this.flowCompleteFired = false;
    void this.currentStep();
  }

  isComplete(): boolean {
    return this.findCurrent() === null;
  }

  isCompleted(id: string): boolean {
    return this.completed.has(id);
  }

  completedIds(): string[] {
    return Array.from(this.completed);
  }

  saveLocal(): void {
    if (this.disposed || !this.persist) return;
    try { this.persist.save(this.completedIds()); } catch { /* ignore */ }
  }

  loadLocal(): void {
    if (this.disposed || !this.persist) return;
    var loaded: string[];
    try { loaded = this.persist.load(); } catch { return; }
    if (!Array.isArray(loaded)) return;
    this.completed.clear();
    for (var i = 0; i < loaded.length; i++) {
      var id = loaded[i];
      if (typeof id === 'string' && id.length > 0) this.completed.add(id);
    }
    this.lastShownId = null;
    this.flowCompleteFired = false;
    void this.currentStep();
  }

  steps_(): TutorialStep[] {
    return this.steps.map(cloneStep);
  }

  dispose(): void {
    this.steps = [];
    this.completed.clear();
    this.persist = null;
    this.onStepChanged = null;
    this.onFlowComplete = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private findCurrent(): TutorialStep | null {
    for (var i = 0; i < this.steps.length; i++) {
      var s = this.steps[i] as TutorialStep;
      if (this.completed.has(s.id)) continue;
      if (s.condition) {
        try { if (!s.condition()) continue; } catch { continue; }
      }
      return s;
    }
    return null;
  }

  private findStep(id: string): TutorialStep | null {
    for (var i = 0; i < this.steps.length; i++) {
      var s = this.steps[i] as TutorialStep;
      if (s.id === id) return s;
    }
    return null;
  }

  private flushChange(next: TutorialStep | null): void {
    var prevId = this.lastShownId;
    var nextId = next ? next.id : null;
    if (prevId === nextId) return;
    var prev = prevId ? this.findStep(prevId) : null;
    this.lastShownId = nextId;
    if (this.onStepChanged) {
      try { this.onStepChanged(next ? cloneStep(next) : null, prev ? cloneStep(prev) : null); }
      catch { /* ignore */ }
    }
  }

  private maybeFireFlowComplete(): void {
    if (this.flowCompleteFired) return;
    if (this.steps.length === 0) return;
    if (this.findCurrent() !== null) return;
    this.flowCompleteFired = true;
    if (this.onFlowComplete) {
      try { this.onFlowComplete(); } catch { /* ignore */ }
    }
  }
}

function cloneStep(s: TutorialStep): TutorialStep {
  var copy: TutorialStep = { id: s.id, anchorId: s.anchorId, message: s.message };
  if (s.condition) copy.condition = s.condition;
  if (s.onShow) copy.onShow = s.onShow;
  if (s.onComplete) copy.onComplete = s.onComplete;
  if (s.data) copy.data = s.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_TUTORIAL_FLOW = 'tutorial_flow';
