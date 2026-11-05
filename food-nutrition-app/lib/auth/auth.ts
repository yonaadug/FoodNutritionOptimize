import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { SingleTable } from '@/lib/user-store/table';
import { createKeyValueStore } from '@/lib/user-store/user-store';
import { singleTableAdapter } from './adapter';
import type { AuthConfig } from './config';
import { authLogger, logEvent, pseudonym } from './log';
import type { Mailer } from './mailer';
import { hit, RATE_RULES } from './rate-limit';

/**
 * The Better Auth instance. Better Auth owns sign-in, sessions, cookies, token
 * handling, CSRF origin checks and sign-in rate limits; this file only configures it.
 * Reasons and trade-offs are in docs/ACCOUNTS.md.
 */

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Better Auth reads the client IP from this header; lib/auth/http.ts decides its value. */
export const CLIENT_IP_HEADER = 'x-md-client-ip';

/**
 * Mail scanners open every link they see, which would burn a single-use GET link
 * before the person clicks it. So the email points at a page with a button, and only
 * that button (a form submit, which scanners don't do) calls the verify endpoint.
 */
export function confirmationUrl(verifyUrl: string, baseUrl: string): string {
    const params = new URL(verifyUrl).searchParams;
    return `${baseUrl}/account/sign-in/confirm?${params.toString()}`;
}

export function createAuth(options: { table: SingleTable; config: AuthConfig; mailer: Mailer }) {
    const { table, config, mailer } = options;
    return betterAuth({
        appName: 'Micronutrient Diary',
        baseURL: config.baseUrl,
        basePath: '/api/auth',
        secret: config.secret,
        trustedOrigins: [config.origin],
        database: singleTableAdapter(table),
        // Sessions, magic-link tokens and auth rate limits are short-lived key-value
        // data with a TTL, so they don't need the adapter's relational shape.
        secondaryStorage: createKeyValueStore(table),
        verification: { storeInDatabase: false },
        session: {
            expiresIn: SESSION_TTL_SECONDS,
            updateAge: 24 * 60 * 60,
            storeSessionInDatabase: false,
            // No cookie cache: signing out or deleting the account must take effect
            // on the very next request, not when a cached cookie expires.
            cookieCache: { enabled: false },
        },
        emailAndPassword: { enabled: false },
        socialProviders: config.google ? { google: config.google } : {},
        account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
        rateLimit: {
            enabled: true,
            storage: 'secondary-storage',
            window: 60,
            max: 100,
            customRules: {
                '/magic-link/verify': { window: 60, max: 20 },
                '/sign-out': { window: 60, max: 30 },
            },
        },
        advanced: {
            useSecureCookies: config.isHttps,
            cookiePrefix: 'md',
            defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.isHttps, path: '/' },
            ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
        },
        telemetry: { enabled: false },
        logger: authLogger,
        databaseHooks: {
            session: {
                create: {
                    // Don't keep a record of where and on what device someone signs in.
                    before: async session => ({ data: { ...session, ipAddress: null, userAgent: null } }),
                },
            },
        },
        plugins: [
            magicLink({
                expiresIn: MAGIC_LINK_TTL_SECONDS,
                storeToken: 'hashed',
                rateLimit: { window: 300, max: 10 },
                sendMagicLink: async ({ email, url }) => {
                    // Over the per-email limit, send nothing but answer exactly as usual:
                    // the response must not reveal anything about this address.
                    const { allowed } = await hit(table, 'signin-email', email.toLowerCase(), RATE_RULES.signInEmail, config.secret);
                    if (!allowed) {
                        logEvent('auth.signin_email_throttled', { email: pseudonym(email.toLowerCase(), config.secret) });
                        return;
                    }
                    await mailer({
                        to: email,
                        url: confirmationUrl(url, config.baseUrl),
                        expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60,
                    });
                },
            }),
        ],
    });
}

export type Auth = ReturnType<typeof createAuth>;
