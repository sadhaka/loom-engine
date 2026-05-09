// Phase 0.74.0 - Crafting tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Crafting,
  RESOURCE_CRAFTING,
  InventoryGrid,
  type Recipe,
} from '../src/index.js';

function makeInventory(capacity: number = 10) {
  return InventoryGrid.create({
    capacity: capacity,
    itemInfo: (id) => ({ maxStack: id.startsWith('stack:') ? 99 : 1 }),
  });
}

const ironSword: Recipe = {
  id: 'forge:iron-sword',
  ingredients: [
    { itemId: 'ore:iron', count: 3 },
    { itemId: 'wood:handle', count: 1 },
  ],
  tools: ['tool:anvil'],
  outputs: [{ itemId: 'weapon:iron-sword', count: 1 }],
};

const splitLog: Recipe = {
  id: 'craft:planks',
  ingredients: [{ itemId: 'wood:log', count: 1 }],
  outputs: [{ itemId: 'wood:plank', count: 2 }],
};

test('crafting: RESOURCE_CRAFTING is the stable string', () => {
  assert.equal(RESOURCE_CRAFTING, 'crafting');
});

test('crafting: registerRecipe adds; duplicate returns false', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  assert.ok(c.registerRecipe(ironSword));
  assert.ok(c.hasRecipe('forge:iron-sword'));
  assert.equal(c.registerRecipe(ironSword), false);
});

test('crafting: registerRecipe rejects invalid recipes', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  assert.equal(c.registerRecipe({ id: '', ingredients: [], outputs: [{ itemId: 'x', count: 1 }] }), false);
  assert.equal(c.registerRecipe({ id: 'a', ingredients: [], outputs: [] } as Recipe), false);
  assert.equal(c.registerRecipe({
    id: 'a', ingredients: [{ itemId: '', count: 1 }], outputs: [{ itemId: 'x', count: 1 }],
  } as Recipe), false);
  assert.equal(c.registerRecipe({
    id: 'a', ingredients: [{ itemId: 'i', count: 0 }], outputs: [{ itemId: 'x', count: 1 }],
  } as Recipe), false);
});

test('crafting: unregisterRecipe drops + clears output index', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  assert.equal(c.recipesByOutput('weapon:iron-sword').length, 1);
  assert.ok(c.unregisterRecipe('forge:iron-sword'));
  assert.equal(c.hasRecipe('forge:iron-sword'), false);
  assert.equal(c.recipesByOutput('weapon:iron-sword').length, 0);
  assert.equal(c.unregisterRecipe('forge:iron-sword'), false);
});

test('crafting: getRecipe + listRecipes return defensive copies', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  const got = c.getRecipe('forge:iron-sword');
  assert.ok(got);
  // Mutating the copy does not affect registry.
  got!.ingredients.push({ itemId: 'x', count: 1 });
  const fresh = c.getRecipe('forge:iron-sword');
  assert.equal(fresh!.ingredients.length, 2);
  // listRecipes also defensive.
  const list = c.listRecipes();
  list.length = 0;
  assert.equal(c.listRecipes().length, 1);
});

test('crafting: recipesByOutput finds by output itemId', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  c.registerRecipe(splitLog);
  const planks = c.recipesByOutput('wood:plank');
  assert.equal(planks.length, 1);
  assert.equal(planks[0]!.id, 'craft:planks');
});

test('crafting: canCraft returns false when missing ingredients', () => {
  const inv = makeInventory();
  inv.add('ore:iron', 1); // not enough (need 3)
  inv.add('wood:handle', 1);
  inv.add('tool:anvil', 1);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  assert.equal(c.canCraft(ironSword), false);
});

test('crafting: canCraft returns true when ingredients + tools present', () => {
  const inv = makeInventory();
  inv.add('ore:iron', 5);
  inv.add('wood:handle', 1);
  inv.add('tool:anvil', 1);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  assert.ok(c.canCraft(ironSword));
});

test('crafting: canCraft returns false when tool missing', () => {
  const inv = makeInventory();
  inv.add('ore:iron', 5);
  inv.add('wood:handle', 1);
  // no anvil
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  assert.equal(c.canCraft(ironSword), false);
});

test('crafting: craft consumes ingredients + adds outputs on success', () => {
  let crafted = 0;
  const inv = makeInventory();
  inv.add('ore:iron', 5);
  inv.add('wood:handle', 1);
  inv.add('tool:anvil', 1);
  const c = Crafting.create({
    inventory: inv,
    onCrafted: () => { crafted++; },
  });
  c.registerRecipe(ironSword);
  const r = c.craft('forge:iron-sword');
  assert.equal(r.ok, true);
  assert.equal(inv.totalOf('ore:iron'), 2);     // 5 - 3
  assert.equal(inv.totalOf('wood:handle'), 0);  // 1 - 1
  assert.equal(inv.totalOf('tool:anvil'), 1);   // tool NOT consumed
  assert.equal(inv.totalOf('weapon:iron-sword'), 1);
  assert.equal(crafted, 1);
});

test('crafting: craft returns missing_ingredients failure with the missing items', () => {
  let failed: { reason?: string; missing?: string[] } = {};
  const inv = makeInventory();
  inv.add('tool:anvil', 1);
  // no iron, no handle
  const c = Crafting.create({
    inventory: inv,
    onFailed: (_r, reason, missing) => { failed = { reason, missing }; },
  });
  c.registerRecipe(ironSword);
  const r = c.craft('forge:iron-sword');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'missing_ingredients');
  assert.deepEqual(r.missing!.sort(), ['ore:iron', 'wood:handle'].sort());
  assert.equal(failed.reason, 'missing_ingredients');
});

