import { NextRequest, NextResponse } from 'next/server';
import { intParam } from '@/lib/api';
import { foodWithPortionsIn } from '@/lib/recipes/match';
import { recipesDb, RequestError } from '@/lib/recipes/request';
import { handleRecipeError } from '@/lib/recipes/respond';

export const runtime = 'nodejs';

/**
 * GET /api/recipes/food?fdcId=123
 * 200: { food: RecipeFood }: the full food, plus conversion portions: its USDA serving rows and those
 * of the SR Legacy food it supersedes. The editor calls this after the user picks a food, because
 * /api/search returns only a food's own rows and Foundation foods often have no household measures.
 */
export async function GET(request: NextRequest) {
    try {
        const fdcId = intParam(request.nextUrl.searchParams, 'fdcId', 0, 1, Number.MAX_SAFE_INTEGER);
        if (!fdcId) throw new RequestError(400, 'invalid_request', 'fdcId is required');
        const food = foodWithPortionsIn(recipesDb(), fdcId);
        if (!food) throw new RequestError(404, 'not_found', 'Food not found');
        return NextResponse.json({ food }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    } catch (error) {
        return handleRecipeError(error, 'recipes/food');
    }
}
