import { cookies } from 'next/headers';
import { logError } from '@/lib/auth/log';
import { getAccountDeps } from '@/lib/auth/server';
import { changedPolicies, consentStatus, getConsent, PENDING_COOKIE, readPendingConsent, type ConsentRecord, type ConsentStatus } from '@/lib/consent';
import type { PolicyKey } from '@/lib/legal';

/** Server-component helpers: where a signed-in person stands on consent. */

export interface PageConsent {
    status: ConsentStatus;
    record: ConsentRecord | null;
    /** Documents that changed since they last agreed (all three when they never have). */
    changed: PolicyKey[];
    /** The sign-in form's ticks are waiting in this browser, ready to be recorded. */
    pending: boolean;
}

export async function getPageConsent(userId: string): Promise<PageConsent> {
    try {
        const deps = await getAccountDeps();
        const record = await getConsent(deps.table, userId);
        const jar = await cookies();
        return {
            status: consentStatus(record),
            record,
            changed: changedPolicies(record?.versions),
            pending: readPendingConsent(jar.get(PENDING_COOKIE)?.value, deps.config.secret),
        };
    } catch (err) {
        logError('consent-page', err);
        return { status: 'missing', record: null, changed: changedPolicies(null), pending: false };
    }
}
