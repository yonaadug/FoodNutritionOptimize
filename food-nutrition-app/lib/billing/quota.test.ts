import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backends } from '@/lib/auth/testing/harness';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import type { SingleTable } from '@/lib/user-store/table';
import { entitlementsFor, type EntitlementRecord } from './entitlements';
import { photoUsage, quotaMessage, reservePhotoRead } from './quota';

const trialStart = '2026-11-14T12:00:00.000Z';
const inTrial = new Date('2026-11-15T12:00:00.000Z');
const afterTrial = new Date('2026-11-30T12:00:00.000Z');
const plusRecord: EntitlementRecord = { trialStartedAt: trialStart, subscriptionId: 'sub_1', subscriptionStatus: 'active' };

for (const backend of backends) {
    describe(`photo quota: ${backend.name}`, () => {
        let table: SingleTable;
        let close: () => Promise<void>;
        let ents: EntitlementStore;
        let n = 0;
        const user = () => `q${++n}`;

        before(async () => {
            ({ table, close } = await backend.start());
            ents = new EntitlementStore(table);
        });
        after(() => close());

        const read = (id: string, record: EntitlementRecord, now: Date) => reservePhotoRead(ents, id, entitlementsFor(record, now), now);

        it('the trial allows 10 reads in total, then refuses without counting the refusal', async () => {
            const id = user();
            const record = { trialStartedAt: trialStart };
            for (let i = 1; i <= 10; i++) {
                const r = await read(id, record, inTrial);
                assert.equal(r.ok, true, `read ${i}`);
                assert.equal(r.usage.used, i);
            }
            const refused = await read(id, record, inTrial);
            assert.equal(refused.ok, false);
            assert.equal(refused.usage.used, 10);
            assert.equal(refused.usage.remaining, 0);
            assert.equal((await photoUsage(ents, id, entitlementsFor(record, inTrial), inTrial)).used, 10);
        });

        it('free allows 3 a month and starts again on the 1st (UTC)', async () => {
            const id = user();
            const record = { trialStartedAt: trialStart };
            for (let i = 0; i < 3; i++) assert.equal((await read(id, record, afterTrial)).ok, true);
            const refused = await read(id, record, afterTrial);
            assert.equal(refused.ok, false);
            assert.equal(refused.usage.resetsAt, '2026-12-01T00:00:00.000Z');
            // 23:59 UTC on the 30th is still November; a minute past midnight UTC is December.
            assert.equal((await read(id, record, new Date('2026-11-30T23:59:00.000Z'))).ok, false);
            assert.equal((await read(id, record, new Date('2026-12-01T00:01:00.000Z'))).ok, true);
        });

        it('trial reads don\'t use up the free month that follows, and Plus starts fresh', async () => {
            const id = user();
            const record = { trialStartedAt: trialStart };
            for (let i = 0; i < 10; i++) await read(id, record, inTrial);
            assert.equal((await read(id, record, afterTrial)).ok, true, 'free has its own counter');
            const plus = await read(id, plusRecord, afterTrial);
            assert.equal(plus.ok, true);
            assert.equal(plus.usage.limit, 50);
            assert.equal(plus.usage.used, 1);
        });

        it('a failed read gives its reservation back', async () => {
            const id = user();
            const record = { trialStartedAt: trialStart };
            const r = await read(id, record, afterTrial);
            assert.ok(r.ok);
            await r.release();
            assert.equal((await photoUsage(ents, id, entitlementsFor(record, afterTrial), afterTrial)).used, 0);
            await r.release(); // only once
            assert.equal((await photoUsage(ents, id, entitlementsFor(record, afterTrial), afterTrial)).used, 0);
        });

        it('concurrent reads never go over the limit', async () => {
            const id = user();
            const record = { trialStartedAt: trialStart };
            const results = await Promise.all(Array.from({ length: 8 }, () => read(id, record, afterTrial)));
            assert.equal(results.filter(r => r.ok).length, 3);
            assert.equal((await photoUsage(ents, id, entitlementsFor(record, afterTrial), afterTrial)).used, 3);
        });
    });
}

describe('quota messages', () => {
    it('say what was used, when it comes back, and mention Plus once', () => {
        assert.equal(
            quotaMessage({ limit: 3, used: 3, remaining: 0, period: 'month', resetsAt: '2026-12-01T00:00:00.000Z' }, 'free'),
            'You\'ve used your 3 photo reads this month. You get 3 more on December 1, or 50 a month with Plus.',
        );
        assert.equal(
            quotaMessage({ limit: 10, used: 10, remaining: 0, period: 'trial', resetsAt: null }, 'trial'),
            'You\'ve used the 10 photo reads in your trial. Plus gives you 50 a month.',
        );
        assert.equal(
            quotaMessage({ limit: 50, used: 50, remaining: 0, period: 'month', resetsAt: '2027-01-01T00:00:00.000Z' }, 'plus'),
            'You\'ve used your 50 photo reads this month. You get 50 more on January 1.',
        );
    });
});
