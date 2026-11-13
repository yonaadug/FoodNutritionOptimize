/**
 * Auth settings from the environment, in one place. Evaluated on the first account
 * request, never at build time or for anonymous pages. Unsafe combinations throw
 * instead of quietly degrading: see the AUTH section of .env.example and docs/ACCOUNTS.md.
 */

export type EmailTransport = 'console' | 'ses';

export interface AuthConfig {
    baseUrl: string;
    origin: string;
    /** Origins allowed to make account requests: this site, or this machine under any of its names on a laptop. */
    origins: string[];
    isHttps: boolean;
    /** The site runs on this machine, so dev conveniences are safe. */
    isLocal: boolean;
    secret: string;
    emailTransport: EmailTransport;
    emailFrom: string;
    sesRegion?: string;
    google?: { clientId: string; clientSecret: string };
    /** Lowercase header names to read the client IP from, in order. */
    ipHeaders: string[];
}

export class AuthConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthConfigError';
    }
}

/** Only ever used when the base URL is localhost, so it can't sign anything that matters. */
const LOCAL_ONLY_SECRET = 'local-development-only-secret-not-for-production-use';
const MIN_SECRET_LENGTH = 32;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
    const isProduction = env.NODE_ENV === 'production';
    const rawBase = env.AUTH_BASE_URL
        || (isProduction ? env.NEXT_PUBLIC_SITE_URL : '')
        || (isProduction ? '' : `http://localhost:${env.PORT || 3000}`);
    if (!rawBase) throw new AuthConfigError('AUTH_BASE_URL (or NEXT_PUBLIC_SITE_URL) is required in production');

    let url: URL;
    try {
        url = new URL(rawBase);
    } catch {
        throw new AuthConfigError('AUTH_BASE_URL is not a valid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AuthConfigError('AUTH_BASE_URL must be http or https');
    const isLocal = LOCAL_HOSTS.has(url.hostname);
    const isHttps = url.protocol === 'https:';
    // Plain http anywhere but this machine would send session cookies in the clear.
    if (!isHttps && !isLocal) throw new AuthConfigError('AUTH_BASE_URL must use https unless it is localhost');

    const secret = env.AUTH_SECRET || (isLocal ? LOCAL_ONLY_SECRET : '');
    if (!secret) throw new AuthConfigError('AUTH_SECRET is required');
    if (secret.length < MIN_SECRET_LENGTH) throw new AuthConfigError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);

    const transport = env.AUTH_EMAIL_TRANSPORT || (isProduction ? 'ses' : 'console');
    if (transport !== 'console' && transport !== 'ses') throw new AuthConfigError('AUTH_EMAIL_TRANSPORT must be console or ses');
    // Printing sign-in links is a bearer credential in the logs: never on a deployed site.
    if (transport === 'console' && !isLocal) throw new AuthConfigError('AUTH_EMAIL_TRANSPORT=console is only allowed when AUTH_BASE_URL is localhost');
    const emailFrom = env.AUTH_EMAIL_FROM || (transport === 'console' ? 'NanoNutrition <no-reply@localhost>' : '');
    if (!emailFrom) throw new AuthConfigError('AUTH_EMAIL_FROM is required when AUTH_EMAIL_TRANSPORT=ses');

    const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined;

    return {
        baseUrl: url.origin,
        origin: url.origin,
        origins: isLocal
            ? ['localhost', '127.0.0.1', '[::1]'].map(host => `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`)
            : [url.origin],
        isHttps,
        isLocal,
        secret,
        emailTransport: transport,
        emailFrom,
        sesRegion: env.AWS_REGION,
        google,
        ipHeaders: (env.AUTH_IP_HEADERS || 'x-forwarded-for').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
    };
}
