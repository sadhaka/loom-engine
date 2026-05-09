export interface AudioCue {
    id: string;
    priority?: number;
    data?: Record<string, unknown>;
}
export interface AudioCueQueueOptions {
    capacity?: number;
}
export declare class AudioCueQueue {
    private entries;
    private capacityNum;
    private nextSeq;
    private disposed;
    private constructor();
    static create(opts?: AudioCueQueueOptions): AudioCueQueue;
    enqueue(cue: AudioCue): boolean;
    next(): AudioCue | null;
    peek(): AudioCue | null;
    size(): number;
    capacity(): number;
    clear(): void;
    removeById(id: string): number;
    list(): AudioCue[];
    dispose(): void;
    private dropLowestPriority;
}
export declare const RESOURCE_AUDIO_CUE_QUEUE = "audio_cue_queue";
//# sourceMappingURL=audio-cue-queue.d.ts.map