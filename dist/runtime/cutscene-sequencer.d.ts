export interface Cue {
    atMs: number;
    kind: string;
    payload?: Record<string, unknown>;
    id?: string;
}
export interface CutsceneState {
    elapsedMs: number;
    totalMs: number;
    isPlaying: boolean;
    isPaused: boolean;
    progress: number;
    speed: number;
    firedCount: number;
}
export interface PlayOptions {
    cues: Cue[];
    totalMs?: number;
    speed?: number;
    onCue?: (cue: Cue) => void;
    onFinish?: () => void;
}
export interface CutsceneSequencerOptions {
}
export declare class CutsceneSequencer {
    private cues;
    private elapsed;
    private totalMs;
    private speed;
    private playing;
    private paused;
    private firedCount;
    private onCue;
    private onFinish;
    private disposed;
    private constructor();
    static create(opts?: CutsceneSequencerOptions): CutsceneSequencer;
    play(opts: PlayOptions): boolean;
    tick(dtMs: number): void;
    pause(): void;
    resume(): void;
    stop(): void;
    setSpeed(multiplier: number): void;
    jumpTo(ms: number): void;
    isPlaying(): boolean;
    isPaused(): boolean;
    getState(): CutsceneState;
    dispose(): void;
    private fireCuesUpTo;
    private publicView;
}
export declare const RESOURCE_CUTSCENE_SEQUENCER = "cutscene_sequencer";
//# sourceMappingURL=cutscene-sequencer.d.ts.map