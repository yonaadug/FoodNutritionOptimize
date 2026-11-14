import { createHmac } from 'node:crypto';
import { verifyStripeSignature, type StripeApi, type StripeProvider, type StripeSubscriptionLike } from '../stripe-client';
import { loadStripeConfig } from '../stripe-config';

/**
 * Test doubles for Stripe. Nothing here talks to Stripe: the API is an in-memory fake,
 * and webhook payloads are signed locally with Stripe's documented scheme
 * (https://docs.stripe.com/webhooks#verify-manually): the header is
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with the endpoint secret>`.
 * Verification then runs through the real SDK's `Stripe.webhooks.constructEvent`.
 */

export const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only';

export const TEST_ENV = {
    STRIPE_MODE: 'test',
    STRIPE_TEST_SECRET_KEY: 'sk_test_fake_never_sent_anywhere',
    STRIPE_TEST_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_TEST_PRICE_PLUS_MONTHLY: 'price_test_monthly',
    STRIPE_TEST_PRICE_PLUS_ANNUAL: 'price_test_annual',
};

export function signatureHeader(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
    const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
    return `t=${timestamp},v1=${v1}`;
}

let seq = 0;
const next = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}`;

export function subscription(fields: Partial<StripeSubscriptionLike> & { customer: string; interval?: 'month' | 'year'; periodEnd?: number }): StripeSubscriptionLike {
    const { interval = 'month', periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400, ...rest } = fields;
    return {
        id: next('sub'),
        object: 'subscription',
        status: 'active',
        livemode: false,
        cancel_at_period_end: false,
        cancel_at: null,
        items: { data: [{ current_period_end: periodEnd, price: { id: interval === 'month' ? 'price_test_monthly' : 'price_test_annual', recurring: { interval } } }] },
        metadata: {},
        ...rest,
    };
}

export function event(type: string, object: Record<string, unknown>, extra: { id?: string; livemode?: boolean; created?: number } = {}) {
    return {
        id: extra.id ?? next('evt'),
        object: 'event',
        api_version: '2026-10-28.endive',
        created: extra.created ?? Math.floor(Date.now() / 1000),
        livemode: extra.livemode ?? false,
        type,
        data: { object },
    };
}

export interface FakeStripe {
    provider: StripeProvider;
    subscriptions: Map<string, StripeSubscriptionLike>;
    calls: { method: string; args: unknown[] }[];
    /** Make the next calls of a method throw this error. */
    failures: Map<string, unknown>;
    count(method: string): number;
}

export function fakeStripe(env: Record<string, string | undefined> = TEST_ENV): FakeStripe {
    const subscriptions = new Map<string, StripeSubscriptionLike>();
    const calls: FakeStripe['calls'] = [];
    const failures = new Map<string, unknown>();
    const record = (method: string, ...args: unknown[]) => {
        calls.push({ method, args });
        if (failures.has(method)) throw failures.get(method);
    };
    const customers = new Map<string, string>();
    const api: StripeApi = {
        customers: {
            create: async (params, options) => {
                record('customers.create', params, options);
                const key = options?.idempotencyKey ?? next('idem');
                if (!customers.has(key)) customers.set(key, next('cus'));
                return { id: customers.get(key)!, livemode: false };
            },
        },
        checkout: {
            sessions: {
                create: async params => {
                    record('checkout.sessions.create', params);
                    const id = next('cs_test');
                    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
                },
            },
        },
        billingPortal: {
            sessions: {
                create: async params => {
                    record('billingPortal.sessions.create', params);
                    return { url: `https://billing.stripe.com/p/session/${next('bps')}` };
                },
            },
        },
        subscriptions: {
            retrieve: async id => {
                record('subscriptions.retrieve', id);
                const sub = subscriptions.get(id);
                if (!sub) throw Object.assign(new Error('No such subscription'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
                return structuredClone(sub);
            },
            cancel: async (id, params) => {
                record('subscriptions.cancel', id, params);
                const sub = subscriptions.get(id);
                if (!sub) throw Object.assign(new Error('No such subscription'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
                sub.status = 'canceled';
                return structuredClone(sub);
            },
        },
    };
    const config = loadStripeConfig(env);
    return {
        provider: {
            config,
            api: async () => {
                if (!config.ok) throw new Error('api() called while Stripe is off');
                calls.push({ method: 'api', args: [] });
                return api;
            },
            verifyWebhook: verifyStripeSignature,
        },
        subscriptions,
        calls,
        failures,
        count: method => calls.filter(c => c.method === method).length,
    };
}

export function webhookRequest(payload: string, header: string | null = signatureHeader(payload)): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (header !== null) headers['stripe-signature'] = header;
    return new Request('http://localhost:3604/api/stripe/webhook', { method: 'POST', headers, body: payload });
}
