// Loom Engine - MarketSimulation (batch-auction order book) tests.
//
// Covers constructor validation, the credit / deposit ledgers,
// escrowed order placement, maker-price matching in both directions,
// partial fills, the no-cross case, generation-validated handles,
// expiry + refund, deterministic matching, the atomic + Int32-safe
// settlement guard, and full wealth / inventory conservation.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { MarketSimulation } from '../src/index.js';
import type { OrderSide, PlaceOrderResult } from '../src/index.js';

const MAX_INT32 = 0x7fffffff;

// Unwrap a successful placeOrder to its orderId, or fail the test.
function expectOk(r: PlaceOrderResult): number {
  if (!r.ok) {
    assert.fail('expected placeOrder to succeed, got reason ' + r.reason);
  }
  return r.orderId;
}

// Unwrap a rejected placeOrder to its reason, or fail the test.
function expectReason(r: PlaceOrderResult): string {
  if (r.ok) {
    assert.fail('expected placeOrder to fail, got orderId ' + r.orderId);
  }
  return r.reason;
}

test('market sim: constructor validates options', () => {
  const m = new MarketSimulation({ maxAgents: 10, itemTypeCount: 4, maxOrders: 32 });
  assert.equal(m.maxAgents, 10);
  assert.equal(m.itemTypeCount, 4);
  assert.equal(m.maxOrders, 32);
  assert.equal(m.openOrderCount(), 0);
  assert.equal(m.batchNumber(), 0);
  assert.throws(() => new MarketSimulation({ maxAgents: 0, itemTypeCount: 4, maxOrders: 32 }), /maxAgents/);
  assert.throws(() => new MarketSimulation({ maxAgents: 2.5, itemTypeCount: 4, maxOrders: 32 }), /maxAgents/);
  assert.throws(() => new MarketSimulation({ maxAgents: 10, itemTypeCount: 0, maxOrders: 32 }), /itemTypeCount/);
  assert.throws(() => new MarketSimulation({ maxAgents: 10, itemTypeCount: 4, maxOrders: 0 }), /maxOrders/);
});

test('market sim: credit and deposit fund the free ledgers', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 2, maxOrders: 16 });
  m.credit(0, 1000);
  m.credit(0, 500);
  assert.equal(m.wealthOf(0), 1500);
  m.deposit(1, 0, 30);
  assert.equal(m.inventoryOf(1, 0), 30);
  assert.equal(m.inventoryOf(1, 1), 0);
  assert.throws(() => m.credit(99, 10), /agentId/);
  assert.throws(() => m.credit(0, -1), /amount/);
  assert.throws(() => m.deposit(0, 9, 1), /itemType/);
  assert.throws(() => m.deposit(0, 0, 2.5), /qty/);
});

test('market sim: a bid escrows wealth out of the free ledger', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 2, maxOrders: 16 });
  m.credit(0, 1000);
  const before = m.circulatingWealth();
  const id = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 8 }));
  assert.equal(m.wealthOf(0), 1000 - 80);
  assert.equal(m.openOrderCount(), 1);
  // The escrow moved the wealth, it did not destroy it.
  assert.equal(m.circulatingWealth(), before);
  const view = m.getOrder(id);
  assert.ok(view);
  assert.equal(view!.side, 'bid');
  assert.equal(view!.escrow, 80);
  assert.equal(view!.qty, 8);
});

test('market sim: an ask escrows inventory out of the free ledger', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 2, maxOrders: 16 });
  m.deposit(1, 0, 40);
  const before = m.circulatingInventory(0);
  const id = expectOk(m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 5, qty: 25 }));
  assert.equal(m.inventoryOf(1, 0), 40 - 25);
  // The escrow moved the units, it did not destroy them.
  assert.equal(m.circulatingInventory(0), before);
  const view = m.getOrder(id);
  assert.ok(view);
  assert.equal(view!.side, 'ask');
  assert.equal(view!.qty, 25);
});

test('market sim: placeOrder reports unfundable placements', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 2 });
  m.credit(0, 50);
  // 10 * 10 = 100 > 50 wealth.
  assert.equal(expectReason(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 10 })),
    'insufficient_wealth');
  // No inventory to sell.
  assert.equal(expectReason(m.placeOrder({ agentId: 0, itemType: 0, side: 'ask', price: 1, qty: 1 })),
    'insufficient_inventory');
  // Fill the 2-slot book, then overflow it.
  m.credit(1, 1000);
  expectOk(m.placeOrder({ agentId: 1, itemType: 0, side: 'bid', price: 1, qty: 1 }));
  expectOk(m.placeOrder({ agentId: 1, itemType: 0, side: 'bid', price: 1, qty: 1 }));
  assert.equal(expectReason(m.placeOrder({ agentId: 1, itemType: 0, side: 'bid', price: 1, qty: 1 })),
    'book_full');
});

