'use client';

import { useSyncExternalStore } from 'react';

/**
 * Browser side of accounts. Everything here is optional sugar on an anonymous site:
 * nothing throws, nothing blocks rendering, and a signed-out visitor makes no account
 * requests at all (see SIGNED_IN_HINT).
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
}

export interface HistoryRecord {
    kind: 'food' | 'recipe' | 'plan' | (string & {});
    itemId: string | number;
    title: string;
    /** A path on this site, e.g. /food/123. */
    href: string;
    /** Small JSON summary shown in the history list (at most 8 KB). */
    data?: Record<string, unknown> | unknown[] | null;
}

export type RecordResult = 'sent' | 'queued' | 'dropped';

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
const QUEUE_KEY = 'md.historyQueue.v1';
const QUEUE_MAX_ITEMS = 50;
const QUEUE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 60_000;

const SERVER_STATE: UserState = { user: null, loading: true };
let state: UserState = SERVER_STATE;
let inflight: Promise<void> | null = null;
let lastChecked = 0;
let started = false;
const listeners = new Set<() => void>();

function storageGet(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key: string, value: string | null) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        /* private mode or storage full: the hint and queue are only conveniences */
    }
}

function setState(next: UserState) {
    const wasSignedIn = Boolean(state.user);
    state = next;
    listeners.forEach(l => l());
    if (next.user && !wasSignedIn) void flushQueue();
}

/**
 * Same-origin fetch for account routes. The SHA-256 header is what CloudFront's
 * origin access control needs to sign a request body for a Lambda URL
 * (docs/aws/AWS_HOSTING_DESIGN.md section 3.2), and is ignored everywhere else.
 */
export async function apiFetch(path: string, init: { method?: string; json?: unknown; keepalive?: boolean } = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (init.json !== undefined) {
        body = JSON.stringify(init.json);
        headers['Content-Type'] = 'application/json';
    }
    if (method !== 'GET' && globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body ?? ''));
        headers['x-amz-content-sha256'] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    return fetch(path, { method, headers, body, credentials: 'same-origin', keepalive: init.keepalive });
}

async function load(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const res = await apiFetch('/api/me');
            if (!res.ok) throw new Error(`status ${res.status}`);
            const { user } = (await res.json()) as { user: CurrentUser | null };
            storageSet(SIGNED_IN_HINT, user ? '1' : null);
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
    if (storageGet(SIGNED_IN_HINT)) return load();
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

/** Re-read the session from the server, for example after sign-in. */
export function refreshCurrentUser(): Promise<void> {
    start();
    return load();
}

/** Tell the client who the server rendered this page for. */
export function primeCurrentUser(user: CurrentUser) {
    start();
    storageSet(SIGNED_IN_HINT, '1');
    lastChecked = Date.now();
    if (state.user?.id !== user.id || state.loading) setState({ user, loading: false });
}

/** Clear the local view of the session after sign-out or account deletion. */
export function clearCurrentUser() {
    storageSet(SIGNED_IN_HINT, null);
    storageSet(QUEUE_KEY, null);
    setState({ user: null, loading: false });
}

/** Ask for a sign-in link. Resolves to the HTTP status so forms can explain rate limits. */
export async function requestSignInLink(email: string, next = '/account'): Promise<number> {
    const res = await apiFetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        json: { email, callbackURL: next, errorCallbackURL: '/account/sign-in' },
    });
    return res.status;
}

export async function signOut(): Promise<void> {
    await apiFetch('/api/auth/sign-out', { method: 'POST', json: {} });
    clearCurrentUser();
}

// ---- history ----

interface QueuedRecord extends HistoryRecord {
    queuedAt: number;
}

function readQueue(): QueuedRecord[] {
    const raw = storageGet(QUEUE_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const oldest = Date.now() - QUEUE_MAX_AGE_MS;
        return parsed.filter(i => i && typeof i === 'object' && typeof i.queuedAt === 'number' && i.queuedAt >= oldest);
    } catch {
        return [];
    }
}

function writeQueue(queue: QueuedRecord[]) {
    storageSet(QUEUE_KEY, queue.length ? JSON.stringify(queue) : null);
}

function enqueue(item: HistoryRecord) {
    const sameItem = (q: QueuedRecord) => q.kind === item.kind && String(q.itemId) === String(item.itemId);
    const queue = readQueue().filter(q => !sameItem(q));
    queue.push({ ...item, queuedAt: Date.now() });
    writeQueue(queue.slice(-QUEUE_MAX_ITEMS));
}

async function send(item: HistoryRecord): Promise<Response> {
    const { kind, itemId, title, href, data } = item;
    return apiFetch('/api/history', { method: 'POST', json: { kind, itemId, title, href, data }, keepalive: true });
}

let flushing: Promise<void> | null = null;

/** Upload what was viewed while signed out. A rejected item is dropped; a transient failure keeps the rest for later. */
export function flushQueue(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
        try {
            const queue = readQueue();
            while (queue.length) {
                const res = await send(queue[0]);
                if (res.status === 429 || res.status >= 500 || res.status === 401) return;
                queue.shift();
                writeQueue(queue);
            }
        } catch {
            /* offline: keep the queue */
        } finally {
            flushing = null;
        }
    })();
    return flushing;
}

/**
 * Remember that the visitor looked at something. Safe to call from anywhere, any
 * number of times, signed in or not: it never throws and never affects the page.
 *
 * Signed out, the item waits in this browser's localStorage (nothing leaves the
 * device) and is uploaded after sign-in. A repeat of the same item just moves it to
 * the top of the history.
 */
export async function recordHistory(item: HistoryRecord): Promise<RecordResult> {
    try {
        start();
        if (inflight) await inflight;
        if (!state.user) {
            enqueue(item);
            return 'queued';
        }
        const res = await send(item);
        if (res.ok) return 'sent';
        if (res.status === 401) {
            // The session ended (expired, or signed out elsewhere). Don't lose the item.
            storageSet(SIGNED_IN_HINT, null);
            setState({ user: null, loading: false });
        }
        if (res.status === 401 || res.status === 429 || res.status >= 500) {
            enqueue(item);
            return 'queued';
        }
        return 'dropped';
    } catch {
        try {
            enqueue(item);
            return 'queued';
        } catch {
            return 'dropped';
        }
    }
}

/** For tests: forget everything this module has learned. */
export function __resetClientState() {
    state = SERVER_STATE;
    inflight = null;
    flushing = null;
    lastChecked = 0;
    started = false;
    listeners.clear();
}
