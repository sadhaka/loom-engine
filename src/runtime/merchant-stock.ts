// MerchantStock - restocking shop inventory with caps + dynamic
// pricing.
//
// 1.2.4 enabling primitive (Wave 1.2 world depth). Every shopkeeper
// in every RPG: a counter of items, a restock cadence (potions
// regenerate every 30 minutes, rare gear once per week), buy /
// sell prices, and optional dynamic pricing (faction discount,
// time-of-day surcharge, supply / demand).
//
//   var shop = MerchantStock.create();
//   shop.addItem({
//     id: 'health_potion',
//     currentStock: 10, maxStock: 10,
//     restockAmount: 2, restockIntervalMs: 30000,
//     basePrice: 50,
//   });
//
//   var result = shop.buy('health_potion', 3, { faction: 'temple' });
//   if (result.ok) deductGold(result.totalCost);
//
//   each frame: shop.tick(dtMs);
//
// Pairs with InventoryGrid (0.54, the player's bag), LootTable
// (0.57), FactionReputation (0.86, often drives discounts).
//
// Code style: var-only in browser source.

export type PriceModifierFn = (basePrice: number, itemId: string,
  ctx: Record<string, unknown>) => number;

export interface StockItemSpec<T = Record<string, unknown>> {
  id: string;
  // Current quantity in stock. Default 0.
  currentStock?: number;
  // Cap on stock. Default Infinity (no cap).
  maxStock?: number;
  // Quantity added per restock tick. Default 0 (no auto-restock).
  restockAmount?: number;
  // ms between restock ticks. 0 = no auto-restock. Default 0.
  restockIntervalMs?: number;
  // Base price per unit. Default 1.
  basePrice?: number;
  // Optional consumer payload.
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
  // ms since last restock; counts up via tick().
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
  // Optional global price modifier applied to every priceFor /
  // buy / sell call. Receives (basePrice, itemId, ctx) and
  // returns the resolved unit price.
  priceFn?: PriceModifierFn;
  // Sell-back percentage of basePrice (0..1). Default 0.5
  // (merchant pays 50% of base when player sells).
  sellbackPct?: number;
  // Reserved.
  data?: Record<string, T>;
}

interface InternalItem<T> extends StockItem<T> {}

const DEFAULT_SELLBACK_PCT = 0.5;

function clampNonNeg(v: number, fallback: number): number {
  if (!isFinite(v) || v < 0) return fallback;
  return v;
}

export class MerchantStock<T = Record<string, unknown>> {
  private items: Map<string, InternalItem<T>> = new Map();
  private priceFn: PriceModifierFn | null;
  private sellbackPct: number;
  private totalSoldUnits: number = 0;
  private totalRevenue_: number = 0;
  private totalBoughtUnits: number = 0;
  private totalCostPaid: number = 0;
  private disposed: boolean = false;

  private constructor(opts: MerchantStockOptions<T>) {
    this.priceFn = opts.priceFn ?? null;
    this.sellbackPct = opts.sellbackPct !== undefined && isFinite(opts.sellbackPct)
        && opts.sellbackPct >= 0 && opts.sellbackPct <= 1
      ? opts.sellbackPct : DEFAULT_SELLBACK_PCT;
  }

  static create<T = Record<string, unknown>>(
    opts: MerchantStockOptions<T> = {}): MerchantStock<T> {
    return new MerchantStock<T>(opts);
  }

