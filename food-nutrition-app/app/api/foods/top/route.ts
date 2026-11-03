import { NextRequest, NextResponse } from 'next/server';
import { getTopFoodsByNutrient, sortableNutrients, SEARCH_MAX_LIMIT } from '@/lib/db';
import { ApiError, handleError, intParam } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/foods/top?nutrient=protein_g&limit=50
 * Top foods by a nutrient per 100 g (foods with no data are skipped).
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
        const foods = await getTopFoodsByNutrient(nutrient, limit);
        return NextResponse.json({ foods });
    } catch (error) {
        return handleError(error, 'foods/top');
    }
}
