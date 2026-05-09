export interface VoiceMarker {
    atMs: number;
    kind: string;
    payload?: Record<string, unknown>;
}
export interface VoiceLine {
    nodeId: string;
    cueId: string;
    durationMs: number;
    markers?: VoiceMarker[];
    data?: Record<string, unknown>;
}
export interface VoiceLineState {
    nodeId: string;
    cueId: string;
    durationMs: number;
    elapsedMs: number;
    isPlaying: boolean;
    isPaused: boolean;
    progress: number;
}
export interface PlayLineOptions {
    speed?: number;
    onMarker?: (m: VoiceMarker) => void;
    onLineEnd?: () => void;
    autoAdvance?: boolean;
}
export interface QueueOptions extends PlayLineOptions {
    nodeIds: string[];
}
export interface DialogVoiceOptions {
}
export declare class DialogVoice {
    private lines;
    private active;
    private queue;
    private disposed;
    private constructor();
    static create(opts?: DialogVoiceOptions): DialogVoice;
    registerLine(line: VoiceLine): boolean;
    unregisterLine(nodeId: string): boolean;
    hasLine(nodeId: string): boolean;
    getLine(nodeId: string): VoiceLine | null;
    lineCount(): number;
    play(nodeId: string, opts?: PlayLineOptions): boolean;
    playQueue(opts: QueueOptions): boolean;
    enqueue(nodeId: string, opts?: PlayLineOptions): boolean;
    interrupt(): boolean;
    pause(): void;
    resume(): void;
    isPlaying(): boolean;
    isPaused(): boolean;
    queueLength(): number;
    getCurrent(): VoiceLineState | null;
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
}
export declare const RESOURCE_DIALOG_VOICE = "dialog_voice";
//# sourceMappingURL=dialog-voice.d.ts.map