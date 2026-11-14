import { loadStripeConfig, type StripeConfig } from './stripe-config';

/**
 * The slice of the Stripe API this app uses, as a narrow interface so tests can pass a
 * fake (no test ever calls Stripe). The real client is built lazily, only after the
 * configuration (and with it the live-key guard) has said yes, and the SDK is imported
 * dynamically, so pages that never bill never load it. Server only.
 */

type Id = string | { id: string } | null | undefined;

export interface StripeSubscriptionLike {
    id: string;
    object?: 'subscription';
    customer: Id;
    status: string;
    livemode?: boolean;
    cancel_at_period_end?: boolean | null;
    cancel_at?: number | null;
    /** Older API versions only; newer ones have it on each item. */
    current_period_end?: number | null;
    items?: { data?: { current_period_end?: number | null; price?: { id?: string; recurring?: { interval?: string } | null } | null }[] };
    metadata?: Record<string, string> | null;
}

export interface StripeEventLike {
    id: string;
    type: string;
    created: number;
    livemode: boolean;
    data: { object: Record<string, unknown> };
}

export interface StripeApi {
    customers: {
        create(params: { email: string; metadata: Record<string, string> }, options?: { idempotencyKey?: string }): Promise<{ id: string; livemode?: boolean }>;
    };
    checkout: {
        sessions: { create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }> };
    };
    billingPortal: {
        sessions: { create(params: { customer: string; return_url: string; configuration?: string }): Promise<{ url: string }> };
    };
    subscriptions: {
        retrieve(id: string): Promise<StripeSubscriptionLike>;
        cancel(id: string, params?: Record<string, unknown>): Promise<StripeSubscriptionLike>;
    };
}

export interface StripeProvider {
    config: StripeConfig;
    /** The client. Only call when `config.ok`; it throws otherwise. */
    api(): Promise<StripeApi>;
    /** Check the Stripe-Signature header on the raw body and return the event. Throws on a bad signature. */
    verifyWebhook(rawBody: string, signature: string, secret: string): Promise<StripeEventLike>;
}

/** Stripe's documented webhook check (HMAC-SHA256 of "<t>.<body>", 5-minute tolerance), done by the SDK without any request. */
export async function verifyStripeSignature(rawBody: string, signature: string, secret: string): Promise<StripeEventLike> {
    const { default: Stripe } = await import('stripe');
    return Stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEventLike;
}

export function createStripeProvider(env: Record<string, string | undefined> = process.env): StripeProvider {
    const config = loadStripeConfig(env);
    let client: Promise<StripeApi> | null = null;
    return {
        config,
        api() {
            if (!config.ok) return Promise.reject(new Error(`Stripe is off: ${config.ownerMessage}`));
            client ??= import('stripe').then(({ default: Stripe }) => new Stripe(config.settings.secretKey, {
                maxNetworkRetries: 2,
                timeout: 20_000,
                appInfo: { name: 'NutritionDictionary' },
            }) as unknown as StripeApi);
            return client;
        },
        verifyWebhook: verifyStripeSignature,
    };
}

export const stripeId = (value: Id): string | null => (typeof value === 'string' ? value : value?.id ?? null);
