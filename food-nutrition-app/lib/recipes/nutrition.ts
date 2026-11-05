/**
 * Recipe totals. Pure and deterministic; no AI, no database. Runs on the
 * server (POST /api/recipes/nutrition) and in the browser (live totals).
 *
 * Data contract (see lib/food-types.ts): a null nutrient means "not measured",
 * never zero. A total built from any ingredient with no data is therefore a
 * lower bound and is flagged `incomplete` (shown as "≥" in the UI). If no
 * counted ingredient has data at all, the total is null ("—").
 */
import type { Food } from '../food-types';
import { nutrientValue } from '../food-types';
import type { AnalyzedRecipe, NutrientTotal, RecipeNutrition } from './types';

/** Small, stable, non-cryptographic hash, for telling versions of something apart. */
export function shortHash(text: string): string {
    let a = 0x811c9dc5;
    let b = 0x1000193;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 16777619);
        b = Math.imul(b + c, 31) ^ (b >>> 7);
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** The title of a recipe nobody has named. */
export const UNTITLED_RECIPE = 'Untitled recipe';

/** Every nutrient column a recipe reports. */
export const RECIPE_NUTRIENTS = [
    'calories', 'protein_g', 'total_fat_g', 'saturated_g', 'monounsaturated_g', 'polyunsaturated_g', 'trans_g',
    'cholesterol_mg', 'carbohydrate_g', 'fiber_g', 'sugars_g', 'sodium_mg',
    'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug', 'thiamin_mg', 'riboflavin_mg',
    'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug', 'pantothenic_acid_mg', 'choline_mg',
    'calcium_mg', 'iron_mg', 'magnesium_mg', 'phosphorus_mg', 'potassium_mg', 'zinc_mg', 'copper_mg',
    'manganese_mg', 'selenium_ug', 'ala_g', 'epa_g', 'dha_g',
] as const;

export const MAX_SERVINGS = 200;
export const MAX_GRAMS_PER_INGREDIENT = 50_000;

export interface NutritionItem {
    /** Display name, used when listing what could not be counted. */
    name: string;
    food: Food | null;
    grams: number | null;
}

/** Whole recipe and per-serving nutrition. `servings` below 1 is allowed (half a portion); non-positive falls back to 1. */
export function computeRecipeNutrition(items: NutritionItem[], servings: number): RecipeNutrition {
    const safeServings = Number.isFinite(servings) && servings > 0 ? servings : 1;
    const counted = items.filter((i): i is NutritionItem & { food: Food; grams: number } =>
        i.food !== null && typeof i.grams === 'number' && Number.isFinite(i.grams) && i.grams >= 0);
    const uncounted = items
        .filter(i => i.food === null || typeof i.grams !== 'number' || !Number.isFinite(i.grams) || i.grams < 0)
        .map(i => i.name);

    const totals: Record<string, NutrientTotal> = {};
    const perServing: Record<string, NutrientTotal> = {};
    const filledFrom: Record<string, number> = {};
    for (const key of RECIPE_NUTRIENTS) {
        let sum = 0;
        let known = 0;
        let missing = 0;
        for (const { food, grams } of counted) {
            const raw = (food as unknown as Record<string, unknown>)[key];
            // Optional columns absent from this database are skipped, not "missing".
            if (raw === undefined) continue;
            const v = nutrientValue(food, key);
            if (v === null) {
                if (grams > 0) missing++;
                continue;
            }
            sum += (v * grams) / 100;
            known++;
            const source = food.filledFrom?.[key];
            if (source !== undefined && grams > 0) filledFrom[key] = source;
        }
        const value = known > 0 ? sum : null;
        const incomplete = missing > 0;
        totals[key] = { value, incomplete };
        perServing[key] = { value: value === null ? null : value / safeServings, incomplete };
    }
    const totalGrams = counted.reduce((s, i) => s + i.grams, 0);
    return {
        servings: safeServings,
        totalGrams,
        servingGrams: totalGrams / safeServings,
        totals,
        perServing,
        uncounted,
        ...(Object.keys(filledFrom).length > 0 ? { filledFrom } : {}),
    };
}

/** Round for JSON: enough precision for display, no float noise. */
function round(n: number, places = 3): number {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

export function roundedNutrition(n: RecipeNutrition): RecipeNutrition {
    const roundAll = (rec: Record<string, NutrientTotal>) =>
        Object.fromEntries(Object.entries(rec).map(([k, t]) => [k, { ...t, value: t.value === null ? null : round(t.value) }]));
    return {
        ...n,
        totalGrams: round(n.totalGrams, 1),
        servingGrams: round(n.servingGrams, 1),
        totals: roundAll(n.totals),
        perServing: roundAll(n.perServing),
    };
}

/**
 * A synthetic Food describing one recipe per 100 g, so NutritionLabel and the
 * planner (which both work per 100 g) can treat the recipe like any food.
 * The negative id cannot collide with a USDA row, and /api/optimize passes
 * unknown foods through unchanged.
 */
export function recipeAsFood(nutrition: RecipeNutrition, title: string, id: number, recordId?: string): Food {
    const per100: Record<string, number | null> = {};
    const scale = nutrition.totalGrams > 0 ? 100 / nutrition.totalGrams : 0;
    for (const key of RECIPE_NUTRIENTS) {
        const t = nutrition.totals[key];
        per100[key] = t?.value === null || t?.value === undefined ? null : t.value * scale;
    }
    const servingGrams = round(nutrition.servingGrams, 1);
    const name = title.trim() || UNTITLED_RECIPE;
    return {
        ...(per100 as unknown as Food),
        id,
        fdc_id: id,
        description: `Recipe: ${name}`,
        data_type: 'recipe',
        food_category: 'Recipes',
        brand_owner: null,
        serving_size: null,
        serving_size_unit: null,
        calories: per100.calories ?? 0,
        serving_sizes: nutrition.servingGrams > 0
            ? [{ id, food_id: id, label: '1 serving', weight_g: servingGrams }]
            : [],
        ...(nutrition.filledFrom ? { filledFrom: nutrition.filledFrom } : {}),
        ...(recordId === undefined ? {} : {
            recipe: {
                id: recordId,
                servingGrams,
                uncounted: nutrition.uncounted,
                incomplete: RECIPE_NUTRIENTS.filter(k => nutrition.totals[k]?.incomplete),
                fingerprint: shortHash(JSON.stringify([
                    name, servingGrams, nutrition.uncounted, RECIPE_NUTRIENTS.map(k => (per100[k] === null ? null : round(per100[k]))),
                ])),
            },
        }),
    };
}

/** Stable negative id for a recipe (from its record id), used when it joins the planner. */
export function recipeFoodId(recipeId: string): number {
    let h = 0;
    for (let i = 0; i < recipeId.length; i++) h = (h * 31 + recipeId.charCodeAt(i)) | 0;
    return -(Math.abs(h) + 1);
}

/** Per-serving amounts and the list of lower-bound nutrients, as stored on AnalyzedRecipe. */
export function summarizeForRecord(n: RecipeNutrition): Pick<AnalyzedRecipe, 'perServing' | 'incomplete' | 'servingGrams'> {
    const perServing: Record<string, number | null> = {};
    const incomplete: string[] = [];
    for (const [k, t] of Object.entries(n.perServing)) {
        perServing[k] = t.value === null ? null : round(t.value);
        if (t.incomplete) incomplete.push(k);
    }
    return { perServing, incomplete, servingGrams: round(n.servingGrams, 1) };
}
