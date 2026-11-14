import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backends, harnessOn, signIn, type Harness } from '@/lib/auth/testing/harness';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import { entitlementsFor } from './entitlements';
import { createStripeProvider } from './stripe-client';
import { event, fakeStripe, signatureHeader, subscription, TEST_ENV, WEBHOOK_SECRET, webhookRequest, type FakeStripe } from './testing/fake-stripe';
import { applySubscription, postWebhook } from './webhook';

const DAY = 86_400_000;

for (const backend of backends) {
    describe(`Stripe webhook: ${backend.name}`, () => {
        let h: Harness;
        let stripe: FakeStripe;
        let ents: EntitlementStore;
        let n = 0;

        before(async () => {
            const { table, close } = await backend.start();
            h = { ...harnessOn(table), close };
            ents = new EntitlementStore(table);
        });
        after(() => h.close());

        const deps = () => ({ table: h.table, store: h.store, stripe: stripe.provider });
        const deliver = async (evt: object, header?: string | null) => {
            const payload = JSON.stringify(evt);
            return postWebhook(webhookRequest(payload, header === undefined ? signatureHeader(payload) : header), deps());
        };
        /** A signed-in account whose trial ended long ago, so only a subscription makes it Plus. */
        const account = async () => {
            stripe = fakeStripe();
            const email = `hook${++n}@example.com`;
            const cookie = await signIn(h, email);
            const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie }) }))!.user.id;
            await ents.ensure(userId, new Date(Date.now() - 60 * DAY));
            return userId;
        };
        const planOf = async (userId: string) => entitlementsFor((await ents.get(userId))!, new Date());
        const checkoutCompleted = (userId: string, customer: string, sub: string) => event('checkout.session.completed', {
            id: 'cs_test_1', object: 'checkout.session', mode: 'subscription', client_reference_id: userId, customer, subscription: sub, metadata: { userId },
        });

        it('refuses a missing, wrong, tampered or stale signature', async () => {
            await account();
            const evt = event('customer.subscription.updated', { id: 'sub_x', customer: 'cus_x' });
            const payload = JSON.stringify(evt);
            assert.equal((await deliver(evt, null)).status, 400, 'no header');
            assert.equal((await deliver(evt, signatureHeader(payload, 'whsec_wrong'))).status, 400, 'wrong secret');
            assert.equal((await postWebhook(webhookRequest(payload.replace('sub_x', 'sub_y'), signatureHeader(payload)), deps())).status, 400, 'tampered body');
            assert.equal((await deliver(evt, signatureHeader(payload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600))).status, 400, 'replayed after 10 minutes');
            assert.equal((await deliver(evt, 't=1,v1=00')).status, 400, 'garbage');
            assert.equal(stripe.count('subscriptions.retrieve'), 0, 'nothing was processed');
        });

        it('checkout.session.completed links the customer and turns on Plus', async () => {
            const userId = await account();
            const sub = subscription({ customer: 'cus_c1', interval: 'year' });
            stripe.subscriptions.set(sub.id, sub);
            const res = await deliver(checkoutCompleted(userId, 'cus_c1', sub.id));
            assert.equal(res.status, 200);
            assert.equal((await planOf(userId)).plan, 'plus');
            const record = await ents.get(userId);
            assert.equal(record?.stripeCustomerId, 'cus_c1');
            assert.equal(record?.interval, 'year');
            assert.equal(record?.currentPeriodEnd, new Date(sub.items!.data![0].current_period_end! * 1000).toISOString());
            assert.equal(await ents.userIdForCustomer('cus_c1'), userId);
        });

        it('is idempotent: a redelivered event is skipped', async () => {
            const userId = await account();
            const sub = subscription({ customer: 'cus_c2' });
            stripe.subscriptions.set(sub.id, sub);
            const evt = checkoutCompleted(userId, 'cus_c2', sub.id);
            assert.equal((await deliver(evt)).status, 200);
            const second = await deliver(evt);
            assert.equal(second.status, 200);
            assert.equal((await second.json()).duplicate, true);
            assert.equal(stripe.count('subscriptions.retrieve'), 1);
        });

        it('subscription events re-read the subscription, so order doesn\'t matter', async () => {
            const userId = await account();
            await ents.linkCustomer(userId, 'cus_c3', false);
            const sub = subscription({ customer: 'cus_c3', metadata: { userId } });
            stripe.subscriptions.set(sub.id, sub);
            assert.equal((await deliver(event('customer.subscription.created', sub))).status, 200);
            assert.equal((await planOf(userId)).plan, 'plus');

            // Cancelled in the portal: still Plus until the period ends.
            stripe.subscriptions.get(sub.id)!.cancel_at_period_end = true;
            await deliver(event('customer.subscription.updated', stripe.subscriptions.get(sub.id)!));
            const cancelling = await planOf(userId);
            assert.equal(cancelling.plan, 'plus');
            assert.equal(cancelling.subscription?.cancelAtPeriodEnd, true);

            // The period ends. A late, stale "updated: active" event can't bring Plus back.
            const stale = event('customer.subscription.updated', { ...sub, status: 'active' });
            stripe.subscriptions.get(sub.id)!.status = 'canceled';
            await deliver(event('customer.subscription.deleted', stripe.subscriptions.get(sub.id)!));
            assert.equal((await planOf(userId)).plan, 'free');
            await deliver(stale);
            assert.equal((await planOf(userId)).plan, 'free');
        });

        it('finds the account by subscription metadata when the pointer is missing', async () => {
            const userId = await account();
            const sub = subscription({ customer: 'cus_unlinked', metadata: { userId } });
            stripe.subscriptions.set(sub.id, sub);
            await deliver(event('customer.subscription.created', sub));
            assert.equal((await planOf(userId)).plan, 'plus');
        });

        it('invoice.payment_failed flags the card; past_due keeps Plus for the grace period; invoice.paid clears it', async () => {
            const userId = await account();
            await ents.linkCustomer(userId, 'cus_c4', false);
            const sub = subscription({ customer: 'cus_c4', status: 'past_due' });
            stripe.subscriptions.set(sub.id, sub);
            const invoice = { id: 'in_1', object: 'invoice', customer: 'cus_c4', parent: { type: 'subscription_details', subscription_details: { subscription: sub.id } } };
            await deliver(event('invoice.payment_failed', invoice));
            const failing = await planOf(userId);
            assert.equal(failing.plan, 'plus', 'grace period');
            assert.equal(failing.subscription?.paymentProblem, true);
            const record = (await ents.get(userId))!;
            assert.equal(entitlementsFor(record, new Date(Date.now() + 4 * DAY)).plan, 'free', 'grace ends after 3 days');

            stripe.subscriptions.get(sub.id)!.status = 'active';
            await deliver(event('invoice.paid', invoice));
            const paid = await planOf(userId);
            assert.equal(paid.plan, 'plus');
            assert.equal(paid.subscription?.paymentProblem, false);
            assert.equal((await ents.get(userId))?.pastDueSince, null);
        });

        it('reads the subscription from an invoice in the older API shape too', async () => {
            const userId = await account();
            await ents.linkCustomer(userId, 'cus_c5', false);
            const sub = subscription({ customer: 'cus_c5' });
            stripe.subscriptions.set(sub.id, sub);
            await deliver(event('invoice.paid', { id: 'in_2', object: 'invoice', customer: 'cus_c5', subscription: sub.id }));
            assert.equal((await planOf(userId)).plan, 'plus');
        });

        it('a failure is a 500 and isn\'t marked processed, so Stripe\'s retry applies it', async () => {
            const userId = await account();
            const sub = subscription({ customer: 'cus_c6' });
            stripe.subscriptions.set(sub.id, sub);
            stripe.failures.set('subscriptions.retrieve', Object.assign(new Error('boom'), { type: 'StripeConnectionError' }));
            const evt = checkoutCompleted(userId, 'cus_c6', sub.id);
            assert.equal((await deliver(evt)).status, 500);
            stripe.failures.clear();
            assert.equal((await deliver(evt)).status, 200);
            assert.equal((await planOf(userId)).plan, 'plus');
        });

        it('acknowledges events it doesn\'t handle, and events from the other mode, without acting', async () => {
            const userId = await account();
            assert.equal((await deliver(event('customer.created', { id: 'cus_z' }))).status, 200);
            const sub = subscription({ customer: 'cus_c7', metadata: { userId } });
            stripe.subscriptions.set(sub.id, sub);
            const res = await deliver(event('customer.subscription.created', sub, { livemode: true }));
            assert.equal(res.status, 200);
            assert.equal((await res.json()).ignored, true);
            assert.equal((await planOf(userId)).plan, 'free');
        });

        it('cancels a subscription paid for by an account that was deleted meanwhile', async () => {
            await account();
            const sub = subscription({ customer: 'cus_gone' });
            stripe.subscriptions.set(sub.id, sub);
            const res = await deliver(checkoutCompleted('user_that_does_not_exist', 'cus_gone', sub.id));
            assert.equal(res.status, 200);
            assert.equal(stripe.count('subscriptions.cancel'), 1);
            assert.equal(stripe.subscriptions.get(sub.id)?.status, 'canceled');
        });

        it('answers 503 when billing is off, and never builds a client for a live key on a laptop', async () => {
            await account();
            const evt = event('customer.subscription.created', subscription({ customer: 'cus_q' }));
            const payload = JSON.stringify(evt);
            const off = await postWebhook(webhookRequest(payload), { table: h.table, store: h.store, stripe: createStripeProvider({}) });
            assert.equal(off.status, 503);
            const live = createStripeProvider({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fake', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, NODE_ENV: 'development' });
            assert.equal((await postWebhook(webhookRequest(payload), { table: h.table, store: h.store, stripe: live })).status, 503);
            const noSecret = fakeStripe({ ...TEST_ENV, STRIPE_TEST_WEBHOOK_SECRET: '' });
            assert.equal((await postWebhook(webhookRequest(payload), { table: h.table, store: h.store, stripe: noSecret.provider })).status, 503);
        });
    });
}

