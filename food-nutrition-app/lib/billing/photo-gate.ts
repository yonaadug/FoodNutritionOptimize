import { hasSessionCookie, type AccountDeps } from '@/lib/auth/handlers';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import { PHOTO_LIMITS, TRIAL_DAYS } from './entitlements';
import { quotaMessage, reservePhotoRead, type PhotoUsage } from './quota';
import { loadEntitlements } from './summary';

/**
 * The account check in front of an AI photo read (POST /api/recipes/parse with an image).
 * Photos need an account, since the quota is per account (AWS design §3.5: AI needs
 * sign-in). Pasted text never comes here: it's free for everyone, signed in or not.
 */

export type PhotoGate =
    | { ok: true; userId: string; usage: PhotoUsage; release: () => Promise<void> }
    | { ok: false; status: number; code: 'sign_in_required' | 'photo_quota' | 'accounts_unavailable'; message: string; usage?: PhotoUsage };

export const SIGN_IN_FOR_PHOTOS = `Sign in to read photos. It's free: new accounts get ${PHOTO_LIMITS.trial.limit} photo reads in their ${TRIAL_DAYS}-day trial, `
    + `then ${PHOTO_LIMITS.free.limit} a month. Pasted recipes never need an account.`;

/** `deps` is null when accounts can't be loaded on this server. */
export async function openPhotoRead(request: Request, deps: AccountDeps | null, now: Date = new Date()): Promise<PhotoGate> {
    if (!hasSessionCookie(request)) return { ok: false, status: 401, code: 'sign_in_required', message: SIGN_IN_FOR_PHOTOS };
    if (!deps) {
        return { ok: false, status: 503, code: 'accounts_unavailable', message: 'Photo reads aren\'t available right now. You can still paste the recipe as text.' };
    }
    const session = await deps.auth.api.getSession({ headers: request.headers });
    if (!session?.user) return { ok: false, status: 401, code: 'sign_in_required', message: SIGN_IN_FOR_PHOTOS };
    const userId = session.user.id;
    const { entitlements } = await loadEntitlements(deps.table, userId, now);
    const reservation = await reservePhotoRead(new EntitlementStore(deps.table), userId, entitlements, now);
    if (!reservation.ok) {
        return { ok: false, status: 403, code: 'photo_quota', message: quotaMessage(reservation.usage, entitlements.plan), usage: reservation.usage };
    }
    return { ok: true, userId, usage: reservation.usage, release: reservation.release };
}
