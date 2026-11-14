import { getPageUser } from '@/lib/auth/pages';
import { toErrorResponse } from '@/lib/auth/http';
import { getAccountDeps } from '@/lib/auth/server';
import { has, type Entitlements, type Feature } from './entitlements';
import { requireFeature } from './gate';
import type { PlanSummary } from './types';

/**
 * Server-side Plus checks for routes and pages. Server only.
 *
 * A route that does Plus work, in one line:
 *
 *   // PLUS-GATE: weekPlanner
 *   export const POST = plusRoute('weekPlanner', async (request, { userId }) => Response.json(...));
 *
 * Signed out is a 401, a free account a 403 { code: 'plus_required' }.
 */
export function plusRoute(
    feature: Feature,
    handler: (request: Request, context: { userId: string; entitlements: Entitlements }) => Promise<Response>,
) {
    return async (request: Request): Promise<Response> => {
        try {
            const context = await requireFeature(request, await getAccountDeps(), feature);
            return await handler(request, context);
        } catch (err) {
            return toErrorResponse(err, `plus-${feature}`);
        }
    };
}

/** In a server component: the plan of the person this page is for, or null when signed out. */
export async function getPagePlan(): Promise<PlanSummary | null> {
    return (await getPageUser())?.plan ?? null;
}

/** In a server component: may this page show `feature`? */
export async function pageHasFeature(feature: Feature): Promise<boolean> {
    return has(await getPagePlan(), feature);
}
