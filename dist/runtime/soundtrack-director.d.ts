export interface StateTransition {
    fadeMs?: number;
}
export interface MusicStateSpec {
    id: string;
    trackIds: string[];
    transitions?: Record<string, StateTransition>;
    defaultFadeMs?: number;
    minHoldMs?: number;
    data?: Record<string, unknown>;
}
export interface SetStateOptions {
    fadeMs?: number;
    force?: boolean;
}
export interface StingerSpec {
    id: string;
    trackId: string;
    durationMs: number;
    resumeAfter?: boolean;
}
export interface SoundtrackSnapshot {
    currentState: string | null;
    currentTrackId: string | null;
    previousState: string | null;
    previousTrackId: string | null;
    fadeProgress: number;
    stinger: {
        id: string;
        trackId: string;
        remainingMs: number;
    } | null;
}
export interface SoundtrackDirectorOptions {
    rng?: () => number;
    seed?: number;
}
export declare class SoundtrackDirector {
    private states;
    private currentStateId;
    private currentTrackId;
    private currentStateAge;
    private prevStateId;
    private prevTrackId;
    private fadeRemainingMs;
    private fadeTotalMs;
    private stinger;
    private rng;
    private disposed;
    private constructor();
    static create(opts?: SoundtrackDirectorOptions): SoundtrackDirector;
    defineState(spec: MusicStateSpec): boolean;
    hasState(id: string): boolean;
    stateIds(): string[];
    setState(stateId: string, opts?: SetStateOptions): boolean;
    getCurrentState(): string | null;
    pickTrack(stateId?: string): string | null;
    playStinger(spec: StingerSpec): boolean;
    cancelStinger(id: string): boolean;
    getSnapshot(): SoundtrackSnapshot;
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private pickTrackForState;
}
export declare const RESOURCE_SOUNDTRACK_DIRECTOR = "soundtrack_director";
//# sourceMappingURL=soundtrack-director.d.ts.map