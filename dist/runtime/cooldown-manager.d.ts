export interface CooldownManagerOptions {
    onReady?: (key: string) => void;
}
export declare class CooldownManager {
    private cds;
    private onReady;
    private disposed;
    private constructor();
    static create(opts?: CooldownManagerOptions): CooldownManager;
    start(key: string, durationMs: number): void;
    tick(dtMs: number): void;
    isReady(key: string): boolean;
    isOnCooldown(key: string): boolean;
    remaining(key: string): number;
    totalFor(key: string): number;
    fractionElapsed(key: string): number;
    clear(key: string): boolean;
    clearAll(): void;
    activeCount(): number;
    activeKeys(): string[];
    tryUse(key: string, durationMs: number): boolean;
    dispose(): void;
}
export declare const RESOURCE_COOLDOWN_MANAGER = "cooldown_manager";
//# sourceMappingURL=cooldown-manager.d.ts.map