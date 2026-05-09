export interface GhostFrame {
    atMs: number;
    x: number;
    y: number;
    rotation?: number;
    animationId?: string;
    data?: Record<string, unknown>;
}
export interface Recording {
    frames: GhostFrame[];
    totalMs: number;
    label?: string;
}
export interface GhostSnapshot {
    id: string;
    x: number;
    y: number;
    rotation: number;
    animationId: string | null;
    data?: Record<string, unknown>;
    progress: number;
    elapsedMs: number;
    isPlaying: boolean;
    isPaused: boolean;
    speed: number;
    alpha: number;
}
export interface StartRecordingOptions {
    sampleRateMs?: number;
    maxFrames?: number;
    label?: string;
}
export interface PlayGhostOptions {
    id?: string;
    speed?: number;
    loop?: boolean;
    fadeInMs?: number;
    fadeOutMs?: number;
    onFinish?: () => void;
}
export interface GhostReplayOptions {
}
export declare class GhostReplay {
    private recording;
    private ghosts;
    private disposed;
    private constructor();
    static create(opts?: GhostReplayOptions): GhostReplay;
    startRecording(opts?: StartRecordingOptions): boolean;
    isRecording(): boolean;
    recordSnapshot(s: {
        x: number;
        y: number;
        rotation?: number;
        animationId?: string;
        data?: Record<string, unknown>;
    }): boolean;
    stopRecording(): Recording | null;
    cancelRecording(): void;
    play(recording: Recording, opts?: PlayGhostOptions): boolean;
    stop(id: string): boolean;
    stopAll(): void;
    pause(id: string): boolean;
    resume(id: string): boolean;
    setSpeed(id: string, multiplier: number): boolean;
    has(id: string): boolean;
    getGhost(id: string): GhostSnapshot | null;
    list(): GhostSnapshot[];
    forEach(cb: (s: GhostSnapshot) => void): void;
    count(): number;
    tick(dtMs: number): void;
    exportRecording(recording: Recording): string;
    importRecording(data: string): Recording | null;
    dispose(): void;
    private snapshotForGhost;
}
export declare const RESOURCE_GHOST_REPLAY = "ghost_replay";
//# sourceMappingURL=ghost-replay.d.ts.map