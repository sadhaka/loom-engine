export interface EngineClockOptions {
    timeScale?: number;
    defaultStepMs?: number;
}
export declare class EngineClock {
    private paused;
    private scaleValue;
    private simulatedMs;
    private realMs;
    private stepCount;
    private readonly defaultStepMsValue;
    constructor(opts?: EngineClockOptions);
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    setTimeScale(scale: number): void;
    timeScale(): number;
    defaultStepMs(): number;
    tick(realDtMs: number): number;
    step(stepMs?: number): number;
    totalSimulatedMs(): number;
    totalRealMs(): number;
    totalSteps(): number;
    resetCounters(): void;
}
export declare const RESOURCE_ENGINE_CLOCK = "loom.engine_clock";
//# sourceMappingURL=engine-clock.d.ts.map