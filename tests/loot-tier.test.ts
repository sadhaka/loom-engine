// Phase 1.2.5 - LootTier tests (Wave 1.2 milestone capstone).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LootTier,
  RESOURCE_LOOT_TIER,
} from '../src/index.js';

interface ItemPayload { name: string }

const seqRng = (vals: number[]): () => number => {
  let i = 0;
  return () => vals[i++ % vals.length] as number;
};

test('lt: RESOURCE_LOOT_TIER is the stable string', () => {
  assert.equal(RESOURCE_LOOT_TIER, 'loot_tier');
});

test('lt: starts empty', () => {
  const lt = LootTier.create();
  assert.equal(lt.tierCount(), 0);
  assert.equal(lt.size(), 0);
});

test('lt: defineTier + hasTier + tierIds', () => {
  const lt = LootTier.create();
  lt.defineTier({ id: 'common', weight: 75 });
  lt.defineTier({ id: 'rare', weight: 5 });
  assert.equal(lt.hasTier('common'), true);
  assert.deepEqual(lt.tierIds().sort(), ['common', 'rare']);
});

test('lt: defineTier rejects empty id', () => {
  const lt = LootTier.create();
  assert.equal(lt.defineTier({ id: '' }), false);
});

test('lt: addItem rejects unknown tier', () => {
  const lt = LootTier.create<ItemPayload>();
  assert.equal(lt.addItem({
    id: 'a', tier: 'missing', payload: { name: 'a' },
  }), false);
});

test('lt: addItem succeeds + indexed by tier', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common' });
  assert.equal(lt.addItem({
    id: 'twig', tier: 'common', payload: { name: 'Twig' },
  }), true);
  assert.equal(lt.size(), 1);
  const items = lt.itemsByTier('common');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'twig');
});

test('lt: removeItem drops from index', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common' });
  lt.addItem({ id: 'twig', tier: 'common', payload: { name: 'Twig' } });
  lt.removeItem('twig');
  assert.equal(lt.size(), 0);
  assert.equal(lt.itemsByTier('common').length, 0);
});

test('lt: removeTier drops all items in that tier', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common' });
  lt.defineTier({ id: 'rare' });
  lt.addItem({ id: 'twig', tier: 'common', payload: { name: 'Twig' } });
  lt.addItem({ id: 'log', tier: 'common', payload: { name: 'Log' } });
  lt.addItem({ id: 'ring', tier: 'rare', payload: { name: 'Ring' } });
  lt.removeTier('common');
  assert.equal(lt.size(), 1);
  assert.equal(lt.hasItem('ring'), true);
});

test('lt: rollTier picks weighted', () => {
  // 75/25 split. With rng=0.5, target=50. 'common' has 75 -> picked.
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.5]) });
  lt.defineTier({ id: 'common', weight: 75 });
  lt.defineTier({ id: 'rare', weight: 25 });
  assert.equal(lt.rollTier(), 'common');
});

test('lt: rollTier respects forced ctx.tier', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common', weight: 100 });
  lt.defineTier({ id: 'legendary', weight: 1 });
  assert.equal(lt.rollTier({ tier: 'legendary' }), 'legendary');
});

test('lt: rollTier returns null when no tiers', () => {
  const lt = LootTier.create<ItemPayload>();
  assert.equal(lt.rollTier(), null);
});

test('lt: rollItem returns DropResult with tier + payload', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.1, 0.5]) });
  lt.defineTier({ id: 'common' });
  lt.addItem({ id: 'twig', tier: 'common', payload: { name: 'Twig' } });
  const drop = lt.rollItem();
  assert.ok(drop);
  assert.equal(drop!.tier, 'common');
  assert.equal(drop!.id, 'twig');
  assert.equal(drop!.payload.name, 'Twig');
});

test('lt: rollItem returns null when tier has no items', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.5]) });
  lt.defineTier({ id: 'rare', weight: 1 });
  // No items added.
  assert.equal(lt.rollItem(), null);
});

test('lt: rollItem within tier weighted', () => {
  // tier rolls common; within common, rng picks weighted item.
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.5, 0.05]) });
  lt.defineTier({ id: 'common' });
  lt.addItem({ id: 'rare_within', tier: 'common', weight: 1, payload: { name: 'Rare' } });
  lt.addItem({ id: 'common_within', tier: 'common', weight: 9, payload: { name: 'Common' } });
  // total weight 10, rng=0.05, target=0.5 -> first accumulator hits 1 -> 'rare_within'.
  const drop = lt.rollItem();
  assert.equal(drop!.id, 'rare_within');
});

test('lt: setTierScaleFn rebalances tier weights by context', () => {
  // Without scale: rare almost never. With scale fn boosting rare 100x at level 30, rare wins.
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.5]) });
  lt.defineTier({ id: 'common', weight: 100 });
  lt.defineTier({ id: 'rare', weight: 1 });
  lt.addItem({ id: 'cmn', tier: 'common', payload: { name: 'C' } });
  lt.addItem({ id: 'rar', tier: 'rare', payload: { name: 'R' } });
  // No scale: total 101, target 50.5 -> common wins (acc=100 >= 50.5).
  assert.equal(lt.rollTier(), 'common');
  // With scale: rare *= 200, common *= 1. rare=200, common=100. total=300, target=150 -> common (acc=100<150, then rare=300>=150).
  lt.setTierScaleFn((tierId, ctx) => {
    if (tierId === 'rare' && (ctx.level as number) > 25) return 200;
    return 1;
  });
  assert.equal(lt.rollTier({ level: 30 }), 'rare');
});

