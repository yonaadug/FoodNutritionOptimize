import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api';
import { analyzeIngredient } from '@/lib/recipes/analyze';
import { parseIngredientLine } from '@/lib/recipes/parse';
import { parseMatchBody, recipesDb, RequestError, MAX_MATCH_BODY_BYTES } from '@/lib/recipes/request';
import { handleRecipeError } from '@/lib/recipes/respond';

export const runtime = 'nodejs';

/**
 * POST /api/recipes/match
 * Body: { line: string }, one ingredient as typed, e.g. "2 cups milk".
 * 200: { ingredient: AnalyzedIngredient }. Rule-based parser and USDA matcher only: no AI, no cost.
 * Powers "Add an ingredient".
 */
export async function POST(request: Request) {
    try {
        const line = parseMatchBody(await readJsonBody(request, MAX_MATCH_BODY_BYTES));
        const parsed = parseIngredientLine(line);
        if (!parsed) throw new RequestError(400, 'invalid_request', 'Type an ingredient, like "2 cups milk"');
        // The person typed this, so the reading itself isn't in doubt.
        const ingredient = analyzeIngredient(recipesDb(), { ...parsed, confidence: 1 }, `add-${crypto.randomUUID()}`);
        return NextResponse.json({ ingredient }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleRecipeError(error, 'recipes/match');
    }
}
