import { NextRequest, NextResponse } from 'next/server';
import { searchFoods, SEARCH_MAX_LIMIT, SEARCH_MAX_PAGE, SEARCH_MAX_QUERY_LENGTH } from '@/lib/db';
import { ApiError, boolParam, handleError, intParam } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/search?q=...&page=1&limit=20[&includeSuperseded=1]
 * 200: { foods, total, page, totalPages, limit }
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
        const result = await searchFoods(query, page, limit, { includeSuperseded: boolParam(params, 'includeSuperseded') });
        return NextResponse.json(result);
    } catch (error) {
        return handleError(error, 'search');
    }
}
