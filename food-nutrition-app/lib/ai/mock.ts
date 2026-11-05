/**
 * Offline provider: deterministic, free and needs no credentials. Text goes
 * through the rule-based reader (lib/recipes/parse.ts), so pasted recipes really
 * work. Images can't be read without a model, so they return a fixture chosen from
 * a hash of the bytes: the same image always gives the same result.
 */
import { createHash } from 'node:crypto';
import type { ParsedRecipe } from '../recipes/types';
import { parseRecipeText } from '../recipes/parse';
import { PLATED_MEAL_MAX_CONFIDENCE } from './schema';
import { AiError, type AiProvider, type RecipeInput } from './types';

const DEMO_WARNING = 'Demo mode: this result is a built-in sample, not a reading of your photo.';

const IMAGE_FIXTURES: ParsedRecipe[] = [
    {
        title: 'Oatmeal with banana (sample)',
        servings: 1,
        platedMeal: true,
        warnings: [DEMO_WARNING],
        ingredients: [
            { name: 'rolled oats', quantity: 0.5, unit: 'cup', preparation: null, notes: null, confidence: PLATED_MEAL_MAX_CONFIDENCE, original: null },
            { name: 'whole milk', quantity: 1, unit: 'cup', preparation: null, notes: null, confidence: 0.5, original: null },
            { name: 'banana', quantity: 1, unit: null, preparation: 'sliced', notes: null, confidence: PLATED_MEAL_MAX_CONFIDENCE, original: null },
            { name: 'honey', quantity: 1, unit: 'tbsp', preparation: null, notes: 'estimated by eye', confidence: 0.4, original: null },
        ],
    },
    {
        title: 'Chicken, rice and broccoli (sample)',
        servings: 1,
        platedMeal: true,
        warnings: [DEMO_WARNING],
        ingredients: [
            { name: 'chicken breast', quantity: 150, unit: 'g', preparation: 'cooked', notes: null, confidence: PLATED_MEAL_MAX_CONFIDENCE, original: null },
            { name: 'rice', quantity: 1, unit: 'cup', preparation: 'cooked', notes: null, confidence: 0.5, original: null },
            { name: 'broccoli', quantity: 1, unit: 'cup', preparation: 'cooked', notes: null, confidence: 0.5, original: null },
            { name: 'olive oil', quantity: 1, unit: 'tbsp', preparation: null, notes: 'likely cooking fat, not visible', confidence: 0.3, original: null },
        ],
    },
];

export function createMockProvider(): AiProvider {
    return {
        name: 'mock',
        model: null,
        async readRecipe(input: RecipeInput) {
            if (input.kind === 'image') {
                const hash = createHash('sha256').update(input.base64).digest();
                const recipe = IMAGE_FIXTURES[hash[0] % IMAGE_FIXTURES.length];
                return { recipe: structuredClone(recipe), usage: null };
            }
            const recipe = parseRecipeText(input.text);
            if (recipe.ingredients.length === 0) {
                throw new AiError('ai_not_food', 'We couldn\'t find any ingredients in that text. Put each ingredient on its own line.');
            }
            return { recipe, usage: null };
        },
    };
}
