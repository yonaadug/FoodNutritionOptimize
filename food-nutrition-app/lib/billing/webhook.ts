import { logError, logEvent } from '@/lib/auth/log';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import type { SingleTable } from '@/lib/user-store/table';
import type { UserStore } from '@/lib/user-store/user-store';
import { subscriptionGrantsPlus, type EntitlementRecord, type Interval } from './entitlements';
import { stripeId, type StripeEventLike, type StripeProvider, type StripeSubscriptionLike } from './stripe-client';

/**
 * POST /api/stripe/webhook. Stripe is the source of truth for subscriptions, and this
 * is the only code that writes subscription state.
 *
 *  1. Verify the Stripe-Signature header against the raw body (a bad one is a 400).
 *  2. Skip an event id already processed (Stripe retries and can deliver twice).
 *  3. Re-read the subscription from Stripe rather than trusting the event's copy, so
 *     events arriving out of order can't leave stale state (AWS design §3.6).
 *  4. Mark the event processed only after it was applied. A failure is a 500 and
 *     Stripe retries; applying the same event twice gives the same result.
 */

export interface WebhookDeps {
    table: SingleTable;
    store: UserStore;
    stripe: StripeProvider;
    now?: () => Date;
}

/** Stripe's events are small; anything far larger isn't one. */
const MAX_BODY_BYTES = 512 * 1024;
const HANDLED = new Set([
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed',
]);
const ENDED = new Set(['canceled', 'incomplete_expired']);
const GRANTING = new Set(['active', 'trialing']);

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const iso = (seconds: number | null | undefined) => (typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);

/** Pure: the record after seeing this subscription. Exported for tests. */
export function applySubscription(record: EntitlementRecord, sub: StripeSubscriptionLike, now: Date): EntitlementRecord {
    // A second subscription (say, two Checkout tabs) never replaces a working one with a dead one.
    if (record.subscriptionId && record.subscriptionId !== sub.id && subscriptionGrantsPlus(record, now) && !GRANTING.has(sub.status)) {
        return record;
    }
    const item = sub.items?.data?.[0];
    const rawInterval = item?.price?.recurring?.interval;
    const interval: Interval | null = rawInterval === 'month' || rawInterval === 'year' ? rawInterval : null;
    const samePastDue = record.subscriptionId === sub.id && record.subscriptionStatus === 'past_due' && record.pastDueSince;
    return {
        ...record,
        subscriptionId: sub.id,
        subscriptionStatus: sub.status,
        priceId: item?.price?.id ?? null,
        interval,
        currentPeriodEnd: iso(item?.current_period_end ?? sub.current_period_end),
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        cancelAt: iso(sub.cancel_at),
        pastDueSince: sub.status === 'past_due' ? (samePastDue ? record.pastDueSince : now.toISOString()) : null,
        paymentFailedAt: ENDED.has(sub.status) ? null : record.paymentFailedAt ?? null,
    };
}

async function liveUser(deps: WebhookDeps, userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    return (await deps.store.getProfile(userId)) ? userId : null;
}

/** The account a customer belongs to: our pointer first, then the metadata we set at Checkout. */
async function userFor(deps: WebhookDeps, customerId: string | null, metadataUserId?: string | null): Promise<string | null> {
    const ents = new EntitlementStore(deps.table);
    const byPointer = customerId ? await ents.userIdForCustomer(customerId) : null;
    return (await liveUser(deps, byPointer)) ?? (await liveUser(deps, metadataUserId));
}

async function syncSubscription(deps: WebhookDeps, userId: string, subscriptionId: string, extra?: (r: EntitlementRecord) => EntitlementRecord) {
    const api = await deps.stripe.api();
    const sub = await api.subscriptions.retrieve(subscriptionId);
    const now = deps.now?.() ?? new Date();
    const ents = new EntitlementStore(deps.table);
    await ents.ensure(userId, now);
    await ents.update(userId, r => {
        const next = applySubscription(r, sub, now);
        return extra ? extra(next) : next;
    });
}

const metadataUser = (object: Record<string, unknown>) => {
    const metadata = object.metadata as Record<string, string> | null | undefined;
    return typeof metadata?.userId === 'string' ? metadata.userId : null;
};

