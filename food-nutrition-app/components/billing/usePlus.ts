'use client';

import { apiFetch, useCurrentUser } from '@/lib/auth/client';
import { has, type Feature, type Interval } from '@/lib/billing/entitlements';
import type { PlanSummary } from '@/lib/billing/types';

/**
 * The signed-in person's plan, from the same /api/me answer as useCurrentUser (no extra
 * request). After anything that changes it, call refreshCurrentUser() from lib/auth/client.
 *
 *   const { plan, has, loading } = usePlus();
 *   if (has('weekPlanner')) ...
 */
export function usePlus(): {
    loading: boolean;
    signedIn: boolean;
    plan: PlanSummary | null;
    has: (feature: Feature) => boolean;
} {
    const { user, loading } = useCurrentUser();
    const plan = user?.plan ?? null;
    return { loading, signedIn: Boolean(user), plan, has: feature => has(plan, feature) };
}

/** Failures become an Error with a message fit to show. */
async function billingRedirect(path: string, json: unknown): Promise<never> {
    let res: Response;
    try {
        res = await apiFetch(path, { method: 'POST', json });
    } catch {
        throw new Error('We couldn\'t reach the server. Check your connection and try again.');
    }
    const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !body?.url) throw new Error(body?.error || 'Something went wrong. Please try again.');
    window.location.assign(body.url);
    // The page is leaving; keep the button busy until it does.
    return new Promise<never>(() => {});
}

/** Go to Stripe Checkout for Plus. */
export function startCheckout(interval: Interval): Promise<never> {
    return billingRedirect('/api/stripe/checkout', { interval });
}

/** Go to the Stripe Customer Portal: change plan, cancel, update the card, invoices. */
export function openPortal(): Promise<never> {
    return billingRedirect('/api/stripe/portal', {});
}
