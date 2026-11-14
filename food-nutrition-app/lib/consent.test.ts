import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authEndpoint, deleteAccount, getAccountExport, postHistory, type AccountDeps } from '@/lib/auth/handlers';
import { toErrorResponse } from '@/lib/auth/http';
import { backends, cookiesFrom, harnessOn, siteRequest, verifyPath, type Harness } from '@/lib/auth/testing/harness';
import {
    changedPolicies, consentStatus, cookieValue, encodePendingConsent, getConsent, hasHealthDataConsent, listConsentLog,
    parseConsentInput, PENDING_COOKIE, readPendingConsent, recordConsent, ConsentError,
} from './consent';
import { postConsent, requireHealthDataConsent, requireSignInConsent, withConsentInExport } from './consent-http';
import { MINIMUM_AGE, POLICY_VERSIONS } from './legal';

type Handler = (request: Request, deps: AccountDeps) => Promise<Response>;

async function call(h: AccountDeps, handler: Handler, request: Request): Promise<Response> {
    try {
        return await handler(request, h);
    } catch (err) {
        return toErrorResponse(err, 'test');
    }
}

const SECRET = 'test-secret-test-secret-test-secret-1234';
const TICKED = { acceptTerms: true, ageConfirmed: true, healthDataConsent: true, versions: { ...POLICY_VERSIONS } };
const food = { kind: 'food', itemId: '1', title: 'Apple', href: '/food/1', data: { kcal: 52 } };

describe('consent rules (no storage)', () => {
    it('needs all three boxes, each one separately', () => {
        assert.deepEqual(parseConsentInput(TICKED).versions, POLICY_VERSIONS);
        for (const key of ['acceptTerms', 'ageConfirmed', 'healthDataConsent'] as const) {
            assert.throws(() => parseConsentInput({ ...TICKED, [key]: false }), (e: unknown) => e instanceof ConsentError && e.reason === 'incomplete', key);
            // "true" as a string is not a tick
            assert.throws(() => parseConsentInput({ ...TICKED, [key]: 'true' }), ConsentError, key);
        }
        assert.throws(() => parseConsentInput(null), ConsentError);
        assert.throws(() => parseConsentInput({ ...TICKED, versions: undefined }), ConsentError);
    });

    it('refuses ticks for versions that are no longer current', () => {
        assert.throws(
            () => parseConsentInput({ ...TICKED, versions: { ...POLICY_VERSIONS, terms: 'old' } }),
            (e: unknown) => e instanceof ConsentError && e.reason === 'versions_changed',
        );
    });

    it('says which policies changed, and whether a record is current', () => {
        assert.deepEqual(changedPolicies(POLICY_VERSIONS), []);
        assert.deepEqual(changedPolicies({ ...POLICY_VERSIONS, healthData: 'old' }), ['healthData']);
        assert.deepEqual(changedPolicies(null), ['terms', 'privacy', 'healthData']);
        const record = { versions: { ...POLICY_VERSIONS }, minimumAge: MINIMUM_AGE, healthDataConsent: true as const, agreedAt: '2026-11-14T00:00:00.000Z', method: 'sign-in-form' as const };
        assert.equal(consentStatus(null), 'missing');
        assert.equal(consentStatus(record), 'current');
        assert.equal(consentStatus(record, { ...POLICY_VERSIONS, privacy: 'next' }), 'outdated', 'a bumped version asks again');
        assert.equal(consentStatus({ ...record, minimumAge: MINIMUM_AGE - 1 }), 'outdated', 'a raised age asks again');
    });

    it('the pending cookie is signed, short-lived and tied to the current versions', () => {
        const now = new Date('2026-11-14T12:00:00Z');
        const value = encodePendingConsent(SECRET, now);
        assert.equal(readPendingConsent(value, SECRET, now), true);
        assert.equal(readPendingConsent(value, SECRET, new Date(now.getTime() + 29 * 60_000)), true);
        assert.equal(readPendingConsent(value, SECRET, new Date(now.getTime() + 31 * 60_000)), false, 'expired');
        assert.equal(readPendingConsent(value, 'another-secret-another-secret-12345', now), false, 'wrong key');
        const [data, sig] = value.split('.');
        const forged = Buffer.from(JSON.stringify({ v: POLICY_VERSIONS, t: Math.floor(now.getTime() / 1000) + 3600 })).toString('base64url');
        assert.equal(readPendingConsent(`${forged}.${sig}`, SECRET, now), false, 'tampered payload');
        assert.equal(readPendingConsent(`${data}.x${sig.slice(1)}`, SECRET, now), false, 'tampered signature');
        assert.equal(readPendingConsent('', SECRET, now), false);
        assert.equal(readPendingConsent(null, SECRET, now), false);
        assert.equal(readPendingConsent('nodot', SECRET, now), false);
    });

    it('reads one cookie from a Cookie header', () => {
        assert.equal(cookieValue('a=1; md.consent=abc.def; b=2', PENDING_COOKIE), 'abc.def');
        assert.equal(cookieValue('a=1', PENDING_COOKIE), null);
        assert.equal(cookieValue(null, PENDING_COOKIE), null);
    });
});