  addItem(spec: StockItemSpec<T>): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    var maxStock = spec.maxStock !== undefined && isFinite(spec.maxStock)
        && spec.maxStock >= 0 ? spec.maxStock : Infinity;
    var current = clampNonNeg(spec.currentStock ?? 0, 0);
    if (current > maxStock) current = maxStock;
    var item: InternalItem<T> = {
      id: spec.id,
      currentStock: current,
      maxStock: maxStock,
      restockAmount: clampNonNeg(spec.restockAmount ?? 0, 0),
      restockIntervalMs: clampNonNeg(spec.restockIntervalMs ?? 0, 0),
      basePrice: spec.basePrice !== undefined && isFinite(spec.basePrice)
        ? spec.basePrice : 1,
      ageSinceRestockMs: 0,
    };
    if (spec.payload !== undefined) item.payload = spec.payload;
    this.items.set(spec.id, item);
    return true;
  }

  removeItem(id: string): boolean {
    if (this.disposed) return false;
    return this.items.delete(id);
  }

  hasItem(id: string): boolean {
    return this.items.has(id);
  }

  getItem(id: string): StockItem<T> | null {
    var item = this.items.get(id);
    return item ? this.snapshot(item) : null;
  }

  list(): StockItem<T>[] {
    var out: StockItem<T>[] = [];
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.snapshot(v.value));
      v = iter.next();
    }
    return out;
  }

  size(): number { return this.items.size; }

  buy(itemId: string, quantity: number,
      ctx: Record<string, unknown> = {}): BuyResult {
    if (this.disposed) {
      return { ok: false, reason: 'unknown_item', unitsSold: 0, totalCost: 0 };
    }
    var item = this.items.get(itemId);
    if (!item) {
      return { ok: false, reason: 'unknown_item', unitsSold: 0, totalCost: 0 };
    }
    if (!isFinite(quantity) || quantity <= 0) {
      return { ok: false, reason: 'invalid_qty', unitsSold: 0, totalCost: 0 };
    }
    var qty = Math.floor(quantity);
    if (item.currentStock <= 0) {
      return { ok: false, reason: 'out_of_stock', unitsSold: 0, totalCost: 0 };
    }
    var canBuy = Math.min(qty, item.currentStock);
    var unitPrice = this.resolvePrice(item.basePrice, item.id, ctx);
    var totalCost = unitPrice * canBuy;
    item.currentStock -= canBuy;
    this.totalSoldUnits += canBuy;
    this.totalRevenue_ += totalCost;
    return { ok: true, unitsSold: canBuy, totalCost: totalCost };
  }

  sell(itemId: string, quantity: number,
       ctx: Record<string, unknown> = {}): SellResult {
    if (this.disposed) {
      return { ok: false, reason: 'unknown_item', unitsBought: 0, totalPaid: 0 };
    }
    var item = this.items.get(itemId);
    if (!item) {
      return { ok: false, reason: 'unknown_item', unitsBought: 0, totalPaid: 0 };
    }
    if (!isFinite(quantity) || quantity <= 0) {
      return { ok: false, reason: 'invalid_qty', unitsBought: 0, totalPaid: 0 };
    }
    var qty = Math.floor(quantity);
    var roomLeft = item.maxStock === Infinity
      ? qty : Math.max(0, item.maxStock - item.currentStock);
    var canBuy = Math.min(qty, roomLeft);
    if (canBuy <= 0) {
      return { ok: false, reason: 'cap_hit', unitsBought: 0, totalPaid: 0 };
    }
    var unitPrice = this.resolvePrice(item.basePrice, item.id, ctx)
      * this.sellbackPct;
    var totalPaid = unitPrice * canBuy;
    item.currentStock += canBuy;
    this.totalBoughtUnits += canBuy;
    this.totalCostPaid += totalPaid;
    return { ok: true, unitsBought: canBuy, totalPaid: totalPaid };
  }

  // Admin override: set stock directly (clamped to maxStock).
  setStock(itemId: string, qty: number): boolean {
    if (this.disposed) return false;
    var item = this.items.get(itemId);
    if (!item) return false;
    if (!isFinite(qty) || qty < 0) return false;
    item.currentStock = Math.min(Math.floor(qty), item.maxStock);
    return true;
  }

  // Update restock policy.
  setRestock(itemId: string, amount: number, intervalMs: number): boolean {
    if (this.disposed) return false;
    var item = this.items.get(itemId);
    if (!item) return false;
    if (isFinite(amount) && amount >= 0) item.restockAmount = amount;
    if (isFinite(intervalMs) && intervalMs >= 0) {
      item.restockIntervalMs = intervalMs;
      item.ageSinceRestockMs = 0;
    }
    return true;
  }

  // Resolved price using priceFn if configured.
  priceFor(itemId: string, ctx: Record<string, unknown> = {}): number | null {
    var item = this.items.get(itemId);
    if (!item) return null;
    return this.resolvePrice(item.basePrice, item.id, ctx);
  }

  setPriceFn(fn: PriceModifierFn | null): void {
    if (this.disposed) return;
    this.priceFn = fn;
  }

  totalSold(): number { return this.totalSoldUnits; }
  totalRevenue(): number { return this.totalRevenue_; }
  totalBought(): number { return this.totalBoughtUnits; }
  totalCost(): number { return this.totalCostPaid; }

  resetStats(): void {
    this.totalSoldUnits = 0;
    this.totalRevenue_ = 0;
    this.totalBoughtUnits = 0;
    this.totalCostPaid = 0;
  }

  // Advance restock cadence. Items with restockIntervalMs > 0 get
  // restockAmount added each interval (capped at maxStock).
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      var item = v.value;
      if (item.restockIntervalMs > 0 && item.restockAmount > 0) {
        item.ageSinceRestockMs += dt;
        while (item.ageSinceRestockMs >= item.restockIntervalMs) {
          item.ageSinceRestockMs -= item.restockIntervalMs;
          var newStock = item.currentStock + item.restockAmount;
          if (newStock > item.maxStock) newStock = item.maxStock;
          item.currentStock = newStock;
        }
      }
      v = iter.next();
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.items.clear();
    this.resetStats();
  }

  dispose(): void {
    this.items.clear();
    this.priceFn = null;
    this.resetStats();
    this.disposed = true;
  }

  // ---------- private ----------

  private resolvePrice(basePrice: number, itemId: string,
                       ctx: Record<string, unknown>): number {
    if (!this.priceFn) return basePrice;
    try {
      var p = this.priceFn(basePrice, itemId, ctx);
      return isFinite(p) && p >= 0 ? p : basePrice;
    } catch { return basePrice; }
  }

  private snapshot(item: InternalItem<T>): StockItem<T> {
    var copy: StockItem<T> = {
      id: item.id,
      currentStock: item.currentStock,
      maxStock: item.maxStock,
      restockAmount: item.restockAmount,
      restockIntervalMs: item.restockIntervalMs,
      basePrice: item.basePrice,
      ageSinceRestockMs: item.ageSinceRestockMs,
    };
    if (item.payload !== undefined) copy.payload = item.payload;
    return copy;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_MERCHANT_STOCK = 'merchant_stock';
