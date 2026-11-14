import { accountRoute } from '@/lib/auth/server';
import { postConsent } from '@/lib/consent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/consent { acceptTerms, ageConfirmed, healthDataConsent, versions } or { usePending: true }
 * Signed out: 200 { pending: true } and a short-lived signed cookie. Signed in: 200 { consent }.
 * See lib/consent.ts for the flow.
 */
export const POST = accountRoute('consent', postConsent);