test('market sim: placeOrder throws on malformed input', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 2, maxOrders: 8 });
  m.credit(0, 1000000);
  assert.throws(() => m.placeOrder({ agentId: 99, itemType: 0, side: 'bid', price: 1, qty: 1 }), /agentId/);
  assert.throws(() => m.placeOrder({ agentId: 0, itemType: 9, side: 'bid', price: 1, qty: 1 }), /itemType/);
  assert.throws(
    () => m.placeOrder({ agentId: 0, itemType: 0, side: 'buy' as OrderSide, price: 1, qty: 1 }),
    /side/,
  );
  assert.throws(() => m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 0, qty: 1 }), /price/);
  assert.throws(() => m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 2.5, qty: 1 }), /price/);
  assert.throws(() => m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 1, qty: -1 }), /qty/);
  // price * qty overflows Int32.
  assert.throws(
    () => m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 100000, qty: 100000 }),
    /overflow/,
  );
  // goodForBatches must be a positive integer or Infinity.
  assert.throws(
    () => m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 1, qty: 1, goodForBatches: 0 }),
    /goodForBatches/,
  );
});

test('market sim: a crossing bid and ask match at the maker price (ask older)', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 16 });
  m.credit(0, 1000);
  m.deposit(1, 0, 50);
  // The seller posts first - the older order, so the maker.
  m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 8, qty: 10 });
  // The buyer crosses with a higher bid - the taker.
  m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 12, qty: 10 });
  const res = m.runBatch();
  assert.equal(res.batchSeq, 1);
  assert.equal(res.trades.length, 1);
  const t = res.trades[0]!;
  assert.equal(t.price, 8, 'executes at the older (maker) ask price');
  assert.equal(t.qty, 10);
  assert.equal(t.buyerId, 0);
  assert.equal(t.sellerId, 1);
  // Buyer escrowed 12*10=120, paid 8*10=80, was refunded the 40 surplus.
  assert.equal(m.wealthOf(0), 1000 - 80);
  assert.equal(m.inventoryOf(0, 0), 10);
  // Seller received 80, handed over 10 units.
  assert.equal(m.wealthOf(1), 80);
  assert.equal(m.inventoryOf(1, 0), 40);
  assert.equal(m.openOrderCount(), 0);
});

test('market sim: when the bid is the older order it sets the price', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 16 });
  m.credit(0, 1000);
  m.deposit(1, 0, 50);
  // The buyer posts first - the maker.
  m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 12, qty: 5 });
  // The seller crosses with a lower ask - the taker.
  m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 8, qty: 5 });
  const res = m.runBatch();
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0]!.price, 12, 'executes at the older (maker) bid price');
  // Buyer escrowed 60, paid 60, no surplus to refund.
  assert.equal(m.wealthOf(0), 1000 - 60);
  // Seller received 12*5 = 60.
  assert.equal(m.wealthOf(1), 60);
});

test('market sim: a partial fill leaves the remainder resting with a consistent escrow', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 16 });
  m.credit(0, 1000);
  m.deposit(1, 0, 100);
  // A big resting bid: 20 units @ 10.
  const bid = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 20 }));
  // A smaller ask: 7 units @ 10.
  m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 10, qty: 7 });
  const res = m.runBatch();
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0]!.qty, 7);
  // The ask is gone; the bid rests with 13 units left.
  assert.equal(m.openOrderCount(), 1);
  const v = m.getOrder(bid);
  assert.ok(v);
  assert.equal(v!.qty, 13);
  // The escrow invariant holds: escrow == price * remaining qty.
  assert.equal(v!.escrow, 10 * 13);
});

test('market sim: a bid below the ask does not trade - both rest', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 16 });
  m.credit(0, 1000);
  m.deposit(1, 0, 50);
  m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 5, qty: 10 });
  m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 9, qty: 10 });
  const res = m.runBatch();
  assert.equal(res.trades.length, 0);
  assert.equal(m.openOrderCount(), 2);
});

