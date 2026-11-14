import { NextResponse } from 'next/server';
import { plusRoute } from '@/lib/billing/server';
import { ApiError, handleError, readJsonBody } from '@/lib/api';
import { getDb } from '@/lib/db';
import { planContaminantsIn, planFdcIds, swapCandidatesIn, type SwapCandidate } from '@/lib/plan-contaminants';
import { PLAN_CONTAMINANT_LIMITS, PlanContaminantRequestError, parsePlanContaminantRequest } from '@/lib/plan-contaminants-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/plan/contaminants
 * Body: { days: [[{ key, fdcId, name, grams }]] }: one day for a day plan, up to 7 for a week.
 * 200: { summary: PlanContaminantSummary, swaps: { "<fdcId>:<contaminant>": SwapCandidate[] } }
 *      Swaps are offered for the foods that push a total into elevated.
 * 400: invalid input.
 *
 * PLUS-GATE: planContaminants. The Plus check goes at the top of this handler.
 */
async function handle(request: Request) {
    try {
        const body = await readJsonBody(request, PLAN_CONTAMINANT_LIMITS.maxBodyBytes);
        let days;
        try {
            ({ days } = parsePlanContaminantRequest(body));
        } catch (e) {
            if (e instanceof PlanContaminantRequestError) throw new ApiError(400, 'invalid_request', e.message);
            throw e;
        }
        const db = getDb();
        const summary = planContaminantsIn(db, days);
        const inPlan = planFdcIds(days);
        const fdcByKey = new Map(days.flat().map(p => [p.key, p.fdcId]));
        const swaps: Record<string, SwapCandidate[]> = {};
        for (const row of summary.rows) {
            for (const key of row.flagged) {
                const fdcId = fdcByKey.get(key);
                if (!fdcId) continue;
                swaps[`${fdcId}:${row.id}`] = swapCandidatesIn(db, fdcId, row.id, inPlan);
            }
        }
        return NextResponse.json({ summary, swaps }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleError(error, 'plan-contaminants');
    }
}

// PLUS-GATE: planContaminants. Signed out: 401; a free account: 403 { code: 'plus_required' }.
export const POST = plusRoute('planContaminants', request => handle(request));
