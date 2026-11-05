/**
 * Parsed recipe -> analyzed rows: USDA match plus gram conversion for each
 * ingredient. Server side (reads the database); no AI of its own. An optional
 * `rerank` callback (provided by AI providers that support it) may choose
 * among the deterministic candidates, and cannot invent a food.
 */
import type { openDatabase } from '../db';
import type { AnalyzedIngredient, MatchCandidate, ParsedIngredient, ParsedRecipe, ParseResponse, RecipeSource } from './types';
import { convertToGrams } from './grams';
import { foodWithPortionsIn, matchIngredientIn, type MatchResult } from './match';
import { MAX_SERVINGS } from './nutrition';

type Connection = ReturnType<typeof openDatabase>;

export const DEFAULT_SERVINGS = 4;

/** One ingredient and its candidates, as given to a re-ranker. */
export interface RerankItem { index: number; name: string; preparation: string | null; candidates: MatchCandidate[] }
/** Chosen fdc id per item index; anything not among the item's candidates is ignored. */
export type Reranker = (items: RerankItem[]) => Promise<Map<number, number>>;

/** Ingredients the scorer is unsure about are the only ones worth sending to a re-ranker. */
export const RERANK_BELOW = 0.75;

/** Pick up to a sane servings value; a stated value of 0 or nonsense becomes the default. */
function safeServings(s: number | null): { servings: number; stated: boolean } {
    if (s !== null && Number.isFinite(s) && s > 0 && s <= MAX_SERVINGS) return { servings: s, stated: true };
    return { servings: DEFAULT_SERVINGS, stated: false };
}

export function analyzeIngredient(conn: Connection, ing: ParsedIngredient, id: string, match?: MatchResult): AnalyzedIngredient {
    const m = match ?? matchIngredientIn(conn, ing);
    const food = m.food;
    return {
        id,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
        notes: ing.notes,
        confidence: ing.confidence,
        original: ing.original ?? null,
        food,
        matchConfidence: m.confidence,
        candidates: m.candidates,
        conversion: convertToGrams(ing, food),
    };
}

/** Apply a re-ranker's choices to low-confidence matches. Failures keep the deterministic match. */
async function applyRerank(conn: Connection, parsed: ParsedIngredient[], matches: MatchResult[], rerank: Reranker): Promise<string[]> {
    const items: RerankItem[] = [];
    matches.forEach((m, index) => {
        if (m.candidates.length > 1 && m.confidence < RERANK_BELOW) {
            items.push({ index, name: parsed[index].name, preparation: parsed[index].preparation, candidates: m.candidates });
        }
    });
    if (!items.length) return [];
    try {
        const choices = await rerank(items);
        for (const item of items) {
            const fdcId = choices.get(item.index);
            const m = matches[item.index];
            if (fdcId === undefined || fdcId === m.food?.fdc_id) continue;
            if (!item.candidates.some(c => c.fdcId === fdcId)) continue;
            const food = foodWithPortionsIn(conn, fdcId);
            if (food) matches[item.index] = { ...m, food, confidence: Math.max(m.confidence, RERANK_BELOW) };
        }
        return [];
    } catch (e) {
        console.warn(`[recipes] re-rank failed, keeping deterministic matches: ${(e as Error).name}`);
        return [];
    }
}

/** Build the full parse response for a recipe read from text or a photo. */
export async function analyzeRecipeIn(
    conn: Connection,
    recipe: ParsedRecipe,
    source: RecipeSource,
    meta: { provider: string; model: string | null; rerank?: Reranker | null },
): Promise<ParseResponse> {
    const matches = recipe.ingredients.map(ing => matchIngredientIn(conn, ing));
    if (meta.rerank) await applyRerank(conn, recipe.ingredients, matches, meta.rerank);
    const ingredients = recipe.ingredients.map((ing, i) => analyzeIngredient(conn, ing, `ing-${i + 1}`, matches[i]));
    const { servings, stated } = safeServings(recipe.servings);
    return {
        title: recipe.title || (source === 'image' ? 'Recipe from photo' : 'Untitled recipe'),
        servings,
        servingsStated: stated,
        source,
        platedMeal: recipe.platedMeal === true,
        ingredients,
        warnings: recipe.warnings ?? [],
        provider: meta.provider,
        model: meta.model,
    };
}
