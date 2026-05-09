// Phase 1.2.4 - MerchantStock tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MerchantStock,
  RESOURCE_MERCHANT_STOCK,
} from '../src/index.js';

test('ms: RESOURCE_MERCHANT_STOCK is the stable string', () => {
  assert.equal(RESOURCE_MERCHANT_STOCK, 'merchant_stock');
});

test('ms: starts empty', () => {
  const s = MerchantStock.create();
  assert.equal(s.size(), 0);
});

test('ms: addItem + has + size', () => {
  const s = MerchantStock.create();
  assert.equal(s.addItem({ id: 'potion', currentStock: 5, basePrice: 50 }), true);
  assert.equal(s.hasItem('potion'), true);
  assert.equal(s.size(), 1);
});

test('ms: addItem rejects empty / non-string id', () => {
  const s = MerchantStock.create();
  assert.equal(s.addItem({ id: '' }), false);
});

test('ms: getItem returns snapshot', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 5, maxStock: 10, basePrice: 50 });
  const item = s.getItem('potion');
  assert.ok(item);
  assert.equal(item!.currentStock, 5);
  assert.equal(item!.maxStock, 10);
  assert.equal(item!.basePrice, 50);
});

test('ms: buy decrements stock', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 10, basePrice: 50 });
  const r = s.buy('potion', 3);
  assert.equal(r.ok, true);
  assert.equal(r.unitsSold, 3);
  assert.equal(r.totalCost, 150);
  assert.equal(s.getItem('potion')!.currentStock, 7);
});

test('ms: buy unknown item returns unknown_item', () => {
  const s = MerchantStock.create();
  const r = s.buy('missing', 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown_item');
});

test('ms: buy out of stock returns out_of_stock', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 0, basePrice: 50 });
  const r = s.buy('potion', 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out_of_stock');
});

test('ms: buy more than available caps at currentStock', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 3, basePrice: 50 });
  const r = s.buy('potion', 10);
  assert.equal(r.ok, true);
  assert.equal(r.unitsSold, 3);
  assert.equal(r.totalCost, 150);
  assert.equal(s.getItem('potion')!.currentStock, 0);
});

test('ms: buy invalid qty returns invalid_qty', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 5, basePrice: 50 });
  const r = s.buy('potion', -1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid_qty');
});

test('ms: sell increments stock (up to maxStock)', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 5, maxStock: 10, basePrice: 50 });
  const r = s.sell('potion', 3);
  assert.equal(r.ok, true);
  assert.equal(r.unitsBought, 3);
  // Default sellback 50% of basePrice: 50 * 0.5 = 25 per unit.
  assert.equal(r.totalPaid, 75);
  assert.equal(s.getItem('potion')!.currentStock, 8);
});

test('ms: sell over maxStock caps + reports cap_hit on full', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 9, maxStock: 10, basePrice: 50 });
  const r1 = s.sell('potion', 5);
  // Only 1 slot left.
  assert.equal(r1.unitsBought, 1);
  assert.equal(r1.totalPaid, 25);
  // Already at cap.
  const r2 = s.sell('potion', 1);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'cap_hit');
});

test('ms: tick restocks at interval', () => {
  const s = MerchantStock.create();
  s.addItem({
    id: 'potion', currentStock: 0, maxStock: 10,
    restockAmount: 2, restockIntervalMs: 100, basePrice: 50,
  });
  s.tick(50);
  assert.equal(s.getItem('potion')!.currentStock, 0);
  s.tick(60); // total 110
  assert.equal(s.getItem('potion')!.currentStock, 2);
});

test('ms: tick restock caps at maxStock', () => {
  const s = MerchantStock.create();
  s.addItem({
    id: 'potion', currentStock: 9, maxStock: 10,
    restockAmount: 5, restockIntervalMs: 100, basePrice: 50,
  });
  s.tick(110);
  // Tried to add 5 but cap is 10, so currentStock = 10.
  assert.equal(s.getItem('potion')!.currentStock, 10);
});

test('ms: tick restock 0 = no auto restock', () => {
  const s = MerchantStock.create();
  s.addItem({
    id: 'potion', currentStock: 0, maxStock: 10,
    restockAmount: 2, restockIntervalMs: 0, basePrice: 50,
  });
  s.tick(99999);
  assert.equal(s.getItem('potion')!.currentStock, 0);
});

