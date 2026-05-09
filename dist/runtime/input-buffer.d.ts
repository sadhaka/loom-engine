export interface BufferedInput<T = unknown> {
    id: number;
    value: T;
    ageMs: number;
    remainingMs: number;
}
export interface BufferOptions {
    windowMs?: number;
}
export type RemovedReason = 'consumed' | 'expired' | 'evicted' | 'cleared';
export interface InputBufferOptions<T = unknown> {
    defaultWindowMs?: number;
    capacity?: number;
    onBuffer?: (i: BufferedInput<T>) => void;
    onRemoved?: (i: BufferedInput<T>, reason: RemovedReason) => void;
}
export declare class InputBuffer<T = unknown> {
    private items;
    private nextId;
    private capacityNum;
    private defaultWindow;
    private onBuffer;
    private onRemoved;
    private disposed;
    private constructor();
    static create<T = unknown>(opts?: InputBufferOptions<T>): InputBuffer<T>;
    buffer(value: T, opts?: BufferOptions): number;
    consume(predicate: (i: BufferedInput<T>) => boolean): BufferedInput<T> | null;
    peek(predicate: (i: BufferedInput<T>) => boolean): BufferedInput<T> | null;
    consumeOldest(): BufferedInput<T> | null;
    removeById(id: number): boolean;
    has(id: number): boolean;
    tick(dtMs: number): void;
    forEach(cb: (i: BufferedInput<T>) => void): void;
    list(): BufferedInput<T>[];
    count(): number;
    capacity(): number;
    clear(): void;
    dispose(): void;
    private evictOldest;
    private snapshot;
}
export declare const RESOURCE_INPUT_BUFFER = "input_buffer";
//# sourceMappingURL=input-buffer.d.ts.map