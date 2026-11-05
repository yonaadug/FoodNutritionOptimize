import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationUrl, CLIENT_IP_HEADER } from './auth';
import { authEndpoint, getMe, hasSessionCookie } from './handlers';
import { SqliteTable } from '@/lib/user-store/sqlite-table';
import {
    backends, cookiesFrom, harnessOn, requestLink, signIn, siteRequest, SITE, verifyPath, type Harness,
} from './testing/harness';

for (const backend of backends) {
    describe(`sign-in and sessions: ${backend.name}`, () => {
        let h: Harness;
        let n = 0;
        const email = () => `person${++n}@example.com`;

        before(async () => {
            const { table, close } = await backend.start();
            h = { ...harnessOn(table), close };
        });
        after(() => h.close());

        it('a link signs a new person in, creates the account, and works exactly once', async () => {
            const address = email();
            const res = await requestLink(h, address);
            assert.equal(res.status, 200);
            const mail = h.sent.at(-1)!;
            assert.equal(mail.to, address);
            assert.ok(mail.url.startsWith(`${SITE}/account/sign-in/confirm?`), 'the email goes to the confirm page, not the verify endpoint');

            const first = await authEndpoint(siteRequest(verifyPath(mail)), h);
            assert.equal(first.status, 302);
            assert.equal(first.headers.get('location'), `${SITE}/account`);
            const cookie = cookiesFrom(first);
            assert.match(cookie, /md\.session_token=/);

            const me = await (await getMe(siteRequest('/api/me', { cookie }), h)).json();
            assert.equal(me.user.email, address);
            assert.ok(me.user.id);

            const second = await authEndpoint(siteRequest(verifyPath(mail)), h);
            assert.equal(second.status, 302);
            assert.match(String(second.headers.get('location')), /\/account\/sign-in\?error=/, 'a used link is refused');
            assert.equal(cookiesFrom(second), '');
        });

        it('two concurrent uses of one link create at most one session', async () => {
            await requestLink(h, email());
            const path = verifyPath(h.sent.at(-1)!);
            const results = await Promise.all(Array.from({ length: 5 }, () => authEndpoint(siteRequest(path), h)));
            assert.equal(results.filter(r => cookiesFrom(r) !== '').length, 1);
        });

        it('an expired link is refused', async () => {
            await requestLink(h, email());
            const path = verifyPath(h.sent.at(-1)!);
            mock.timers.enable({ apis: ['Date'], now: Date.now() + 16 * 60 * 1000 });
            try {
                const res = await authEndpoint(siteRequest(path), h);
                assert.match(String(res.headers.get('location')), /\/account\/sign-in\?error=/);
                assert.equal(cookiesFrom(res), '');
            } finally {
                mock.timers.reset();
            }
        });

        it('signing in again finds the same account (email is case-insensitive)', async () => {
            const address = email();
            const c1 = await signIn(h, address);
            const c2 = await signIn(h, address.toUpperCase());
            const a = await (await getMe(siteRequest('/api/me', { cookie: c1 }), h)).json();
            const b = await (await getMe(siteRequest('/api/me', { cookie: c2 }), h)).json();
            assert.equal(a.user.id, b.user.id);
        });

        it('answers identically whether or not the account exists', async () => {
            const known = email();
            await signIn(h, known);
            const a = await requestLink(h, known);
            const b = await requestLink(h, email());
            assert.equal(a.status, b.status);
            assert.deepEqual(await a.json(), await b.json());
        });

        it('signing out ends the session on the next request', async () => {
            const cookie = await signIn(h, email());
            const out = await authEndpoint(siteRequest('/api/auth/sign-out', { method: 'POST', cookie, body: {} }), h);
            assert.equal(out.status, 200);
            const me = await (await getMe(siteRequest('/api/me', { cookie }), h)).json();
            assert.equal(me.user, null);
        });

        it('a forged or tampered cookie is not a session', async () => {
            const cookie = await signIn(h, email());
            const [name, value] = cookie.split('=');
            const tampered = `${name}=x${value.slice(1)}`;
            assert.equal((await (await getMe(siteRequest('/api/me', { cookie: tampered }), h)).json()).user, null);
            assert.equal((await (await getMe(siteRequest('/api/me', { cookie: 'md.session_token=abc.def' }), h)).json()).user, null);
        });

        it('stores no IP address or user agent with the session', async () => {
            const cookie = await signIn(h, email());
            const session = await h.auth.api.getSession({ headers: new Headers({ cookie }) });
            assert.equal(session?.session.ipAddress ?? null, null);
            assert.equal(session?.session.userAgent ?? null, null);
        });

        it('refuses a sign-in request from another site', async () => {
            const res = await requestLink(h, email(), { origin: 'https://evil.example' });
            assert.equal(res.status, 403);
        });

        it('refuses a redirect to another site after sign-in', async () => {
            const res = await authEndpoint(siteRequest('/api/auth/sign-in/magic-link', {
                method: 'POST',
                body: { email: email(), callbackURL: 'https://evil.example/phish' },
            }), h);
            assert.equal(res.status, 403);
        });

        it('only the endpoints the site uses are reachable', async () => {
            const cookie = await signIn(h, email());
            for (const [method, path] of [
                ['POST', '/api/auth/update-user'],
                ['POST', '/api/auth/delete-user'],
                ['POST', '/api/auth/change-email'],
                ['GET', '/api/auth/list-accounts'],
                ['GET', '/api/auth/list-sessions'],
            ]) {
                await assert.rejects(
                    authEndpoint(siteRequest(path, { method, cookie, ...(method === 'POST' ? { body: {} } : {}) }), h),
                    (e: { status?: number }) => e.status === 404,
                    `${method} ${path}`,
                );
            }
        });

        it('rate-limits sign-in requests per IP, and a spoofed internal header does not help', async () => {
            const headers = { 'x-forwarded-for': '198.51.100.20' };
            const statuses: number[] = [];
            for (let i = 0; i < 12; i++) {
                const res = await requestLink(h, email(), { ...headers, [CLIENT_IP_HEADER]: `10.0.0.${i}` });
                statuses.push(res.status);
            }
            assert.ok(statuses.slice(0, 10).every(s => s === 200), statuses.join());
            assert.equal(statuses.at(-1), 429);
        });

        it('caps sign-in emails to one address, without changing the response', async () => {
            const address = email();
            const before = h.sent.length;
            for (let i = 0; i < 7; i++) {
                const res = await requestLink(h, address, { 'x-forwarded-for': `198.51.100.${100 + i}` });
                assert.equal(res.status, 200);
            }
            assert.equal(h.sent.length - before, 5);
        });

        it('logs no email addresses or tokens through a whole sign-in', async () => {
            const lines: string[] = [];
            const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
            const spies = [mock.method(console, 'log', capture), mock.method(console, 'warn', capture), mock.method(console, 'error', capture), mock.method(console, 'info', capture)];
            const address = email();
            try {
                const cookie = await signIn(h, address);
                await requestLink(h, address);
                await authEndpoint(siteRequest('/api/auth/sign-out', { method: 'POST', cookie, body: {} }), h);
            } finally {
                spies.forEach(s => s.mock.restore());
            }
            const text = lines.join('\n');
            assert.ok(!text.includes(address), text);
            assert.ok(!text.includes('token='), text);
        });
    });
}