test('market sim: cancelOrder refunds escrow and the handle goes stale', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 8 });
  m.credit(0, 1000);
  const before = m.circulatingWealth();
  const id = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 5 }));
  assert.equal(m.wealthOf(0), 1000 - 50);
  assert.equal(m.cancelOrder(id), true);
  assert.equal(m.wealthOf(0), 1000, 'escrow refunded');
  assert.equal(m.circulatingWealth(), before);
  assert.equal(m.openOrderCount(), 0);
  // The handle is now stale.
  assert.equal(m.cancelOrder(id), false);
  assert.equal(m.getOrder(id), null);
});

test('market sim: a recycled slot rejects the old handle', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 1 });
  m.credit(0, 1000);
  const first = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 1 }));
  assert.equal(m.cancelOrder(first), true);
  // Only one slot - the next order reuses it with a bumped generation.
  const second = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 1 }));
  assert.notEqual(first, second, 'a recycled slot yields a different handle');
  // The stale handle must not resolve to the new order.
  assert.equal(m.getOrder(first), null);
  assert.equal(m.cancelOrder(first), false);
  // The fresh handle still works.
  assert.ok(m.getOrder(second));
});

test('market sim: an order expires after goodForBatches and is refunded', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 8 });
  m.credit(0, 1000);
  const before = m.circulatingWealth();
  // Rests for exactly one batch.
  const bid = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 5, goodForBatches: 1 }));
  // Batch 1: still eligible, no counterparty - rests, not swept.
  let res = m.runBatch();
  assert.equal(res.expired, 0);
  assert.equal(m.openOrderCount(), 1);
  assert.ok(m.getOrder(bid));
  // Batch 2: goodForBatches elapsed - swept and refunded.
  res = m.runBatch();
  assert.equal(res.expired, 1);
  assert.equal(m.openOrderCount(), 0);
  assert.equal(m.getOrder(bid), null);
  assert.equal(m.wealthOf(0), 1000, 'escrow refunded on expiry');
  assert.equal(m.circulatingWealth(), before);
});

test('market sim: a goodForBatches order still matches within its window', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 8 });
  m.credit(0, 1000);
  m.deposit(1, 0, 50);
  m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 5, goodForBatches: 1 });
  m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 10, qty: 5 });
  const res = m.runBatch();
  assert.equal(res.trades.length, 1);
  assert.equal(res.expired, 0);
});

test('market sim: matching is deterministic across identical runs', () => {
  function build(): MarketSimulation {
    const m = new MarketSimulation({ maxAgents: 8, itemTypeCount: 2, maxOrders: 64 });
    for (let a = 0; a < 8; a++) {
      m.credit(a, 100000);
      m.deposit(a, 0, 500);
      m.deposit(a, 1, 500);
    }
    // A spread of crossing and resting orders across two items.
    m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 50, qty: 10 });
    m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 45, qty: 4 });
    m.placeOrder({ agentId: 2, itemType: 0, side: 'ask', price: 48, qty: 8 });
    m.placeOrder({ agentId: 3, itemType: 0, side: 'bid', price: 49, qty: 6 });
    m.placeOrder({ agentId: 4, itemType: 1, side: 'ask', price: 20, qty: 15 });
    m.placeOrder({ agentId: 5, itemType: 1, side: 'bid', price: 25, qty: 9 });
    m.placeOrder({ agentId: 6, itemType: 1, side: 'bid', price: 22, qty: 5 });
    return m;
  }
  assert.deepEqual(build().runBatch(), build().runBatch());
});

test('market sim: a settlement that would overflow Int32 is refused, leaving the book intact', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 8 });
  // The seller is already at the wealth ceiling.
  m.credit(1, MAX_INT32);
  m.deposit(1, 0, 100);
  m.credit(0, 1000);
  const before = m.circulatingWealth();
  // Seller posts first (maker). A crossing pair @ 5.
  const ask = expectOk(m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 5, qty: 10 }));
  const bid = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 5, qty: 10 }));
  const res = m.runBatch();
  // The seller's wealth cannot take the proceeds, so the trade is
  // refused - and refused without any partial mutation.
  assert.equal(res.trades.length, 0);
  assert.equal(m.openOrderCount(), 2, 'both orders still rest');
  assert.equal(m.wealthOf(1), MAX_INT32, 'seller wealth untouched');
  assert.equal(m.wealthOf(0), 1000 - 50, 'buyer escrow still held, nothing spent');
  assert.equal(m.circulatingWealth(), before);
  assert.equal(m.getOrder(ask)!.qty, 10);
  assert.equal(m.getOrder(bid)!.qty, 10);
  assert.equal(m.getOrder(bid)!.escrow, 50);
});

