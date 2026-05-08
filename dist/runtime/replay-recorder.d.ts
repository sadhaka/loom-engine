export interface ReplayEvent {
    type: string;
    key?: string;
    data?: Record<string, unknown>;
    tick: number;
}
export interface ReplayStep {
    tick: number;
    dtMs: number;
    events: ReplayEvent[];
}
export interface ReplayTrace {
    version: number;
    engineVersion: string;
    initialSeed: number;
    initialSnapshot: unknown;
    steps: ReplayStep[];
}
export interface ReplayRecorderOptions {
    initialSeed?: number;
    engineVersion?: string;
    maxSteps?: number;
}
export type RecorderMode = 'idle' | 'recording' | 'playback' | 'finished';
export declare class ReplayRecorder {
    private mode;
    private initialSeed;
    private engineVersion;
    private maxSteps;
    private initialSnapshot;
    private steps;
    private pendingEvents;
    private cursor;
    private constructor();
    static create(opts?: ReplayRecorderOptions): ReplayRecorder;
    static fromTrace(trace: ReplayTrace): ReplayRecorder;
    attachInitialSnapshot(snap: unknown): void;
    getInitialSeed(): number;
    getEngineVersion(): string;
    getInitialSnapshot(): unknown;
    getMode(): RecorderMode;
    stepCount(): number;
    startRecording(): void;
    recordEvent(type: string, key?: string, data?: Record<string, unknown>): void;
    recordTick(dtMs: number): ReplayStep | null;
    stopRecording(): void;
    startPlayback(): void;
    nextStep(): ReplayStep | null;
    hasNextStep(): boolean;
    rewind(): void;
    stopPlayback(): void;
    toTrace(): ReplayTrace;
}
export declare const RESOURCE_REPLAY_RECORDER = "replay_recorder";
//# sourceMappingURL=replay-recorder.d.ts.map