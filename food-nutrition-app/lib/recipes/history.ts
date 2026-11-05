import type { HistoryRecord } from '@/lib/auth/client';
import { HISTORY_LIMITS, type HistoryItem } from '@/lib/user-store/history';
import type { AnalyzedRecipe, RecipeSource } from './types';

/** Nutrient columns shown on a recipe's history row, and the name each goes by there. */
const SUMMARY_NUTRIENTS = [
    ['calories', 'calories'],
    ['protein_g', 'protein'],
    ['carbohydrate_g', 'carbs'],
    ['total_fat_g', 'fat'],
] as const;

/** The address that opens one recipe: from a history row, Back, a reload or a plan. */
export function recipeHref(id: string): string {
    return `/recipes?id=${encodeURIComponent(id)}`;
}

/** One ingredient as stored in history, with short names so a long recipe fits the size cap. */
interface StoredIngredient {
    n: string;
    q: number | null;
    u: string | null;
    p?: string;
    o?: string;
    c: number;
    f: number | null;
}

interface StoredRecipe {
    source: RecipeSource;
    platedMeal: boolean;
    provider: string | null;
    createdAt: string;
    ingredients: StoredIngredient[];
}

function fits(data: unknown): boolean {
    return new TextEncoder().encode(JSON.stringify(data)).length <= HISTORY_LIMITS.dataBytes;
}

function storedIngredients(recipe: AnalyzedRecipe, withNotes: boolean): StoredIngredient[] {
    return recipe.ingredients.map(i => ({
        n: i.name,
        q: i.quantity,
        u: i.unit,
        ...(withNotes && i.preparation ? { p: i.preparation } : {}),
        ...(withNotes && i.notes ? { o: i.notes } : {}),
        c: i.confidence,
        f: i.fdcId,
    }));
}

/**
 * The account-history entry for an analyzed recipe: a small summary for the row, plus
 * the ingredients, so the recipe can be reopened on another device. Foods are stored by
 * id and their nutrition is read fresh when it opens. A nutrient with no data is left out
 * rather than shown as 0, and a total that is only a lower bound stays marked as one.
 *
 * If it can't fit the size cap, preparation notes go first, then the whole ingredient
 * list: a recipe with some ingredients missing would give the wrong nutrition.
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

    const stored = (withNotes: boolean): StoredRecipe => ({
        source: recipe.source,
        platedMeal: recipe.platedMeal,
        provider: recipe.provider,
        createdAt: recipe.createdAt,
        ingredients: storedIngredients(recipe, withNotes),
    });
    const withEverything = { ...data, recipe: stored(true) };
    const withoutNotes = { ...data, recipe: stored(false) };
    return {
        kind: 'recipe',
        itemId: recipe.id,
        title: recipe.title.slice(0, HISTORY_LIMITS.titleLength),
        href: recipeHref(recipe.id),
        data: fits(withEverything) ? withEverything : fits(withoutNotes) ? withoutNotes : { ...data, tooLong: true },
    };
}

const SOURCES: readonly string[] = ['text', 'image', 'blank'];
const optionalString = (v: unknown) => (typeof v === 'string' ? v : null);

/** Rebuild a recipe from its history row. Null when the row holds no complete recipe. */
export function recipeFromHistory(item: HistoryItem): AnalyzedRecipe | null {
    if (typeof item.data !== 'object' || item.data === null || Array.isArray(item.data)) return null;
    const data = item.data as { servings?: unknown; recipe?: Partial<StoredRecipe> | null };
    const stored = data.recipe;
    if (typeof stored !== 'object' || stored === null || !Array.isArray(stored.ingredients)) return null;
    if (stored.ingredients.some(i => typeof i !== 'object' || i === null || typeof i.n !== 'string')) return null;
    const servings = typeof data.servings === 'number' && data.servings > 0 ? data.servings : 1;
    return {
        version: 1,
        id: item.itemId,
        title: item.title,
        servings,
        source: SOURCES.includes(String(stored.source)) ? stored.source as RecipeSource : 'text',
        platedMeal: stored.platedMeal === true,
        createdAt: optionalString(stored.createdAt) ?? item.createdAt,
        updatedAt: item.updatedAt,
        ingredients: stored.ingredients.map(i => ({
            name: i.n,
            quantity: typeof i.q === 'number' ? i.q : null,
            unit: optionalString(i.u),
            preparation: optionalString(i.p),
            notes: optionalString(i.o),
            confidence: typeof i.c === 'number' ? i.c : 1,
            fdcId: typeof i.f === 'number' ? i.f : null,
            foodDescription: null,
            grams: null,
            conversion: 'unknown',
        })),
        // Worked out again from the ingredients when the recipe opens.
        perServing: {},
        incomplete: [],
        servingGrams: 0,
        provider: optionalString(stored.provider),
    };
}
