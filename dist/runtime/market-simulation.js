// MarketSimulation - a deterministic batch-auction order book with
// Int32 wealth + inventory ledgers and escrowed, conservation-safe
// settlement.
//
// The Trinity dossier's section 13. The Gemini sketch was a
// non-atomic executeTrade: it mutated the buyer's wealth, the
// seller's wealth, and both inventories in sequence with early
// returns between the writes, so any rejected guard left the ledgers
// half-updated - value created or destroyed. Codex flagged it
// "severe atomic and conservation bugs". This rebuild closes that:
// every order escrows its commitment up front, every settlement
// checks all guards before it writes anything, and the maker's
// integer limit price is the execution price so there is no division
// and no rounding leak.
//
// Storage is flat typed arrays. Agents are integer ids in
// [0, maxAgents); item types are integer ids in [0, itemTypeCount):
//   wealth      Int32   per agent        - free, unescrowed wealth
//   inventory   Int32   per (agent,item) - free, unescrowed units
//   orderAgent  Int32   per order slot   - owner, or -1 if slot is free
//   orderItem   Int32   per order slot   - item type
//   orderSide   Int8    per order slot   - 0 bid (buy), 1 ask (sell)
//   orderPrice  Int32   per order slot   - limit price per unit
//   orderQty    Int32   per order slot   - remaining unfilled units; for
//                                          an ask this IS the escrowed
//                                          inventory
//   orderEscrow Int32   per order slot   - for a bid, the escrowed
//                                          wealth; invariant:
//                                          == orderPrice * orderQty
//   orderSeq    Float64 per order slot   - monotonic placement stamp;
//                                          the lower seq of a crossing
//                                          pair is the maker and sets
//                                          the execution price
//   orderExpiry Float64 per order slot   - batch number after which the
//                                          order is swept (Infinity =
//                                          rest until filled/cancelled)
//   orderGen    Int32   per order slot   - bumped on free; an orderId
//                                          packs (generation, slot) so a
//                                          handle to a recycled slot
//                                          fails validation
//
// The 6 Codex gates, enforced:
//   1. atomic settlement - settle() computes the fill, checks every
//      guard (escrow sufficiency, Int32 overflow of the seller's
//      wealth and the buyer's inventory), and only then writes. No
//      guard sits between two ledger writes, so a refused trade
//      leaves the book bit-identical to before the attempt.
//   2. wealth conservation - placing a bid moves wealth out of the
//      owner's ledger into orderEscrow; a fill moves it from escrow to
//      the seller; a cancel / expiry moves it back. Wealth is always
//      in exactly one place, so SUM(wealth) + SUM(bid escrow) is
//      invariant across every operation. circulatingWealth() exposes
//      the total for audits.
//   3. inventory conservation - placing an ask moves units out of the
//      owner's inventory into orderQty; a fill moves them to the
//      buyer; a cancel / expiry moves them back. Per item type,
//      SUM(inventory) + SUM(ask escrow) is invariant.
//      circulatingInventory(item) exposes the total.
//   4. deterministic matching - runBatch() sorts the whole live book
//      by (item, side, price, seq): bids highest-price-first, asks
//      lowest-price-first, ties broken by the monotonic orderSeq. The
//      match result depends only on the set of resting orders and
//      their seqs, never on slot positions or submission interleaving.
//   5. Int32 ledger safety - placeOrder rejects an order whose
//      price * qty would overflow Int32 (so orderEscrow always fits);
//      settle() refuses a fill that would push the seller's wealth or
//      the buyer's inventory past the Int32 ceiling, leaving both
//      orders resting rather than wrapping a ledger.
//   6. generation-validated handles - an orderId packs an 8-bit
//      generation with the 24-bit slot. Freeing a slot bumps its
//      generation, so cancelOrder / getOrder on a handle to a recycled
//      slot fails validation - no double refund, no write to the wrong
//      order.
//
// The deferred layer (precedent from LoomFlux): multi-producer order
// ingestion over a SharedArrayBuffer queue. The matching core is
// single-threaded with no Atomics; a consumer that needs lock-free
// cross-thread submission drains its SAB queue into placeOrder() calls
// on the owning thread.
// Sanity caps on the constructor-derived sizes.
const MAX_AGENTS_CAP = 1 << 16;
const MAX_ITEM_TYPES_CAP = 1 << 12;
const MAX_ORDERS_CAP = 1 << 20;
// inventory is maxAgents * itemTypeCount Int32s - cap the product so
// the backing array stays sane.
const MAX_INVENTORY_CELLS = 1 << 24;
// Int32 ledger ceiling. Wealth, inventory counts, and per-order escrow
// all live in [0, MAX_INT32].
const MAX_INT32 = 0x7fffffff;
// orderId layout, mirroring LoomDecay's MaterialHandle: low 24 bits
// slot, high 8 bits generation.
const ORDER_SLOT_MASK = 0x00ffffff;
const ORDER_GEN_SHIFT = 24;
const ORDER_GEN_MASK = 0xff;
// orderSide values.
const SIDE_BID = 0;
const SIDE_ASK = 1;
// orderAgent sentinel for a free slot.
const SLOT_FREE = -1;
export class MarketSimulation {
    maxAgents;
    itemTypeCount;
    maxOrders;
    // Free, unescrowed ledgers.
    wealth;
    inventory;
    // Order columns. A slot is live iff orderAgent[slot] !== SLOT_FREE.
    orderAgent;
    orderItem;
    orderSide;
    orderPrice;
    orderQty;
    orderEscrow;
    orderSeq;
    orderExpiry;
    orderGen;
    // Free-list stack of order slots: freeList[0, freeCount) holds the
    // available slot indices.
    freeList;
    freeCount;
    // Scratch index buffer for runBatch's whole-book sort. Reused every
    // batch, so matching allocates only the returned Trade list.
    liveScratch;
    // Monotonic placement counter - the price-time priority key.
    nextSeq;
    // Number of completed batches.
    batchSeq;
    // Live (non-free) order count.
    liveOrders;
    // Bound match comparator - created once so runBatch's sort allocates
    // nothing.
    matchCmp;
    constructor(opts) {
        const maxAgents = opts ? opts.maxAgents : NaN;
        const itemTypeCount = opts ? opts.itemTypeCount : NaN;
        const maxOrders = opts ? opts.maxOrders : NaN;
        if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > MAX_AGENTS_CAP) {
            throw new RangeError('MarketSimulation: maxAgents must be an integer in [1, ' + MAX_AGENTS_CAP + '], got ' + maxAgents);
        }
        if (!Number.isInteger(itemTypeCount) || itemTypeCount < 1 || itemTypeCount > MAX_ITEM_TYPES_CAP) {
            throw new RangeError('MarketSimulation: itemTypeCount must be an integer in [1, ' + MAX_ITEM_TYPES_CAP + '], got '
                + itemTypeCount);
        }
        if (!Number.isInteger(maxOrders) || maxOrders < 1 || maxOrders > MAX_ORDERS_CAP) {
            throw new RangeError('MarketSimulation: maxOrders must be an integer in [1, ' + MAX_ORDERS_CAP + '], got ' + maxOrders);
        }
        if (maxAgents * itemTypeCount > MAX_INVENTORY_CELLS) {
            throw new RangeError('MarketSimulation: maxAgents * itemTypeCount must be <= ' + MAX_INVENTORY_CELLS
                + ', got ' + (maxAgents * itemTypeCount));
        }
        this.maxAgents = maxAgents;
        this.itemTypeCount = itemTypeCount;
        this.maxOrders = maxOrders;
        this.wealth = new Int32Array(maxAgents);
        this.inventory = new Int32Array(maxAgents * itemTypeCount);
        this.orderAgent = new Int32Array(maxOrders).fill(SLOT_FREE);
        this.orderItem = new Int32Array(maxOrders);
        this.orderSide = new Int8Array(maxOrders);
        this.orderPrice = new Int32Array(maxOrders);
        this.orderQty = new Int32Array(maxOrders);
        this.orderEscrow = new Int32Array(maxOrders);
        this.orderSeq = new Float64Array(maxOrders);
        this.orderExpiry = new Float64Array(maxOrders);
        this.orderGen = new Int32Array(maxOrders);
        this.freeList = new Int32Array(maxOrders);
        // Fill so the first pop hands out slot 0, then 1, ... - matching
        // is slot-order-independent, but predictable slots keep tests
        // legible.
        for (let i = 0; i < maxOrders; i++) {
            this.freeList[i] = maxOrders - 1 - i;
        }
        this.freeCount = maxOrders;
        this.liveScratch = new Int32Array(maxOrders);
        this.nextSeq = 0;
        this.batchSeq = 0;
        this.liveOrders = 0;
        this.matchCmp = this.compareForMatch.bind(this);
    }
    // ---------- ledger setup / inspection ----------
    // Add wealth to an agent's free ledger - for economy setup and for
    // consumer-side wealth injection (faucets). Throws on a bad agent
    // id, a non-integer / negative amount, or an Int32 overflow.
    credit(agentId, amount) {
        this.requireAgent(agentId, 'credit');
        if (!Number.isInteger(amount) || amount < 0) {
            throw new RangeError('MarketSimulation.credit: amount must be a non-negative integer, got ' + amount);
        }
        const next = (this.wealth[agentId] ?? 0) + amount;
        if (next > MAX_INT32) {
            throw new RangeError('MarketSimulation.credit: agent ' + agentId + ' wealth would overflow Int32 (' + next + ')');
        }
        this.wealth[agentId] = next;
    }
    // Add units of an item to an agent's free inventory. Throws on a bad
    // agent / item id, a non-integer / negative qty, or an Int32
    // overflow.
    deposit(agentId, itemType, qty) {
        this.requireAgent(agentId, 'deposit');
        this.requireItem(itemType, 'deposit');
        if (!Number.isInteger(qty) || qty < 0) {
            throw new RangeError('MarketSimulation.deposit: qty must be a non-negative integer, got ' + qty);
        }
        const cell = agentId * this.itemTypeCount + itemType;
        const next = (this.inventory[cell] ?? 0) + qty;
        if (next > MAX_INT32) {
            throw new RangeError('MarketSimulation.deposit: agent ' + agentId + ' item ' + itemType
                + ' inventory would overflow Int32 (' + next + ')');
        }
        this.inventory[cell] = next;
    }
    // An agent's free (unescrowed) wealth.
    wealthOf(agentId) {
        this.requireAgent(agentId, 'wealthOf');
        return this.wealth[agentId] ?? 0;
    }
    // An agent's free (unescrowed) units of an item.
    inventoryOf(agentId, itemType) {
        this.requireAgent(agentId, 'inventoryOf');
        this.requireItem(itemType, 'inventoryOf');
        return this.inventory[agentId * this.itemTypeCount + itemType] ?? 0;
    }
    // ---------- orders ----------
    // Place a limit order. A bid escrows price * qty wealth out of the
    // owner's ledger; an ask escrows qty units of inventory. Malformed
    // input throws a RangeError; a placement that cannot be funded
    // returns { ok: false, reason }.
    placeOrder(spec) {
        const agentId = spec ? spec.agentId : NaN;
        const itemType = spec ? spec.itemType : NaN;
        const side = spec ? spec.side : undefined;
        const price = spec ? spec.price : NaN;
        const qty = spec ? spec.qty : NaN;
        const goodForBatches = spec && spec.goodForBatches !== undefined ? spec.goodForBatches : Infinity;
        this.requireAgent(agentId, 'placeOrder');
        this.requireItem(itemType, 'placeOrder');
        if (side !== 'bid' && side !== 'ask') {
            throw new RangeError("MarketSimulation.placeOrder: side must be 'bid' or 'ask', got " + side);
        }
        if (!Number.isInteger(price) || price < 1 || price > MAX_INT32) {
            throw new RangeError('MarketSimulation.placeOrder: price must be an integer in [1, ' + MAX_INT32 + '], got ' + price);
        }
        if (!Number.isInteger(qty) || qty < 1 || qty > MAX_INT32) {
            throw new RangeError('MarketSimulation.placeOrder: qty must be an integer in [1, ' + MAX_INT32 + '], got ' + qty);
        }
        if (goodForBatches !== Infinity && (!Number.isInteger(goodForBatches) || goodForBatches < 1)) {
            throw new RangeError('MarketSimulation.placeOrder: goodForBatches must be a positive integer or Infinity, got '
                + goodForBatches);
        }
        // Gate 5: the escrowed notional must fit Int32.
        const notional = price * qty;
        if (notional > MAX_INT32) {
            throw new RangeError('MarketSimulation.placeOrder: price * qty (' + notional + ') would overflow Int32');
        }
        if (this.freeCount === 0) {
            return { ok: false, reason: 'book_full' };
        }
        // Funding check - no state has been mutated yet.
        const cell = agentId * this.itemTypeCount + itemType;
        if (side === 'bid') {
            if ((this.wealth[agentId] ?? 0) < notional) {
                return { ok: false, reason: 'insufficient_wealth' };
            }
        }
        else {
            if ((this.inventory[cell] ?? 0) < qty) {
                return { ok: false, reason: 'insufficient_inventory' };
            }
        }
        // Allocate a slot and escrow the commitment. Past this point the
        // placement cannot fail, so the escrow move and the slot write
        // stay consistent.
        const slot = this.freeList[this.freeCount - 1] ?? 0;
        this.freeCount--;
        if (side === 'bid') {
            this.wealth[agentId] = (this.wealth[agentId] ?? 0) - notional;
            this.orderEscrow[slot] = notional;
            this.orderSide[slot] = SIDE_BID;
        }
        else {
            this.inventory[cell] = (this.inventory[cell] ?? 0) - qty;
            this.orderEscrow[slot] = 0;
            this.orderSide[slot] = SIDE_ASK;
        }
        this.orderAgent[slot] = agentId;
        this.orderItem[slot] = itemType;
        this.orderPrice[slot] = price;
        this.orderQty[slot] = qty;
        this.orderSeq[slot] = this.nextSeq;
        this.nextSeq++;
        this.orderExpiry[slot] = goodForBatches === Infinity ? Infinity : this.batchSeq + goodForBatches;
        this.liveOrders++;
        return { ok: true, orderId: this.makeOrderId(slot) };
    }
    // Cancel a resting order, refunding its escrow (a bid's wealth, an
    // ask's units) to the owner. Returns false if the handle is stale,
    // malformed, or already filled.
    cancelOrder(orderId) {
        const slot = this.resolveSlot(orderId);
        if (slot < 0)
            return false;
        this.refundOrder(slot);
        this.freeSlot(slot);
        return true;
    }
    // A snapshot of a resting order, or null if the handle does not
    // resolve to a live slot.
    getOrder(orderId) {
        const slot = this.resolveSlot(orderId);
        if (slot < 0)
            return null;
        return {
            orderId: orderId,
            agentId: this.orderAgent[slot] ?? 0,
            itemType: this.orderItem[slot] ?? 0,
            side: this.orderSide[slot] === SIDE_BID ? 'bid' : 'ask',
            price: this.orderPrice[slot] ?? 0,
            qty: this.orderQty[slot] ?? 0,
            escrow: this.orderEscrow[slot] ?? 0,
            expiresAfterBatch: this.orderExpiry[slot] ?? Infinity,
        };
    }
    // ---------- the batch auction ----------
    // Advance one batch: sweep expired orders, then match every item's
    // crossing orders. Returns the batch number, the trades executed,
    // and how many orders were swept for expiry.
    runBatch() {
        this.batchSeq++;
        // Sweep expired orders before matching. An order rests through
        // goodForBatches batches; once batchSeq passes its expiry it is
        // refunded and removed.
        let expired = 0;
        for (let slot = 0; slot < this.maxOrders; slot++) {
            if (this.orderAgent[slot] === SLOT_FREE)
                continue;
            if (this.batchSeq > (this.orderExpiry[slot] ?? Infinity)) {
                this.refundOrder(slot);
                this.freeSlot(slot);
                expired++;
            }
        }
        // Collect the live book and sort it once: (item, side, price,
        // seq). Within an item the bids form a contiguous best-first run
        // followed by the asks' best-first run.
        let liveN = 0;
        for (let slot = 0; slot < this.maxOrders; slot++) {
            if (this.orderAgent[slot] !== SLOT_FREE) {
                this.liveScratch[liveN] = slot;
                liveN++;
            }
        }
        const trades = [];
        if (liveN > 0) {
            this.liveScratch.subarray(0, liveN).sort(this.matchCmp);
            let i = 0;
            while (i < liveN) {
                const item = this.orderItem[this.liveScratch[i] ?? 0] ?? 0;
                // End of this item's run.
                let j = i;
                while (j < liveN && (this.orderItem[this.liveScratch[j] ?? 0] ?? 0) === item)
                    j++;
                // Bid / ask split within [i, j): bids (side 0) sort before
                // asks (side 1).
                let k = i;
                while (k < j && (this.orderSide[this.liveScratch[k] ?? 0] ?? 0) === SIDE_BID)
                    k++;
                this.matchRun(i, k, j, item, trades);
                i = j;
            }
        }
        return { batchSeq: this.batchSeq, trades: trades, expired: expired };
    }
    // ---------- inspection ----------
    // Live (resting) order count.
    openOrderCount() {
        return this.liveOrders;
    }
    // Number of batches completed so far.
    batchNumber() {
        return this.batchSeq;
    }
    // Total wealth in circulation: every agent's free wealth plus every
    // bid order's escrow. Invariant across placeOrder / cancelOrder /
    // runBatch - the conservation audit hook for gate 2.
    circulatingWealth() {
        let total = 0;
        for (let a = 0; a < this.maxAgents; a++)
            total += this.wealth[a] ?? 0;
        for (let slot = 0; slot < this.maxOrders; slot++) {
            if (this.orderAgent[slot] !== SLOT_FREE)
                total += this.orderEscrow[slot] ?? 0;
        }
        return total;
    }
    // Total units of an item in circulation: every agent's free
    // inventory plus every ask order's escrowed (unfilled) units.
    // Invariant across placeOrder / cancelOrder / runBatch - the
    // conservation audit hook for gate 3.
    circulatingInventory(itemType) {
        this.requireItem(itemType, 'circulatingInventory');
        let total = 0;
        for (let a = 0; a < this.maxAgents; a++) {
            total += this.inventory[a * this.itemTypeCount + itemType] ?? 0;
        }
        for (let slot = 0; slot < this.maxOrders; slot++) {
            if (this.orderAgent[slot] !== SLOT_FREE
                && this.orderSide[slot] === SIDE_ASK
                && this.orderItem[slot] === itemType) {
                total += this.orderQty[slot] ?? 0;
            }
        }
        return total;
    }
    // Reset to the constructed-but-empty state: ledgers zeroed, book
    // cleared, batch and sequence counters reset. Generations are bumped
    // (not reset) so an orderId minted before clear() can never validate
    // against a slot reused after it.
    clear() {
        this.wealth.fill(0);
        this.inventory.fill(0);
        this.orderAgent.fill(SLOT_FREE);
        for (let i = 0; i < this.maxOrders; i++) {
            this.orderGen[i] = ((this.orderGen[i] ?? 0) + 1) & ORDER_GEN_MASK;
            this.orderEscrow[i] = 0;
            this.orderQty[i] = 0;
            this.freeList[i] = this.maxOrders - 1 - i;
        }
        this.freeCount = this.maxOrders;
        this.nextSeq = 0;
        this.batchSeq = 0;
        this.liveOrders = 0;
    }
    // ---------- private: matching ----------
    // Match one item's sorted run. liveScratch[bidStart, askStart) holds
    // the item's bids best-first; liveScratch[askStart, askEnd) holds
    // its asks best-first. Two-pointer walk: while the best bid still
    // crosses the best ask, settle the pair.
    matchRun(bidStart, askStart, askEnd, item, trades) {
        let bi = bidStart;
        let ai = askStart;
        while (bi < askStart && ai < askEnd) {
            const bidSlot = this.liveScratch[bi] ?? 0;
            const askSlot = this.liveScratch[ai] ?? 0;
            const bidPrice = this.orderPrice[bidSlot] ?? 0;
            const askPrice = this.orderPrice[askSlot] ?? 0;
            // Best bid no longer crosses the best ask - this item is done.
            if (bidPrice < askPrice)
                break;
            // The maker is the older order (lower seq); its limit is the
            // execution price. Seqs are globally unique, so this is a strict
            // decision.
            const execPrice = (this.orderSeq[bidSlot] ?? 0) < (this.orderSeq[askSlot] ?? 0) ? bidPrice : askPrice;
            const fillQty = Math.min(this.orderQty[bidSlot] ?? 0, this.orderQty[askSlot] ?? 0);
            if (!this.settle(bidSlot, askSlot, item, execPrice, fillQty, trades)) {
                // Gate 5: a settlement that would overflow an Int32 ledger is
                // refused; matching for this item halts and both orders rest.
                break;
            }
            // fillQty is the min of the two quantities, so at least one
            // order is now fully filled.
            if ((this.orderQty[bidSlot] ?? 0) === 0) {
                this.freeSlot(bidSlot);
                bi++;
            }
            if ((this.orderQty[askSlot] ?? 0) === 0) {
                this.freeSlot(askSlot);
                ai++;
            }
        }
    }
    // Gate 1: atomic settlement. Compute the fill, check every guard,
    // and only then write. Nothing mutates before all guards pass, so a
    // refused trade leaves the book bit-identical. Returns false iff a
    // guard refused the trade.
    settle(bidSlot, askSlot, item, execPrice, fillQty, trades) {
        const buyer = this.orderAgent[bidSlot] ?? 0;
        const seller = this.orderAgent[askSlot] ?? 0;
        const bidPrice = this.orderPrice[bidSlot] ?? 0;
        // The bid escrowed at its own limit; it pays the (<=) execution
        // price and the difference is refunded to its owner.
        const cost = execPrice * fillQty;
        const refund = (bidPrice - execPrice) * fillQty;
        const buyerCell = buyer * this.itemTypeCount + item;
        // --- guards: nothing has been written yet ---
        // Escrow sufficiency. By the orderEscrow == price * qty invariant
        // (cost + refund == bidPrice * fillQty <= bidPrice * orderQty)
        // this always holds; checked anyway so settle() can never
        // overdraw an escrow.
        if ((this.orderEscrow[bidSlot] ?? 0) < cost + refund)
            return false;
        // Gate 5: the seller's wealth, the buyer's refunded wealth, and
        // the buyer's inventory must all stay within Int32.
        if ((this.wealth[seller] ?? 0) + cost > MAX_INT32)
            return false;
        if ((this.wealth[buyer] ?? 0) + refund > MAX_INT32)
            return false;
        if ((this.inventory[buyerCell] ?? 0) + fillQty > MAX_INT32)
            return false;
        // --- mutate: past here nothing can fail ---
        this.orderEscrow[bidSlot] = (this.orderEscrow[bidSlot] ?? 0) - cost - refund;
        this.wealth[seller] = (this.wealth[seller] ?? 0) + cost;
        this.wealth[buyer] = (this.wealth[buyer] ?? 0) + refund;
        this.inventory[buyerCell] = (this.inventory[buyerCell] ?? 0) + fillQty;
        this.orderQty[bidSlot] = (this.orderQty[bidSlot] ?? 0) - fillQty;
        this.orderQty[askSlot] = (this.orderQty[askSlot] ?? 0) - fillQty;
        trades.push({
            itemType: item,
            buyerId: buyer,
            sellerId: seller,
            buyOrderId: this.makeOrderId(bidSlot),
            sellOrderId: this.makeOrderId(askSlot),
            price: execPrice,
            qty: fillQty,
            batchSeq: this.batchSeq,
        });
        return true;
    }
    // Whole-book match order: item asc, then side (bids before asks),
    // then price (bids high-first, asks low-first), then the monotonic
    // placement seq. Seqs are unique so this is a total order - the
    // source of gate 4's determinism.
    compareForMatch(a, b) {
        const ia = this.orderItem[a] ?? 0;
        const ib = this.orderItem[b] ?? 0;
        if (ia !== ib)
            return ia - ib;
        const sa = this.orderSide[a] ?? 0;
        const sb = this.orderSide[b] ?? 0;
        if (sa !== sb)
            return sa - sb;
        const pa = this.orderPrice[a] ?? 0;
        const pb = this.orderPrice[b] ?? 0;
        if (pa !== pb)
            return sa === SIDE_BID ? pb - pa : pa - pb;
        return (this.orderSeq[a] ?? 0) - (this.orderSeq[b] ?? 0);
    }
    // ---------- private: slots, handles, refunds ----------
    // Return an order's escrowed commitment to its owner's free ledger.
    // A bid's escrow is wealth; an ask's escrow is the unfilled units
    // still sitting in orderQty.
    refundOrder(slot) {
        const agent = this.orderAgent[slot] ?? 0;
        if (this.orderSide[slot] === SIDE_BID) {
            this.wealth[agent] = (this.wealth[agent] ?? 0) + (this.orderEscrow[slot] ?? 0);
        }
        else {
            const cell = agent * this.itemTypeCount + (this.orderItem[slot] ?? 0);
            this.inventory[cell] = (this.inventory[cell] ?? 0) + (this.orderQty[slot] ?? 0);
        }
    }
    // Mark a slot free, bump its generation (so outstanding handles to
    // it stop validating), and push it back on the free-list.
    freeSlot(slot) {
        this.orderAgent[slot] = SLOT_FREE;
        this.orderEscrow[slot] = 0;
        this.orderQty[slot] = 0;
        this.orderGen[slot] = ((this.orderGen[slot] ?? 0) + 1) & ORDER_GEN_MASK;
        this.freeList[this.freeCount] = slot;
        this.freeCount++;
        this.liveOrders--;
    }
    // Pack (generation, slot) into a non-negative orderId.
    makeOrderId(slot) {
        return (((this.orderGen[slot] ?? 0) << ORDER_GEN_SHIFT) | slot) >>> 0;
    }
    // Decode an orderId to a live slot, or -1 if the handle is
    // malformed, out of range, points at a free slot, or carries a
    // stale generation.
    resolveSlot(orderId) {
        if (!Number.isInteger(orderId) || orderId < 0 || orderId > 0xffffffff)
            return -1;
        const slot = orderId & ORDER_SLOT_MASK;
        if (slot >= this.maxOrders)
            return -1;
        if (this.orderAgent[slot] === SLOT_FREE)
            return -1;
        const gen = (orderId >>> ORDER_GEN_SHIFT) & ORDER_GEN_MASK;
        if (gen !== (this.orderGen[slot] ?? 0))
            return -1;
        return slot;
    }
    requireAgent(agentId, op) {
        if (!Number.isInteger(agentId) || agentId < 0 || agentId >= this.maxAgents) {
            throw new RangeError('MarketSimulation.' + op + ': agentId ' + agentId + ' out of [0, ' + this.maxAgents + ')');
        }
    }
    requireItem(itemType, op) {
        if (!Number.isInteger(itemType) || itemType < 0 || itemType >= this.itemTypeCount) {
            throw new RangeError('MarketSimulation.' + op + ': itemType ' + itemType + ' out of [0, ' + this.itemTypeCount + ')');
        }
    }
}
//# sourceMappingURL=market-simulation.js.map