import { NextResponse } from 'next/server';
import { optimizeDiet } from '@/lib/optimizer';
import { hydrateFoods, DatabaseUnavailableError, type Food } from '@/lib/db';
import { ApiError, handleError, jsonError, readJsonBody } from '@/lib/api';
import { parseOptimizeRequest, RequestValidationError, OPTIMIZE_LIMITS } from '@/lib/optimize-request';

export const runtime = 'nodejs';

/**
 * POST /api/optimize
 * Body: { foods, guaranteedFoods?, customConstraints?, maxCalories?, minCalories?,
 *         diversityMode?, maxFoodAmount?, foodConstraints?, applyUpperLimits?,
 *         portionCap?: { servings?, grams? } }
 * 200: OptimizationResult (success true or false; `warnings` always present)
 * 400: { error, code } for malformed input; 413/415 for body problems.
 */
export async function POST(request: Request) {
    try {
        const body = await readJsonBody(request, OPTIMIZE_LIMITS.maxBodyBytes);
        let params;
        try {
            params = parseOptimizeRequest(body);
        } catch (e) {
            if (e instanceof RequestValidationError) throw new ApiError(400, 'invalid_request', e.message);
            throw e;
        }

        // Nutrient data comes from the database when the food is known there,
        // not from the client (stale localStorage, tampering, null semantics).
        try {
            const all = [...params.foods, ...(params.guaranteedFoods ?? []).map(g => g.food)];
            const hydrated = hydrateFoods(all) as Food[];
            params.foods = hydrated.slice(0, params.foods.length);
            params.guaranteedFoods = (params.guaranteedFoods ?? []).map((g, i) => ({
                ...g,
                food: hydrated[params.foods.length + i],
            }));
        } catch (e) {
            if (!(e instanceof DatabaseUnavailableError)) throw e;
            console.warn('[optimize] database unavailable; using client-supplied nutrient data');
        }

        const result = optimizeDiet(params);
        if (result.error) return jsonError(400, 'invalid_input', result.error);
        // The fixed foods as used here, so the plan's rows agree with its totals whatever the browser had saved.
        return NextResponse.json({ ...result, guaranteedFoods: params.guaranteedFoods ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleError(error, 'optimize');
    }
}
