import { logError } from '@/lib/auth/log';
import { getAccountDeps } from '@/lib/auth/server';
import { postWebhook } from '@/lib/billing/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/webhook, called by Stripe (or `stripe listen` locally). Verifies the
 * Stripe-Signature header on the raw body; see lib/billing/webhook.ts.
 * 200 processed, duplicate or ignored; 400 bad signature; 500 failed (Stripe retries);
 * 503 billing not set up.
 */
export async function POST(request: Request): Promise<Response> {
    try {
        const deps = await getAccountDeps();
        if (!deps.stripe) return Response.json({ error: 'Billing is not configured', code: 'billing_unavailable' }, { status: 503 });
        return await postWebhook(request, { table: deps.table, store: deps.store, stripe: deps.stripe });
    } catch (err) {
        logError('stripe-webhook', err);
        return Response.json({ error: 'Internal server error', code: 'internal_error' }, { status: 500 });
    }
}
