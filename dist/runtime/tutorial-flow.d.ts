export interface TutorialStep {
    id: string;
    anchorId: string;
    message: string;
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
export declare class TutorialFlow {
    private steps;
    private completed;
    private persist;
    private onStepChanged;
    private onFlowComplete;
    private lastShownId;
    private flowCompleteFired;
    private disposed;
    private constructor();
    static create(opts: TutorialFlowOptions): TutorialFlow;
    currentStep(): TutorialStep | null;
    advance(): boolean;
    completeStep(id: string): boolean;
    skipAll(): void;
    restart(): void;
    isComplete(): boolean;
    isCompleted(id: string): boolean;
    completedIds(): string[];
    saveLocal(): void;
    loadLocal(): void;
    steps_(): TutorialStep[];
    dispose(): void;
    private findCurrent;
    private findStep;
    private flushChange;
    private maybeFireFlowComplete;
}
export declare const RESOURCE_TUTORIAL_FLOW = "tutorial_flow";
//# sourceMappingURL=tutorial-flow.d.ts.map