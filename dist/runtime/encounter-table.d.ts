export interface EncounterEntry<T = Record<string, unknown>> {
    id: string;
    zones?: string[];
    phases?: string[];
    minLevel?: number;
    maxLevel?: number;
    tags?: string[];
    weight?: number;
    payload: T;
}
export interface RollContext {
    zone?: string;
    phase?: string;
    level?: number;
    tags?: string[];
}
export type RngFn = () => number;
export interface EncounterTableOptions {
    rng?: RngFn;
    seed?: number;
}
export declare class EncounterTable<T = Record<string, unknown>> {
    private entries;
    private rng;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: EncounterTableOptions): EncounterTable<T>;
    add(entry: EncounterEntry<T>): boolean;
    remove(id: string): boolean;
    has(id: string): boolean;
    size(): number;
    filter(ctx?: RollContext): EncounterEntry<T>[];
    list(): EncounterEntry<T>[];
    roll(ctx?: RollContext): EncounterEntry<T> | null;
    totalWeightFor(ctx?: RollContext): number;
    setRng(rng: RngFn): void;
    clear(): void;
    dispose(): void;
    private matches;
    private publicView;
}
export declare const RESOURCE_ENCOUNTER_TABLE = "encounter_table";
//# sourceMappingURL=encounter-table.d.ts.map