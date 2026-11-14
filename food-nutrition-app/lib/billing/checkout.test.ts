import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteAccount, getHistory, getMe, type AccountDeps } from '@/lib/auth/handlers';
import { toErrorResponse } from '@/lib/auth/http';
import { backends, harnessOn, signIn, siteRequest, type Harness } from '@/lib/auth/testing/harness';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import { postCheckout, postPortal, type BillingDeps } from './checkout';
import { CANCEL_FAILED_MESSAGE } from './cancel';
import { requireFeature } from './gate';
import { createStripeProvider } from './stripe-client';
import { BILLING_OFF_MESSAGE } from './stripe-config';
import { fakeStripe, subscription, type FakeStripe } from './testing/fake-stripe';

type Handler = (request: Request, deps: BillingDeps) => Promise<Response>;

async function call(deps: AccountDeps, handler: Handler | ((r: Request, d: AccountDeps) => Promise<Response>), request: Request): Promise<Response> {
    try {
        return await (handler as Handler)(request, deps as BillingDeps);
    } catch (err) {
        return toErrorResponse(err, 'test');
    }
}

const DAY = 86_400_000;

for (const backend of backends) {
    describe(`billing routes: ${backend.name}`, () => {
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

        const newUser = async (provider?: FakeStripe) => {
            stripe = provider ?? fakeStripe();
            const email = `buyer${++n}@example.com`;
            const cookie = await signIn(h, email);
            const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie }) }))!.user.id;
            return { email, cookie, userId, deps: { ...h, stripe: stripe.provider } as BillingDeps };
        };
        const checkout = (deps: AccountDeps, cookie: string | undefined, body: unknown = { interval: 'month' }, headers?: Record<string, string>) =>
            call(deps, postCheckout, siteRequest('/api/stripe/checkout', { method: 'POST', cookie, body, headers }));
        const portal = (deps: AccountDeps, cookie: string) => call(deps, postPortal, siteRequest('/api/stripe/portal', { method: 'POST', cookie, body: {} }));
        const remove = (deps: AccountDeps, cookie: string, email: string) => call(deps, deleteAccount, siteRequest('/api/account', { method: 'DELETE', cookie, body: { confirmEmail: email } }));
        const makePlus = async (userId: string) => {
            await ents.ensure(userId);
            await ents.linkCustomer(userId, `cus_${userId}`, false);
            const sub = subscription({ customer: `cus_${userId}` });
            stripe.subscriptions.set(sub.id, sub);
            await ents.update(userId, r => ({ ...r, subscriptionId: sub.id, subscriptionStatus: 'active' }));
            return sub;
        };

        it('Checkout needs a session and a same-site request', async () => {
            const { deps, cookie } = await newUser();
            assert.equal((await checkout(deps, undefined)).status, 401);
            assert.equal((await checkout(deps, cookie, { interval: 'month' }, { origin: 'https://evil.example' })).status, 403);
            assert.equal((await checkout(deps, cookie, { interval: 'week' })).status, 400);
            assert.equal(stripe.count('api'), 0);
        });

        it('starts Checkout for the chosen price with our customer, created once', async () => {
            const { deps, cookie, userId, email } = await newUser();
            const res = await checkout(deps, cookie, { interval: 'year' });
            assert.equal(res.status, 200);
            assert.match((await res.json()).url, /^https:\/\/checkout\.stripe\.com\//);
            const created = stripe.calls.find(c => c.method === 'customers.create')!;
            assert.deepEqual(created.args[0], { email, metadata: { userId } });
            assert.match(String((created.args[1] as { idempotencyKey: string }).idempotencyKey), /^nd-customer-test-/);
            const params = stripe.calls.find(c => c.method === 'checkout.sessions.create')!.args[0] as Record<string, any>;
            assert.equal(params.mode, 'subscription');
            assert.equal(params.client_reference_id, userId);
            assert.equal(params.customer, (await ents.get(userId))?.stripeCustomerId);
            assert.deepEqual(params.line_items, [{ price: 'price_test_annual', quantity: 1 }]);
            assert.equal(params.subscription_data.metadata.userId, userId);
            assert.equal(params.success_url, 'http://localhost:3604/plus/welcome?session_id={CHECKOUT_SESSION_ID}');
            assert.equal(params.cancel_url, 'http://localhost:3604/plus');
            assert.equal(params.customer_email, undefined, 'customer, not customer_email');

            await checkout(deps, cookie, { interval: 'month' });
            assert.equal(stripe.count('customers.create'), 1, 'the second Checkout reuses the customer');
            const second = stripe.calls.filter(c => c.method === 'checkout.sessions.create')[1].args[0] as Record<string, any>;
            assert.deepEqual(second.line_items, [{ price: 'price_test_monthly', quantity: 1 }]);
            assert.equal((await ents.get(userId))?.subscriptionStatus, undefined, 'Checkout alone changes nothing');
        });

        it('won\'t sell Plus twice', async () => {
            const { deps, cookie, userId } = await newUser();
            await makePlus(userId);
            const res = await checkout(deps, cookie);
            assert.equal(res.status, 409);
            assert.equal((await res.json()).code, 'conflict');
        });

        it('with billing not set up, says so and calls nothing', async () => {
            const { deps, cookie } = await newUser(fakeStripe({}));
            const res = await checkout(deps, cookie);
            assert.equal(res.status, 503);
            const body = await res.json();
            assert.equal(body.code, 'billing_unavailable');
            assert.equal(body.error, BILLING_OFF_MESSAGE);
            assert.equal(stripe.count('api'), 0);
        });

        it('the live-key guard: a live key on a laptop never reaches Stripe', async () => {
            const { cookie } = await newUser();
            for (const env of [
                { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fake', STRIPE_PRICE_PLUS_MONTHLY: 'price_live' },
                { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_fake', STRIPE_PRICE_PLUS_MONTHLY: 'price_live', NODE_ENV: 'production' },
                { STRIPE_MODE: 'test', STRIPE_TEST_SECRET_KEY: 'sk_live_fake', STRIPE_TEST_PRICE_PLUS_MONTHLY: 'price_live' },
            ]) {
                const live = fakeStripe(env);
                const res = await checkout({ ...h, stripe: live.provider } as BillingDeps, cookie);
                assert.equal(res.status, 503, JSON.stringify(env));
                assert.equal(live.count('api'), 0, 'no client was built');
                // And the real provider refuses to build a client at all.
                await assert.rejects(createStripeProvider(env).api());
            }
        });

        it('a missing price for one interval is a clear 503', async () => {
            const { cookie } = await newUser();
            const half = fakeStripe({ STRIPE_MODE: 'test', STRIPE_TEST_SECRET_KEY: 'sk_test_x', STRIPE_TEST_PRICE_PLUS_MONTHLY: 'price_m' });
            const res = await checkout({ ...h, stripe: half.provider } as BillingDeps, cookie, { interval: 'year' });
            assert.equal(res.status, 503);
        });

        it('a Stripe error is a friendly 502', async () => {
            const { deps, cookie } = await newUser();
            stripe.failures.set('checkout.sessions.create', Object.assign(new Error('api_key sk_test_... invalid'), { type: 'StripeAuthenticationError' }));
            const res = await checkout(deps, cookie);
            assert.equal(res.status, 502);
            assert.doesNotMatch((await res.json()).error, /sk_test/);
        });

        it('the portal opens for a customer and returns to /account', async () => {
            const { deps, cookie, userId } = await newUser();
            assert.equal((await portal(deps, cookie)).status, 409, 'nothing to manage yet');
            await makePlus(userId);
            const res = await portal(deps, cookie);
            assert.equal(res.status, 200);
            assert.match((await res.json()).url, /^https:\/\/billing\.stripe\.com\//);
            const params = stripe.calls.find(c => c.method === 'billingPortal.sessions.create')!.args[0] as Record<string, string>;
            assert.equal(params.customer, `cus_${userId}`);
            assert.equal(params.return_url, 'http://localhost:3604/account');
        });

        it('/api/me tells the browser the plan, starting the trial on first sight', async () => {
            const { deps, cookie } = await newUser();
            const { user } = await (await call(deps, getMe, siteRequest('/api/me', { cookie }))).json();
            assert.equal(user.plan.plan, 'trial');
            assert.equal(user.plan.trial.daysLeft, 14);
            assert.deepEqual(user.plan.photo, { limit: 10, used: 0, remaining: 10, period: 'trial', resetsAt: null });
            assert.equal(user.plan.historyLimit, null);
            assert.equal(user.plan.billingAvailable, true);
            assert.equal(JSON.stringify(user.plan).includes('cus_'), false, 'no Stripe ids');
            const off = await (await call({ ...h }, getMe, siteRequest('/api/me', { cookie }))).json();
            assert.equal(off.user.plan.billingAvailable, false);
        });

        it('history: free sees the newest 5 plans and can\'t open older ones; the export has them all', async () => {
            const { deps, cookie, userId } = await newUser();
            await ents.ensure(userId, new Date(Date.now() - 30 * DAY));
            for (let i = 1; i <= 7; i++) {
                await h.store.upsertHistory(userId, { kind: 'plan', itemId: `p${i}`, title: `Plan ${i}`, href: `/plan?open=p${i}` });
                await new Promise(r => setTimeout(r, 3));
            }
            const list = await (await call(deps, getHistory, siteRequest('/api/history?kind=plan&limit=20', { cookie }))).json();
            assert.deepEqual(list.items.map((i: { itemId: string }) => i.itemId), ['p7', 'p6', 'p5', 'p4', 'p3']);
            assert.deepEqual(list.limited, { limit: 5, hidden: 2 });
            const hidden = await call(deps, getHistory, siteRequest('/api/history?kind=plan&itemId=p1', { cookie }));
            assert.equal(hidden.status, 403);
            assert.equal((await hidden.json()).code, 'plus_required');
            assert.equal((await h.store.exportAccount(userId)).history.length, 7);

            await makePlus(userId);
            const all = await (await call(deps, getHistory, siteRequest('/api/history?kind=plan&limit=20', { cookie }))).json();
            assert.equal(all.items.length, 7, 'upgrading brings them back');
            assert.equal((await call(deps, getHistory, siteRequest('/api/history?kind=plan&itemId=p1', { cookie }))).status, 200);
        });

        it('requireFeature: 401 signed out, 403 on free, through on the trial and Plus', async () => {
            const { deps, cookie, userId } = await newUser();
            const gate = (c?: string) => call(deps, async (r, d) => {
                await requireFeature(r, d, 'weekPlanner');
                return Response.json({ ok: true });
            }, siteRequest('/api/week', { cookie: c }));
            assert.equal((await gate()).status, 401);
            assert.equal((await gate(cookie)).status, 200, 'trial');
            await ents.update(userId, r => ({ ...r, trialStartedAt: new Date(Date.now() - 15 * DAY).toISOString() }));
            const free = await gate(cookie);
            assert.equal(free.status, 403);
            assert.deepEqual(await free.json(), { error: 'The week planner is part of Plus.', code: 'plus_required', details: { feature: 'weekPlanner' } });
            await makePlus(userId);
            assert.equal((await gate(cookie)).status, 200, 'Plus');
        });

        // ---- account deletion cancels the subscription first ----

        it('deletion cancels an active subscription, then deletes', async () => {
            const { deps, cookie, userId, email } = await newUser();
            const sub = await makePlus(userId);
            const res = await remove(deps, cookie, email);
            assert.equal(res.status, 200);
            const cancel = stripe.calls.find(c => c.method === 'subscriptions.cancel')!;
            assert.equal(cancel.args[0], sub.id);
            assert.equal(stripe.subscriptions.get(sub.id)?.status, 'canceled');
            assert.equal(await h.store.getProfile(userId), null);
            assert.equal(await ents.userIdForCustomer(`cus_${userId}`), null);
        });

        it('if cancelling fails, nothing is deleted and the message says why', async () => {
            const { deps, cookie, userId, email } = await newUser();
            await makePlus(userId);
            stripe.failures.set('subscriptions.cancel', Object.assign(new Error('timeout'), { type: 'StripeConnectionError' }));
            const res = await remove(deps, cookie, email);
            assert.equal(res.status, 502);
            const body = await res.json();
            assert.equal(body.code, 'subscription_cancel_failed');
            assert.equal(body.error, CANCEL_FAILED_MESSAGE);
            assert.ok(await h.store.getProfile(userId), 'the account is still there');
            assert.equal((await call(deps, getMe, siteRequest('/api/me', { cookie })).then(r => r.json())).user.id, userId, 'still signed in');
        });

        it('with billing off, an account with a subscription isn\'t deleted', async () => {
            const { cookie, userId, email } = await newUser();
            await makePlus(userId);
            const res = await remove({ ...h }, cookie, email);
            assert.equal(res.status, 503);
            assert.ok(await h.store.getProfile(userId));
        });

        it('a subscription already gone at Stripe doesn\'t block deletion', async () => {
            const { deps, cookie, userId, email } = await newUser();
            const sub = await makePlus(userId);
            stripe.subscriptions.delete(sub.id);
            assert.equal((await remove(deps, cookie, email)).status, 200);
            assert.equal(await h.store.getProfile(userId), null);
        });

        it('no subscription (or a cancelled one): deletion never calls Stripe', async () => {
            const { deps, cookie, userId, email } = await newUser();
            await ents.ensure(userId);
            await ents.update(userId, r => ({ ...r, subscriptionId: 'sub_old', subscriptionStatus: 'canceled' }));
            assert.equal((await remove(deps, cookie, email)).status, 200);
            assert.equal(stripe.count('api'), 0);
            const other = await newUser();
            assert.equal((await remove({ ...h }, other.cookie, other.email)).status, 200, 'billing off is fine without a subscription');
        });
    });
}
