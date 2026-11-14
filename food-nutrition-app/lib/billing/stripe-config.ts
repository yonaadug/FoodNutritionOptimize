/**
 * Stripe settings, read from the environment (food-nutrition-app/.env.example).
 *
 *   STRIPE_MODE=test (default)  STRIPE_TEST_SECRET_KEY, STRIPE_TEST_WEBHOOK_SECRET,
 *                               STRIPE_TEST_PRICE_PLUS_MONTHLY, STRIPE_TEST_PRICE_PLUS_ANNUAL,
 *                               STRIPE_TEST_PORTAL_CONFIGURATION_ID. Each falls back to the
 *                               unprefixed name, which must then hold a test key too.
 *   STRIPE_MODE=live            STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PLUS_MONTHLY,
 *                               STRIPE_PRICE_PLUS_ANNUAL, STRIPE_PORTAL_CONFIGURATION_ID.
 *
 * The live-key guard: a live key (sk_live_ / rk_live_) is refused unless NODE_ENV is
 * production AND STRIPE_ALLOW_LIVE=1. `npm run dev` and `npm test` can never use one,
 * and neither can `npm run preview` (a production build) without the explicit flag. So a
 * laptop holding live keys in .env.local can't charge a real card by accident.
 *
 * Any problem leaves billing off and the rest of the site untouched: upgrade buttons say
 * billing isn't set up, and the server log says why.
 */

type Env = Record<string, string | undefined>;

export type StripeMode = 'test' | 'live';

export interface StripeSettings {
    mode: StripeMode;
    secretKey: string;
    webhookSecret: string | null;
    prices: { month: string | null; year: string | null };
    portalConfigurationId: string | null;
}

export type StripeConfig =
    | { ok: true; settings: StripeSettings }
    | {
        ok: false;
        reason: 'not_configured' | 'misconfigured' | 'live_refused';
        /** For the server log. */
        ownerMessage: string;
        /** For people using the site. */
        publicMessage: string;
    };

export const BILLING_OFF_MESSAGE = 'Billing isn\'t set up on this site yet, so upgrades are off. Everything else works as usual.';

const value = (env: Env, name: string) => env[name]?.trim() || null;

/** test or live from a secret or restricted key's prefix; null for anything else (including publishable keys). */
export function keyMode(key: string): StripeMode | null {
    const m = /^(?:sk|rk)_(test|live)_/.exec(key);
    return m ? (m[1] as StripeMode) : null;
}

export function liveKeysAllowed(env: Env): boolean {
    return env.NODE_ENV === 'production' && env.STRIPE_ALLOW_LIVE === '1';
}

function off(reason: 'not_configured' | 'misconfigured' | 'live_refused', ownerMessage: string): StripeConfig {
    return { ok: false, reason, ownerMessage, publicMessage: BILLING_OFF_MESSAGE };
}

export function loadStripeConfig(env: Env = process.env): StripeConfig {
    const mode = (env.STRIPE_MODE?.trim().toLowerCase() || 'test');
    if (mode !== 'test' && mode !== 'live') return off('misconfigured', `STRIPE_MODE must be test or live, not "${mode}".`);
    const pick = (name: string) => (mode === 'test' ? value(env, `STRIPE_TEST_${name}`) ?? value(env, `STRIPE_${name}`) : value(env, `STRIPE_${name}`));

    const secretKey = pick('SECRET_KEY');
    if (!secretKey) return off('not_configured', `No Stripe secret key for STRIPE_MODE=${mode}; billing is off.`);
    const keyIs = keyMode(secretKey);
    if (!keyIs) return off('misconfigured', 'The Stripe secret key must start with sk_test_, rk_test_, sk_live_ or rk_live_.');
    if (keyIs !== mode) return off('misconfigured', `STRIPE_MODE=${mode} but the secret key is a ${keyIs} key. Billing is off until they match.`);
    if (keyIs === 'live' && !liveKeysAllowed(env)) {
        return off('live_refused', 'Stripe live keys are refused here. They are used only with NODE_ENV=production and STRIPE_ALLOW_LIVE=1. '
            + 'To try billing on a laptop, set STRIPE_MODE=test with test keys (docs/STRIPE_PLAN.md §7).');
    }
    return {
        ok: true,
        settings: {
            mode,
            secretKey,
            webhookSecret: pick('WEBHOOK_SECRET'),
            prices: { month: pick('PRICE_PLUS_MONTHLY'), year: pick('PRICE_PLUS_ANNUAL') },
            portalConfigurationId: pick('PORTAL_CONFIGURATION_ID'),
        },
    };
}
