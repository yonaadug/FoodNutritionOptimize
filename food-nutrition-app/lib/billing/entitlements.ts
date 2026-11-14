/**
 * The one source of truth for what a person's plan lets them do. Pure functions of
 * the stored entitlement record and the time, so every rule here is unit-tested and
 * the server, the API and the UI can't disagree.
 *
 *   free   the default. Food pages, contaminant meters, the one-day planner, pasted
 *          recipes and export are always free (docs/DECISIONS.md).
 *   trial  14 days of Plus with no card, from the first time we see the account
 *          (a new account: when it's created; an existing one: its first visit after
 *          this shipped). AI photo reads are capped at 10 in total.
 *   plus   a Stripe subscription that is active or trialing, or past_due for at most
 *          3 days while Stripe retries the card (docs/aws/AWS_HOSTING_DESIGN.md §3.6).
 *
 * Stripe webhooks are the only writer of the subscription fields (lib/billing/webhook.ts).
 */

export type Plan = 'free' | 'trial' | 'plus';

/** What Plus unlocks. The one-day planner and everything else stays free. */
export const FEATURES = ['photoQuota', 'unlimitedHistory', 'weekPlanner', 'planContaminants'] as const;
export type Feature = (typeof FEATURES)[number];

export const TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 3;

/**
 * AI photo reads (docs/STRIPE_PLAN.md "Limits" has the reasoning). Pasted text read by
 * the built-in reader is free and never counted.
 */
export const PHOTO_LIMITS = {
    free: { limit: 3, period: 'month' },
    trial: { limit: 10, period: 'trial' },
    plus: { limit: 50, period: 'month' },
} as const satisfies Record<Plan, { limit: number; period: 'month' | 'trial' }>;

/** Free accounts see this many of their most recent plans and recipes. Older ones are kept. */
export const FREE_HISTORY_LIMIT = 5;
export const LIMITED_HISTORY_KINDS = ['plan', 'recipe'] as const;

export const PRICES = {
    month: { amount: 5.99, label: '$5.99', per: 'month' },
    year: { amount: 39.99, label: '$39.99', per: 'year' },
} as const;
export type Interval = keyof typeof PRICES;

/** Stripe subscription statuses that give Plus outright. */
const GRANTING = new Set(['active', 'trialing']);
const DAY_MS = 86_400_000;

/** The stored record (USER#<id> / ENT). Every field but the trial start is optional. */
export interface EntitlementRecord {
    trialStartedAt: string;
    stripeCustomerId?: string | null;
    /** Whether the customer was created with a live key. A test customer is never used with a live key, and vice versa. */
    stripeLivemode?: boolean | null;
    subscriptionId?: string | null;
    subscriptionStatus?: string | null;
    priceId?: string | null;
    interval?: Interval | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean | null;
    cancelAt?: string | null;
    /** When the subscription was first seen past_due in its current spell. Starts the grace period. */
    pastDueSince?: string | null;
    /** The last failed invoice payment, cleared by the next paid invoice. */
    paymentFailedAt?: string | null;
    updatedAt?: string;
}

export interface Entitlements {
    plan: Plan;
    features: Record<Feature, boolean>;
    trial: { startedAt: string; endsAt: string; daysLeft: number; active: boolean };
    subscription: {
        status: string;
        interval: Interval | null;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
        paymentProblem: boolean;
    } | null;
    /** There's a Stripe customer, so the Customer Portal can open. */
    hasBillingAccount: boolean;
}

export function subscriptionGrantsPlus(record: Pick<EntitlementRecord, 'subscriptionStatus' | 'pastDueSince'>, now: Date): boolean {
    const status = record.subscriptionStatus;
    if (!status) return false;
    if (GRANTING.has(status)) return true;
    if (status === 'past_due' && record.pastDueSince) {
        return now.getTime() < Date.parse(record.pastDueSince) + PAST_DUE_GRACE_DAYS * DAY_MS;
    }
    return false;
}

export function trialEndsAt(record: Pick<EntitlementRecord, 'trialStartedAt'>): Date {
    return new Date(Date.parse(record.trialStartedAt) + TRIAL_DAYS * DAY_MS);
}

export function entitlementsFor(record: EntitlementRecord, now: Date = new Date()): Entitlements {
    const ends = trialEndsAt(record);
    const msLeft = ends.getTime() - now.getTime();
    const trialActive = msLeft > 0;
    const plus = subscriptionGrantsPlus(record, now);
    const plan: Plan = plus ? 'plus' : trialActive ? 'trial' : 'free';
    const unlocked = plan !== 'free';
    const features = Object.fromEntries(FEATURES.map(f => [f, unlocked])) as Record<Feature, boolean>;
    const status = record.subscriptionStatus ?? null;
    return {
        plan,
        features,
        trial: {
            startedAt: record.trialStartedAt,
            endsAt: ends.toISOString(),
            daysLeft: trialActive ? Math.ceil(msLeft / DAY_MS) : 0,
            active: trialActive,
        },
        subscription: record.subscriptionId && status
            ? {
                status,
                interval: record.interval ?? null,
                currentPeriodEnd: record.currentPeriodEnd ?? null,
                cancelAtPeriodEnd: Boolean(record.cancelAtPeriodEnd || record.cancelAt),
                paymentProblem: status === 'past_due' || status === 'unpaid' || Boolean(record.paymentFailedAt),
            }
            : null,
        hasBillingAccount: Boolean(record.stripeCustomerId),
    };
}

export function has(entitlements: Pick<Entitlements, 'features'> | null | undefined, feature: Feature): boolean {
    return Boolean(entitlements?.features[feature]);
}

// ---- photo quota periods ----

/** Months are UTC calendar months for everyone, so a counter means the same thing on every server. */
export function monthKey(now: Date): string {
    return now.toISOString().slice(0, 7);
}

export function nextMonthStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface PhotoAllowance {
    limit: number;
    period: 'month' | 'trial';
    /** Which usage counter this plan draws from. Each plan has its own, so an upgrade starts fresh. */
    counter: string;
    /** When the count starts again; null for the trial, which doesn't reset. */
    resetsAt: string | null;
}

export function photoAllowance(entitlements: Pick<Entitlements, 'plan'>, now: Date = new Date()): PhotoAllowance {
    const { plan } = entitlements;
    const rule = PHOTO_LIMITS[plan];
    if (rule.period === 'trial') return { limit: rule.limit, period: 'trial', counter: 'trial', resetsAt: null };
    return { limit: rule.limit, period: 'month', counter: `${plan}#${monthKey(now)}`, resetsAt: nextMonthStart(now).toISOString() };
}

/** How many plans and recipes this plan shows; null is all of them. */
export function historyLimit(entitlements: Pick<Entitlements, 'features'> | null): number | null {
    return has(entitlements, 'unlimitedHistory') ? null : FREE_HISTORY_LIMIT;
}
