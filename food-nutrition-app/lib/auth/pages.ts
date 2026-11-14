import { headers } from 'next/headers';
import { planSummary } from '@/lib/billing/summary';
import type { CurrentUser } from './client';
import { hasSessionCookie, publicUser } from './handlers';
import { logError } from './log';
import { getAccountDeps } from './server';
import { loadAuthConfig } from './config';

/** Server-component helpers for the /account pages. */

/** Who this page is being rendered for, or null. A store problem reads as signed out. */
export async function getPageUser(): Promise<CurrentUser | null> {
    const requestHeaders = await headers();
    if (!hasSessionCookie(requestHeaders)) return null;
    try {
        const deps = await getAccountDeps();
        const session = await deps.auth.api.getSession({ headers: requestHeaders });
        const profile = session?.user ? await deps.store.getProfile(session.user.id) : null;
        if (!profile) return null;
        return { ...publicUser(profile), plan: await planSummary(deps.table, profile.id, Boolean(deps.stripe?.config.ok)) };
    } catch (err) {
        logError('account-page', err);
        return null;
    }
}

export interface SignInOptions {
    available: boolean;
    /** Links are printed to the server console (local development). */
    consoleLinks: boolean;
    google: boolean;
}

export function getSignInOptions(): SignInOptions {
    try {
        const config = loadAuthConfig();
        return { available: true, consoleLinks: config.emailTransport === 'console', google: Boolean(config.google) };
    } catch (err) {
        logError('account-config', err);
        return { available: false, consoleLinks: false, google: false };
    }
}
