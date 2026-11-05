import { NextRequest, NextResponse } from 'next/server';
import { ApiError, handleError } from '@/lib/api';
import { FoodNotFoundError, getContaminantReport } from '@/lib/contaminants';
import { ContaminantQueryError, parseContaminantQuery } from '@/lib/contaminants-query';

export const runtime = 'nodejs';
// Reads the database at request time; never prerender at build.
export const dynamic = 'force-dynamic';

/**
 * GET /api/contaminants?fdcId=2727569&grams=85
 * fdcId: required USDA FoodData Central id. grams: optional serving, defaults to a typical serving.
 * 200: ContaminantReport (see lib/contaminants-meter.ts). Missing data is status "no_data", never a zero.
 * 400: invalid input. 404: unknown food.
 */
export async function GET(request: NextRequest) {
    try {
        const { fdcId, grams } = parseContaminantQuery(request.nextUrl.searchParams);
        return NextResponse.json(getContaminantReport(fdcId, grams));
    } catch (error) {
        if (error instanceof ContaminantQueryError) return handleError(new ApiError(400, 'invalid_request', error.message), 'contaminants');
        if (error instanceof FoodNotFoundError) return handleError(new ApiError(404, 'not_found', error.message), 'contaminants');
        return handleError(error, 'contaminants');
    }
}