test('market sim: wealth and inventory are conserved across placing, matching, cancelling', () => {
  const m = new MarketSimulation({ maxAgents: 6, itemTypeCount: 2, maxOrders: 64 });
  for (let a = 0; a < 6; a++) {
    m.credit(a, 10000);
    m.deposit(a, 0, 200);
    m.deposit(a, 1, 200);
  }
  const w0 = m.circulatingWealth();
  const inv0 = m.circulatingInventory(0);
  const inv1 = m.circulatingInventory(1);

  const ids: number[] = [];
  ids.push(expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 30, qty: 10 })));
  ids.push(expectOk(m.placeOrder({ agentId: 1, itemType: 0, side: 'ask', price: 28, qty: 6 })));
  ids.push(expectOk(m.placeOrder({ agentId: 2, itemType: 0, side: 'ask', price: 35, qty: 5 })));
  ids.push(expectOk(m.placeOrder({ agentId: 3, itemType: 1, side: 'bid', price: 12, qty: 20 })));
  ids.push(expectOk(m.placeOrder({ agentId: 4, itemType: 1, side: 'ask', price: 10, qty: 8 })));
  // Escrow moved value but neither created nor destroyed it.
  assert.equal(m.circulatingWealth(), w0);
  assert.equal(m.circulatingInventory(0), inv0);
  assert.equal(m.circulatingInventory(1), inv1);

  m.runBatch();
  // Trades moved value but conserved it.
  assert.equal(m.circulatingWealth(), w0);
  assert.equal(m.circulatingInventory(0), inv0);
  assert.equal(m.circulatingInventory(1), inv1);

  // Cancel whatever is still resting (stale handles just return false).
  for (const id of ids) m.cancelOrder(id);
  assert.equal(m.circulatingWealth(), w0);
  assert.equal(m.circulatingInventory(0), inv0);
  assert.equal(m.circulatingInventory(1), inv1);
  assert.equal(m.openOrderCount(), 0);
});

test('market sim: clear resets the book and invalidates outstanding handles', () => {
  const m = new MarketSimulation({ maxAgents: 4, itemTypeCount: 1, maxOrders: 8 });
  m.credit(0, 1000);
  m.deposit(1, 0, 50);
  const bid = expectOk(m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 10, qty: 5 }));
  m.runBatch();
  m.clear();
  assert.equal(m.openOrderCount(), 0);
  assert.equal(m.batchNumber(), 0);
  assert.equal(m.wealthOf(0), 0, 'ledgers zeroed');
  assert.equal(m.inventoryOf(1, 0), 0);
  assert.equal(m.circulatingWealth(), 0);
  assert.equal(m.getOrder(bid), null, 'a pre-clear handle no longer resolves');
  // The sim is usable again.
  m.credit(2, 500);
  assert.ok(m.placeOrder({ agentId: 2, itemType: 0, side: 'bid', price: 5, qty: 1 }).ok);
});

test('market sim: realistic example - a three-batch market converges', () => {
  const m = new MarketSimulation({ maxAgents: 6, itemTypeCount: 1, maxOrders: 64 });
  // Three buyers, three sellers, all funded.
  for (let a = 0; a < 3; a++) m.credit(a, 100000);
  for (let a = 3; a < 6; a++) m.deposit(a, 0, 100);
  const totalWealth = m.circulatingWealth();
  const totalGoods = m.circulatingInventory(0);

  // Batch 1: a wide spread, one obvious cross.
  m.placeOrder({ agentId: 0, itemType: 0, side: 'bid', price: 100, qty: 10 });
  m.placeOrder({ agentId: 3, itemType: 0, side: 'ask', price: 90, qty: 4 });
  m.placeOrder({ agentId: 4, itemType: 0, side: 'ask', price: 130, qty: 10 });
  let res = m.runBatch();
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0]!.qty, 4);
  assert.equal(res.trades[0]!.price, 100, 'the older bid is the maker');

  // Batch 2: a new seller undercuts; the resting bid (6 left) fills more.
  m.placeOrder({ agentId: 5, itemType: 0, side: 'ask', price: 95, qty: 8 });
  res = m.runBatch();
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0]!.qty, 6, 'the resting bid had 6 units left');
  assert.equal(res.trades[0]!.price, 100, 'the resting bid is still the maker');

  // Batch 3: nothing left crosses.
  res = m.runBatch();
  assert.equal(res.trades.length, 0);

  // Conservation holds across the whole session.
  assert.equal(m.circulatingWealth(), totalWealth);
  assert.equal(m.circulatingInventory(0), totalGoods);
});
