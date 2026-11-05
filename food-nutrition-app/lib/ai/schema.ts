/**
 * The tool a model fills in to return a recipe, and the validator every reply
 * goes through. `strict: true` asks the API to enforce the schema, but the
 * validator still runs: it normalises units, clamps values and caps sizes, and
 * it is what protects the rest of the app if a model or provider misbehaves.
 */
import type { ParsedIngredient, ParsedRecipe } from '../recipes/types';
import { MAX_INGREDIENTS } from '../recipes/parse';
import { UNITS, lookupUnit } from '../recipes/units';
import { AiError } from './types';

export const RECORD_RECIPE_TOOL = 'record_recipe';

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };

/** Tool definition shared by every Claude provider. Schema keywords are limited to what strict mode allows. */
export const RECORD_RECIPE_TOOL_DEF = {
    name: RECORD_RECIPE_TOOL,
    description: 'Record the ingredients read from the recipe text or photo. Call this exactly once.',
    strict: true,
    input_schema: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['kind', 'title', 'servings', 'ingredients', 'warnings'],
        properties: {
            kind: {
                type: 'string',
                enum: ['recipe', 'plated_meal', 'not_food'],
                description: 'recipe: written ingredients (typed, a cookbook page, a card). plated_meal: a photo of prepared food. not_food: neither.',
            },
            title: { type: 'string', description: 'Recipe or dish name. Empty string if unknown.' },
            servings: { ...nullableNumber, description: 'Servings the recipe states. For a plated meal, 1. Null if not stated: do not guess.' },
            ingredients: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'quantity', 'unit', 'preparation', 'notes', 'confidence'],
                    properties: {
                        name: { type: 'string', description: 'The food only, in plain English: "garlic", "chicken breast", "cooked white rice" if the recipe specifies cooked.' },
                        quantity: { ...nullableNumber, description: 'Amount as a decimal: 1.5 for "1 1/2". Mean of a range. Null if none given.' },
                        unit: { ...nullableString, description: 'g, kg, oz, lb, ml, l, tsp, tbsp, cup, fl oz, pint, quart, pinch, dash, clove, slice, piece, can, stick, large, medium, small; null for a bare count ("2 eggs").' },
                        preparation: { ...nullableString, description: 'Preparation: "minced", "cooked", "canned, drained".' },
                        notes: { ...nullableString, description: 'Anything else: "to taste", "optional", "2-3".' },
                        confidence: { type: 'number', description: '0 to 1: how sure you are of this name and amount. Low for smudged text or a portion you are estimating by eye.' },
                    },
                },
            },
            warnings: { type: 'array', items: { type: 'string' }, description: 'Short notes for the user, e.g. "The bottom of the card is cut off."' },
        },
    },
};

/** Tool for the optional re-rank step. */
export const CHOOSE_FOODS_TOOL_DEF = {
    name: 'choose_foods',
    description: 'Record the best database food for each ingredient. Call this exactly once.',
    strict: true,
    input_schema: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['choices'],
        properties: {
            choices: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['index', 'fdc_id'],
                    properties: {
                        index: { type: 'integer', description: 'The ingredient index given.' },
                        fdc_id: { type: ['integer', 'null'], description: 'fdc_id of the best candidate; null if none fit.' },
                    },
                },
            },
        },
    },
};

/** Most a plated-meal portion estimate may claim: published error is around 21-37% for energy. See docs/research/RECIPE_ANALYSIS.md. */
export const PLATED_MEAL_MAX_CONFIDENCE = 0.6;

const MAX_STR = 200;

function str(v: unknown, max = MAX_STR): string | null {
    if (typeof v !== 'string') return null;
    const s = v.replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
}

function normalizeIngredient(raw: unknown, maxConfidence: number): ParsedIngredient | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const name = str(o.name, 120);
    if (!name) return null;

    const quantity = typeof o.quantity === 'number' && Number.isFinite(o.quantity) && o.quantity > 0 && o.quantity < 1e6 ? o.quantity : null;
    let notes = str(o.notes);
    const rawUnit = str(o.unit, 40);
    let unit = rawUnit ? lookupUnit(rawUnit) : null;
    if (unit && !UNITS[unit]) unit = null;
    // Keep a unit we don't know visible rather than silently losing it.
    if (rawUnit && !unit) notes = notes ? `${notes}; ${rawUnit}` : rawUnit;

    const c = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0.5;
    return {
        name,
        quantity,
        unit,
        preparation: str(o.preparation),
        notes,
        confidence: Math.min(maxConfidence, Math.max(0, c)),
        original: null,
    };
}

/** Validate and normalise a record_recipe tool input. Throws AiError when it isn't usable. */
export function validateRecipeOutput(input: unknown): ParsedRecipe {
    if (typeof input !== 'object' || input === null) {
        throw new AiError('ai_bad_output', 'The reader returned something we could not understand. Please try again.');
    }
    const o = input as Record<string, unknown>;
    if (o.kind === 'not_food') {
        throw new AiError('ai_not_food', 'That doesn\'t look like a recipe or a meal. Try another photo, or paste the recipe as text.');
    }
    if (!Array.isArray(o.ingredients)) {
        throw new AiError('ai_bad_output', 'The reader returned something we could not understand. Please try again.');
    }
    const platedMeal = o.kind === 'plated_meal';
    const maxConfidence = platedMeal ? PLATED_MEAL_MAX_CONFIDENCE : 1;
    const ingredients = o.ingredients
        .slice(0, MAX_INGREDIENTS)
        .map(i => normalizeIngredient(i, maxConfidence))
        .filter((i): i is ParsedIngredient => i !== null);
    const servings = typeof o.servings === 'number' && Number.isFinite(o.servings) && o.servings > 0 && o.servings <= 200 ? o.servings : null;
    const warnings = Array.isArray(o.warnings)
        ? o.warnings.map(w => str(w)).filter((w): w is string => w !== null).slice(0, 5)
        : [];
    return { title: str(o.title, 120) ?? '', servings, ingredients, platedMeal, warnings };
}

/** Validate a choose_foods tool input into index -> fdc id. */
export function validateChoices(input: unknown): Map<number, number> {
    const out = new Map<number, number>();
    const choices = (input as { choices?: unknown } | null)?.choices;
    if (!Array.isArray(choices)) return out;
    for (const c of choices) {
        const { index, fdc_id: fdcId } = (c ?? {}) as { index?: unknown; fdc_id?: unknown };
        if (Number.isSafeInteger(index) && Number.isSafeInteger(fdcId)) out.set(index as number, fdcId as number);
    }
    return out;
}