test('crafting: craft returns missing_tool failure', () => {
  const inv = makeInventory();
  inv.add('ore:iron', 5);
  inv.add('wood:handle', 1);
  // no anvil
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  const r = c.craft('forge:iron-sword');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'missing_tool');
  assert.deepEqual(r.missing, ['tool:anvil']);
});

test('crafting: craft returns unknown_recipe for unregistered id', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  const r = c.craft('does-not-exist');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'unknown_recipe');
});

test('crafting: craft is atomic - missing ingredients leaves inventory untouched', () => {
  const inv = makeInventory();
  inv.add('tool:anvil', 1);
  inv.add('ore:iron', 1); // not enough
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  c.craft('forge:iron-sword');
  // Inventory unchanged.
  assert.equal(inv.totalOf('tool:anvil'), 1);
  assert.equal(inv.totalOf('ore:iron'), 1);
  assert.equal(inv.totalOf('weapon:iron-sword'), 0);
});

test('crafting: craft rolls back on output_overflow (full inventory)', () => {
  // 1-slot inventory, fill it with the tool. Recipe needs no tool;
  // outputs go nowhere.
  const inv = InventoryGrid.create({ capacity: 1 });
  inv.add('blocker', 1);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe({
    id: 'overflow:test',
    ingredients: [],
    outputs: [{ itemId: 'pile-of-stuff', count: 1 }],
  });
  const r = c.craft('overflow:test');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'output_overflow');
  // Inventory unchanged.
  assert.equal(inv.totalOf('blocker'), 1);
  assert.equal(inv.totalOf('pile-of-stuff'), 0);
});

test('crafting: rollback restores ingredients on output_overflow', () => {
  // 2-slot inventory: slot 0 has 1 ingredient, slot 1 will fill
  // when ingredient is consumed; output cannot fit because both
  // slots will be full of the wrong type.
  const inv = InventoryGrid.create({ capacity: 2 });
  inv.add('ingredient', 1);
  inv.add('blocker', 1); // fills slot 1
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe({
    id: 'almost:overflow',
    ingredients: [{ itemId: 'ingredient', count: 1 }],
    outputs: [
      { itemId: 'output-a', count: 1 }, // slot 0 (newly empty after consume)
      { itemId: 'output-b', count: 1 }, // overflow - both slots used
    ],
  });
  const r = c.craft('almost:overflow');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'output_overflow');
  // Ingredient restored.
  assert.equal(inv.totalOf('ingredient'), 1);
  assert.equal(inv.totalOf('blocker'), 1);
  assert.equal(inv.totalOf('output-a'), 0);
  assert.equal(inv.totalOf('output-b'), 0);
});

test('crafting: craft can be invoked by recipe object directly', () => {
  const inv = makeInventory();
  inv.add('ore:iron', 5);
  inv.add('wood:handle', 1);
  inv.add('tool:anvil', 1);
  const c = Crafting.create({ inventory: inv });
  // No prior registration; pass the recipe object.
  const r = c.craft(ironSword);
  assert.equal(r.ok, true);
});

test('crafting: tools are NOT consumed', () => {
  const inv = makeInventory();
  inv.add('ore:iron', 5);
  inv.add('wood:handle', 1);
  inv.add('tool:anvil', 1);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  c.craft('forge:iron-sword');
  c.craft('forge:iron-sword'); // try to craft again with a new ingredient set
  // First craft consumed enough; second fails for missing ingredients
  // (only 2 iron + 0 handle left). But the anvil is still there.
  assert.equal(inv.totalOf('tool:anvil'), 1);
});

test('crafting: dispose clears recipes + locks ops', () => {
  const inv = makeInventory();
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  c.dispose();
  assert.equal(c.hasRecipe('forge:iron-sword'), false);
  assert.equal(c.registerRecipe(splitLog), false);
  assert.equal(c.canCraft('forge:iron-sword'), false);
  const r = c.craft('forge:iron-sword');
  assert.equal(r.ok, false);
});

test('crafting: realistic forge - sword from iron + handle + anvil', () => {
  // 9 non-stackable iron + 3 handles + 1 anvil = 13 slots; size up.
  const inv = makeInventory(20);
  inv.add('ore:iron', 9); // 3 swords' worth
  inv.add('wood:handle', 3);
  inv.add('tool:anvil', 1);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(ironSword);
  for (let i = 0; i < 3; i++) {
    const r = c.craft('forge:iron-sword');
    assert.equal(r.ok, true);
  }
  assert.equal(inv.totalOf('weapon:iron-sword'), 3);
  assert.equal(inv.totalOf('ore:iron'), 0);
  assert.equal(inv.totalOf('wood:handle'), 0);
  // Fourth craft fails for ingredients.
  const fail = c.craft('forge:iron-sword');
  assert.equal(fail.ok, false);
  if (fail.ok) return;
  assert.equal(fail.reason, 'missing_ingredients');
});

test('crafting: multi-output recipe (split log produces 2 planks)', () => {
  const inv = makeInventory();
  inv.add('wood:log', 1);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe(splitLog);
  const r = c.craft('craft:planks');
  assert.equal(r.ok, true);
  assert.equal(inv.totalOf('wood:log'), 0);
  assert.equal(inv.totalOf('wood:plank'), 2);
});

test('crafting: stackable outputs merge into inventory stacks', () => {
  const inv = InventoryGrid.create({
    capacity: 5,
    itemInfo: () => ({ maxStack: 99 }),
  });
  inv.add('plank', 10);
  const c = Crafting.create({ inventory: inv });
  c.registerRecipe({
    id: 'stack:more',
    ingredients: [],
    outputs: [{ itemId: 'plank', count: 5 }],
  });
  const r = c.craft('stack:more');
  assert.equal(r.ok, true);
  assert.equal(inv.totalOf('plank'), 15);
  assert.equal(inv.occupiedCount(), 1);
});
