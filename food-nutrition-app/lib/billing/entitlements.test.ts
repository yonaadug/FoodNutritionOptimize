import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    entitlementsFor, FEATURES, has, monthKey, nextMonthStart, PAST_DUE_GRACE_DAYS, photoAllowance, subscriptionGrantsPlus, TRIAL_DAYS,
    type EntitlementRecord,
} from './entitlements';

const DAY = 86_400_000;
const start = '2026-11-14T12:00:00.000Z';
const at = (iso: string) => new Date(iso);
const after = (days: number, from = start) => new Date(Date.parse(from) + days * DAY);
const record = (extra: Partial<EntitlementRecord> = {}): EntitlementRecord => ({ trialStartedAt: start, ...extra });

describe('entitlementsFor: the plan', () => {
    it('a new account is on the 14-day trial, with every Plus feature', () => {
        const ent = entitlementsFor(record(), at(start));
        assert.equal(ent.plan, 'trial');
        for (const f of FEATURES) assert.equal(has(ent, f), true, f);
        assert.equal(ent.trial?.endsAt, '2026-11-28T12:00:00.000Z');
        assert.equal(ent.trial?.daysLeft, 14);
    });

    it('counts trial days down in whole days, rounding up, and ends exactly 14 days later', () => {
        assert.equal(entitlementsFor(record(), after(0.5)).trial?.daysLeft, 14);
        assert.equal(entitlementsFor(record(), after(1)).trial?.daysLeft, 13);
        assert.equal(entitlementsFor(record(), after(13.9)).trial?.daysLeft, 1);
        assert.equal(entitlementsFor(record(), new Date(Date.parse(start) + TRIAL_DAYS * DAY - 1)).plan, 'trial');
        const ended = entitlementsFor(record(), after(TRIAL_DAYS));
        assert.equal(ended.plan, 'free');
        assert.equal(ended.trial?.daysLeft, 0);
        assert.equal(ended.trial?.active, false);
    });

    it('free has none of the Plus features', () => {
        const ent = entitlementsFor(record(), after(30));
        assert.equal(ent.plan, 'free');
        for (const f of FEATURES) assert.equal(has(ent, f), false, f);
    });

    it('an active or trialing subscription is Plus, during or after the app trial', () => {
        for (const status of ['active', 'trialing']) {
            assert.equal(entitlementsFor(record({ subscriptionId: 'sub_1', subscriptionStatus: status }), after(2)).plan, 'plus', status);
            assert.equal(entitlementsFor(record({ subscriptionId: 'sub_1', subscriptionStatus: status }), after(60)).plan, 'plus', status);
        }
        const plus = entitlementsFor(record({ subscriptionId: 'sub_1', subscriptionStatus: 'active' }), after(60));
        for (const f of FEATURES) assert.equal(has(plus, f), true, f);
    });

    it('a cancelled subscription falls back to the trial if it is still running, else free', () => {
        const canceled = record({ subscriptionId: 'sub_1', subscriptionStatus: 'canceled' });
        assert.equal(entitlementsFor(canceled, after(3)).plan, 'trial');
        assert.equal(entitlementsFor(canceled, after(20)).plan, 'free');
        for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
            assert.equal(entitlementsFor(record({ subscriptionId: 'sub_1', subscriptionStatus: status }), after(20)).plan, 'free', status);
        }
    });

    it('past_due keeps Plus for a 3-day grace period while Stripe retries the card', () => {
        const since = '2026-12-20T00:00:00.000Z';
        const pastDue = record({ subscriptionId: 'sub_1', subscriptionStatus: 'past_due', pastDueSince: since });
        assert.equal(entitlementsFor(pastDue, after(PAST_DUE_GRACE_DAYS - 0.01, since)).plan, 'plus');
        assert.equal(entitlementsFor(pastDue, after(PAST_DUE_GRACE_DAYS, since)).plan, 'free');
        assert.equal(entitlementsFor(pastDue, after(1, since)).subscription?.paymentProblem, true);
        // Without a recorded start, there's no grace to give.
        assert.equal(subscriptionGrantsPlus({ subscriptionStatus: 'past_due' }, after(1)), false);
    });

    it('reports the subscription details the account page shows', () => {
        const ent = entitlementsFor(record({
            stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'active', interval: 'year',
            currentPeriodEnd: '2027-11-14T12:00:00.000Z', cancelAtPeriodEnd: true,
        }), after(20));
        assert.deepEqual(ent.subscription, {
            status: 'active', interval: 'year', currentPeriodEnd: '2027-11-14T12:00:00.000Z', cancelAtPeriodEnd: true, paymentProblem: false,
        });
        assert.equal(ent.hasBillingAccount, true);
        assert.equal(entitlementsFor(record(), after(1)).subscription, null);
        assert.equal(entitlementsFor(record(), after(1)).hasBillingAccount, false);
    });

    it('a cancel date set in the portal counts as cancelling', () => {
        const ent = entitlementsFor(record({ subscriptionId: 'sub_1', subscriptionStatus: 'active', cancelAt: '2026-12-14T00:00:00.000Z' }), after(1));
        assert.equal(ent.subscription?.cancelAtPeriodEnd, true);
    });
});

describe('photo allowance', () => {
    it('free: 3 a month, counted per UTC calendar month', () => {
        const a = photoAllowance(entitlementsFor(record(), after(30)), after(30));
        assert.equal(a.limit, 3);
        assert.equal(a.period, 'month');
        assert.equal(a.counter, 'free#2026-12');
        assert.equal(a.resetsAt, '2027-01-01T00:00:00.000Z');
    });

    it('trial: 10 in total, for the whole trial', () => {
        const a = photoAllowance(entitlementsFor(record(), after(1)), after(1));
        assert.equal(a.limit, 10);
        assert.equal(a.period, 'trial');
        assert.equal(a.counter, 'trial');
        assert.equal(a.resetsAt, null);
    });

    it('Plus: 50 a month, with its own counter, so upgrading mid-month starts fresh', () => {
        const ent = entitlementsFor(record({ subscriptionId: 'sub_1', subscriptionStatus: 'active' }), after(30));
        const a = photoAllowance(ent, after(30));
        assert.equal(a.limit, 50);
        assert.equal(a.counter, 'plus#2026-12');
    });

    it('months roll over at midnight UTC, whatever the server timezone', () => {
        assert.equal(monthKey(at('2026-11-30T23:59:59.999Z')), '2026-11');
        assert.equal(monthKey(at('2026-12-01T00:00:00.000Z')), '2026-12');
        assert.equal(monthKey(at('2026-12-31T23:30:00.000-05:00')), '2027-01');
        assert.equal(nextMonthStart(at('2026-12-15T00:00:00.000Z')).toISOString(), '2027-01-01T00:00:00.000Z');
        assert.equal(nextMonthStart(at('2027-02-28T10:00:00.000Z')).toISOString(), '2027-03-01T00:00:00.000Z');
    });
});
