export type ToastSeverity = 'info' | 'success' | 'warn' | 'error' | 'critical';
export interface Toast {
    id: number;
    severity: ToastSeverity;
    message: string;
    remainingMs: number;
    ageMs: number;
    data?: Record<string, unknown>;
}
export interface PostOptions {
    lifetimeMs?: number;
    data?: Record<string, unknown>;
}
export interface ToastQueueOptions {
    capacity?: number;
    defaultLifetimeMs?: Partial<Record<ToastSeverity, number>>;
    onPost?: (toast: Toast) => void;
    onRemoved?: (toast: Toast, reason: 'expired' | 'dismissed' | 'evicted') => void;
}
export declare class ToastQueue {
    private toasts;
    private nextId;
    private capacityNum;
    private lifetimes;
    private onPost;
    private onRemoved;
    private disposed;
    private constructor();
    static create(opts?: ToastQueueOptions): ToastQueue;
    post(severity: ToastSeverity, message: string, opts?: PostOptions): number;
    info(msg: string, opts?: PostOptions): number;
    success(msg: string, opts?: PostOptions): number;
    warn(msg: string, opts?: PostOptions): number;
    error(msg: string, opts?: PostOptions): number;
    critical(msg: string, opts?: PostOptions): number;
    tick(dtMs: number): void;
    dismiss(id: number): boolean;
    clear(): void;
    forEach(cb: (t: Toast) => void): void;
    list(): Toast[];
    count(): number;
    capacity(): number;
    dispose(): void;
    private evictOne;
}
export declare const RESOURCE_TOAST_QUEUE = "toast_queue";
//# sourceMappingURL=toast-queue.d.ts.map