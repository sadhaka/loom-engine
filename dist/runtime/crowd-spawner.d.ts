export interface SpawnDef<TMob = unknown> {
    id: string;
    factory: () => TMob;
    max?: number;
    weight?: number;
}
export interface CrowdSpawnerOptions {
    totalBudget?: number;
    rng?: () => number;
}
export declare class CrowdSpawner<TMob = unknown> {
    private spawns;
    private totalActive;
    private budget;
    private rng;
    private disposed;
    private constructor();
    static create<TMob = unknown>(opts?: CrowdSpawnerOptions): CrowdSpawner<TMob>;
    registerSpawn(def: SpawnDef<TMob>): boolean;
    unregisterSpawn(id: string): boolean;
    has(id: string): boolean;
    spawnOne(id: string): TMob | null;
    spawnRandom(): TMob | null;
    notifyDespawn(id: string): boolean;
    activeCountOf(id: string): number;
    getTotalActive(): number;
    totalBudget(): number;
    budgetRemaining(): number;
    size(): number;
    list(): SpawnDef<TMob>[];
    clear(): void;
    dispose(): void;
}
export declare const RESOURCE_CROWD_SPAWNER = "crowd_spawner";
//# sourceMappingURL=crowd-spawner.d.ts.map