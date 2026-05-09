// Crafting - recipe matcher + ingredient consumption + output production.
//
// 0.74.0 enabling primitive. Recipes - "iron + handle = sword" with
// maybe an "anvil" tool - are everywhere in survival / RPG / hub-MMO
// worlds. This module is the recipe registry + the atomic
// consume-then-produce step on top of an InventoryGrid (0.58).
//
// Each recipe declares a stable id, a set of ingredients (consumed),
// a set of outputs (produced), and an optional list of tools (must
// be PRESENT, not consumed). craft() is atomic: it pre-checks
// ingredients, tools, and output room, and only mutates the inventory
// if every check passes.
//
//   var craft = Crafting.create({
//     inventory: inventoryGrid,
//     onCrafted: (r) => log('crafted ' + r.id),
//   });
//   craft.registerRecipe({
//     id: 'forge:iron-sword',
//     ingredients: [
//       { itemId: 'ore:iron', count: 3 },
//       { itemId: 'wood:handle', count: 1 },
//     ],
//     tools: ['tool:anvil'],
//     outputs: [{ itemId: 'weapon:iron-sword', count: 1 }],
//   });
//   var result = craft.craft('forge:iron-sword');
//
// The inventory dependency is structural - any object with the same
// totalOf / has / add / remove signatures works (plain InventoryGrid,
// a custom adapter, or a test fake).
//
// Pairs with InventoryGrid (0.58).
//
// Code style: var-only in browser source.

import type { AddResult } from './inventory-grid.js';

export interface RecipeIngredient {
  itemId: string;
  // Required positive integer count.
  count: number;
}

export interface RecipeOutput {
  itemId: string;
  count: number;
}

export interface Recipe {
  // Stable id ('forge:iron-sword', 'cook:soup'). Used for lookup
  // and event correlation.
  id: string;
  ingredients: RecipeIngredient[];
  outputs: RecipeOutput[];
  // Tools that must be PRESENT in inventory (not consumed). Pickaxe
  // to mine, anvil to forge, etc.
  tools?: string[];
  // Pass-through metadata for UI labels / sound cues / etc.
  data?: Record<string, unknown>;
}

export type CraftFailureReason =
  | 'unknown_recipe'
  | 'missing_ingredients'
  | 'missing_tool'
  | 'output_overflow';

export interface CraftSuccess {
  ok: true;
  recipe: Recipe;
}

export interface CraftFailure {
  ok: false;
  reason: CraftFailureReason;
  // For missing_ingredients / missing_tool: the item ids we lacked.
  // For output_overflow: the output item ids that didn't fit.
  missing?: string[];
}

export type CraftResult = CraftSuccess | CraftFailure;

export interface IInventoryAdapter {
  totalOf(itemId: string): number;
  has(itemId: string): boolean;
  add(itemId: string, count: number): AddResult;
  remove(itemId: string, count: number): number;
}

export interface CraftingOptions {
  inventory: IInventoryAdapter;
  // Fired after a successful craft.
  onCrafted?: (recipe: Recipe) => void;
  // Fired on every failure path (recipe is null only for
  // unknown_recipe with a string lookup).
  onFailed?: (recipe: Recipe | null, reason: CraftFailureReason, missing?: string[]) => void;
}

export class Crafting {
  private inventory: IInventoryAdapter;
  private recipes: Map<string, Recipe> = new Map();
  private byOutput: Map<string, Set<string>> = new Map();
  private onCrafted: ((r: Recipe) => void) | null;
  private onFailed: ((r: Recipe | null, reason: CraftFailureReason, missing?: string[]) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: CraftingOptions) {
    this.inventory = opts.inventory;
    this.onCrafted = opts.onCrafted ?? null;
    this.onFailed = opts.onFailed ?? null;
  }

  static create(opts: CraftingOptions): Crafting {
    return new Crafting(opts);
  }