describe('applySubscription', () => {
    const now = new Date('2026-11-20T00:00:00.000Z');
    const base = { trialStartedAt: '2026-01-01T00:00:00.000Z' };

    it('keeps the first past_due time across repeated updates', () => {
        const sub = subscription({ customer: 'c', status: 'past_due' });
        const first = applySubscription(base, sub, now);
        assert.equal(first.pastDueSince, now.toISOString());
        const again = applySubscription(first, sub, new Date('2026-11-21T00:00:00.000Z'));
        assert.equal(again.pastDueSince, now.toISOString());
        assert.equal(applySubscription(again, { ...sub, status: 'active' }, now).pastDueSince, null);
    });

    it('never swaps a working subscription for a dead second one', () => {
        const live = applySubscription(base, subscription({ customer: 'c', id: 'sub_a' }), now);
        const dead = applySubscription(live, subscription({ customer: 'c', id: 'sub_b', status: 'incomplete_expired' }), now);
        assert.equal(dead.subscriptionId, 'sub_a');
        const replaced = applySubscription({ ...live, subscriptionStatus: 'canceled' }, subscription({ customer: 'c', id: 'sub_b' }), now);
        assert.equal(replaced.subscriptionId, 'sub_b');
    });

    it('reads the period end from the item, falling back to the subscription', () => {
        const sub = subscription({ customer: 'c', periodEnd: 1_800_000_000 });
        assert.equal(applySubscription(base, sub, now).currentPeriodEnd, new Date(1_800_000_000_000).toISOString());
        const old = { ...sub, items: { data: [{ price: { id: 'p', recurring: { interval: 'month' } } }] }, current_period_end: 1_700_000_000 };
        assert.equal(applySubscription(base, old, now).currentPeriodEnd, new Date(1_700_000_000_000).toISOString());
    });
});
