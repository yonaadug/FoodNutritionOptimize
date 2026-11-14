import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { keyMode, liveKeysAllowed, loadStripeConfig } from './stripe-config';

// Shapes only: none of these are real keys.
const TEST_KEY = 'sk_test_fake000000000000000000';
const LIVE_KEY = 'sk_live_fake000000000000000000';
const LIVE_RESTRICTED = 'rk_live_fake000000000000000000';

const testEnv = {
    STRIPE_MODE: 'test',
    STRIPE_TEST_SECRET_KEY: TEST_KEY,
    STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_TEST_PRICE_PLUS_MONTHLY: 'price_m',
    STRIPE_TEST_PRICE_PLUS_ANNUAL: 'price_y',
};

describe('Stripe configuration', () => {
    it('reads the test settings in test mode, which is the default', () => {
        for (const env of [testEnv, { ...testEnv, STRIPE_MODE: undefined }, { ...testEnv, STRIPE_MODE: ' TEST ' }]) {
            const c = loadStripeConfig(env);
            assert.ok(c.ok, JSON.stringify(c));
            assert.equal(c.settings.mode, 'test');
            assert.equal(c.settings.secretKey, TEST_KEY);
            assert.equal(c.settings.webhookSecret, 'whsec_test');
            assert.deepEqual(c.settings.prices, { month: 'price_m', year: 'price_y' });
        }
    });

    it('test mode can use the unprefixed names, for a deploy that only has test keys', () => {
        const c = loadStripeConfig({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: TEST_KEY, STRIPE_PRICE_PLUS_MONTHLY: 'price_m' });
        assert.ok(c.ok);
        assert.equal(c.settings.secretKey, TEST_KEY);
        assert.equal(c.settings.prices.month, 'price_m');
        assert.equal(c.settings.prices.year, null);
    });

    it('with no key, billing is simply not set up', () => {
        for (const env of [{}, { STRIPE_MODE: 'test' }, { STRIPE_MODE: 'live' }, { STRIPE_TEST_SECRET_KEY: '  ' }]) {
            const c = loadStripeConfig(env);
            assert.equal(c.ok, false);
            if (!c.ok) assert.equal(c.reason, 'not_configured');
        }
    });

    it('refuses a key that doesn\'t match the mode, or isn\'t a secret key', () => {
        const cases = [
            { STRIPE_MODE: 'test', STRIPE_TEST_SECRET_KEY: LIVE_KEY },
            { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: LIVE_KEY },
            { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: TEST_KEY, NODE_ENV: 'production', STRIPE_ALLOW_LIVE: '1' },
            { STRIPE_MODE: 'test', STRIPE_TEST_SECRET_KEY: 'pk_test_publishable' },
            { STRIPE_MODE: 'sandbox', STRIPE_TEST_SECRET_KEY: TEST_KEY },
        ];
        for (const env of cases) {
            const c = loadStripeConfig(env);
            assert.equal(c.ok, false, JSON.stringify(env));
            if (!c.ok) assert.equal(c.reason, 'misconfigured', JSON.stringify(env));
        }
    });

    it('knows live keys from test keys', () => {
        assert.equal(keyMode(LIVE_KEY), 'live');
        assert.equal(keyMode(LIVE_RESTRICTED), 'live');
        assert.equal(keyMode(TEST_KEY), 'test');
        assert.equal(keyMode('rk_test_x'), 'test');
        assert.equal(keyMode('pk_live_x'), null);
        assert.equal(keyMode(''), null);
    });
});

describe('live-key guard', () => {
    const live = (extra: Record<string, string | undefined>) => ({
        STRIPE_MODE: 'live', STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_PRICE_PLUS_MONTHLY: 'price_live_m', ...extra,
    });

    it('refuses live keys on a laptop: development, test, or a production build without STRIPE_ALLOW_LIVE=1', () => {
        const refused = [
            {},
            { NODE_ENV: 'development' },
            { NODE_ENV: 'test', STRIPE_ALLOW_LIVE: '1' },
            { NODE_ENV: 'development', STRIPE_ALLOW_LIVE: '1' },
            { NODE_ENV: 'production' },
            { NODE_ENV: 'production', STRIPE_ALLOW_LIVE: 'true' },
            { NODE_ENV: 'production', STRIPE_ALLOW_LIVE: '0' },
        ];
        for (const extra of refused) {
            const c = loadStripeConfig(live(extra));
            assert.equal(c.ok, false, JSON.stringify(extra));
            if (!c.ok) {
                assert.equal(c.reason, 'live_refused', JSON.stringify(extra));
                assert.match(c.ownerMessage, /STRIPE_ALLOW_LIVE=1/);
            }
        }
        // A restricted live key is just as live.
        const restricted = loadStripeConfig({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: LIVE_RESTRICTED, NODE_ENV: 'production' });
        assert.equal(restricted.ok, false);
    });

    it('allows live keys only with NODE_ENV=production and STRIPE_ALLOW_LIVE=1', () => {
        const c = loadStripeConfig(live({ NODE_ENV: 'production', STRIPE_ALLOW_LIVE: '1' }));
        assert.ok(c.ok);
        assert.equal(c.settings.mode, 'live');
        assert.equal(c.settings.prices.month, 'price_live_m');
        assert.equal(liveKeysAllowed({ NODE_ENV: 'production', STRIPE_ALLOW_LIVE: '1' }), true);
        assert.equal(liveKeysAllowed({ NODE_ENV: 'production' }), false);
    });

    it('test keys never need the flag', () => {
        assert.equal(loadStripeConfig({ ...testEnv, NODE_ENV: 'production' }).ok, true);
    });

    it('the message people see never names keys or settings', () => {
        const c = loadStripeConfig(live({}));
        assert.equal(c.ok, false);
        if (!c.ok) assert.doesNotMatch(c.publicMessage, /STRIPE|key|live/i);
    });
});