  // Register a recipe. Returns false if disposed, recipe invalid, or
  // a recipe with the same id is already registered.
  registerRecipe(recipe: Recipe): boolean {
    if (this.disposed) return false;
    if (!isValidRecipe(recipe)) return false;
    if (this.recipes.has(recipe.id)) return false;
    var copy: Recipe = {
      id: recipe.id,
      ingredients: recipe.ingredients.map((i) => ({ itemId: i.itemId, count: i.count })),
      outputs: recipe.outputs.map((o) => ({ itemId: o.itemId, count: o.count })),
    };
    if (recipe.tools) copy.tools = recipe.tools.slice();
    if (recipe.data) copy.data = recipe.data;
    this.recipes.set(recipe.id, copy);
    // Maintain output index.
    for (var i = 0; i < copy.outputs.length; i++) {
      var oid = (copy.outputs[i] as RecipeOutput).itemId;
      var bucket = this.byOutput.get(oid);
      if (!bucket) {
        bucket = new Set();
        this.byOutput.set(oid, bucket);
      }
      bucket.add(copy.id);
    }
    return true;
  }

  unregisterRecipe(id: string): boolean {
    if (this.disposed) return false;
    var r = this.recipes.get(id);
    if (!r) return false;
    this.recipes.delete(id);
    for (var i = 0; i < r.outputs.length; i++) {
      var oid = (r.outputs[i] as RecipeOutput).itemId;
      var bucket = this.byOutput.get(oid);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) this.byOutput.delete(oid);
      }
    }
    return true;
  }

  hasRecipe(id: string): boolean {
    return this.recipes.has(id);
  }

  getRecipe(id: string): Recipe | null {
    var r = this.recipes.get(id);
    return r ? cloneRecipe(r) : null;
  }

  listRecipes(): Recipe[] {
    var out: Recipe[] = [];
    this.recipes.forEach((r) => out.push(cloneRecipe(r)));
    return out;
  }

  // Recipes whose outputs include `itemId`.
  recipesByOutput(itemId: string): Recipe[] {
    var bucket = this.byOutput.get(itemId);
    if (!bucket) return [];
    var out: Recipe[] = [];
    bucket.forEach((id) => {
      var r = this.recipes.get(id);
      if (r) out.push(cloneRecipe(r));
    });
    return out;
  }

  // True if the inventory currently has all ingredients + tools.
  // Output room is NOT pre-checked here (would require a dry-run
  // add to be accurate); craft() does the full atomic check.
  canCraft(recipe: Recipe | string): boolean {
    if (this.disposed) return false;
    var r = this.resolve(recipe);
    if (!r) return false;
    return this.checkIngredients(r).length === 0 && this.checkTools(r).length === 0;
  }

  // Execute a recipe atomically. Pre-checks ingredients, tools,
  // and output room. Only mutates the inventory if every check
  // passes. On output_overflow, the partial outputs that DID land
  // are removed before returning so the inventory is restored.
  craft(recipe: Recipe | string): CraftResult {
    if (this.disposed) {
      return { ok: false, reason: 'unknown_recipe' };
    }
    var r: Recipe | null;
    if (typeof recipe === 'string') {
      var found = this.recipes.get(recipe);
      r = found ? cloneRecipe(found) : null;
      if (!r) {
        this.fireFailed(null, 'unknown_recipe');
        return { ok: false, reason: 'unknown_recipe' };
      }
    } else {
      if (!isValidRecipe(recipe)) {
        this.fireFailed(null, 'unknown_recipe');
        return { ok: false, reason: 'unknown_recipe' };
      }
      r = cloneRecipe(recipe);
    }
    var missingIng = this.checkIngredients(r);
    if (missingIng.length > 0) {
      this.fireFailed(r, 'missing_ingredients', missingIng);
      return { ok: false, reason: 'missing_ingredients', missing: missingIng };
    }
    var missingTools = this.checkTools(r);
    if (missingTools.length > 0) {
      this.fireFailed(r, 'missing_tool', missingTools);
      return { ok: false, reason: 'missing_tool', missing: missingTools };
    }
    // Consume ingredients.
    for (var i = 0; i < r.ingredients.length; i++) {
      var ing = r.ingredients[i] as RecipeIngredient;
      this.inventory.remove(ing.itemId, ing.count);
    }
    // Produce outputs. Track partial drops in case overflow.
    var dropped: Array<{ itemId: string; count: number }> = [];
    var overflowItems: string[] = [];
    for (var j = 0; j < r.outputs.length; j++) {
      var out = r.outputs[j] as RecipeOutput;
      var addRes = this.inventory.add(out.itemId, out.count);
      if (addRes.added > 0) {
        dropped.push({ itemId: out.itemId, count: addRes.added });
      }
      if (addRes.overflow > 0) {
        if (overflowItems.indexOf(out.itemId) < 0) overflowItems.push(out.itemId);
      }
    }
    if (overflowItems.length > 0) {
      // Roll back: remove what we added; re-add what we consumed.
      for (var k = 0; k < dropped.length; k++) {
        var d = dropped[k] as { itemId: string; count: number };
        this.inventory.remove(d.itemId, d.count);
      }
      for (var m = 0; m < r.ingredients.length; m++) {
        var ing2 = r.ingredients[m] as RecipeIngredient;
        this.inventory.add(ing2.itemId, ing2.count);
      }
      this.fireFailed(r, 'output_overflow', overflowItems);
      return { ok: false, reason: 'output_overflow', missing: overflowItems };
    }
    if (this.onCrafted) {
      try { this.onCrafted(r); } catch { /* ignore */ }
    }
    return { ok: true, recipe: r };
  }

  dispose(): void {
    this.recipes.clear();
    this.byOutput.clear();
    this.onCrafted = null;
    this.onFailed = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private resolve(recipe: Recipe | string): Recipe | null {
    if (typeof recipe === 'string') {
      var r = this.recipes.get(recipe);
      return r ? cloneRecipe(r) : null;
    }
    return isValidRecipe(recipe) ? cloneRecipe(recipe) : null;
  }

  private checkIngredients(r: Recipe): string[] {
    var missing: string[] = [];
    for (var i = 0; i < r.ingredients.length; i++) {
      var ing = r.ingredients[i] as RecipeIngredient;
      if (this.inventory.totalOf(ing.itemId) < ing.count) {
        if (missing.indexOf(ing.itemId) < 0) missing.push(ing.itemId);
      }
    }
    return missing;
  }

  private checkTools(r: Recipe): string[] {
    if (!r.tools || r.tools.length === 0) return [];
    var missing: string[] = [];
    for (var i = 0; i < r.tools.length; i++) {
      var t = r.tools[i] as string;
      if (!this.inventory.has(t)) {
        if (missing.indexOf(t) < 0) missing.push(t);
      }
    }
    return missing;
  }

  private fireFailed(r: Recipe | null, reason: CraftFailureReason, missing?: string[]): void {
    if (!this.onFailed) return;
    try { this.onFailed(r, reason, missing); } catch { /* ignore */ }
  }
}

