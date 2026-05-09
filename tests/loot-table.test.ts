// Phase 0.62.0 - LootTable tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LootTable,
  RESOURCE_LOOT_TABLE,
} from '../src/index.js';

test('loot: RESOURCE_LOOT_TABLE is the stable string', () => {
  assert.equal(RESOURCE_LOOT_TABLE, 'loot_table');
});

test('loot: empty entries throws', () => {
  // @ts-expect-error - testing runtime guard
  assert.throws(() => LootTable.create({}), /entries array/);
});

test('loot: filters out invalid entries (no id / weight <= 0)', () => {
  const t = LootTable.create({
    entries: [
      { itemId: 'gold', weight: 10 },
      { itemId: '', weight: 5 },
      { itemId: 'iron', weight: 0 },
      { itemId: 'gem', weight: -3 },
    ],
  });
  assert.equal(t.poolSize(), 1);
  assert.equal(t.totalWeightSum(), 10);
});

test('loot: roll returns one drop with default rollCount=1', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'gold', weight: 1 }],
    seed: 1,
  });
  const drops = t.roll();
  assert.equal(drops.length, 1);
  assert.equal(drops[0]!.itemId, 'gold');
  assert.equal(drops[0]!.count, 1);
});

test('loot: rollCount > 1 produces N weighted drops', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'gold', weight: 1 }],
    rollCount: 5,
    seed: 1,
  });
  const drops = t.roll();
  assert.equal(drops.length, 5);
  for (var i = 0; i < drops.length; i++) {
    assert.equal(drops[i]!.itemId, 'gold');
  }
});

test('loot: count and countRange resolve as expected', () => {
  const t = LootTable.create({
    entries: [
      { itemId: 'pile', weight: 1, count: 50 },
      { itemId: 'range', weight: 1, countRange: [3, 5] },
    ],
    rollCount: 200,
    seed: 42,
  });
  const drops = t.roll();
  for (var i = 0; i < drops.length; i++) {
    var d = drops[i]!;
    if (d.itemId === 'pile') assert.equal(d.count, 50);
    if (d.itemId === 'range') assert.ok(d.count >= 3 && d.count <= 5);
  }
});

test('loot: countRange handles flipped [hi, lo]', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'x', weight: 1, countRange: [10, 5] }],
    rollCount: 50,
    seed: 1,
  });
  const drops = t.roll();
  for (var i = 0; i < drops.length; i++) {
    assert.ok(drops[i]!.count >= 5 && drops[i]!.count <= 10);
  }
});

test('loot: deterministic - same seed produces same drops', () => {
  function run(): string[] {
    const t = LootTable.create({
      entries: [
        { itemId: 'a', weight: 30 },
        { itemId: 'b', weight: 60 },
        { itemId: 'c', weight: 9 },
        { itemId: 'd', weight: 1 },
      ],
      rollCount: 20,
      seed: 9999,
    });
    return t.roll().map((d) => d.itemId);
  }
  assert.deepEqual(run(), run());
});

test('loot: different seeds produce different drops', () => {
  const a = LootTable.create({
    entries: [
      { itemId: 'x', weight: 1 },
      { itemId: 'y', weight: 1 },
      { itemId: 'z', weight: 1 },
    ],
    rollCount: 30,
    seed: 1,
  });
  const b = LootTable.create({
    entries: [
      { itemId: 'x', weight: 1 },
      { itemId: 'y', weight: 1 },
      { itemId: 'z', weight: 1 },
    ],
    rollCount: 30,
    seed: 2,
  });
  const seqA = a.roll().map((d) => d.itemId).join(',');
  const seqB = b.roll().map((d) => d.itemId).join(',');
  // With 30 picks across 3 items, seeds 1 vs 2 produce different
  // sequences with overwhelming probability.
  assert.notEqual(seqA, seqB);
});

test('loot: reseed resets the RNG', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'a', weight: 1 }, { itemId: 'b', weight: 1 }],
    rollCount: 10,
    seed: 7,
  });
  const first = t.roll();
  t.reseed(7);
  const second = t.roll();
  assert.deepEqual(first, second);
});

