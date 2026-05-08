// Phase 0.58.0 - InventoryGrid tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  InventoryGrid,
  RESOURCE_INVENTORY_GRID,
} from '../src/index.js';

const STACK_INFO = (id: string) => {
  // potion stacks to 5; everything else 1.
  return id === 'potion' ? { maxStack: 5 } : { maxStack: 1 };
};

test('inventory: RESOURCE_INVENTORY_GRID is the stable string', () => {
  assert.equal(RESOURCE_INVENTORY_GRID, 'inventory_grid');
});

test('inventory: create rejects non-positive capacity', () => {
  assert.throws(() => InventoryGrid.create({ capacity: 0 }), /positive/);
});

test('inventory: starts empty', () => {
  const inv = InventoryGrid.create({ capacity: 4 });
  assert.equal(inv.capacity(), 4);
  assert.equal(inv.occupiedCount(), 0);
  assert.equal(inv.freeSlots(), 4);
});

test('inventory: add non-stackable consumes one slot per unit', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  inv.add('sword', 1);
  inv.add('helm', 1);
  assert.equal(inv.occupiedCount(), 2);
  assert.equal(inv.totalOf('sword'), 1);
});

test('inventory: add returns added + overflow', () => {
  const inv = InventoryGrid.create({ capacity: 2 });
  inv.add('sword', 1);
  inv.add('helm', 1);
  const r = inv.add('shield', 3); // no room
  assert.equal(r.added, 0);
  assert.equal(r.overflow, 3);
});

test('inventory: add stackable merges into existing slot', () => {
  const inv = InventoryGrid.create({ capacity: 5, itemInfo: STACK_INFO });
  inv.add('potion', 3);
  inv.add('potion', 1);
  assert.equal(inv.totalOf('potion'), 4);
  assert.equal(inv.occupiedCount(), 1);
});

test('inventory: add stackable spills to a new slot when first fills', () => {
  const inv = InventoryGrid.create({ capacity: 5, itemInfo: STACK_INFO });
  // potion maxStack=5, add 7 -> 5 in slot 0, 2 in slot 1.
  inv.add('potion', 7);
  assert.equal(inv.totalOf('potion'), 7);
  assert.equal(inv.occupiedCount(), 2);
});

test('inventory: add overflow when out of slots', () => {
  const inv = InventoryGrid.create({ capacity: 1, itemInfo: STACK_INFO });
  const r = inv.add('potion', 10);
  // 5 fit in the single slot; 5 overflow.
  assert.equal(r.added, 5);
  assert.equal(r.overflow, 5);
});

test('inventory: add 0 / negative is no-op', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  const r = inv.add('sword', 0);
  assert.equal(r.added, 0);
  assert.equal(r.overflow, 0);
  const r2 = inv.add('sword', -3);
  assert.equal(r2.added, 0);
});

test('inventory: empty itemId is rejected', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  const r = inv.add('', 1);
  assert.equal(r.added, 0);
  assert.equal(r.overflow, 1);
});

test('inventory: getSlot returns a copy', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  inv.add('sword', 1);
  const s = inv.getSlot(0)!;
  s.count = 999;
  assert.equal(inv.getSlot(0)!.count, 1);
});

test('inventory: getSlot out-of-bounds returns null', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  assert.equal(inv.getSlot(-1), null);
  assert.equal(inv.getSlot(99), null);
});

test('inventory: has + totalOf reflect contents', () => {
  const inv = InventoryGrid.create({ capacity: 5, itemInfo: STACK_INFO });
  inv.add('potion', 3);
  inv.add('potion', 4);  // 5 in slot 0, 2 in slot 1
  assert.equal(inv.has('potion'), true);
  assert.equal(inv.totalOf('potion'), 7);
  assert.equal(inv.has('missing'), false);
});

test('inventory: remove decrements count + clears slot when empty', () => {
  const inv = InventoryGrid.create({ capacity: 5, itemInfo: STACK_INFO });
  inv.add('potion', 5);
  const removed = inv.remove('potion', 2);
  assert.equal(removed, 2);
  assert.equal(inv.totalOf('potion'), 3);
  inv.remove('potion', 3);
  assert.equal(inv.has('potion'), false);
});

test('inventory: remove more than held returns actual removed', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  inv.add('sword', 1);
  const removed = inv.remove('sword', 5);
  assert.equal(removed, 1);
});

test('inventory: takeSlot returns + clears the slot', () => {
  const inv = InventoryGrid.create({ capacity: 5, itemInfo: STACK_INFO });
  inv.add('potion', 4);
  const taken = inv.takeSlot(0);
  assert.deepEqual(taken, { itemId: 'potion', count: 4 });
  assert.equal(inv.getSlot(0), null);
});

test('inventory: takeSlot empty / OOB returns null', () => {
  const inv = InventoryGrid.create({ capacity: 5 });
  assert.equal(inv.takeSlot(0), null);
  assert.equal(inv.takeSlot(-1), null);
});

test('inventory: move into empty slot transfers wholesale', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  inv.add('sword', 1);
  assert.equal(inv.move(0, 2), true);
  assert.equal(inv.getSlot(0), null);
  assert.equal(inv.getSlot(2)!.itemId, 'sword');
});

