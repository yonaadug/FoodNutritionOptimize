import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthConfigError, loadAuthConfig } from './config';
import { AccountError, assertSameOrigin, clientIp, rateLimitIp } from './http';
import { pseudonym, scrub } from './log';

const SECRET = 'x'.repeat(40);
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe('loadAuthConfig', () => {
    it('works with no settings on a laptop: localhost, console email, a local secret', () => {
        const config = loadAuthConfig(env({ NODE_ENV: 'development', PORT: '3604' }));
        assert.equal(config.baseUrl, 'http://localhost:3604');
        assert.equal(config.emailTransport, 'console');
        assert.equal(config.isHttps, false);
        assert.ok(config.secret.length >= 32);
    });

    it('a production build on localhost (npm run preview) can use the console transport', () => {
        const config = loadAuthConfig(env({ NODE_ENV: 'production', AUTH_BASE_URL: 'http://localhost:3604', AUTH_EMAIL_TRANSPORT: 'console' }));
        assert.equal(config.emailTransport, 'console');
    });

    it('on a laptop, trusts this machine under any of its names', () => {
        // `make dev` prints http://127.0.0.1:3000, while sign-in links use localhost.
        const config = loadAuthConfig(env({ NODE_ENV: 'development', PORT: '3000' }));
        assert.deepEqual(config.origins, ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']);
        const request = (origin: string) => new Request('http://localhost:3000/api/history', { method: 'POST', headers: { origin } });
        assert.doesNotThrow(() => assertSameOrigin(request('http://127.0.0.1:3000'), config));
        assert.doesNotThrow(() => assertSameOrigin(request('http://localhost:3000'), config));
        assert.throws(() => assertSameOrigin(request('http://127.0.0.1:9999'), config), AccountError);
        assert.throws(() => assertSameOrigin(request('https://evil.example'), config), AccountError);
    });

    it('a deployed site trusts only its own origin', () => {
        const config = loadAuthConfig(env({ NODE_ENV: 'production', AUTH_BASE_URL: 'https://nanonutrition.app', AUTH_SECRET: SECRET, AUTH_EMAIL_FROM: 'x@nanonutrition.app' }));
        assert.deepEqual(config.origins, ['https://nanonutrition.app']);
        const request = (origin: string) => new Request('https://nanonutrition.app/api/history', { method: 'POST', headers: { origin } });
        assert.throws(() => assertSameOrigin(request('http://localhost:3000'), config), AccountError);
    });

    it('a deployed site needs https, a real secret and a sender', () => {
        const prod = { NODE_ENV: 'production', AUTH_BASE_URL: 'https://nanonutrition.app', AUTH_SECRET: SECRET, AUTH_EMAIL_FROM: 'no-reply@nanonutrition.app' };
        const config = loadAuthConfig(env(prod));
        assert.equal(config.emailTransport, 'ses');
        assert.equal(config.isHttps, true);
        assert.equal(config.isLocal, false);

        const missing: [Record<string, string>, RegExp][] = [
            [{ ...prod, AUTH_SECRET: '' }, /AUTH_SECRET/],
            [{ ...prod, AUTH_SECRET: 'short' }, /at least 32/],
            [{ ...prod, AUTH_EMAIL_FROM: '' }, /AUTH_EMAIL_FROM/],
            [{ ...prod, AUTH_BASE_URL: 'http://nanonutrition.app' }, /https/],
            [{ NODE_ENV: 'production' }, /AUTH_BASE_URL/],
        ];
        for (const [values, message] of missing) {
            assert.throws(() => loadAuthConfig(env(values)), (e: Error) => e instanceof AuthConfigError && message.test(e.message), JSON.stringify(values));
        }
    });

    it('never prints sign-in links on a deployed site', () => {
        assert.throws(() => loadAuthConfig(env({
            NODE_ENV: 'production', AUTH_BASE_URL: 'https://nanonutrition.app', AUTH_SECRET: SECRET, AUTH_EMAIL_TRANSPORT: 'console',
        })), /only allowed when AUTH_BASE_URL is localhost/);
    });

    it('enables Google only with both values', () => {
        const base = { NODE_ENV: 'development' };
        assert.equal(loadAuthConfig(env({ ...base, GOOGLE_CLIENT_ID: 'a' })).google, undefined);
        assert.deepEqual(loadAuthConfig(env({ ...base, GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' })).google, { clientId: 'a', clientSecret: 'b' });
    });
});

describe('clientIp', () => {
    const req = (headers: Record<string, string>) => new Request('http://x/', { headers });

    it('reads the first x-forwarded-for entry', () => {
        assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }), { ipHeaders: ['x-forwarded-for'] }), '203.0.113.5');
    });

    it('reads CloudFront-Viewer-Address, removing the port', () => {
        const cf = { ipHeaders: ['cloudfront-viewer-address'] };
        assert.equal(clientIp(req({ 'cloudfront-viewer-address': '203.0.113.5:44321' }), cf), '203.0.113.5');
        assert.equal(clientIp(req({ 'cloudfront-viewer-address': '2001:db8:85a3::8a2e:370:7334:44321' }), cf), '2001:db8:85a3::8a2e:370:7334');
    });

    it('ignores headers that are not configured as trusted, and values that are not addresses', () => {
        assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.5' }), { ipHeaders: ['cloudfront-viewer-address'] }), null);
        assert.equal(clientIp(req({ 'x-forwarded-for': 'not-an-ip' }), { ipHeaders: ['x-forwarded-for'] }), null);
    });

    it('counts IPv6 per /64, so hopping inside one network does not reset a limit', () => {
        const cfg = { ipHeaders: ['x-forwarded-for'] };
        const a = rateLimitIp(req({ 'x-forwarded-for': '2001:db8:1:2:aaaa::1' }), cfg);
        const b = rateLimitIp(req({ 'x-forwarded-for': '2001:db8:1:2:bbbb::2' }), cfg);
        const c = rateLimitIp(req({ 'x-forwarded-for': '2001:db8:1:3::1' }), cfg);
        assert.equal(a, b);
        assert.notEqual(a, c);
        assert.equal(rateLimitIp(req({ 'x-forwarded-for': '203.0.113.5' }), cfg), '203.0.113.5');
    });
});

describe('assertSameOrigin', () => {
    const config = { origins: ['https://site.example'] };
    const req = (headers: Record<string, string>) => new Request('https://lambda-url.example/', { method: 'POST', headers });
    const refused = (e: unknown) => e instanceof AccountError && e.status === 403;

    it('compares against the configured origin, not the Host the origin server sees', () => {
        assert.doesNotThrow(() => assertSameOrigin(req({ origin: 'https://site.example' }), config));
        assert.throws(() => assertSameOrigin(req({ origin: 'https://lambda-url.example' }), config), refused);
    });

    it('falls back to Sec-Fetch-Site only when Origin is absent', () => {
        assert.doesNotThrow(() => assertSameOrigin(req({ 'sec-fetch-site': 'same-origin' }), config));
        assert.throws(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' }), config), refused);
        assert.throws(() => assertSameOrigin(req({}), config), refused);
        assert.throws(() => assertSameOrigin(req({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), config), refused);
    });
});

describe('log privacy', () => {
    it('scrubs emails and tokens from free text', () => {
        const out = scrub('failed for jane.doe+x@example.co.uk at /verify?token=abc123&callbackURL=/a and ?code=zzz');
        assert.ok(!out.includes('jane.doe'), out);
        assert.ok(!out.includes('abc123'), out);
        assert.ok(!out.includes('zzz'), out);
        assert.ok(out.includes('callbackURL=/a'));
    });

    it('pseudonyms are stable, keyed and not reversible by guessing without the key', () => {
        assert.equal(pseudonym('a@example.com', 's1'), pseudonym('a@example.com', 's1'));
        assert.notEqual(pseudonym('a@example.com', 's1'), pseudonym('a@example.com', 's2'));
        assert.ok(!pseudonym('a@example.com', 's1').includes('example'));
    });
});