for (const backend of backends) {
    describe(`consent: ${backend.name}`, () => {
        let h: Harness;
        let n = 0;
        const freshEmail = () => `consent${++n}@example.com`;

        /** The browser flow: tick the boxes, ask for a link, follow it. Returns all cookies, session included. */
        async function signInLikeABrowser(email: string): Promise<{ pending: string; session: string }> {
            const consent = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', body: TICKED }));
            assert.equal(consent.status, 200);
            assert.deepEqual(await consent.json(), { pending: true, versions: POLICY_VERSIONS });
            const pending = cookiesFrom(consent);
            assert.match(pending, /^md\.consent=/);

            const guarded = requireSignInConsent(authEndpoint);
            const link = await call(h, guarded, siteRequest('/api/auth/sign-in/magic-link', {
                method: 'POST', cookie: pending, body: { email, callbackURL: '/account/sign-in/done', errorCallbackURL: '/account/sign-in' },
            }));
            assert.equal(link.status, 200);
            const verified = await authEndpoint(siteRequest(verifyPath(h.sent[h.sent.length - 1])), h);
            const session = cookiesFrom(verified);
            assert.ok(session, 'signed in');
            return { pending, session };
        }

        before(async () => {
            const { table, close } = await backend.start();
            h = { ...harnessOn(table), close };
        });
        after(() => h.close());

        it('no sign-in link is emailed, and no Google sign-in starts, without the ticks', async () => {
            const guarded = requireSignInConsent(authEndpoint);
            const before = h.sent.length;
            const link = await call(h, guarded, siteRequest('/api/auth/sign-in/magic-link', { method: 'POST', body: { email: freshEmail(), callbackURL: '/account' } }));
            assert.equal(link.status, 403);
            assert.equal((await link.json()).details.reason, 'consent_required');
            assert.equal(h.sent.length, before, 'nothing sent');

            const google = await call(h, guarded, siteRequest('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', callbackURL: '/account' } }));
            assert.equal(google.status, 403);

            const forged = await call(h, guarded, siteRequest('/api/auth/sign-in/magic-link', { method: 'POST', cookie: `${PENDING_COOKIE}=bogus.value`, body: { email: freshEmail() } }));
            assert.equal(forged.status, 403, 'a made-up cookie is not consent');

            // Returning from a link or signing out is not a new sign-in, so it isn't blocked.
            const signOut = await call(h, guarded, siteRequest('/api/auth/sign-out', { method: 'POST', body: {} }));
            assert.notEqual(signOut.status, 403);
        });

        it('refuses incomplete ticks without setting the cookie', async () => {
            const res = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', body: { ...TICKED, healthDataConsent: false } }));
            assert.equal(res.status, 400);
            assert.equal((await res.json()).details.reason, 'incomplete');
            assert.equal(cookiesFrom(res), '');
            const stale = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', body: { ...TICKED, versions: { ...POLICY_VERSIONS, terms: 'old' } } }));
            assert.equal((await stale.json()).details.reason, 'versions_changed');
        });

        it('refuses a consent post from another site', async () => {
            const res = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', body: TICKED, headers: { origin: 'https://evil.example' } }));
            assert.equal(res.status, 403);
        });

        it('records the pending consent with versions and a time, and no IP', async () => {
            const email = freshEmail();
            const { pending, session } = await signInLikeABrowser(email);
            const me = await h.auth.api.getSession({ headers: new Headers({ cookie: session }) });
            const userId = me!.user.id;
            assert.equal(await getConsent(h.table, userId), null, 'not recorded until the done page asks');

            const started = Date.now();
            const res = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', cookie: `${session}; ${pending}`, body: { usePending: true }, headers: { 'x-forwarded-for': '203.0.113.9' } }));
            assert.equal(res.status, 200);
            assert.match(res.headers.getSetCookie().join('\n'), /md\.consent=; Path=\/; Max-Age=0/, 'the pending cookie is cleared');

            const record = await getConsent(h.table, userId);
            assert.ok(record);
            assert.deepEqual(record.versions, POLICY_VERSIONS);
            assert.equal(record.minimumAge, MINIMUM_AGE);
            assert.equal(record.healthDataConsent, true);
            assert.equal(record.method, 'sign-in-form');
            assert.ok(Date.parse(record.agreedAt) >= started - 1000);
            assert.equal(consentStatus(record), 'current');

            const raw = await h.table.get({ PK: `USER#${userId}`, SK: 'CONSENT' });
            assert.ok(!JSON.stringify(raw).includes('203.0.113.9'), 'the IP address is not stored');
            assert.ok(!/ip|agent/i.test(Object.keys(raw!).join(',')), 'no IP or user-agent fields');
        });

        it('usePending without a valid cookie asks again, and explicit ticks record it', async () => {
            const { session } = await signInLikeABrowser(freshEmail());
            const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie: session }) }))!.user.id;
            const noCookie = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', cookie: session, body: { usePending: true } }));
            assert.equal(noCookie.status, 403, 'link opened in another browser: the consent step asks');
            assert.equal(await getConsent(h.table, userId), null);

            const ticked = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', cookie: session, body: TICKED }));
            assert.equal(ticked.status, 200);
            assert.equal((await ticked.json()).consent.method, 'sign-in-review');
            assert.equal(consentStatus(await getConsent(h.table, userId)), 'current');
        });

        it('history needs health-data consent on record', async () => {
            const { session } = await signInLikeABrowser(freshEmail());
            const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie: session }) }))!.user.id;
            const guarded = requireHealthDataConsent(postHistory);

            const refused = await call(h, guarded, siteRequest('/api/history', { method: 'POST', cookie: session, body: food }));
            assert.equal(refused.status, 403);
            assert.equal((await refused.json()).details.reason, 'consent_required');
            assert.equal((await h.store.listHistory(userId)).items.length, 0, 'nothing written');

            await recordConsent(h.table, userId, 'sign-in-review');
            assert.equal(await hasHealthDataConsent(h.table, userId), true);
            const ok = await call(h, guarded, siteRequest('/api/history', { method: 'POST', cookie: session, body: food }));
            assert.equal(ok.status, 200);

            const signedOut = await call(h, guarded, siteRequest('/api/history', { method: 'POST', body: food }));
            assert.equal(signedOut.status, 401, 'signed out still gets the usual 401');
        });

        it('a bumped version reads as outdated and is asked again; agreeing again is logged', async () => {
            const { session } = await signInLikeABrowser(freshEmail());
            const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie: session }) }))!.user.id;
            // An agreement to last year's versions, as an existing account would have.
            const old = { versions: { terms: 'old-terms', privacy: POLICY_VERSIONS.privacy, healthData: 'old-health' }, minimumAge: MINIMUM_AGE, healthDataConsent: true, agreedAt: '2025-11-14T00:00:00.000Z', method: 'sign-in-form' };
            await h.table.put({ PK: `USER#${userId}`, SK: 'CONSENTLOG#2025-11-14T00:00:00.000Z', ...old });
            await h.table.put({ PK: `USER#${userId}`, SK: 'CONSENT', ...old });
            const before = await getConsent(h.table, userId);
            assert.equal(consentStatus(before), 'outdated');
            assert.deepEqual(changedPolicies(before!.versions), ['terms', 'healthData']);
            assert.equal(await hasHealthDataConsent(h.table, userId), true, 'history keeps working until the next sign-in asks');

            const res = await call(h, postConsent, siteRequest('/api/consent', { method: 'POST', cookie: session, body: TICKED }));
            assert.equal(res.status, 200);
            assert.equal(consentStatus(await getConsent(h.table, userId)), 'current');
            const log = await listConsentLog(h.table, userId);
            assert.equal(log.length, 2, 'both agreements kept as evidence');
            assert.equal(log[0].versions.terms, 'old-terms');
            assert.deepEqual(log[1].versions, POLICY_VERSIONS);
        });

        it('export includes consent records, and deleting the account removes them', async () => {
            const email = freshEmail();
            const { session } = await signInLikeABrowser(email);
            const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie: session }) }))!.user.id;
            await recordConsent(h.table, userId, 'sign-in-form');

            const res = await call(h, withConsentInExport(getAccountExport), siteRequest('/api/account/export', { cookie: session }));
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
            assert.equal(res.headers.get('cache-control'), 'private, no-store');
            const data = await res.json();
            assert.equal(data.format, 'nutrition-dictionary-account-export');
            assert.equal(data.profile.email, email);
            assert.equal(data.consent.status, 'current');
            assert.deepEqual(data.consent.current.versions, POLICY_VERSIONS);
            assert.equal(data.consent.history.length, 1);

            const del = await call(h, deleteAccount, siteRequest('/api/account', { method: 'DELETE', cookie: session, body: { confirmEmail: email } }));
            assert.equal(del.status, 200);
            assert.equal(await getConsent(h.table, userId), null);
            assert.equal((await listConsentLog(h.table, userId)).length, 0);
        });
    });
}
