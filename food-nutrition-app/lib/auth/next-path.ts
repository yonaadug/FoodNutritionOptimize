/**
 * Where to send someone after they sign in. Only ever a page on this site: the value
 * arrives in a query string, so anyone can craft a link with `next=https://evil.example`.
 * Pure, so both the sign-in page (server) and the header (browser) use the same rule.
 */

export const DEFAULT_AFTER_SIGN_IN = '/account';

const SIGN_IN_PAGE = '/account/sign-in';
const MAX_LENGTH = 512;
// Control characters and spaces: browsers strip some of them, which can change where a URL goes.
const UNSAFE_CHARS = /[\u0000- \u007f-\u009f\\]/;
// Encoded slashes, backslashes and dots: a later decoding step could turn them into a new host or path.
const ENCODED_TRICKS = /%(2f|5c|2e)/i;

/** `raw` if it is a safe path on this site, otherwise `fallback`. */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
    if (!raw.startsWith('/') || raw.startsWith('//') || UNSAFE_CHARS.test(raw)) return fallback;

    const pathEnd = raw.search(/[?#]/);
    const path = pathEnd === -1 ? raw : raw.slice(0, pathEnd);
    if (ENCODED_TRICKS.test(path)) return fallback;
    if (path.split('/').some(segment => segment === '.' || segment === '..')) return fallback;

    if (path === SIGN_IN_PAGE || path.startsWith(`${SIGN_IN_PAGE}/`)) return fallback;
    if (path === '/api' || path.startsWith('/api/')) return fallback;

    try {
        const base = 'https://site.invalid';
        return new URL(raw, base).origin === base ? raw : fallback;
    } catch {
        return fallback;
    }
}

/** The sign-in page, returning to `next` afterwards. */
export function signInPath(next?: string | null): string {
    const safe = safeNextPath(next);
    return safe === DEFAULT_AFTER_SIGN_IN ? SIGN_IN_PAGE : `${SIGN_IN_PAGE}?next=${encodeURIComponent(safe)}`;
}

/** The page someone is on, as a `next` value. Null on the sign-in pages themselves. */
export function nextFromLocation(location: { pathname: string; search: string; hash: string }): string | null {
    const here = `${location.pathname}${location.search}${location.hash}`;
    return safeNextPath(here, '') || null;
}

/**
 * Where a sign-in link lands. This page can see the new session, tells the browser who
 * signed in, and then moves on to `next`.
 */
export function afterSignInPath(next: unknown): string {
    return `${SIGN_IN_PAGE}/done?next=${encodeURIComponent(safeNextPath(next))}`;
}
