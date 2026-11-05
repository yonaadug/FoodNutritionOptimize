import { NextRequest, NextResponse } from 'next/server';
import { getBestSources, getTopFoodsByNutrient, sortableNutrients, SEARCH_MAX_LIMIT } from '@/lib/db';
import { ApiError, handleError, intParam } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/foods/top?nutrient=protein_g&limit=50
 *   Top foods by a nutrient per 100 g (foods with no data are skipped).
 *
 * GET /api/foods/top?nutrient=iron_mg&rank=serving[&everyday=0][&exclude=1,2,3]
 *   Good sources for people: ranked by a realistic serving, everyday foods
 *   with decent data first, specialty items (supplements, powders, organ
 *   meats...) only to fill up. everyday=0 ranks every food by serving.
 *   Each food carries `best: { servingLabel, servingGrams, perServing, per100g, everyday }`.
 *
 * `nutrient` must be a configured nutrient that exists as a column in the DB.
 */
export async function GET(request: NextRequest) {
    try {
        const params = request.nextUrl.searchParams;
        const nutrient = params.get('nutrient') ?? '';
        const allowed = sortableNutrients();
        if (!allowed.includes(nutrient)) {
            throw new ApiError(400, 'invalid_request', 'Invalid nutrient parameter', { allowed });
        }
        const limit = intParam(params, 'limit', 50, 1, SEARCH_MAX_LIMIT);
        const rank = params.get('rank') ?? '100g';
        if (rank !== '100g' && rank !== 'serving') {
            throw new ApiError(400, 'invalid_request', 'rank must be "100g" or "serving"');
        }
        if (rank === '100g') {
            const foods = await getTopFoodsByNutrient(nutrient, limit);
            return NextResponse.json({ foods, rank });
        }
        const exclude = (params.get('exclude') ?? '').split(',').map(Number).filter(n => Number.isSafeInteger(n)).slice(0, 500);
        const foods = await getBestSources(nutrient, { limit, exclude, everyday: params.get('everyday') !== '0' });
        return NextResponse.json({ foods, rank });
    } catch (error) {
        return handleError(error, 'foods/top');
    }
}
