import { getSessionCookie } from 'better-auth/cookies';
import {
    HISTORY_LIMITS, validateHistoryInput, validateItemId, validateKind,
} from '@/lib/user-store/history';
import type { SingleTable } from '@/lib/user-store/table';
import {
    DISPLAY_NAME_MAX, PREFERENCES_MAX_BYTES, type ProfilePatch, type UserProfile, type UserStore,
} from '@/lib/user-store/user-store';
import { CLIENT_IP_HEADER, type Auth } from './auth';
import type { AuthConfig } from './config';
import { AccountError, assertSameOrigin, clientIp, jsonOk, rateLimitIp, readJson } from './http';
import { logEvent, pseudonym } from './log';
import { enforce, RATE_RULES, type RateRule } from './rate-limit';

/**
 * The account API, as plain (Request, deps) => Response functions. The route files
 * in app/api only wire these up, so the tests can exercise them without a server.
 */

export interface AccountDeps {
    config: AuthConfig;
    table: SingleTable;
    store: UserStore;
    auth: Auth;
}

const COOKIE_PREFIX = 'md';
const PROFILE_BODY_MAX_BYTES = 4 * 1024;

/** Whether the request could be signed in at all. No I/O: anonymous visitors stay off the database. */
export function hasSessionCookie(request: Request | Headers): boolean {
    return Boolean(getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX }));
}

async function limitByIp(request: Request, deps: AccountDeps, scope: string, rule: RateRule) {
    const ip = rateLimitIp(request, deps.config);
    if (ip) await enforce(deps.table, `${scope}-ip`, ip, rule, deps.config.secret);
}

interface SessionUser {
    id: string;
    email: string;
}

async function currentUser(request: Request, deps: AccountDeps): Promise<SessionUser | null> {
    if (!hasSessionCookie(request)) return null;
    const session = await deps.auth.api.getSession({ headers: request.headers });
    return session?.user ? { id: session.user.id, email: session.user.email } : null;
}

async function requireUser(request: Request, deps: AccountDeps): Promise<SessionUser> {
    const user = await currentUser(request, deps);
    if (!user) throw new AccountError(401, 'unauthorized', 'Sign in to use this feature');
    return user;
}

export function publicUser(profile: UserProfile) {
    return {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        preferences: profile.preferences,
        createdAt: profile.createdAt,
    };
}

// ---- /api/me ----

export async function getMe(request: Request, deps: AccountDeps): Promise<Response> {
    await limitByIp(request, deps, 'read', RATE_RULES.readIp);
    // returnHeaders: a session refresh must reach the browser, or the cookie expires
    // 30 days after sign-in even for someone using the site every day.
    const { response: session, headers } = await deps.auth.api.getSession({ headers: request.headers, returnHeaders: true });
    const profile = session?.user ? await deps.store.getProfile(session.user.id) : null;
    const res = jsonOk({ user: profile ? publicUser(profile) : null });
    headers.forEach((value, name) => {
        if (name.toLowerCase() === 'set-cookie') res.headers.append('set-cookie', value);
    });
    return res;
}

function parseProfilePatch(body: unknown): ProfilePatch {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new AccountError(400, 'invalid_request', 'Request body must be a JSON object');
    }
    const { displayName, preferences } = body as Record<string, unknown>;
    const patch: ProfilePatch = {};
    if (displayName !== undefined) {
        if (typeof displayName !== 'string' || displayName.length > DISPLAY_NAME_MAX || /[\u0000-\u001f\u007f]/.test(displayName)) {
            throw new AccountError(400, 'invalid_request', `displayName must be at most ${DISPLAY_NAME_MAX} characters`, { field: 'displayName' });
        }
        patch.displayName = displayName.trim();
    }
    if (preferences !== undefined) {
        if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
            throw new AccountError(400, 'invalid_request', 'preferences must be a JSON object', { field: 'preferences' });
        }
        if (Buffer.byteLength(JSON.stringify(preferences), 'utf8') > PREFERENCES_MAX_BYTES) {
            throw new AccountError(413, 'payload_too_large', `preferences must be at most ${PREFERENCES_MAX_BYTES} bytes`, { field: 'preferences' });
        }
        patch.preferences = preferences as Record<string, unknown>;
    }
    if (patch.displayName === undefined && patch.preferences === undefined) {
        throw new AccountError(400, 'invalid_request', 'Nothing to update');
    }
    return patch;
}

export async function patchMe(request: Request, deps: AccountDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    await limitByIp(request, deps, 'write', RATE_RULES.writeIp);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'write-user', user.id, RATE_RULES.writeUser, deps.config.secret);
    const patch = parseProfilePatch(await readJson(request, PROFILE_BODY_MAX_BYTES));
    const profile = await deps.store.updateProfile(user.id, patch);
    if (!profile) throw new AccountError(404, 'not_found', 'Account not found');
    return jsonOk({ user: publicUser(profile) });
}

// ---- /api/history ----

function pageSize(params: URLSearchParams): number {
    const raw = params.get('limit');
    if (raw === null || raw === '') return HISTORY_LIMITS.pageSizeDefault;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > HISTORY_LIMITS.pageSizeMax) {
        throw new AccountError(400, 'invalid_request', `limit must be an integer between 1 and ${HISTORY_LIMITS.pageSizeMax}`, { field: 'limit' });
    }
    return n;
}

