export interface Action {
    label?: string;
    apply: () => void;
    undo: () => void;
}
export interface ActionHistoryOptions {
    capacity?: number;
    onApplied?: (action: Action) => void;
    onUndone?: (action: Action) => void;
}
export declare class ActionHistory {
    private undoStack;
    private redoStack;
    private capacityNum;
    private onApplied;
    private onUndone;
    private disposed;
    private constructor();
    static create(opts?: ActionHistoryOptions): ActionHistory;
    push(action: Action): void;
    undo(): boolean;
    redo(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    peekUndo(): Action | null;
    peekRedo(): Action | null;
    undoSize(): number;
    redoSize(): number;
    clear(): void;
    dispose(): void;
}
export declare const RESOURCE_ACTION_HISTORY = "action_history";
//# sourceMappingURL=action-history.d.ts.map