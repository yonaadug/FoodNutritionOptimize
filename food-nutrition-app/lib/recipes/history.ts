import type { HistoryRecord } from '@/lib/auth/client';
import { HISTORY_LIMITS } from '@/lib/user-store/history';
import type { AnalyzedRecipe } from './types';

/** Nutrient columns shown on a recipe's history row, and the name each goes by there. */
const SUMMARY_NUTRIENTS = [
    ['calories', 'calories'],
    ['protein_g', 'protein'],
    ['carbohydrate_g', 'carbs'],
    ['total_fat_g', 'fat'],
] as const;

/**
 * The account-history entry for an analyzed recipe. Only a small summary is kept, not
 * the ingredient list, so it always fits the size cap. A nutrient with no data is left
 * out rather than shown as 0, and a total that is only a lower bound stays marked as
 * one, as it is in the analyzer.
 */
export function recipeHistoryItem(recipe: AnalyzedRecipe): HistoryRecord {
    const data: Record<string, unknown> = { servings: recipe.servings };
    const incomplete: string[] = [];
    for (const [column, name] of SUMMARY_NUTRIENTS) {
        const value = recipe.perServing[column];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        data[`${name}PerServing`] = value;
        if (recipe.incomplete.includes(column)) incomplete.push(name);
    }
    if (incomplete.length > 0) data.incomplete = incomplete;
    if (recipe.platedMeal) data.estimated = true;
    return {
        kind: 'recipe',
        itemId: recipe.id,
        title: recipe.title.slice(0, HISTORY_LIMITS.titleLength),
        href: '/recipes',
        data,
    };
}
