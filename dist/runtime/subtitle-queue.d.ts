export type SubtitleState = 'fadeIn' | 'visible' | 'fadeOut';
export interface SubtitleSpec {
    id: string;
    text: string;
    durationMs: number;
    speakerId?: string;
    priority?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
    data?: Record<string, unknown>;
}
export interface SubtitleSnapshot {
    id: string;
    text: string;
    speakerId: string | null;
    priority: number;
    state: SubtitleState;
    alpha: number;
    ageMs: number;
    remainingMs: number;
    data?: Record<string, unknown>;
}
export interface SubtitleQueueOptions {
    maxConcurrent?: number;
    onPush?: (line: SubtitleSnapshot) => void;
    onRemoved?: (line: SubtitleSnapshot, reason: 'expired' | 'cancelled' | 'cleared') => void;
}
export declare class SubtitleQueue {
    private lines;
    private maxConcurrent;
    private onPush;
    private onRemoved;
    private disposed;
    private constructor();
    static create(opts?: SubtitleQueueOptions): SubtitleQueue;
    push(spec: SubtitleSpec): boolean;
    cancel(id: string): boolean;
    cancelAll(): void;
    clear(): void;
    isShowing(id: string): boolean;
    count(): number;
    visible(maxLines?: number): SubtitleSnapshot[];
    list(): SubtitleSnapshot[];
    forEach(cb: (line: SubtitleSnapshot) => void): void;
    tick(dtMs: number): void;
    dispose(): void;
    private findIndex;
    private snapshot;
}
export declare const RESOURCE_SUBTITLE_QUEUE = "subtitle_queue";
//# sourceMappingURL=subtitle-queue.d.ts.map