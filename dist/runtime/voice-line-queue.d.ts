export interface VOLineSpec {
    id: string;
    cueId: string;
    durationMs: number;
    channel?: string;
    priority?: number;
    resumeOnInterrupt?: boolean;
    data?: Record<string, unknown>;
}
export interface VOLineSnapshot {
    id: string;
    cueId: string;
    channel: string;
    priority: number;
    durationMs: number;
    elapsedMs: number;
    remainingMs: number;
    resumeOnInterrupt: boolean;
    data?: Record<string, unknown>;
}
export interface VoiceLineQueueOptions {
    onStart?: (line: VOLineSnapshot) => void;
    onEnd?: (line: VOLineSnapshot) => void;
    onInterrupt?: (line: VOLineSnapshot, interruptedBy: VOLineSnapshot) => void;
}
export declare class VoiceLineQueue {
    private channels;
    private onStart;
    private onEnd;
    private onInterrupt;
    private disposed;
    private constructor();
    static create(opts?: VoiceLineQueueOptions): VoiceLineQueue;
    enqueue(spec: VOLineSpec): boolean;
    cancelLine(id: string): boolean;
    cancelChannel(channelId: string): boolean;
    pauseChannel(channelId: string): boolean;
    resumeChannel(channelId: string): boolean;
    setChannelMute(channelId: string, muted: boolean): boolean;
    isMuted(channelId: string): boolean;
    getActive(channelId: string): VOLineSnapshot | null;
    isPlaying(channelId?: string): boolean;
    channelIds(): string[];
    activeChannels(): VOLineSnapshot[];
    queueLength(channelId: string): number;
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private getOrCreateChannel;
    private advance;
    private fireStart;
    private fireEnd;
    private fireInterrupt;
    private snapshot;
}
export declare const RESOURCE_VOICE_LINE_QUEUE = "voice_line_queue";
//# sourceMappingURL=voice-line-queue.d.ts.map