function isValidRecipe(r: Recipe): boolean {
  if (!r || typeof r.id !== 'string' || r.id.length === 0) return false;
  if (!Array.isArray(r.ingredients)) return false;
  if (!Array.isArray(r.outputs) || r.outputs.length === 0) return false;
  for (var i = 0; i < r.ingredients.length; i++) {
    var ing = r.ingredients[i] as RecipeIngredient;
    if (!ing || typeof ing.itemId !== 'string' || ing.itemId.length === 0) return false;
    if (typeof ing.count !== 'number' || ing.count <= 0 || !isFinite(ing.count)) return false;
  }
  for (var j = 0; j < r.outputs.length; j++) {
    var out = r.outputs[j] as RecipeOutput;
    if (!out || typeof out.itemId !== 'string' || out.itemId.length === 0) return false;
    if (typeof out.count !== 'number' || out.count <= 0 || !isFinite(out.count)) return false;
  }
  return true;
}

function cloneRecipe(r: Recipe): Recipe {
  var copy: Recipe = {
    id: r.id,
    ingredients: r.ingredients.map((i) => ({ itemId: i.itemId, count: i.count })),
    outputs: r.outputs.map((o) => ({ itemId: o.itemId, count: o.count })),
  };
  if (r.tools) copy.tools = r.tools.slice();
  if (r.data) copy.data = r.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_CRAFTING = 'crafting';