test('inventory: move same-item stack merges', () => {
  const inv = InventoryGrid.create({ capacity: 3, itemInfo: STACK_INFO });
  // Put 2 potions in slot 0; 3 in slot 2.
  inv.add('potion', 2);
  inv.takeSlot(1); // ensure slot 1 empty
  inv.move(0, 2);  // would merge 2+0 ... but slot 2 empty, transfers
  inv.add('potion', 3);  // ends in slot 0 (free) ... let's just rebuild test
  // Restart for clarity.
  const inv2 = InventoryGrid.create({ capacity: 3, itemInfo: STACK_INFO });
  inv2.add('potion', 2);          // slot 0
  // Manually place 3 into slot 1 by overflow tactics: adding 3 more
  // merges into slot 0 (fills to 5). Need a multi-slot start.
  inv2.add('potion', 6);          // slot 0 fills to 5, slot 1 has 3
  // Now move slot 1 -> slot 0 should fail (slot 0 full).
  assert.equal(inv2.move(1, 0), false);
  // Take some from slot 0 then merge.
  inv2.remove('potion', 3);       // slot 0 now 2; slot 1 still 3
  // Move slot 1 -> slot 0: 2 + 3 = 5; slot 1 becomes empty.
  assert.equal(inv2.move(1, 0), true);
  assert.equal(inv2.getSlot(0)!.count, 5);
  assert.equal(inv2.getSlot(1), null);
});

test('inventory: move different items swaps slots', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  inv.add('sword', 1);
  inv.add('helm', 1);
  // slot 0 = sword; slot 1 = helm.
  assert.equal(inv.move(0, 1), true);
  assert.equal(inv.getSlot(0)!.itemId, 'helm');
  assert.equal(inv.getSlot(1)!.itemId, 'sword');
});

test('inventory: move with from === to is a no-op', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  inv.add('sword', 1);
  assert.equal(inv.move(0, 0), false);
});

test('inventory: move from empty slot is no-op', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  inv.add('sword', 1);
  assert.equal(inv.move(2, 0), false);
});

test('inventory: clear empties all slots', () => {
  const inv = InventoryGrid.create({ capacity: 3, itemInfo: STACK_INFO });
  inv.add('potion', 5);
  inv.add('sword', 1);
  inv.clear();
  assert.equal(inv.occupiedCount(), 0);
});

test('inventory: snapshot + fromSnapshot roundtrip', () => {
  const inv = InventoryGrid.create({ capacity: 4, itemInfo: STACK_INFO });
  inv.add('potion', 3);
  inv.add('sword', 1);
  const snap = inv.toSnapshot();
  const inv2 = InventoryGrid.create({ capacity: 4, itemInfo: STACK_INFO });
  inv2.fromSnapshot(snap);
  assert.equal(inv2.totalOf('potion'), 3);
  assert.equal(inv2.totalOf('sword'), 1);
});

test('inventory: fromSnapshot rejects malformed slots', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  // @ts-expect-error - testing malformed input
  inv.fromSnapshot([{ itemId: 'sword', count: 'one' }, null, undefined]);
  // Slot 0 was malformed (count not number) -> nulled.
  assert.equal(inv.getSlot(0), null);
});

test('inventory: fromSnapshot truncates if longer + clears tail if shorter', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  inv.add('helm', 1);
  inv.fromSnapshot([{ itemId: 'sword', count: 1 }]);
  // Slot 0 from snap; slots 1+2 cleared.
  assert.equal(inv.getSlot(0)!.itemId, 'sword');
  assert.equal(inv.getSlot(1), null);
  assert.equal(inv.getSlot(2), null);
});

test('inventory: onChanged fires for affected slots', () => {
  const changes: number[] = [];
  const inv = InventoryGrid.create({
    capacity: 5,
    itemInfo: STACK_INFO,
    onChanged: (idx) => changes.push(idx),
  });
  inv.add('potion', 3);   // slot 0 created
  inv.add('potion', 1);   // slot 0 updated
  changes.length = 0;
  inv.takeSlot(0);
  assert.deepEqual(changes, [0]);
});

test('inventory: throwing onChanged is isolated', () => {
  const inv = InventoryGrid.create({
    capacity: 3,
    onChanged: () => { throw new Error('boom'); },
  });
  // Should not throw.
  inv.add('sword', 1);
  assert.equal(inv.totalOf('sword'), 1);
});

test('inventory: dispose makes ops no-op', () => {
  const inv = InventoryGrid.create({ capacity: 3 });
  inv.add('sword', 1);
  inv.dispose();
  const r = inv.add('helm', 1);
  assert.equal(r.added, 0);
  assert.equal(r.overflow, 1);
});

test('inventory: throwing itemInfo defaults to non-stackable', () => {
  const inv = InventoryGrid.create({
    capacity: 5,
    itemInfo: () => { throw new Error('config-fail'); },
  });
  inv.add('foo', 3);
  // Each unit consumes a slot since maxStack defaulted to 1.
  assert.equal(inv.occupiedCount(), 3);
});
