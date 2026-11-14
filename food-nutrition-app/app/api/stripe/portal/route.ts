import { accountRoute } from '@/lib/auth/server';
import { postPortal, type BillingDeps } from '@/lib/billing/checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/stripe/portal  200: { url } of a Stripe Customer Portal session. 409 when there's no customer yet. */
export const POST = accountRoute('stripe-portal', (request, deps) => postPortal(request, deps as BillingDeps));
