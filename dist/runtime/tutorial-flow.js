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
export class TutorialFlow {
    steps;
    completed = new Set();
    persist;
    onStepChanged;
    onFlowComplete;
    lastShownId = null;
    flowCompleteFired = false;
    disposed = false;
    constructor(opts) {
        this.steps = (opts.steps || []).map(cloneStep);
        this.persist = opts.persist ?? null;
        this.onStepChanged = opts.onStepChanged ?? null;
        this.onFlowComplete = opts.onFlowComplete ?? null;
    }
    static create(opts) {
        return new TutorialFlow(opts);
    }
    // The current visible step: first incomplete step whose condition
    // passes. Returns null if every step is done or condition-locked.
    // Calling currentStep() also pumps onStepChanged when the visible
    // step changed since the last call, and fires onShow for new step.
    currentStep() {
        if (this.disposed)
            return null;
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
                try {
                    next.onShow(next);
                }
                catch { /* ignore */ }
            }
        }
        return cloneStep(next);
    }
    // Mark current step complete + advance.
    advance() {
        if (this.disposed)
            return false;
        var current = this.findCurrent();
        if (!current)
            return false;
        this.completed.add(current.id);
        if (current.onComplete) {
            try {
                current.onComplete(current);
            }
            catch { /* ignore */ }
        }
        // Fire onStepChanged for the new state.
        var next = this.findCurrent();
        if (!next) {
            this.flushChange(null);
            this.maybeFireFlowComplete();
        }
        else if (next.id !== current.id) {
            this.flushChange(next);
            if (next.onShow) {
                try {
                    next.onShow(next);
                }
                catch { /* ignore */ }
            }
        }
        return true;
    }
    // Mark a specific step complete (e.g. player did the thing
    // out-of-order). Returns false if id unknown / disposed.
    completeStep(id) {
        if (this.disposed)
            return false;
        var step = this.findStep(id);
        if (!step)
            return false;
        if (this.completed.has(id))
            return true;
        this.completed.add(id);
        if (step.onComplete) {
            try {
                step.onComplete(step);
            }
            catch { /* ignore */ }
        }
        // Pump current.
        void this.currentStep();
        return true;
    }
    // Mark every step complete.
    skipAll() {
        if (this.disposed)
            return;
        for (var i = 0; i < this.steps.length; i++) {
            var s = this.steps[i];
            this.completed.add(s.id);
        }
        this.flushChange(null);
        this.maybeFireFlowComplete();
    }
    // Reset all completion state.
    restart() {
        if (this.disposed)
            return;
        this.completed.clear();
        this.lastShownId = null;
        this.flowCompleteFired = false;
        void this.currentStep();
    }
    isComplete() {
        return this.findCurrent() === null;
    }
    isCompleted(id) {
        return this.completed.has(id);
    }
    completedIds() {
        return Array.from(this.completed);
    }
    saveLocal() {
        if (this.disposed || !this.persist)
            return;
        try {
            this.persist.save(this.completedIds());
        }
        catch { /* ignore */ }
    }
    loadLocal() {
        if (this.disposed || !this.persist)
            return;
        var loaded;
        try {
            loaded = this.persist.load();
        }
        catch {
            return;
        }
        if (!Array.isArray(loaded))
            return;
        this.completed.clear();
        for (var i = 0; i < loaded.length; i++) {
            var id = loaded[i];
            if (typeof id === 'string' && id.length > 0)
                this.completed.add(id);
        }
        this.lastShownId = null;
        this.flowCompleteFired = false;
        void this.currentStep();
    }
    steps_() {
        return this.steps.map(cloneStep);
    }
    dispose() {
        this.steps = [];
        this.completed.clear();
        this.persist = null;
        this.onStepChanged = null;
        this.onFlowComplete = null;
        this.disposed = true;
    }
    // ---------- private ----------
    findCurrent() {
        for (var i = 0; i < this.steps.length; i++) {
            var s = this.steps[i];
            if (this.completed.has(s.id))
                continue;
            if (s.condition) {
                try {
                    if (!s.condition())
                        continue;
                }
                catch {
                    continue;
                }
            }
            return s;
        }
        return null;
    }
    findStep(id) {
        for (var i = 0; i < this.steps.length; i++) {
            var s = this.steps[i];
            if (s.id === id)
                return s;
        }
        return null;
    }
    flushChange(next) {
        var prevId = this.lastShownId;
        var nextId = next ? next.id : null;
        if (prevId === nextId)
            return;
        var prev = prevId ? this.findStep(prevId) : null;
        this.lastShownId = nextId;
        if (this.onStepChanged) {
            try {
                this.onStepChanged(next ? cloneStep(next) : null, prev ? cloneStep(prev) : null);
            }
            catch { /* ignore */ }
        }
    }
    maybeFireFlowComplete() {
        if (this.flowCompleteFired)
            return;
        if (this.steps.length === 0)
            return;
        if (this.findCurrent() !== null)
            return;
        this.flowCompleteFired = true;
        if (this.onFlowComplete) {
            try {
                this.onFlowComplete();
            }
            catch { /* ignore */ }
        }
    }
}
function cloneStep(s) {
    var copy = { id: s.id, anchorId: s.anchorId, message: s.message };
    if (s.condition)
        copy.condition = s.condition;
    if (s.onShow)
        copy.onShow = s.onShow;
    if (s.onComplete)
        copy.onComplete = s.onComplete;
    if (s.data)
        copy.data = s.data;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_TUTORIAL_FLOW = 'tutorial_flow';
//# sourceMappingURL=tutorial-flow.js.map