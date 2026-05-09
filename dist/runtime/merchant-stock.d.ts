export type PriceModifierFn = (basePrice: number, itemId: string, ctx: Record<string, unknown>) => number;
export interface StockItemSpec<T = Record<string, unknown>> {
    id: string;
    currentStock?: number;
    maxStock?: number;
    restockAmount?: number;
    restockIntervalMs?: number;
    basePrice?: number;
    payload?: T;
}
export interface StockItem<T = Record<string, unknown>> {
    id: string;
    currentStock: number;
    maxStock: number;
    restockAmount: number;
    restockIntervalMs: number;
    basePrice: number;
    payload?: T;
    ageSinceRestockMs: number;
}
export interface BuyResult {
    ok: boolean;
    reason?: 'unknown_item' | 'out_of_stock' | 'invalid_qty';
    unitsSold: number;
    totalCost: number;
}
export interface SellResult {
    ok: boolean;
    reason?: 'unknown_item' | 'invalid_qty' | 'cap_hit';
    unitsBought: number;
    totalPaid: number;
}
export interface MerchantStockOptions<T = Record<string, unknown>> {
    priceFn?: PriceModifierFn;
    sellbackPct?: number;
    data?: Record<string, T>;
}
export declare class MerchantStock<T = Record<string, unknown>> {
    private items;
    private priceFn;
    private sellbackPct;
    private totalSoldUnits;
    private totalRevenue_;
    private totalBoughtUnits;
    private totalCostPaid;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: MerchantStockOptions<T>): MerchantStock<T>;
    addItem(spec: StockItemSpec<T>): boolean;
    removeItem(id: string): boolean;
    hasItem(id: string): boolean;
    getItem(id: string): StockItem<T> | null;
    list(): StockItem<T>[];
    size(): number;
    buy(itemId: string, quantity: number, ctx?: Record<string, unknown>): BuyResult;
    sell(itemId: string, quantity: number, ctx?: Record<string, unknown>): SellResult;
    setStock(itemId: string, qty: number): boolean;
    setRestock(itemId: string, amount: number, intervalMs: number): boolean;
    priceFor(itemId: string, ctx?: Record<string, unknown>): number | null;
    setPriceFn(fn: PriceModifierFn | null): void;
    totalSold(): number;
    totalRevenue(): number;
    totalBought(): number;
    totalCost(): number;
    resetStats(): void;
    tick(dtMs: number): void;
    clear(): void;
    dispose(): void;
    private resolvePrice;
    private snapshot;
}
export declare const RESOURCE_MERCHANT_STOCK = "merchant_stock";
//# sourceMappingURL=merchant-stock.d.ts.map