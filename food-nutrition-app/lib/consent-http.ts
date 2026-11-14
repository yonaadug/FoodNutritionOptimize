import { hasSessionCookie, type AccountDeps } from '@/lib/auth/handlers';
import { AccountError, assertSameOrigin, jsonOk, rateLimitIp, readJson } from '@/lib/auth/http';
import { logEvent, pseudonym } from '@/lib/auth/log';
import { enforce, RATE_RULES } from '@/lib/auth/rate-limit';
import {
    clearPendingCookieHeader, ConsentError, consentStatus, cookieValue, encodePendingConsent, getConsent, hasHealthDataConsent,
    listConsentLog, parseConsentInput, PENDING_COOKIE, pendingCookieHeader, readPendingConsent, recordConsent,
} from '@/lib/consent';
import { POLICY_VERSIONS } from '@/lib/legal';

/**
 * The consent API and the guards that depend on it, as (Request, deps) => Response
 * functions like lib/auth/handlers.ts, so tests run them without a server.
 * lib/consent.ts explains the flow.
 */

type Handler = (request: Request, deps: AccountDeps) => Promise<Response>;

const BODY_MAX_BYTES = 2 * 1024;

/** A refusal the sign-in form and the history client can recognise. */
function consentRequired(message: string): AccountError {
    return new AccountError(403, 'forbidden', message, { reason: 'consent_required' });
}

async function sessionUser(request: Request, deps: AccountDeps): Promise<{ id: string } | null> {
    if (!hasSessionCookie(request)) return null;
    const session = await deps.auth.api.getSession({ headers: request.headers });
    return session?.user ? { id: session.user.id } : null;
}

function hasPendingConsent(request: Request, deps: AccountDeps): boolean {
    return readPendingConsent(cookieValue(request.headers.get('cookie'), PENDING_COOKIE), deps.config.secret);
}

/**
 * POST /api/consent
 *   { acceptTerms, ageConfirmed, healthDataConsent, versions }  the boxes, as ticked
 *   { usePending: true }                                         "record what I ticked on the sign-in page"
 *
 * Signed out: the ticks become the pending cookie (200 { pending: true }).
 * Signed in: they're recorded against the account (200 { consent }), and the cookie is cleared.
 * Refusals: 400 with details.reason 'incomplete' | 'versions_changed' | 'invalid',
 * or 403 consent_required when usePending finds no valid cookie.
 */
export async function postConsent(request: Request, deps: AccountDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    const ip = rateLimitIp(request, deps.config);
    if (ip) await enforce(deps.table, 'write-ip', ip, RATE_RULES.writeIp, deps.config.secret);
    const body = await readJson(request, BODY_MAX_BYTES);
    const user = await sessionUser(request, deps);
    const secure = deps.config.isHttps;

    const usePending = (body as { usePending?: unknown } | null)?.usePending === true;
    if (usePending) {
        if (!user) throw new AccountError(401, 'unauthorized', 'Sign in first');
        if (!hasPendingConsent(request, deps)) throw consentRequired('Please review and agree to continue');
    } else {
        try {
            parseConsentInput(body);
        } catch (e) {
            if (e instanceof ConsentError) throw new AccountError(400, 'invalid_request', e.message, { reason: e.reason });
            throw e;
        }
    }

    if (!user) {
        const res = jsonOk({ pending: true, versions: POLICY_VERSIONS });
        res.headers.append('set-cookie', pendingCookieHeader(encodePendingConsent(deps.config.secret), secure));
        return res;
    }
    await enforce(deps.table, 'write-user', user.id, RATE_RULES.writeUser, deps.config.secret);
    const consent = await recordConsent(deps.table, user.id, usePending ? 'sign-in-form' : 'sign-in-review');
    logEvent('account.consent_recorded', { user: pseudonym(user.id, deps.config.secret), versions: Object.values(consent.versions).join(',') });
    const res = jsonOk({ consent });
    res.headers.append('set-cookie', clearPendingCookieHeader(secure));
    return res;
}

/** The sign-in requests that start a sign-in. Verification and callbacks are the person returning, so they pass. */
const SIGN_IN_STARTS = new Set(['/api/auth/sign-in/magic-link', '/api/auth/sign-in/social']);

/**
 * Wraps the Better Auth endpoint: no sign-in link is emailed, and no Google sign-in
 * starts, unless the sign-in form's boxes were ticked (the pending cookie). The check
 * is a signature, with no database read.
 */
export function requireSignInConsent(handler: Handler): Handler {
    return async (request, deps) => {
        if (request.method === 'POST' && SIGN_IN_STARTS.has(new URL(request.url).pathname) && !hasPendingConsent(request, deps)) {
            throw consentRequired('Tick the boxes to agree to our Terms, Privacy Policy and Consumer Health Data Privacy Policy first');
        }
        return handler(request, deps);
    };
}

/**
 * Wraps a write of health-related history: refused for an account with no health-data
 * consent on record. Signed-out requests go straight through, so the handler's own 401 applies.
 */
export function requireHealthDataConsent(handler: Handler): Handler {
    return async (request, deps) => {
        const user = await sessionUser(request, deps);
        if (user && !(await hasHealthDataConsent(deps.table, user.id))) {
            throw consentRequired('Agree to the Consumer Health Data Privacy Policy to save history to your account');
        }
        return handler(request, deps);
    };
}

/** Wraps the account export so it includes every consent on record. */
export function withConsentInExport(handler: Handler): Handler {
    return async (request, deps) => {
        const res = await handler(request, deps);
        if (!res.ok) return res;
        const user = await sessionUser(request, deps);
        if (!user) return res;
        const data = (await res.json()) as Record<string, unknown>;
        const [current, log] = await Promise.all([getConsent(deps.table, user.id), listConsentLog(deps.table, user.id)]);
        const out = jsonOk({ ...data, consent: { current, status: consentStatus(current), history: log } });
        const disposition = res.headers.get('content-disposition');
        if (disposition) out.headers.set('content-disposition', disposition);
        return out;
    };
}
