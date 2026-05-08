export interface FrameBudgetTaskDef {
    id?: string;
    priority?: number;
    step: () => boolean;
    onComplete?: () => void;
    onCancel?: () => void;
}
export interface FrameBudgetStats {
    budgetMs: number;
    spentMs: number;
    ranCount: number;
    completedCount: number;
    pendingCount: number;
    overBudget: boolean;
}
export interface FrameBudgetSchedulerOptions {
    budgetMs?: number;
    now?: () => number;
}
export declare class FrameBudgetScheduler {
    private budgetMs;
    private nowMs;
    private queue;
    private byId;
    private synthCounter;
    private insertCounter;
    private disposed;
    private constructor();
    static create(opts?: FrameBudgetSchedulerOptions): FrameBudgetScheduler;
    schedule(task: FrameBudgetTaskDef): string;
    cancel(id: string): boolean;
    has(id: string): boolean;
    pendingCount(): number;
    setBudgetMs(ms: number): void;
    getBudgetMs(): number;
    tick(): FrameBudgetStats;
    flush(): FrameBudgetStats;
    dispose(): void;
}
export declare const RESOURCE_FRAME_BUDGET_SCHEDULER = "frame_budget_scheduler";
//# sourceMappingURL=frame-budget-scheduler.d.ts.map