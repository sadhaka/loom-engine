export type OrderSide = 'bid' | 'ask';
export interface MarketSimulationOptions {
    maxAgents: number;
    itemTypeCount: number;
    maxOrders: number;
}
export interface PlaceOrderSpec {
    agentId: number;
    itemType: number;
    side: OrderSide;
    price: number;
    qty: number;
    goodForBatches?: number;
}
export type PlaceOrderResult = {
    ok: true;
    orderId: number;
} | {
    ok: false;
    reason: 'insufficient_wealth' | 'insufficient_inventory' | 'book_full';
};
export interface OrderView {
    orderId: number;
    agentId: number;
    itemType: number;
    side: OrderSide;
    price: number;
    qty: number;
    escrow: number;
    expiresAfterBatch: number;
}
export interface Trade {
    itemType: number;
    buyerId: number;
    sellerId: number;
    buyOrderId: number;
    sellOrderId: number;
    price: number;
    qty: number;
    batchSeq: number;
}
export interface BatchResult {
    batchSeq: number;
    trades: Trade[];
    expired: number;
}
export declare class MarketSimulation {
    readonly maxAgents: number;
    readonly itemTypeCount: number;
    readonly maxOrders: number;
    private readonly wealth;
    private readonly inventory;
    private readonly orderAgent;
    private readonly orderItem;
    private readonly orderSide;
    private readonly orderPrice;
    private readonly orderQty;
    private readonly orderEscrow;
    private readonly orderSeq;
    private readonly orderExpiry;
    private readonly orderGen;
    private readonly freeList;
    private freeCount;
    private readonly liveScratch;
    private nextSeq;
    private batchSeq;
    private liveOrders;
    private readonly matchCmp;
    constructor(opts: MarketSimulationOptions);
    credit(agentId: number, amount: number): void;
    deposit(agentId: number, itemType: number, qty: number): void;
    wealthOf(agentId: number): number;
    inventoryOf(agentId: number, itemType: number): number;
    placeOrder(spec: PlaceOrderSpec): PlaceOrderResult;
    cancelOrder(orderId: number): boolean;
    getOrder(orderId: number): OrderView | null;
    runBatch(): BatchResult;
    openOrderCount(): number;
    batchNumber(): number;
    circulatingWealth(): number;
    circulatingInventory(itemType: number): number;
    clear(): void;
    private matchRun;
    private settle;
    private compareForMatch;
    private refundOrder;
    private freeSlot;
    private makeOrderId;
    private resolveSlot;
    private requireAgent;
    private requireItem;
}
//# sourceMappingURL=market-simulation.d.ts.map