export async function getHistory(request: Request, deps: AccountDeps): Promise<Response> {
    await limitByIp(request, deps, 'read', RATE_RULES.readIp);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'read-user', user.id, RATE_RULES.readUser, deps.config.secret);
    const params = new URL(request.url).searchParams;
    const rawKind = params.get('kind');
    const rawItemId = params.get('itemId');
    if (rawItemId !== null) {
        if (!rawKind) throw new AccountError(400, 'invalid_request', 'Pass kind with itemId', { field: 'kind' });
        const item = await deps.store.getHistoryItem(user.id, validateKind(rawKind), validateItemId(rawItemId));
        if (!item) throw new AccountError(404, 'not_found', 'History item not found');
        return jsonOk({ item });
    }
    const page = await deps.store.listHistory(user.id, {
        kind: rawKind ? validateKind(rawKind) : undefined,
        limit: pageSize(params),
        cursor: params.get('cursor') || undefined,
    });
    return jsonOk(page);
}

export async function postHistory(request: Request, deps: AccountDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    await limitByIp(request, deps, 'write', RATE_RULES.writeIp);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'write-user', user.id, RATE_RULES.writeUser, deps.config.secret);
    const input = validateHistoryInput(await readJson(request, HISTORY_LIMITS.bodyBytes));
    const item = await deps.store.upsertHistory(user.id, input);
    return jsonOk({ item });
}

/**
 * DELETE /api/history?kind=food&itemId=123   remove one item
 * DELETE /api/history?all=1[&kind=food]      clear everything (or one kind)
 * Clearing is spelled out, so a request with a forgotten itemId can't wipe history.
 */
export async function deleteHistory(request: Request, deps: AccountDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    await limitByIp(request, deps, 'write', RATE_RULES.writeIp);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'write-user', user.id, RATE_RULES.writeUser, deps.config.secret);
    const params = new URL(request.url).searchParams;
    const rawKind = params.get('kind');
    const rawItemId = params.get('itemId');
    if (params.get('all') === '1') {
        if (rawItemId) throw new AccountError(400, 'invalid_request', 'Use either all=1 or itemId, not both');
        const removed = await deps.store.clearHistory(user.id, rawKind ? validateKind(rawKind) : undefined);
        return jsonOk({ removed });
    }
    if (!rawKind || !rawItemId) {
        throw new AccountError(400, 'invalid_request', 'Pass kind and itemId to remove one item, or all=1 to clear history');
    }
    const removed = await deps.store.deleteHistory(user.id, validateKind(rawKind), validateItemId(rawItemId));
    if (!removed) throw new AccountError(404, 'not_found', 'History item not found');
    return jsonOk({ removed: 1 });
}

// ---- /api/account ----

/** Attachment rather than page data, and still never cached. */
export async function getAccountExport(request: Request, deps: AccountDeps): Promise<Response> {
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'export-user', user.id, RATE_RULES.exportUser, deps.config.secret);
    const data = await deps.store.exportAccount(user.id);
    logEvent('account.exported', { user: pseudonym(user.id, deps.config.secret) });
    return jsonOk(data, {
        headers: { 'Content-Disposition': 'attachment; filename="nutrition-dictionary-account.json"' },
    });
}

/**
 * Sessions go first: once they are revoked no new request can pass the session check
 * while the data is being removed. Typing the address back is the confirmation: it
 * stops accidents and makes an unattended signed-in browser harder to abuse.
 */
export async function deleteAccount(request: Request, deps: AccountDeps): Promise<Response> {
    assertSameOrigin(request, deps.config);
    const user = await requireUser(request, deps);
    await enforce(deps.table, 'delete-user', user.id, RATE_RULES.deleteUser, deps.config.secret);
    const body = await readJson(request, PROFILE_BODY_MAX_BYTES);
    const typed = (body as { confirmEmail?: unknown } | null)?.confirmEmail;
    if (typeof typed !== 'string' || typed.trim().toLowerCase() !== user.email.toLowerCase()) {
        throw new AccountError(400, 'invalid_request', 'Type your email address to confirm', { field: 'confirmEmail' });
    }
    const context = await deps.auth.$context;
    await context.internalAdapter.deleteUserSessions(user.id);
    await deps.store.deleteAccountData(user.id);
    logEvent('account.deleted', { user: pseudonym(user.id, deps.config.secret) });

    const res = jsonOk({ deleted: true });
    const cookie = context.authCookies.sessionToken;
    const secure = deps.config.isHttps ? '; Secure' : '';
    res.headers.append('set-cookie', `${cookie.name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
    return res;
}

// ---- /api/auth/* ----

/**
 * Only what the site uses is reachable. Better Auth serves many more endpoints by
 * default (update-user, change-email, list-accounts and so on), and every one that
 * stays off is one the app doesn't need to think about.
 */
const AUTH_ROUTES: { method: string; path: RegExp }[] = [
    { method: 'POST', path: /^\/sign-in\/magic-link$/ },
    { method: 'GET', path: /^\/magic-link\/verify$/ },
    { method: 'POST', path: /^\/sign-in\/social$/ },
    { method: 'GET', path: /^\/callback\/google$/ },
    { method: 'POST', path: /^\/callback\/google$/ },
    { method: 'POST', path: /^\/sign-out$/ },
    { method: 'GET', path: /^\/get-session$/ },
    { method: 'GET', path: /^\/error$/ },
];

export async function authEndpoint(request: Request, deps: AccountDeps): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, '');
    if (!AUTH_ROUTES.some(r => r.method === request.method && r.path.test(path))) {
        throw new AccountError(404, 'not_found', 'Not found');
    }
    // Replace, never trust: a client-supplied value must not choose its own rate-limit bucket.
    const headers = new Headers(request.headers);
    headers.delete(CLIENT_IP_HEADER);
    const ip = clientIp(request, deps.config);
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
    const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, redirect: 'manual' };
    if (request.body) {
        init.body = request.body;
        init.duplex = 'half';
    }
    return deps.auth.handler(new Request(request.url, init));
}
