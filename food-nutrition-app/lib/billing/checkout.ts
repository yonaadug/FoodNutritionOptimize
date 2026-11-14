import { requireUser, type AccountDeps } from '@/lib/auth/handlers';
import { AccountError, assertSameOrigin, jsonOk, readJson } from '@/lib/auth/http';
import { logError, logEvent, pseudonym } from '@/lib/auth/log';
import { enforce } from '@/lib/auth/rate-limit';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import { subscriptionGrantsPlus, type Interval } from './entitlements';
import type { StripeApi, StripeProvider } from './stripe-client';
import type { StripeSettings } from './stripe-config';

/**
 * POST /api/stripe/checkout { interval: 'month' | 'year' }  200: { url }  (Stripe-hosted Checkout)
 * POST /api/stripe/portal                                    200: { url }  (Customer Portal)
 *
 * Both need a session and a same-site Origin, and answer JSON so the page can show a
 * friendly message instead of a broken redirect. Neither changes the plan: only the
 * webhook does (lib/billing/webhook.ts).
 */

export type BillingDeps = AccountDeps & { stripe: StripeProvider };

const BODY_MAX_BYTES = 1024;
const BILLING_RULE = { limit: 10, windowSeconds: 600 };
const PROVIDER_DOWN = 'We couldn\'t reach our payment provider. Please try again in a minute.';
const STILL_OPEN = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

function settingsOrOff(stripe: StripeProvider): StripeSettings {
    const { config } = stripe;
    if (!config.ok) {
        if (config.reason !== 'not_configured') logError('billing', new Error(config.ownerMessage));
        throw new AccountError(503, 'billing_unavailable', config.publicMessage);
    }
    return config.settings;
}

function parseInterval(body: unknown): Interval {
    const interval = (body as { interval?: unknown } | null)?.interval;
    if (interval !== 'month' && interval !== 'year') {
        throw new AccountError(400, 'invalid_request', 'interval must be "month" or "year"', { field: 'interval' });
    }
    return interval;
}

async function stripeCall<T>(context: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (err) {
        // Stripe's messages can echo request details; log the type only.
        const e = err as { type?: string; code?: string; statusCode?: number };
        logError(context, new Error(`Stripe ${e.type ?? 'error'} ${e.code ?? ''} ${e.statusCode ?? ''}`.trim()));
        throw new AccountError(502, 'billing_unavailable', PROVIDER_DOWN);
    }
}

/** The person's Stripe customer in the current mode, created the first time they upgrade. */
async function customerFor(api: StripeApi, ents: EntitlementStore, user: { id: string; email: string }, mode: StripeSettings['mode']): Promise<string> {
    const record = await ents.ensure(user.id);
    const live = mode === 'live';
    if (record.stripeCustomerId && Boolean(record.stripeLivemode) === live) return record.stripeCustomerId;
    const customer = await stripeCall('billing customer', () => api.customers.create(
        { email: user.email, metadata: { userId: user.id } },
        // Two quick clicks make one customer, not two.
        { idempotencyKey: `nd-customer-${mode}-${user.id}` },
    ));
    await ents.linkCustomer(user.id, customer.id, live);
    return customer.id;
}

export async function postCheckout(request: Request, deps: BillingDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'billing-user', user.id, BILLING_RULE, deps.config.secret);
    const interval = parseInterval(await readJson(request, BODY_MAX_BYTES));
    const settings = settingsOrOff(deps.stripe);
    const price = settings.prices[interval];
    if (!price) {
        logError('billing', new Error(`No price id for ${interval} (STRIPE_${settings.mode === 'test' ? 'TEST_' : ''}PRICE_PLUS_${interval === 'month' ? 'MONTHLY' : 'ANNUAL'})`));
        throw new AccountError(503, 'billing_unavailable', 'That plan isn\'t available right now. Please try the other one, or come back later.');
    }

    const ents = new EntitlementStore(deps.table);
    const record = await ents.ensure(user.id);
    const sameMode = Boolean(record.stripeLivemode) === (settings.mode === 'live');
    if (sameMode && record.subscriptionId && record.subscriptionStatus && STILL_OPEN.has(record.subscriptionStatus)) {
        const message = subscriptionGrantsPlus(record, new Date())
            ? 'You already have Plus. You can change or cancel it under Manage subscription.'
            : 'Your Plus subscription needs attention. Open Manage subscription to update your card.';
        throw new AccountError(409, 'conflict', message);
    }

    const api = await deps.stripe.api();
    const customer = await customerFor(api, ents, user, settings.mode);
    const base = deps.config.baseUrl;
    const session = await stripeCall('billing checkout', () => api.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        metadata: { userId: user.id },
        subscription_data: { metadata: { userId: user.id } },
        allow_promotion_codes: true,
        success_url: `${base}/plus/welcome?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/plus`,
    }));
    if (!session.url) throw new AccountError(502, 'billing_unavailable', PROVIDER_DOWN);
    logEvent('billing.checkout_started', { user: pseudonym(user.id, deps.config.secret), interval, mode: settings.mode });
    return jsonOk({ url: session.url });
}

export async function postPortal(request: Request, deps: BillingDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'billing-user', user.id, BILLING_RULE, deps.config.secret);
    const settings = settingsOrOff(deps.stripe);
    const record = await new EntitlementStore(deps.table).get(user.id);
    if (!record?.stripeCustomerId || Boolean(record.stripeLivemode) !== (settings.mode === 'live')) {
        throw new AccountError(409, 'conflict', 'There\'s no subscription to manage yet.');
    }
    const api = await deps.stripe.api();
    const session = await stripeCall('billing portal', () => api.billingPortal.sessions.create({
        customer: record.stripeCustomerId!,
        return_url: `${deps.config.baseUrl}/account`,
        ...(settings.portalConfigurationId ? { configuration: settings.portalConfigurationId } : {}),
    }));
    return jsonOk({ url: session.url });
}
