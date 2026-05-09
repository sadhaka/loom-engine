// ActionHistory - undo / redo stack with command pattern.
//
// 0.67.0 enabling primitive. Map editors, level builders, dialog-
// authoring tools, and any in-game "I just made a mistake" surface
// want undo/redo. ActionHistory is the canonical command-stack
// machinery: each action knows how to apply itself and how to
// undo itself; pushing a new action clears the redo stack;
// undo/redo move actions between two stacks.
//
// The engine doesn't dictate WHAT actions do - they're consumer-
// supplied closures. The history just routes them.
//
// Code style: var-only in browser source.
export class ActionHistory {
    undoStack = [];
    redoStack = [];
    capacityNum;
    onApplied;
    onUndone;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && opts.capacity >= 0
            ? Math.floor(opts.capacity) : 100;
        this.onApplied = opts.onApplied ?? null;
        this.onUndone = opts.onUndone ?? null;
    }
    static create(opts = {}) {
        return new ActionHistory(opts);
    }
    // Push + apply a new action. Calls action.apply(), pushes onto
    // undo stack, clears the redo stack. Capacity overflow drops
    // the oldest action.
    push(action) {
        if (this.disposed)
            return;
        if (!action || typeof action.apply !== 'function' || typeof action.undo !== 'function')
            return;
        try {
            action.apply();
        }
        catch {
            // If apply throws, don't add to history - caller's state is
            // unchanged from their perspective.
            return;
        }
        this.undoStack.push(action);
        // Drop redo - new branch.
        this.redoStack.length = 0;
        // Trim to capacity (if bounded).
        if (this.capacityNum > 0 && this.undoStack.length > this.capacityNum) {
            this.undoStack.shift();
        }
        if (this.onApplied) {
            try {
                this.onApplied(action);
            }
            catch { /* ignore */ }
        }
    }
    // Undo the most recent action. Returns true if an action was
    // undone; false if the undo stack was empty.
    undo() {
        if (this.disposed)
            return false;
        var action = this.undoStack.pop();
        if (!action)
            return false;
        try {
            action.undo();
        }
        catch {
            // If undo throws, push the action back so the stacks stay
            // consistent.
            this.undoStack.push(action);
            return false;
        }
        this.redoStack.push(action);
        if (this.onUndone) {
            try {
                this.onUndone(action);
            }
            catch { /* ignore */ }
        }
        return true;
    }
    // Re-apply the most recently undone action. Returns true if an
    // action was redone; false if the redo stack was empty.
    redo() {
        if (this.disposed)
            return false;
        var action = this.redoStack.pop();
        if (!action)
            return false;
        try {
            action.apply();
        }
        catch {
            // Re-stack on failure.
            this.redoStack.push(action);
            return false;
        }
        this.undoStack.push(action);
        if (this.onApplied) {
            try {
                this.onApplied(action);
            }
            catch { /* ignore */ }
        }
        return true;
    }
    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
    // Read the topmost actions on each stack (for menu labels).
    // Returns null if the stack is empty.
    peekUndo() {
        return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null;
    }
    peekRedo() {
        return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null;
    }
    undoSize() { return this.undoStack.length; }
    redoSize() { return this.redoStack.length; }
    // Wipe both stacks. Does NOT call undo() on pending actions -
    // the caller is asserting the world is in a clean state.
    clear() {
        if (this.disposed)
            return;
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
    dispose() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.onApplied = null;
        this.onUndone = null;
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_ACTION_HISTORY = 'action_history';
//# sourceMappingURL=action-history.js.map