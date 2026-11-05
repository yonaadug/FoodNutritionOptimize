import { NextRequest, NextResponse } from 'next/server';
import { getFoodsByFdcIds, getFoodsByIds } from '@/lib/db';
import { ApiError, handleError } from '@/lib/api';

export const runtime = 'nodejs';

const MAX_IDS = 200;

/**
 * GET /api/food?ids=1,2,3        by database row id
 * GET /api/food?fdcIds=1,2,3     by FoodData Central id, which stays the same between database builds
 * 200: { foods } (unknown ids are omitted)
 */
export async function GET(request: NextRequest) {
    try {
        const fdcParam = request.nextUrl.searchParams.get('fdcIds');
        const idsParam = fdcParam ?? request.nextUrl.searchParams.get('ids');
        if (!idsParam) throw new ApiError(400, 'invalid_request', 'ids parameter required');
        const parts = idsParam.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length > MAX_IDS) throw new ApiError(400, 'invalid_request', `At most ${MAX_IDS} ids per request`);
        if (parts.some(p => !/^\d+$/.test(p))) throw new ApiError(400, 'invalid_request', 'ids must be positive integers');
        const ids = parts.map(Number).filter(Number.isSafeInteger);
        if (ids.length === 0) throw new ApiError(400, 'invalid_request', 'ids parameter required');
        const foods = fdcParam !== null ? await getFoodsByFdcIds(ids) : await getFoodsByIds(ids);
        return NextResponse.json({ foods });
    } catch (error) {
        return handleError(error, 'food');
    }
}
