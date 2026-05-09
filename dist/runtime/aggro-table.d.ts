export interface AggroTableOptions {
    decayPerSecond?: number;
    minThreat?: number;
    maxTargets?: number;
}
export interface AggroEntry {
    target: string;
    threat: number;
    lastHitAt: number;
}
export declare class AggroTable {
    private entries;
    private decay;
    private minThreat;
    private maxTargets;
    private hitSeq;
    private disposed;
    private constructor();
    static create(opts?: AggroTableOptions): AggroTable;
    addThreat(target: string, amount: number): void;
    setThreat(target: string, amount: number): void;
    remove(target: string): boolean;
    clear(): void;
    getThreat(target: string): number;
    has(target: string): boolean;
    topTarget(): string | null;
    lastHitTarget(): string | null;
    list(): AggroEntry[];
    tick(dtMs: number): void;
    setDecayPerSecond(rate: number): void;
    size(): number;
    dispose(): void;
    private evictIfFull;
}
export declare const RESOURCE_AGGRO_TABLE = "aggro_table";
//# sourceMappingURL=aggro-table.d.ts.map