test('ms: setStock admin override', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 5, maxStock: 10, basePrice: 50 });
  s.setStock('potion', 8);
  assert.equal(s.getItem('potion')!.currentStock, 8);
  // Over maxStock clamps.
  s.setStock('potion', 99);
  assert.equal(s.getItem('potion')!.currentStock, 10);
});

test('ms: setRestock updates policy', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 0, maxStock: 10, basePrice: 50 });
  s.setRestock('potion', 3, 50);
  s.tick(60);
  assert.equal(s.getItem('potion')!.currentStock, 3);
});

test('ms: priceFn applies global modifier', () => {
  const s = MerchantStock.create({
    priceFn: (basePrice, _id, ctx) => {
      const discount = (ctx.faction === 'temple') ? 0.5 : 1;
      return basePrice * discount;
    },
  });
  s.addItem({ id: 'potion', currentStock: 10, basePrice: 100 });
  assert.equal(s.priceFor('potion', { faction: 'temple' }), 50);
  assert.equal(s.priceFor('potion'), 100);
});

test('ms: buy uses priceFn', () => {
  const s = MerchantStock.create({
    priceFn: (b) => b * 0.5,
  });
  s.addItem({ id: 'potion', currentStock: 10, basePrice: 100 });
  const r = s.buy('potion', 2);
  assert.equal(r.totalCost, 100); // 2 * 50
});

test('ms: throwing priceFn falls back to basePrice', () => {
  const s = MerchantStock.create({
    priceFn: () => { throw new Error('boom'); },
  });
  s.addItem({ id: 'potion', currentStock: 10, basePrice: 100 });
  assert.equal(s.priceFor('potion'), 100);
});

test('ms: removeItem drops + removes from list', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'a', basePrice: 1 });
  s.addItem({ id: 'b', basePrice: 1 });
  assert.equal(s.removeItem('a'), true);
  assert.equal(s.size(), 1);
});

test('ms: stats track sold + revenue', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 10, basePrice: 50 });
  s.buy('potion', 3);
  s.buy('potion', 2);
  assert.equal(s.totalSold(), 5);
  assert.equal(s.totalRevenue(), 250);
});

test('ms: resetStats clears counters', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'potion', currentStock: 10, basePrice: 50 });
  s.buy('potion', 3);
  s.resetStats();
  assert.equal(s.totalSold(), 0);
  assert.equal(s.totalRevenue(), 0);
});

test('ms: NaN / negative dt no-op', () => {
  const s = MerchantStock.create();
  s.addItem({
    id: 'potion', currentStock: 0, maxStock: 10,
    restockAmount: 2, restockIntervalMs: 100, basePrice: 50,
  });
  s.tick(NaN);
  s.tick(-50);
  s.tick(Infinity);
  assert.equal(s.getItem('potion')!.currentStock, 0);
});

test('ms: dispose locks ops', () => {
  const s = MerchantStock.create();
  s.addItem({ id: 'a', basePrice: 1 });
  s.dispose();
  assert.equal(s.addItem({ id: 'b', basePrice: 1 }), false);
  assert.equal(s.buy('a', 1).ok, false);
});

test('ms: realistic example - faction-priced merchant with restock', () => {
  const s = MerchantStock.create({
    priceFn: (base, _id, ctx) => {
      const rep = ctx.factionRep as number;
      // 1% off per rep point, capped at 50% off.
      const discount = Math.max(0.5, 1 - rep * 0.01);
      return base * discount;
    },
  });
  s.addItem({
    id: 'rare_potion', currentStock: 5, maxStock: 5,
    restockAmount: 1, restockIntervalMs: 60000, basePrice: 100,
  });
  // Friendly faction (rep 30): 70% of base = 70.
  const r1 = s.buy('rare_potion', 2, { factionRep: 30 });
  assert.equal(r1.totalCost, 140);
  assert.equal(s.getItem('rare_potion')!.currentStock, 3);
  // After 60s, 1 restocks.
  s.tick(60001);
  assert.equal(s.getItem('rare_potion')!.currentStock, 4);
});
