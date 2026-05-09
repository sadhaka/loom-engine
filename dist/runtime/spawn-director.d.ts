export type SpawnFn = () => boolean;
export interface SpawnRule {
    id: string;
    zone: string;
    intervalMs?: number;
    spawnFn: SpawnFn;
    maxConcurrent?: number;
    maxPerZone?: number;
    gate?: (ctx: Record<string, unknown>) => boolean;
    data?: Record<string, unknown>;
}
export interface SpawnDirectorOptions {
    globalBudget?: number;
    context?: Record<string, unknown>;
    onSpawned?: (ruleId: string) => void;
    onRejected?: (ruleId: string, reason: RejectReason) => void;
}
export type RejectReason = 'cooldown' | 'gate' | 'maxConcurrent' | 'maxPerZone' | 'globalBudget' | 'spawnFnFailed' | 'spawnFnThrew';
export declare class SpawnDirector {
    private rules;
    private zoneCounts;
    private spawnedTotal;
    private globalBudget;
    private context;
    private onSpawned;
    private onRejected;
    private disposed;
    private constructor();
    static create(opts?: SpawnDirectorOptions): SpawnDirector;
    defineRule(rule: SpawnRule): boolean;
    removeRule(id: string): boolean;
    hasRule(id: string): boolean;
    notifySpawned(ruleId: string): boolean;
    notifyDespawned(ruleId: string): boolean;
    tryAttempt(ruleId: string): RejectReason | 'spawned';
    tick(dtMs: number): void;
    setContext(ctx: Record<string, unknown>): void;
    setGlobalBudget(budget: number): void;
    getSpawnedTotal(): number;
    getActiveCount(ruleId: string): number;
    getZoneCount(zone: string, ruleId: string): number;
    ruleCount(): number;
    ruleIds(): string[];
    clear(): void;
    dispose(): void;
    private attempt;
    private fireRejected;
}
export declare const RESOURCE_SPAWN_DIRECTOR = "spawn_director";
//# sourceMappingURL=spawn-director.d.ts.map