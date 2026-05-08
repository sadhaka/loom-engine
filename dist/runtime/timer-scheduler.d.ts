export interface TimerHandle {
    cancel(): void;
    isActive(): boolean;
    readonly id: number;
}
export interface TimerSchedulerOptions {
    maxFiresPerTick?: number;
}
export declare class TimerScheduler {
    private timers;
    private nextId;
    private firedCount;
    private cancelledCount;
    private maxFires;
    private disposed;
    private constructor();
    static create(opts?: TimerSchedulerOptions): TimerScheduler;
    setTimeout(fn: () => void, delayMs: number): TimerHandle;
    setInterval(fn: () => void, delayMs: number): TimerHandle;
    clearTimeout(handle: TimerHandle | number | null | undefined): void;
    clearInterval(handle: TimerHandle | number | null | undefined): void;
    cancelAll(): void;
    has(id: number): boolean;
    pendingCount(): number;
    tick(dtMs: number): void;
    stats(): {
        pending: number;
        fired: number;
        cancelled: number;
    };
    dispose(): void;
    private schedule;
    private cancelInternal;
}
export declare const RESOURCE_TIMER_SCHEDULER = "timer_scheduler";
//# sourceMappingURL=timer-scheduler.d.ts.map