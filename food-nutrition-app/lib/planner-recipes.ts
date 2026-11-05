/**
 * Recipes in the plan. A recipe joins the planner as a fixed amount, and that amount
 * means a number of servings. Pure, so the rules can be tested without a browser.
 */
import type { Food } from './food-types';

interface Fixed { food: Food; grams: number }

const tenth = (n: number) => Math.round(n * 10) / 10;

function servingOf(food: Food): number {
    return food.recipe?.servingGrams ?? 0;
}

/** How many servings of a recipe the plan holds (0 when it isn't there). */
export function recipeServingsInPlan(fixedFoods: readonly Fixed[], foodId: number): number {
    const entry = fixedFoods.find(f => f.food.id === foodId);
    if (!entry) return 0;
    const serving = servingOf(entry.food);
    return serving > 0 ? Math.round((entry.grams / serving) * 100) / 100 : 0;
}

/** One more serving: joins the list if it isn't there, and always with the recipe as it stands now. */
export function addRecipeServing<T extends Fixed>(fixedFoods: readonly T[], food: Food): (T | Fixed)[] {
    const serving = servingOf(food);
    const at = fixedFoods.findIndex(f => f.food.id === food.id);
    if (at === -1) return [...fixedFoods, { food, grams: serving }];
    const servings = recipeServingsInPlan(fixedFoods, food.id);
    return fixedFoods.map((f, i) => (i === at ? { ...f, food, grams: tenth((servings + 1) * serving) } : f));
}

/** One serving fewer: leaves the list at zero. */
export function removeRecipeServing<T extends Fixed>(fixedFoods: readonly T[], foodId: number): T[] {
    const at = fixedFoods.findIndex(f => f.food.id === foodId);
    if (at === -1) return [...fixedFoods];
    const remaining = recipeServingsInPlan(fixedFoods, foodId) - 1;
    if (remaining <= 0) return fixedFoods.filter((_, i) => i !== at);
    const serving = servingOf(fixedFoods[at].food);
    return fixedFoods.map((f, i) => (i === at ? { ...f, grams: tenth(remaining * serving) } : f));
}

/**
 * Carry an edited recipe into the plan, keeping the number of servings. Returns the same
 * array when nothing changed, so an unchanged recipe doesn't read as an edit.
 */
export function syncRecipeInPlan<T extends Fixed>(fixedFoods: readonly T[], food: Food): readonly T[] {
    const at = fixedFoods.findIndex(f => f.food.id === food.id);
    if (at === -1) return fixedFoods;
    const old = fixedFoods[at];
    if (old.food.recipe?.fingerprint === food.recipe?.fingerprint) return fixedFoods;
    const oldServing = servingOf(old.food);
    const servings = oldServing > 0 ? old.grams / oldServing : 1;
    const next = fixedFoods.slice();
    next[at] = { ...old, food, grams: tenth(servings * servingOf(food)) };
    return next;
}
