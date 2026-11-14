import { accountRoute } from '@/lib/auth/server';
import { postCheckout, type BillingDeps } from '@/lib/billing/checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/checkout { interval: 'month' | 'year' }
 * 200: { url } of a Stripe-hosted Checkout page. 401 signed out, 409 already Plus,
 * 503 billing not set up (or a live key refused on this machine), 502 Stripe unreachable.
 */
export const POST = accountRoute('stripe-checkout', (request, deps) => postCheckout(request, deps as BillingDeps));
