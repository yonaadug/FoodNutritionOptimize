import { requireUser, type AccountDeps } from '@/lib/auth/handlers';
import { AccountError } from '@/lib/auth/http';
import { has, type Entitlements, type Feature } from './entitlements';
import { FEATURE_COPY } from './features';
import { loadEntitlements } from './summary';

/**
 * The server-side half of a Plus gate. The UI hides a feature with <PlusGate>; any API
 * route that does the work also checks here, so a free account can't call it directly.
 * Wrapping a whole route is one line with plusRoute (lib/billing/server.ts).
 */
export async function requireFeature(request: Request, deps: AccountDeps, feature: Feature, now: Date = new Date()): Promise<{ userId: string; entitlements: Entitlements }> {
    const user = await requireUser(request, deps);
    const { entitlements } = await loadEntitlements(deps.table, user.id, now);
    if (!has(entitlements, feature)) {
        throw new AccountError(403, 'plus_required', `${FEATURE_COPY[feature].name} is part of Plus.`, { feature });
    }
    return { userId: user.id, entitlements };
}