test('lt: throwing tierScaleFn falls back to weight 1', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.1]) });
  lt.defineTier({ id: 'common', weight: 1 });
  lt.setTierScaleFn(() => { throw new Error('boom'); });
  // Should not throw.
  const t = lt.rollTier();
  assert.equal(t, 'common');
});

test('lt: tag filter restricts items in a tier', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.5, 0.5]) });
  lt.defineTier({ id: 'common' });
  lt.addItem({
    id: 'red_sword', tier: 'common', tags: ['fire'],
    payload: { name: 'Red Sword' },
  });
  lt.addItem({
    id: 'blue_sword', tier: 'common', tags: ['water'],
    payload: { name: 'Blue Sword' },
  });
  // ctx.tags=['fire'] -> only red_sword matches.
  const drop = lt.rollItem({ tags: ['fire'] });
  assert.equal(drop!.id, 'red_sword');
});

test('lt: requireTagMatch excludes untagged items', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.5, 0.5]) });
  lt.defineTier({ id: 'common' });
  lt.addItem({ id: 'untagged', tier: 'common', payload: { name: 'X' } });
  lt.addItem({
    id: 'tagged', tier: 'common', tags: ['fire'],
    payload: { name: 'Y' },
  });
  // Without requireTagMatch: untagged is eligible.
  const drop1 = lt.rollItem({ tags: ['fire'] });
  assert.ok(drop1!.id === 'tagged' || drop1!.id === 'untagged');
  // With requireTagMatch: untagged excluded, only tagged drops.
  const drop2 = lt.rollItem({ tags: ['fire'], requireTagMatch: true });
  assert.equal(drop2!.id, 'tagged');
});

test('lt: rollItems returns N independent rolls', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.1, 0.1, 0.5, 0.1, 0.5, 0.1]) });
  lt.defineTier({ id: 'common', weight: 1 });
  lt.addItem({ id: 'a', tier: 'common', payload: { name: 'A' } });
  const drops = lt.rollItems(3);
  assert.equal(drops.length, 3);
});

test('lt: rollItemsUnique returns N unique items (or fewer)', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.1, 0.05, 0.95, 0.5, 0.5]) });
  lt.defineTier({ id: 'common', weight: 1 });
  lt.addItem({ id: 'a', tier: 'common', weight: 1, payload: { name: 'A' } });
  lt.addItem({ id: 'b', tier: 'common', weight: 1, payload: { name: 'B' } });
  const drops = lt.rollItemsUnique(2);
  assert.equal(drops.length, 2);
  const ids = drops.map((d) => d.id);
  assert.notEqual(ids[0], ids[1]);
});

test('lt: rollItemsUnique caps at pool size', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common', weight: 1 });
  lt.addItem({ id: 'only', tier: 'common', payload: { name: 'X' } });
  const drops = lt.rollItemsUnique(5);
  assert.equal(drops.length, 1);
});

test('lt: re-adding item moves it between tiers', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common' });
  lt.defineTier({ id: 'rare' });
  lt.addItem({ id: 'sword', tier: 'common', payload: { name: 'Sword' } });
  assert.equal(lt.itemsByTier('common').length, 1);
  // Re-add same id with different tier.
  lt.addItem({ id: 'sword', tier: 'rare', payload: { name: 'Sword' } });
  assert.equal(lt.itemsByTier('common').length, 0);
  assert.equal(lt.itemsByTier('rare').length, 1);
});

test('lt: clear empties everything', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common' });
  lt.addItem({ id: 'a', tier: 'common', payload: { name: 'A' } });
  lt.clear();
  assert.equal(lt.tierCount(), 0);
  assert.equal(lt.size(), 0);
});

test('lt: dispose locks ops', () => {
  const lt = LootTier.create<ItemPayload>();
  lt.defineTier({ id: 'common' });
  lt.dispose();
  assert.equal(lt.defineTier({ id: 'rare' }), false);
  assert.equal(lt.rollTier(), null);
});

test('lt: realistic example - tiered drop with level scaling', () => {
  const lt = LootTier.create<ItemPayload>({ rng: seqRng([0.99]) });
  lt.defineTier({ id: 'common',    weight: 75 });
  lt.defineTier({ id: 'uncommon',  weight: 20 });
  lt.defineTier({ id: 'rare',      weight: 4 });
  lt.defineTier({ id: 'legendary', weight: 1 });

  lt.addItem({ id: 'twig', tier: 'common', payload: { name: 'Twig' } });
  lt.addItem({ id: 'goldring', tier: 'rare', payload: { name: 'Gold Ring' } });
  lt.addItem({ id: 'mirror_shard', tier: 'legendary', payload: { name: 'Mirror Shard' } });

  // rng=0.99 with default weights (total 100). target=99 -> common 75 -> uncommon 95 -> rare 99 -> legendary 100. acc=99 -> rare. But uncommon has no items, rare has 1.
  const drop = lt.rollItem();
  assert.ok(drop);
  // It should be either rare or legendary depending on exact accumulator.
  assert.ok(drop!.tier === 'rare' || drop!.tier === 'legendary');
});
