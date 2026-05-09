export interface WatchdogEntryOptions {
    timeoutMs?: number;
    onStale?: () => void;
    onAlive?: () => void;
}
export interface WatchdogStatus {
    name: string;
    ageMs: number;
    timeoutMs: number;
    alive: boolean;
}
export interface WatchdogOptions {
    defaultTimeoutMs?: number;
}
export declare class Watchdog {
    private entries;
    private defaultTimeoutMs;
    private disposed;
    private constructor();
    static create(opts?: WatchdogOptions): Watchdog;
    register(name: string, opts?: WatchdogEntryOptions): boolean;
    unregister(name: string): boolean;
    has(name: string): boolean;
    heartbeat(name: string): boolean;
    tick(dtMs: number): void;
    status(name: string): WatchdogStatus | null;
    isAlive(name: string): boolean;
    list(): WatchdogStatus[];
    staleNames(): string[];
    setTimeout(name: string, timeoutMs: number): boolean;
    count(): number;
    clear(): void;
    dispose(): void;
}
export declare const RESOURCE_WATCHDOG = "watchdog";
//# sourceMappingURL=watchdog.d.ts.map