import { AccountError } from '@/lib/auth/http';
import { logError, logEvent } from '@/lib/auth/log';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import type { SingleTable } from '@/lib/user-store/table';
import type { StripeProvider } from './stripe-client';

/**
 * Account deletion cancels the subscription first (docs/STRIPE_PLAN.md §8). If that
 * can't be done, deletion stops: deleting the account would leave a subscription
 * charging someone we no longer know about. Called by DELETE /api/account before
 * anything is removed.
 */

export const CANCEL_FAILED_MESSAGE = 'We couldn\'t cancel your Plus subscription, so your account hasn\'t been deleted. '
    + 'Please try again in a few minutes, or cancel it first under Manage subscription.';

const ENDED = new Set(['canceled', 'incomplete_expired']);

export async function cancelSubscriptionForDeletion(table: SingleTable, stripe: StripeProvider | undefined, userId: string): Promise<'none' | 'cancelled'> {
    const ents = new EntitlementStore(table);
    const record = await ents.get(userId);
    if (!record?.subscriptionId || !record.subscriptionStatus || ENDED.has(record.subscriptionStatus)) return 'none';

    const config = stripe?.config;
    if (!stripe || !config?.ok) {
        logError('account-delete', new Error(`Can't cancel a subscription: ${config && !config.ok ? config.ownerMessage : 'Stripe is not set up'}`));
        throw new AccountError(503, 'subscription_cancel_failed', CANCEL_FAILED_MESSAGE);
    }
    if (Boolean(record.stripeLivemode) !== (config.settings.mode === 'live')) {
        logError('account-delete', new Error(`The subscription is in Stripe ${record.stripeLivemode ? 'live' : 'test'} mode, but STRIPE_MODE=${config.settings.mode}`));
        throw new AccountError(503, 'subscription_cancel_failed', CANCEL_FAILED_MESSAGE);
    }
    try {
        const api = await stripe.api();
        await api.subscriptions.cancel(record.subscriptionId, { prorate: false, invoice_now: false });
    } catch (err) {
        // Already gone on Stripe's side is what we wanted anyway.
        if ((err as { code?: string })?.code !== 'resource_missing') {
            logError('account-delete stripe', err);
            throw new AccountError(502, 'subscription_cancel_failed', CANCEL_FAILED_MESSAGE);
        }
    }
    await ents.update(userId, r => ({ ...r, subscriptionStatus: 'canceled', cancelAtPeriodEnd: false }));
    logEvent('billing.cancelled_for_deletion');
    return 'cancelled';
}
