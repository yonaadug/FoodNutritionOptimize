/**
 * Recipe analyzer types. Type-only module (safe for client components).
 *
 * Flow: text or photo -> ParsedRecipe (AI provider or the rule-based parser)
 * -> AnalyzedIngredient[] (USDA match + gram conversion, server side)
 * -> editable rows in the UI -> RecipeNutrition (pure, client and server)
 * -> AnalyzedRecipe (compact JSON for history / onRecipeAnalyzed).
 */
import type { Food } from '../food-types';

/** One ingredient as read from the recipe (before matching). */
export interface ParsedIngredient {
    /** Food name without amounts or preparation, e.g. "garlic". */
    name: string;
    /** Amount in `unit`; null when the recipe gives none ("salt to taste"). */
    quantity: number | null;
    /** Canonical unit (see lib/recipes/units.ts) or null for a bare count ("2 eggs"). */
    unit: string | null;
    /** How it is prepared, e.g. "minced", "cooked", "chopped". */
    preparation: string | null;
    /** Anything else worth keeping, e.g. "to taste", "divided", "about 2 cups". */
    notes: string | null;
    /** 0..1: how sure the reader is about this line. */
    confidence: number;
    /** The original line, when known. */
    original?: string | null;
}

export type RecipeSource = 'text' | 'image' | 'blank';

export interface ParsedRecipe {
    title: string;
    /** Servings the recipe makes; null when not stated. */
    servings: number | null;
    ingredients: ParsedIngredient[];
    /** True when the input was a photo of a plated meal rather than a written recipe. */
    platedMeal?: boolean;
    /** Reader warnings (e.g. "part of the card is unreadable"). */
    warnings?: string[];
}

export type ConversionMethod = 'exact' | 'estimated' | 'unknown';

export interface Conversion {
    grams: number | null;
    method: ConversionMethod;
    /** Human explanation, e.g. "USDA: 1 cup = 125 g". */
    basis: string;
}

/** A USDA serving row usable for conversion (own rows plus rows borrowed from an equivalent SR Legacy food). */
export interface Portion {
    label: string;
    grams: number;
    /** 'food' = this food's own USDA row; 'related' = the SR Legacy row it supersedes. */
    source: 'food' | 'related';
}

/** A matched food sent to the client: the full Food plus conversion portions. */
export type RecipeFood = Food & {
    portions: Portion[];
};

export interface MatchCandidate {
    fdcId: number;
    description: string;
    dataType: string;
    /** Higher is better; comparable only within one ingredient. */
    score: number;
}

export interface AnalyzedIngredient {
    /** Stable row id (client-side keys). */
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    preparation: string | null;
    notes: string | null;
    /** Reader confidence (0..1). */
    confidence: number;
    original: string | null;
    food: RecipeFood | null;
    /** 0..1: how good the USDA match looks. */
    matchConfidence: number;
    candidates: MatchCandidate[];
    conversion: Conversion;
}

export interface ParseResponse {
    title: string;
    servings: number;
    /** True when servings came from the recipe; false when defaulted. */
    servingsStated: boolean;
    source: RecipeSource;
    platedMeal: boolean;
    ingredients: AnalyzedIngredient[];
    warnings: string[];
    provider: string;
    model: string | null;
}

/** One nutrient total: `incomplete` means at least one ingredient has no data, so the value is a lower bound ("≥"). */
export interface NutrientTotal {
    value: number | null;
    incomplete: boolean;
}

export interface RecipeNutrition {
    servings: number;
    /** Grams of all ingredients whose weight is known. */
    totalGrams: number;
    servingGrams: number;
    totals: Record<string, NutrientTotal>;
    perServing: Record<string, NutrientTotal>;
    /** Ingredients that could not be counted (no food or unknown weight). */
    uncounted: string[];
    /** Nutrients where a counted ingredient's value came from USDA's older entry (see Food.filledFrom). */
    filledFrom?: Record<string, number>;
}

/** Compact, JSON-serializable record of an analysis (history, localStorage, onRecipeAnalyzed). */
export interface AnalyzedRecipe {
    version: 1;
    id: string;
    title: string;
    servings: number;
    source: RecipeSource;
    /** Estimated from a photo of a plated meal, so amounts are rough. */
    platedMeal: boolean;
    createdAt: string;
    updatedAt: string;
    ingredients: {
        name: string;
        quantity: number | null;
        unit: string | null;
        preparation: string | null;
        notes: string | null;
        confidence: number;
        fdcId: number | null;
        foodDescription: string | null;
        grams: number | null;
        conversion: ConversionMethod;
    }[];
    /** Per-serving amounts (null = no data); keys are nutrient columns, e.g. "iron_mg". */
    perServing: Record<string, number | null>;
    /** Nutrient keys whose per-serving value is a lower bound. */
    incomplete: string[];
    servingGrams: number;
    provider: string | null;
    /**
     * The account this was made under, in this browser. Absent for work done before
     * signing in, which is not added to anyone's history unless they choose to save it.
     */
    ownerId?: string;
}
