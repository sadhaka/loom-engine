export type RngFn = () => number;
export interface TierSpec {
    id: string;
    weight?: number;
}
export interface LootItem<T = Record<string, unknown>> {
    id: string;
    tier: string;
    weight?: number;
    tags?: string[];
    payload: T;
}
export interface DropResult<T = Record<string, unknown>> {
    tier: string;
    id: string;
    payload: T;
    tags?: string[];
}
export interface RollContext {
    level?: number;
    tags?: string[];
    requireTagMatch?: boolean;
    tier?: string;
}
export type TierScaleFn = (tierId: string, ctx: RollContext) => number;
export interface LootTierOptions {
    rng?: RngFn;
    seed?: number;
}
export declare class LootTier<T = Record<string, unknown>> {
    private tiers;
    private items;
    private itemsByTierIndex;
    private rng;
    private tierScaleFn;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: LootTierOptions): LootTier<T>;
    defineTier(spec: TierSpec): boolean;
    removeTier(id: string): boolean;
    hasTier(id: string): boolean;
    tierIds(): string[];
    tierCount(): number;
    addItem(item: LootItem<T>): boolean;
    removeItem(id: string): boolean;
    hasItem(id: string): boolean;
    size(): number;
    itemsByTier(tier: string): LootItem<T>[];
    list(): LootItem<T>[];
    setTierScaleFn(fn: TierScaleFn | null): void;
    effectiveTierWeights(ctx?: RollContext): {
        id: string;
        weight: number;
    }[];
    rollTier(ctx?: RollContext): string | null;
    rollItem(ctx?: RollContext): DropResult<T> | null;
    rollItems(count: number, ctx?: RollContext): DropResult<T>[];
    rollItemsUnique(count: number, ctx?: RollContext): DropResult<T>[];
    setRng(rng: RngFn): void;
    clear(): void;
    dispose(): void;
    private rollItemInTier;
    private safeRng;
    private toDropResult;
    private publicItem;
}
export declare const RESOURCE_LOOT_TIER = "loot_tier";
//# sourceMappingURL=loot-tier.d.ts.map