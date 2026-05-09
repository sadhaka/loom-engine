import type { AddResult } from './inventory-grid.js';
export interface RecipeIngredient {
    itemId: string;
    count: number;
}
export interface RecipeOutput {
    itemId: string;
    count: number;
}
export interface Recipe {
    id: string;
    ingredients: RecipeIngredient[];
    outputs: RecipeOutput[];
    tools?: string[];
    data?: Record<string, unknown>;
}
export type CraftFailureReason = 'unknown_recipe' | 'missing_ingredients' | 'missing_tool' | 'output_overflow';
export interface CraftSuccess {
    ok: true;
    recipe: Recipe;
}
export interface CraftFailure {
    ok: false;
    reason: CraftFailureReason;
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
    onCrafted?: (recipe: Recipe) => void;
    onFailed?: (recipe: Recipe | null, reason: CraftFailureReason, missing?: string[]) => void;
}
export declare class Crafting {
    private inventory;
    private recipes;
    private byOutput;
    private onCrafted;
    private onFailed;
    private disposed;
    private constructor();
    static create(opts: CraftingOptions): Crafting;
    registerRecipe(recipe: Recipe): boolean;
    unregisterRecipe(id: string): boolean;
    hasRecipe(id: string): boolean;
    getRecipe(id: string): Recipe | null;
    listRecipes(): Recipe[];
    recipesByOutput(itemId: string): Recipe[];
    canCraft(recipe: Recipe | string): boolean;
    craft(recipe: Recipe | string): CraftResult;
    dispose(): void;
    private resolve;
    private checkIngredients;
    private checkTools;
    private fireFailed;
}
export declare const RESOURCE_CRAFTING = "crafting";
//# sourceMappingURL=crafting.d.ts.map