test('loot: reseed with new seed changes output', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'a', weight: 1 }, { itemId: 'b', weight: 1 }],
    rollCount: 30,
    seed: 7,
  });
  const first = t.roll().map((d) => d.itemId).join(',');
  t.reseed(8);
  const second = t.roll().map((d) => d.itemId).join(',');
  assert.notEqual(first, second);
});

test('loot: guaranteed drops always appear (registered)', () => {
  const t = LootTable.create({
    entries: [
      { itemId: 'gold', weight: 100, count: 50 },
      { itemId: 'rare', weight: 1 },
    ],
    rollCount: 1,
    guaranteed: ['gold'],
    seed: 1,
  });
  // Run many rolls; gold should appear in EVERY one.
  for (var i = 0; i < 20; i++) {
    const drops = t.roll();
    var hasGold = false;
    for (var j = 0; j < drops.length; j++) {
      if (drops[j]!.itemId === 'gold') hasGold = true;
    }
    assert.equal(hasGold, true);
  }
});

test('loot: guaranteed drop uses registered count', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'gold', weight: 1, count: 25 }],
    guaranteed: ['gold'],
    rollCount: 0,
    seed: 1,
  });
  const drops = t.roll();
  // Only the guaranteed entry; rollCount=0 produces no extras.
  assert.equal(drops.length, 1);
  assert.equal(drops[0]!.itemId, 'gold');
  assert.equal(drops[0]!.count, 25);
});

test('loot: guaranteed drop with unregistered id defaults count=1', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'gold', weight: 1 }],
    guaranteed: ['ghost'],
    rollCount: 0,
    seed: 1,
  });
  const drops = t.roll();
  assert.equal(drops.length, 1);
  assert.equal(drops[0]!.itemId, 'ghost');
  assert.equal(drops[0]!.count, 1);
});

test('loot: rollMultiple sums multiple roll() calls', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'a', weight: 1 }],
    rollCount: 1,
    seed: 1,
  });
  const drops = t.rollMultiple(5);
  assert.equal(drops.length, 5);
});

test('loot: rollMultiple with 0 / negative returns empty', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'a', weight: 1 }],
    rollCount: 1,
  });
  assert.deepEqual(t.rollMultiple(0), []);
  assert.deepEqual(t.rollMultiple(-3), []);
});

test('loot: probabilityOf returns weight / total', () => {
  const t = LootTable.create({
    entries: [
      { itemId: 'common', weight: 70 },
      { itemId: 'rare', weight: 25 },
      { itemId: 'epic', weight: 5 },
    ],
  });
  assert.ok(Math.abs(t.probabilityOf('common') - 0.70) < 1e-9);
  assert.ok(Math.abs(t.probabilityOf('rare') - 0.25) < 1e-9);
  assert.ok(Math.abs(t.probabilityOf('epic') - 0.05) < 1e-9);
});

test('loot: probabilityOf unknown id returns 0', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'a', weight: 1 }],
  });
  assert.equal(t.probabilityOf('missing'), 0);
});

test('loot: empty pool returns empty drops (after guaranteed)', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'x', weight: 0 }],
    rollCount: 5,
    seed: 1,
  });
  const drops = t.roll();
  assert.deepEqual(drops, []);
});

test('loot: dispose locks subsequent ops', () => {
  const t = LootTable.create({
    entries: [{ itemId: 'a', weight: 1 }],
    seed: 1,
  });
  t.dispose();
  assert.deepEqual(t.roll(), []);
  assert.equal(t.poolSize(), 0);
});

test('loot: distribution roughly matches weights at scale', () => {
  // 1000 picks; weights 70 / 30 should produce roughly the same
  // ratio (within a generous tolerance).
  const t = LootTable.create({
    entries: [
      { itemId: 'A', weight: 70 },
      { itemId: 'B', weight: 30 },
    ],
    rollCount: 1000,
    seed: 12345,
  });
  const drops = t.roll();
  let aCount = 0;
  let bCount = 0;
  for (var i = 0; i < drops.length; i++) {
    if (drops[i]!.itemId === 'A') aCount++;
    else if (drops[i]!.itemId === 'B') bCount++;
  }
  // Expect ~700 A's; tolerate +/- 10%.
  assert.ok(aCount > 600 && aCount < 800, `aCount = ${aCount}`);
  assert.ok(bCount > 200 && bCount < 400, `bCount = ${bCount}`);
});
