import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backends } from '@/lib/auth/testing/harness';
import { EntitlementStore } from './entitlements';
import type { SingleTable } from './table';
import { UserStore } from './user-store';

const t0 = new Date('2026-11-14T12:00:00.000Z');

for (const backend of backends) {
    describe(`EntitlementStore: ${backend.name}`, () => {
        let table: SingleTable;
        let close: () => Promise<void>;
        let ents: EntitlementStore;
        let n = 0;
        const user = () => `e${++n}`;

        before(async () => {
            ({ table, close } = await backend.start());
            ents = new EntitlementStore(table);
        });
        after(() => close());

        it('has no record until the account is first seen, then starts the trial once', async () => {
            const id = user();
            assert.equal(await ents.get(id), null);
            const first = await ents.ensure(id, t0);
            assert.equal(first.trialStartedAt, t0.toISOString());
            const later = await ents.ensure(id, new Date('2026-12-30T00:00:00.000Z'));
            assert.equal(later.trialStartedAt, t0.toISOString(), 'a second visit never restarts the trial');
        });

        it('concurrent first visits agree on one trial start', async () => {
            const id = user();
            const results = await Promise.all([0, 1, 2, 3].map(i => ents.ensure(id, new Date(t0.getTime() + i * 1000))));
            assert.equal(new Set(results.map(r => r.trialStartedAt)).size, 1);
        });

        it('updates fields with compare-and-set and keeps the rest', async () => {
            const id = user();
            await ents.ensure(id, t0);
            const updated = await ents.update(id, r => ({ ...r, subscriptionId: 'sub_1', subscriptionStatus: 'active', currentPeriodEnd: '2026-12-14T12:00:00.000Z' }));
            assert.equal(updated?.subscriptionStatus, 'active');
            const again = await ents.update(id, r => ({ ...r, cancelAtPeriodEnd: true }));
            assert.equal(again?.subscriptionId, 'sub_1');
            assert.equal(again?.cancelAtPeriodEnd, true);
            assert.equal((await ents.get(id))?.trialStartedAt, t0.toISOString());
            // Concurrent writers both land.
            await Promise.all([
                ents.update(id, r => ({ ...r, priceId: 'price_1' })),
                ents.update(id, r => ({ ...r, interval: 'year' })),
            ]);
            const both = await ents.get(id);
            assert.equal(both?.priceId, 'price_1');
            assert.equal(both?.interval, 'year');
        });

        it('update on a missing record does nothing', async () => {
            assert.equal(await ents.update(user(), r => ({ ...r, subscriptionStatus: 'active' })), null);
        });

        it('links a Stripe customer both ways', async () => {
            const id = user();
            await ents.ensure(id, t0);
            await ents.linkCustomer(id, `cus_${id}`, false);
            assert.equal((await ents.get(id))?.stripeCustomerId, `cus_${id}`);
            assert.equal((await ents.get(id))?.stripeLivemode, false);
            assert.equal(await ents.userIdForCustomer(`cus_${id}`), id);
            assert.equal(await ents.userIdForCustomer('cus_nobody'), null);
        });

        it('counts photo usage per counter, and can give a read back', async () => {
            const id = user();
            assert.equal(await ents.usage(id, 'free#2026-11'), 0);
            assert.equal(await ents.addUsage(id, 'free#2026-11', 1), 1);
            assert.equal(await ents.addUsage(id, 'free#2026-11', 1), 2);
            assert.equal(await ents.addUsage(id, 'free#2026-11', -1), 1);
            assert.equal(await ents.usage(id, 'free#2026-11'), 1);
            assert.equal(await ents.usage(id, 'free#2026-12'), 0, 'a new month is a new counter');
            assert.equal(await ents.usage(id, 'plus#2026-11'), 0, 'each plan has its own counter');
        });

        it('remembers processed Stripe events', async () => {
            const evt = `evt_${user()}`;
            assert.equal(await ents.eventProcessed(evt), false);
            await ents.markEventProcessed(evt, 'customer.subscription.updated');
            assert.equal(await ents.eventProcessed(evt), true);
            await ents.markEventProcessed(evt, 'customer.subscription.updated'); // a second mark is harmless
            assert.equal(await ents.eventProcessed(evt), true);
        });

        it('export includes the plan and usage; deletion removes them and the customer pointer', async () => {
            const store = new UserStore(table);
            const id = user();
            await ents.ensure(id, t0);
            await ents.linkCustomer(id, `cus_${id}`, false);
            await ents.addUsage(id, 'trial', 2);
            const data = await store.exportAccount(id);
            assert.equal(data.plan?.trialStartedAt, t0.toISOString());
            assert.equal(data.plan?.stripeCustomerId, `cus_${id}`);
            assert.deepEqual(data.usage, [{ counter: 'photo#trial', count: 2 }]);
            assert.equal(JSON.stringify(data).includes('_ptrs'), false, 'no internal fields in the export');

            await store.deleteAccountData(id);
            assert.equal(await ents.get(id), null);
            assert.equal(await ents.userIdForCustomer(`cus_${id}`), null);
            assert.equal(await ents.usage(id, 'trial'), 0);
        });
    });
}
