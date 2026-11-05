import { NextRequest, NextResponse } from 'next/server';
import { intParam } from '@/lib/api';
import { recipesDb, RequestError } from '@/lib/recipes/request';
import { handleRecipeError } from '@/lib/recipes/respond';
import { withPortionsIn } from '@/lib/recipes/match';
import type { Food } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/recipes/portions?fdcId=123
 * 200: { portions: Portion[] }: the food's USDA serving rows plus rows from the SR Legacy food it
 * supersedes. The editor calls this after the user picks a different food, since /api/search
 * returns only a food's own rows and Foundation foods often have no household measures.
 */
export async function GET(request: NextRequest) {
    try {
        const fdcId = intParam(request.nextUrl.searchParams, 'fdcId', 0, 1, Number.MAX_SAFE_INTEGER);
        if (!fdcId) throw new RequestError(400, 'invalid_request', 'fdcId is required');
        const conn = recipesDb();
        const row = conn.db.prepare('SELECT * FROM foods WHERE fdc_id = ?').get(fdcId) as Food | undefined;
        if (!row) throw new RequestError(404, 'not_found', 'Food not found');
        const servings = conn.db.prepare('SELECT id, food_id, label, weight_g FROM serving_sizes WHERE food_id = ? ORDER BY weight_g, id').all(row.id) as Food['serving_sizes'];
        const [food] = withPortionsIn(conn, [{ ...row, serving_sizes: servings }]);
        return NextResponse.json({ portions: food.portions }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    } catch (error) {
        return handleRecipeError(error, 'recipes/portions');
    }
}