/** The subscription an invoice belongs to, in both the current and the pre-2025 API shapes. */
function invoiceSubscription(invoice: Record<string, unknown>): string | null {
    const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
    return stripeId(parent?.subscription_details?.subscription as string | null) ?? stripeId(invoice.subscription as string | null);
}

export async function handleStripeEvent(event: StripeEventLike, deps: WebhookDeps): Promise<'applied' | 'ignored'> {
    const object = event.data.object;
    const now = deps.now?.() ?? new Date();
    const ents = new EntitlementStore(deps.table);

    if (event.type === 'checkout.session.completed') {
        if (object.mode !== 'subscription') return 'ignored';
        const customerId = stripeId(object.customer as string | null);
        const subscriptionId = stripeId(object.subscription as string | null);
        const claimed = typeof object.client_reference_id === 'string' ? object.client_reference_id : metadataUser(object);
        const userId = (await liveUser(deps, claimed)) ?? (await userFor(deps, customerId));
        if (!userId) {
            // Paid, but the account is gone (deleted while Checkout was open): don't keep charging.
            if (subscriptionId) await (await deps.stripe.api()).subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
            logEvent('billing.checkout_without_account', { cancelled: Boolean(subscriptionId) });
            return 'ignored';
        }
        await ents.ensure(userId, now);
        if (customerId && (await ents.get(userId))?.stripeCustomerId !== customerId) await ents.linkCustomer(userId, customerId, event.livemode);
        if (subscriptionId) await syncSubscription(deps, userId, subscriptionId);
        return 'applied';
    }

    if (event.type.startsWith('customer.subscription.')) {
        const subscriptionId = String(object.id);
        const userId = await userFor(deps, stripeId(object.customer as string | null), metadataUser(object));
        if (!userId) return 'ignored';
        await syncSubscription(deps, userId, subscriptionId);
        return 'applied';
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
        const userId = await userFor(deps, stripeId(object.customer as string | null));
        if (!userId) return 'ignored';
        const failedAt = event.type === 'invoice.payment_failed' ? iso(event.created) ?? now.toISOString() : null;
        const mark = (r: EntitlementRecord): EntitlementRecord => ({ ...r, paymentFailedAt: failedAt });
        const subscriptionId = invoiceSubscription(object);
        if (subscriptionId) await syncSubscription(deps, userId, subscriptionId, mark);
        else {
            await ents.ensure(userId, now);
            await ents.update(userId, mark);
        }
        return 'applied';
    }
    return 'ignored';
}

export async function postWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
    const { config } = deps.stripe;
    if (!config.ok) {
        logError('stripe-webhook', new Error(config.ownerMessage));
        return json(503, { error: 'Billing is not configured', code: 'billing_unavailable' });
    }
    const secret = config.settings.webhookSecret;
    if (!secret) {
        logError('stripe-webhook', new Error('No webhook signing secret (STRIPE_TEST_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET)'));
        return json(503, { error: 'Billing is not configured', code: 'billing_unavailable' });
    }
    const signature = request.headers.get('stripe-signature');
    if (!signature) return json(400, { error: 'Missing Stripe-Signature header', code: 'invalid_signature' });
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { error: 'Body too large', code: 'payload_too_large' });
    // The exact bytes Stripe signed: never parse and re-serialize before verifying.
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return json(413, { error: 'Body too large', code: 'payload_too_large' });

    let event: StripeEventLike;
    try {
        event = await deps.stripe.verifyWebhook(raw, signature, secret);
    } catch {
        return json(400, { error: 'Invalid signature', code: 'invalid_signature' });
    }
    if (event.livemode !== (config.settings.mode === 'live')) {
        logEvent('billing.webhook_wrong_mode', { type: event.type, livemode: event.livemode });
        return json(200, { received: true, ignored: true });
    }
    if (!HANDLED.has(event.type)) return json(200, { received: true, ignored: true });

    const ents = new EntitlementStore(deps.table);
    if (await ents.eventProcessed(event.id)) return json(200, { received: true, duplicate: true });
    try {
        const outcome = await handleStripeEvent(event, deps);
        await ents.markEventProcessed(event.id, event.type);
        logEvent('billing.webhook', { type: event.type, outcome });
        return json(200, { received: true });
    } catch (err) {
        logError(`stripe-webhook ${event.type}`, err);
        return json(500, { error: 'Could not process the event; Stripe will retry', code: 'internal_error' });
    }
}
