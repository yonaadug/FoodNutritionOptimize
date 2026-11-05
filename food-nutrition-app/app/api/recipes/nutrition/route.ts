import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api';
import { MAX_NUTRITION_BODY_BYTES, nutritionFor, parseNutritionBody, recipesDb } from '@/lib/recipes/request';
import { handleRecipeError } from '@/lib/recipes/respond';

export const runtime = 'nodejs';

/**
 * POST /api/recipes/nutrition
 * Body: { ingredients: [{ fdcId, grams }], servings }
 * 200: RecipeNutrition (lib/recipes/types.ts): totals and perServing, where each nutrient is
 * { value, incomplete }. `incomplete` means an ingredient has no data, so the value is a lower bound.
 * Pure and deterministic: no AI, no rate limit.
 */
export async function POST(request: Request) {
    try {
        const body = parseNutritionBody(await readJsonBody(request, MAX_NUTRITION_BODY_BYTES));
        return NextResponse.json(nutritionFor(recipesDb(), body), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleRecipeError(error, 'recipes/nutrition');
    }
}
