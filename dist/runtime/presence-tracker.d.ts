export interface PresenceEntry<T = Record<string, unknown>> {
    id: string;
    lastSeenAt: number;
    heartbeatCount: number;
    firstSeenAt: number;
    data?: T;
}
export interface PresenceOptions {
    timeoutMs?: number;
    maxEntries?: number;
}
export declare class PresenceTracker<T = Record<string, unknown>> {
    private entries;
    private timeoutMs;
    private maxEntries;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: PresenceOptions): PresenceTracker<T>;
    heartbeat(id: string, data: T | undefined, now: number): PresenceEntry<T> | null;
    remove(id: string): boolean;
    tick(now: number): string[];
    get(id: string): PresenceEntry<T> | null;
    has(id: string): boolean;
    list(): PresenceEntry<T>[];
    count(): number;
    staleCount(now: number): number;
    getTimeoutMs(): number;
    setTimeoutMs(ms: number): void;
    clear(): void;
    private snapshot;
    private evictOldest;
}
export declare const RESOURCE_PRESENCE_TRACKER = "presence_tracker";
//# sourceMappingURL=presence-tracker.d.ts.map