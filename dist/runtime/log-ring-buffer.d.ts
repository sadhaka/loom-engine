export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface LogEntry {
    id: number;
    level: LogLevel;
    message: string;
    timestampMs: number;
    channel?: string;
    data?: Record<string, unknown>;
}
export interface LogRingBufferOptions {
    capacity?: number;
    minLevel?: LogLevel;
    sink?: (entry: LogEntry) => void;
    now?: () => number;
}
export interface LogFilter {
    minLevel?: LogLevel;
    since?: number;
    channel?: string | string[];
}
export declare class LogRingBuffer {
    private buffer;
    private capacityNum;
    private head;
    private size;
    private nextId;
    private droppedCount;
    private minLevel;
    private nowMs;
    private sink;
    private disposed;
    private constructor();
    static create(opts?: LogRingBufferOptions): LogRingBuffer;
    log(level: LogLevel, message: string, extras?: {
        channel?: string;
        data?: Record<string, unknown>;
    }): number;
    debug(message: string, extras?: {
        channel?: string;
        data?: Record<string, unknown>;
    }): number;
    info(message: string, extras?: {
        channel?: string;
        data?: Record<string, unknown>;
    }): number;
    warn(message: string, extras?: {
        channel?: string;
        data?: Record<string, unknown>;
    }): number;
    error(message: string, extras?: {
        channel?: string;
        data?: Record<string, unknown>;
    }): number;
    fatal(message: string, extras?: {
        channel?: string;
        data?: Record<string, unknown>;
    }): number;
    setMinLevel(level: LogLevel): void;
    getMinLevel(): LogLevel;
    count(): number;
    capacity(): number;
    droppedSinceStart(): number;
    tail(n?: number): LogEntry[];
    all(): LogEntry[];
    filter(opts: LogFilter): LogEntry[];
    clear(): void;
    dispose(): void;
}
export declare const RESOURCE_LOG_RING_BUFFER = "log_ring_buffer";
//# sourceMappingURL=log-ring-buffer.d.ts.map