'use client';

import { sameOriginFetch } from '@/lib/same-origin-fetch';
import { useSyncExternalStore } from 'react';
import type { PlanSummary } from '@/lib/billing/types';
import type { HistoryItem } from '@/lib/user-store/history';
import { LOCAL_DATA_CLEARED_EVENT, reconcileLocalData } from '@/lib/local-data';
import { afterSignInPath, signInPath } from './next-path';

/**
 * Browser side of accounts. Everything here is optional sugar on an anonymous site:
 * nothing throws, nothing blocks rendering, and a signed-out visitor makes no account
 * requests and has nothing stored (see SIGNED_IN_HINT).
 *
 *   const { user, loading } = useCurrentUser();
 *   recordHistory({ kind: 'recipe', itemId, title, href, data: { caloriesPerServing, proteinPerServing } });
 */

export interface CurrentUser {
    id: string;
    email: string;
    displayName: string;
    preferences: Record<string, unknown>;
    createdAt: string;
    /** The plan, trial and photo quota (lib/billing/types.ts). Absent from older responses. */
    plan?: PlanSummary | null;
}

export interface HistoryRecord {
    kind: 'food' | 'recipe' | 'plan' | (string & {});
    itemId: string | number;
    title: string;
    /** A path on this site, e.g. /food/123. */
    href: string;
    /** Small JSON summary shown in the history list (at most 8 KB). See lib/auth/history-summary.ts. */
    data?: Record<string, unknown> | unknown[] | null;
}

export type RecordResult = 'sent' | 'skipped' | 'failed';

export interface UserState {
    user: CurrentUser | null;
    /** True until we know whether someone is signed in. */
    loading: boolean;
}

/**
 * The session cookie is httpOnly, so scripts can't see it. This flag records "this
 * browser was signed in" so anonymous visitors never call /api/me: it saves a Lambda
 * invocation per page view and means the header doesn't flash. It grants nothing; the
 * server decides who is signed in. If it is lost, /account sets it again.
 */
const SIGNED_IN_HINT = 'md.signedIn';
const STALE_AFTER_MS = 60_000;

const SERVER_STATE: UserState = { user: null, loading: true };
let state: UserState = SERVER_STATE;
let inflight: Promise<void> | null = null;
let lastChecked = 0;
let started = false;
/** Who the last definite answer said was signed in. Undefined until there has been one. */
let lastIdentity: string | null | undefined;
const listeners = new Set<() => void>();

function readHint(): boolean {
    try {
        return localStorage.getItem(SIGNED_IN_HINT) !== null;
    } catch {
        return false;
    }
}

function writeHint(signedIn: boolean) {
    try {
        if (signedIn) localStorage.setItem(SIGNED_IN_HINT, '1');
        else localStorage.removeItem(SIGNED_IN_HINT);
    } catch {
        /* private mode or storage full: the hint is only a convenience */
    }
}

function setState(next: UserState) {
    state = next;
    listeners.forEach(l => l());
}

/**
 * Apply the rule for data in this browser (lib/local-data.ts) after a definite answer
 * about who is signed in. A failed request is not an answer, so being offline never
 * clears anything.
 */
function settleIdentity(user: CurrentUser | null) {
    const id = user?.id ?? null;
    let storage: Storage | null = null;
    try {
        storage = localStorage;
    } catch {
        /* blocked storage: nothing is kept, so nothing can be left behind */
    }
    const cleared = reconcileLocalData(storage, id);
    const leftOrSwitched = lastIdentity !== undefined && lastIdentity !== null && lastIdentity !== id;
    lastIdentity = id;
    if ((cleared || leftOrSwitched) && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(LOCAL_DATA_CLEARED_EVENT));
    }
}

/** Same-origin fetch for account routes; see lib/same-origin-fetch.ts for the CloudFront header. */
export async function apiFetch(path: string, init: { method?: string; json?: unknown; keepalive?: boolean } = {}): Promise<Response> {
    return sameOriginFetch(path, init);
}

function load(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const res = await apiFetch('/api/me');
            if (!res.ok) throw new Error(`status ${res.status}`);
            const { user } = (await res.json()) as { user: CurrentUser | null };
            writeHint(Boolean(user));
            settleIdentity(user);
            setState({ user, loading: false });
        } catch {
            // Offline or a server problem. Keep what we had rather than signing anyone out.
            setState({ user: state.user, loading: false });
        } finally {
            lastChecked = Date.now();
            inflight = null;
        }
    })();
    return inflight;
}

