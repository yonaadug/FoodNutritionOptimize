/**
 * The recipe editor's state changes, kept pure so they can be tested without a
 * browser. No runtime dependencies beyond this folder (safe for client components).
 */
import type { AnalyzedIngredient, AnalyzedRecipe, ParseResponse, RecipeFood, RecipeNutrition, RecipeSource } from './types';
import { convertToGrams } from './grams';
import { computeRecipeNutrition, MAX_SERVINGS, summarizeForRecord, UNTITLED_RECIPE } from './nutrition';

export interface EditorState {
    id: string;
    title: string;
    servings: number;
    source: RecipeSource;
    platedMeal: boolean;
    warnings: string[];
    provider: string | null;
    createdAt: string;
    rows: AnalyzedIngredient[];
    /**
     * Opened from this browser's recent recipes, but not made under the signed-in account:
     * work from before signing in, or by whoever used this browser before. It stays out of
     * their history unless they press "Save to my account".
     */
    unclaimed?: boolean;
}

export const DEFAULT_BLANK_SERVINGS = 4;

export function blankEditor(id: string, now: string): EditorState {
    return { id, title: '', servings: DEFAULT_BLANK_SERVINGS, source: 'blank', platedMeal: false, warnings: [], provider: null, createdAt: now, rows: [] };
}

export function editorFromParse(parse: ParseResponse, id: string, now: string): EditorState {
    return {
        id,
        title: parse.title,
        servings: parse.servings,
        source: parse.source,
        platedMeal: parse.platedMeal,
        warnings: parse.warnings,
        provider: parse.provider,
        createdAt: now,
        rows: parse.ingredients,
    };
}

/** Change the amount. The person has now confirmed it, so the "check this" flag clears. */
export function setRowAmount(row: AnalyzedIngredient, quantity: number | null, unit: string | null): AnalyzedIngredient {
    return { ...row, quantity, unit, confidence: 1, conversion: convertToGrams({ ...row, quantity, unit }, row.food) };
}

/** Change the matched food, keeping the amount as written. */
export function setRowFood(row: AnalyzedIngredient, food: RecipeFood): AnalyzedIngredient {
    return { ...row, food, matchConfidence: 1, conversion: convertToGrams(row, food) };
}

export function clampServings(n: number | undefined): number | null {
    if (n === undefined || !Number.isFinite(n) || n <= 0) return null;
    return Math.min(n, MAX_SERVINGS);
}

export function rowsNutrition(rows: AnalyzedIngredient[], servings: number): RecipeNutrition {
    return computeRecipeNutrition(rows.map(r => ({ name: r.name, food: r.food, grams: r.conversion.grams })), servings);
}

/** The compact record handed to onRecipeAnalyzed and kept in recent analyses. Plain JSON. */
export function toRecord(state: EditorState, nutrition: RecipeNutrition, now: string): AnalyzedRecipe {
    return {
        version: 1,
        id: state.id,
        title: state.title.trim() || UNTITLED_RECIPE,
        servings: state.servings,
        source: state.source,
        platedMeal: state.platedMeal,
        createdAt: state.createdAt,
        updatedAt: now,
        ingredients: state.rows.map(r => ({
            name: r.name,
            quantity: r.quantity,
            unit: r.unit,
            preparation: r.preparation,
            notes: r.notes,
            confidence: r.confidence,
            fdcId: r.food?.fdc_id ?? null,
            foodDescription: r.food?.description ?? null,
            grams: r.conversion.grams === null ? null : Math.round(r.conversion.grams * 10) / 10,
            conversion: r.conversion.method,
        })),
        ...summarizeForRecord(nutrition),
        provider: state.provider,
    };
}

/** Rebuild an editor from a stored record, given the foods fetched again by id. Amounts are re-converted. */
export function editorFromRecord(record: AnalyzedRecipe, foods: Map<number, RecipeFood>): EditorState {
    return {
        id: record.id,
        title: record.title,
        servings: record.servings,
        source: record.source,
        platedMeal: record.platedMeal === true,
        warnings: [],
        provider: record.provider,
        createdAt: record.createdAt,
        unclaimed: !record.ownerId,
        rows: record.ingredients.map((ing, i) => {
            const food = ing.fdcId !== null ? foods.get(ing.fdcId) ?? null : null;
            return {
                id: `saved-${i + 1}`,
                name: ing.name,
                quantity: ing.quantity,
                unit: ing.unit,
                preparation: ing.preparation,
                notes: ing.notes,
                confidence: ing.confidence,
                original: null,
                food,
                matchConfidence: food ? 1 : 0,
                candidates: [],
                conversion: convertToGrams(ing, food),
            };
        }),
    };
}

/**
 * Published error for plated-meal photos is about 21-37% for energy, and the app
 * says so with a range. See docs/research/RECIPE_ANALYSIS.md.
 */
export const PLATED_MEAL_ERROR = 0.35;

export function platedRange(value: number): { low: number; high: number } {
    return { low: value * (1 - PLATED_MEAL_ERROR), high: value * (1 + PLATED_MEAL_ERROR) };
}

/** Shape of a row's review flags. */
export interface RowFlags {
    checkAmount: boolean;
    checkMatch: boolean;
    estimated: boolean;
    uncounted: boolean;
}

const CHECK_BELOW = 0.7;

export function rowFlags(row: AnalyzedIngredient): RowFlags {
    return {
        checkAmount: row.confidence < CHECK_BELOW,
        checkMatch: row.food !== null && row.matchConfidence < CHECK_BELOW,
        estimated: row.conversion.method === 'estimated',
        uncounted: row.food === null || row.conversion.grams === null,
    };
}

export const RECENTS_KEY = 'recipes.recent.v1';
export const MAX_RECENTS = 10;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(r: unknown): r is AnalyzedRecipe {
    const o = r as Partial<AnalyzedRecipe> | null;
    return !!o && o.version === 1 && typeof o.id === 'string' && typeof o.title === 'string' && Array.isArray(o.ingredients) && typeof o.perServing === 'object';
}

/** Recent analyses from browser storage. Empty when storage is blocked or holds anything unexpected. */
export function loadRecents(storage: StorageLike | null): AnalyzedRecipe[] {
    try {
        const raw = storage?.getItem(RECENTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, MAX_RECENTS) : [];
    } catch {
        return [];
    }
}

/** Insert or update by id, newest first. Blocked or full storage is not an error. */
export function saveRecent(storage: StorageLike | null, record: AnalyzedRecipe): AnalyzedRecipe[] {
    const next = [record, ...loadRecents(storage).filter(r => r.id !== record.id)].slice(0, MAX_RECENTS);
    try {
        storage?.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
        // Private mode or full storage: recents are a convenience.
    }
    return next;
}

export function removeRecent(storage: StorageLike | null, id: string): AnalyzedRecipe[] {
    const next = loadRecents(storage).filter(r => r.id !== id);
    try {
        storage?.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
        // See saveRecent.
    }
    return next;
}
