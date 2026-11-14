import { NextResponse } from 'next/server';
import { ApiError, handleError, jsonError, readJsonBody } from '@/lib/api';
import { hydrateFoods, DatabaseUnavailableError, type Food } from '@/lib/db';
import { planWeek } from '@/lib/week-planner/solve';
import { parseWeekRequest, RequestValidationError, WEEK_REQUEST_LIMITS } from '@/lib/week-planner/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/plan/week
 * Body: the day planner's fields ({ foods, fixedFoods, customConstraints, minCalories, maxCalories,
 *       portionCap, foodConstraints, applyUpperLimits }) plus
 *       settings?: { days, maxDaysPerFood, leftovers, weeklyAverages, avoidBackToBack },
 *       locks?: { days: number[], items: [{ day, foodId, grams, servings?, leftover? }] },
 *       avoid?: [{ day, foodId }]   (re-plan: steer away from these food-days)
 * 200: WeekResult (success true or false). 400: malformed input.
 *
 * PLUS-GATE: weekPlanner. The Plus check goes at the top of this handler.
 */
export async function POST(request: Request) {
    try {
        const body = await readJsonBody(request, WEEK_REQUEST_LIMITS.maxBodyBytes);
        let params;
        try {
            params = parseWeekRequest(body);
        } catch (e) {
            if (e instanceof RequestValidationError) throw new ApiError(400, 'invalid_request', e.message);
            throw e;
        }
        // Nutrient data from the database, not the browser's saved copy (as /api/optimize does).
        try {
            const fixed = params.fixedFoods ?? [];
            const hydrated = hydrateFoods([...params.foods, ...fixed.map(f => f.food)]) as Food[];
            params.foods = hydrated.slice(0, params.foods.length);
            params.fixedFoods = fixed.map((f, i) => ({ ...f, food: hydrated[params.foods.length + i] }));
        } catch (e) {
            if (!(e instanceof DatabaseUnavailableError)) throw e;
            console.warn('[plan-week] database unavailable; using client-supplied nutrient data');
        }
        const result = await planWeek(params);
        if (result.error) return jsonError(400, 'invalid_input', result.error);
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleError(error, 'plan-week');
    }
}
