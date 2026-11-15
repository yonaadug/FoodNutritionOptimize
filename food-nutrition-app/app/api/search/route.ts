import { NextRequest, NextResponse } from 'next/server';
import { searchFoodGroups, searchFoods, searchGroupTypes, SEARCH_MAX_LIMIT, SEARCH_MAX_PAGE, SEARCH_MAX_QUERY_LENGTH } from '@/lib/db';
import { ApiError, boolParam, handleError, intParam } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/search?q=...&page=1&limit=20[&includeSuperseded=1]
 * 200: { foods, total, page, totalPages, limit }
 *
 * GET /api/search?q=...&group=1  one row per food (lib/food-groups.ts); paging counts groups
 * 200: { groups: [{ key, name, count, food, types }], total, entries, page, totalPages, limit }
 *      (a group lists at most 60 types; `count` says how many matched)
 *
 * GET /api/search?q=...&group=1&key=<group key>  every matched type of one group
 * 200: { key, types }
 */
export async function GET(request: NextRequest) {
    try {
        const params = request.nextUrl.searchParams;
        const query = params.get('q')?.trim() ?? '';
        if (!query) throw new ApiError(400, 'invalid_request', 'Query parameter q is required');
        if (query.length > SEARCH_MAX_QUERY_LENGTH) {
            throw new ApiError(400, 'invalid_request', `q must be at most ${SEARCH_MAX_QUERY_LENGTH} characters`);
        }
        const page = intParam(params, 'page', 1, 1, SEARCH_MAX_PAGE);
        const limit = intParam(params, 'limit', 20, 1, SEARCH_MAX_LIMIT);
        const options = { includeSuperseded: boolParam(params, 'includeSuperseded') };
        if (!boolParam(params, 'group')) return NextResponse.json(await searchFoods(query, page, limit, options));
        const key = params.get('key');
        if (key !== null) {
            if (!key || key.length > SEARCH_MAX_QUERY_LENGTH + 10) throw new ApiError(400, 'invalid_request', 'key is invalid');
            return NextResponse.json({ key, types: await searchGroupTypes(query, key, options) });
        }
        return NextResponse.json(await searchFoodGroups(query, page, limit, options));
    } catch (error) {
        return handleError(error, 'search');
    }
}