function check(): Promise<void> {
    if (readHint()) return load();
    settleIdentity(null);
    if (state.loading || state.user) setState({ user: null, loading: false });
    return Promise.resolve();
}

function start() {
    if (started || typeof window === 'undefined') return;
    started = true;
    window.addEventListener('focus', () => {
        // Catch a sign-out or expiry that happened while the tab was in the background.
        if (Date.now() - lastChecked > STALE_AFTER_MS) void check();
    });
    window.addEventListener('storage', e => {
        // Signed in or out in another tab.
        if (e.key === SIGNED_IN_HINT) void check();
    });
    void check();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    start();
    return () => {
        listeners.delete(listener);
    };
}

/** Who is signed in, for any component. `user` is null for anonymous visitors. */
export function useCurrentUser(): UserState {
    return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Re-read the session from the server, for example after changing the profile. */
export function refreshCurrentUser(): Promise<void> {
    start();
    return load();
}

/** Tell the client who the server rendered this page for. */
export function primeCurrentUser(user: CurrentUser) {
    start();
    writeHint(true);
    settleIdentity(user);
    lastChecked = Date.now();
    if (state.user?.id !== user.id || state.loading) setState({ user, loading: false });
}

/** Clear the local view of the session after sign-out or account deletion, and what that person left in this browser. */
export function clearCurrentUser() {
    writeHint(false);
    settleIdentity(null);
    setState({ user: null, loading: false });
}

/** The signed-in person's id right now, for code outside React. */
export function currentUserId(): string | null {
    return state.user?.id ?? null;
}

/** Ask for a sign-in link. Resolves to the HTTP status so forms can explain rate limits. */
export async function requestSignInLink(email: string, next = '/account'): Promise<number> {
    const res = await apiFetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        json: { email, callbackURL: afterSignInPath(next), errorCallbackURL: signInPath(next) },
    });
    return res.status;
}

export async function signOut(): Promise<void> {
    await apiFetch('/api/auth/sign-out', { method: 'POST', json: {} });
    clearCurrentUser();
}

/**
 * Remember that a signed-in person looked at something. Safe to call from anywhere,
 * any number of times: it never throws and never affects the page.
 *
 * Signed out, it does nothing at all: no request, nothing stored. What someone looks
 * at before signing in is not added to their account later. A repeat of the same item
 * just moves it to the top of the history. History is best-effort, so a failed write
 * isn't retried.
 */
export async function recordHistory(item: HistoryRecord): Promise<RecordResult> {
    try {
        start();
        if (inflight) await inflight;
        if (!state.user) return 'skipped';
        const { kind, itemId, title, href, data } = item;
        const res = await apiFetch('/api/history', { method: 'POST', json: { kind, itemId, title, href, data }, keepalive: true });
        if (res.ok) return 'sent';
        // The session ended (expired, or signed out elsewhere): stop treating them as signed in.
        if (res.status === 401) clearCurrentUser();
        return 'failed';
    } catch {
        return 'failed';
    }
}

export type HistoryLookup =
    | { status: 'ok'; item: HistoryItem }
    | { status: 'signed-out' | 'not-found' | 'failed' };

/** One saved item, for reopening it on this or another device. Asks the server nothing when signed out. */
export async function fetchHistoryItem(kind: string, itemId: string): Promise<HistoryLookup> {
    try {
        start();
        if (inflight) await inflight;
        if (!state.user) return { status: 'signed-out' };
        const res = await apiFetch(`/api/history?${new URLSearchParams({ kind, itemId })}`);
        if (res.status === 401) {
            clearCurrentUser();
            return { status: 'signed-out' };
        }
        if (res.status === 404) return { status: 'not-found' };
        if (!res.ok) return { status: 'failed' };
        const { item } = (await res.json()) as { item: HistoryItem };
        return { status: 'ok', item };
    } catch {
        return { status: 'failed' };
    }
}

/** The newest saved items of a kind, or an empty list when signed out or on any problem. */
export async function fetchLatestHistory(kind: string, limit = 1): Promise<HistoryItem[]> {
    try {
        start();
        if (inflight) await inflight;
        if (!state.user) return [];
        const res = await apiFetch(`/api/history?${new URLSearchParams({ kind, limit: String(limit) })}`);
        if (!res.ok) return [];
        return ((await res.json()) as { items: HistoryItem[] }).items;
    } catch {
        return [];
    }
}

/** For tests: forget everything this module has learned. */
export function __resetClientState() {
    lastIdentity = undefined;
    state = SERVER_STATE;
    inflight = null;
    lastChecked = 0;
    started = false;
    listeners.clear();
}
