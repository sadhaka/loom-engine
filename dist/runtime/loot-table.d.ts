export interface LootEntry {
    itemId: string;
    weight: number;
    count?: number;
    countRange?: [number, number];
}
export interface LootDrop {
    itemId: string;
    count: number;
}
export interface LootTableOptions {
    entries: LootEntry[];
    rollCount?: number;
    guaranteed?: string[];
    seed?: number;
}
export declare class LootTable {
    private entries;
    private weightedPool;
    private cumulativeWeights;
    private totalWeight;
    private rollCount;
    private guaranteed;
    private rng;
    private seed;
    private disposed;
    private constructor();
    static create(opts: LootTableOptions): LootTable;
    poolSize(): number;
    totalWeightSum(): number;
    reseed(seed?: number): void;
    roll(): LootDrop[];
    rollMultiple(times: number): LootDrop[];
    probabilityOf(itemId: string): number;
    dispose(): void;
    private findEntry;
    private resolveCount;
    private weightedPick;
}
export declare const RESOURCE_LOOT_TABLE = "loot_table";
//# sourceMappingURL=loot-table.d.ts.map