describe('cookies', () => {
    it('are httpOnly and SameSite=Lax, and not Secure on localhost', async () => {
        const table = new SqliteTable(':memory:');
        const h = harnessOn(table);
        await requestLink(h, 'a@example.com');
        const res = await authEndpoint(siteRequest(verifyPath(h.sent[0])), h);
        const cookie = res.headers.getSetCookie().find(c => c.includes('session_token'))!;
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
        assert.doesNotMatch(cookie, /Secure/i);
        table.close();
    });

    it('are Secure with the __Secure- prefix on an https site', async () => {
        const table = new SqliteTable(':memory:');
        const site = 'https://micronutrientdiary.example';
        const h = harnessOn(table, { AUTH_BASE_URL: site, AUTH_EMAIL_TRANSPORT: 'ses', AUTH_EMAIL_FROM: 'a@micronutrientdiary.example' });
        const send = (path: string, init: RequestInit) => authEndpoint(new Request(`${site}${path}`, init), h);
        await send('/api/auth/sign-in/magic-link', {
            method: 'POST',
            headers: { origin: site, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
            body: JSON.stringify({ email: 'a@example.com', callbackURL: '/account' }),
        });
        assert.ok(h.sent[0].url.startsWith(`${site}/account/sign-in/confirm?`));
        const params = new URL(h.sent[0].url).searchParams;
        const res = await send(`/api/auth/magic-link/verify?${params}`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
        const cookie = res.headers.getSetCookie().find(c => c.includes('session_token'))!;
        assert.match(cookie, /^__Secure-md\.session_token=/);
        assert.match(cookie, /; Secure/i);
        assert.match(cookie, /HttpOnly/i);
        assert.ok(hasSessionCookie(new Request(`${site}/`, { headers: { cookie: cookie.split(';')[0] } })));
        table.close();
    });
});

describe('confirmationUrl', () => {
    it('keeps the parameters and points at the confirm page', () => {
        const url = confirmationUrl(`${SITE}/api/auth/magic-link/verify?token=abc&callbackURL=%2Faccount`, SITE);
        assert.equal(url, `${SITE}/account/sign-in/confirm?token=abc&callbackURL=%2Faccount`);
    });
});

describe('hasSessionCookie', () => {
    it('is false with no cookie, so anonymous requests never reach the store', () => {
        assert.equal(hasSessionCookie(new Request(SITE)), false);
        assert.equal(hasSessionCookie(new Request(SITE, { headers: { cookie: 'theme=dark' } })), false);
    });
});
