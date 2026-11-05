import { createHmac } from 'node:crypto';

/**
 * Structured logs for the account code, with one rule: no personal data. People are
 * identified only by a keyed hash, and anything that looks like an email address,
 * token or sign-in URL is scrubbed from free text before it is printed.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_PARAM_RE = /([?&](?:token|code|state)=)[^&\s"']+/gi;

export function scrub(text: string): string {
    return text.replace(EMAIL_RE, '[email]').replace(TOKEN_PARAM_RE, '$1[redacted]');
}

/** A stable pseudonym for logs and rate-limit keys. Keyed, because IPs and emails are guessable. */
export function pseudonym(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 22);
}

export function logEvent(event: string, fields: Record<string, string | number | boolean | undefined> = {}) {
    console.log(JSON.stringify({ level: 'info', event, ...fields }));
}

export function logError(context: string, err: unknown) {
    const e = err as { name?: unknown; message?: unknown } | null;
    console.error(JSON.stringify({
        level: 'error',
        context,
        name: typeof e?.name === 'string' ? e.name : 'Error',
        message: scrub(typeof e?.message === 'string' ? e.message : String(err)),
    }));
}

/** Better Auth's logger, which would otherwise print arguments that can include user records. */
export const authLogger = {
    level: 'warn' as const,
    log(level: 'debug' | 'info' | 'success' | 'warn' | 'error', message: string) {
        if (level === 'warn' || level === 'error') {
            console[level === 'warn' ? 'warn' : 'error'](JSON.stringify({ level, context: 'better-auth', message: scrub(message) }));
        }
    },
};
