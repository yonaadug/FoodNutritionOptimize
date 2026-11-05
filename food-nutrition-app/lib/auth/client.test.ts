import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    __resetClientState, clearCurrentUser, fetchHistoryItem, primeCurrentUser, recordHistory, refreshCurrentUser, requestSignInLink, signOut,
} from './client';

class MemoryStorage {
    private m = new Map<string, string>();
    get size() { return this.m.size; }
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

const HINT = 'md.signedIn';
const USER = { id: 'u1', email: 'a@example.com', displayName: '', preferences: {}, createdAt: '2026-01-01T00:00:00.000Z' };
const item = (itemId: string | number = 1) => ({ kind: 'food', itemId, title: 'Salmon', href: `/food/${itemId}`, data: { kcal: 208 } });

let calls: { path: string; method: string; body?: unknown; headers: Record<string, string> }[] = [];
let respond: (path: string, method: string) => Response | Promise<Response>;
const realFetch = globalThis.fetch;

beforeEach(() => {
    storage.clear();
    __resetClientState();
    calls = [];
    respond = () => Response.json({ user: null });
    globalThis.fetch = (async (path: string, init: RequestInit) => {
        calls.push({
            path,
            method: init.method ?? 'GET',
            body: init.body ? JSON.parse(String(init.body)) : undefined,
            headers: init.headers as Record<string, string>,
        });
        return respond(path, init.method ?? 'GET');
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('recordHistory', () => {
    it('signed out: does nothing at all, with no request and nothing stored', async () => {
        assert.equal(await recordHistory(item()), 'skipped');
        assert.equal(calls.length, 0);
        assert.equal(storage.size, 0);
    });

    it('signed in: posts the item', async () => {
        primeCurrentUser(USER);
        respond = () => Response.json({ item: {} });
        assert.equal(await recordHistory(item(7)), 'sent');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].path, '/api/history');
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(calls[0].body, item(7));
    });

    it('views from before sign-in are not uploaded afterwards', async () => {
        await recordHistory(item(1));
        primeCurrentUser(USER);
        await refreshCurrentUser();
        assert.ok(calls.every(c => c.path !== '/api/history'));
    });

    it('never throws, even if fetch and storage both fail', async () => {
        primeCurrentUser(USER);
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        assert.equal(await recordHistory(item()), 'failed');

        const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        Object.defineProperty(globalThis, 'localStorage', { value: broken, configurable: true, writable: true });
        try {
            assert.equal(await recordHistory(item()), 'failed');
            clearCurrentUser();
            assert.equal(await recordHistory(item()), 'skipped');
        } finally {
            Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
        }
    });

    it('a rejected or failed write is reported, not retried', async () => {
        primeCurrentUser(USER);
        for (const status of [400, 429, 503]) {
            respond = () => new Response('{}', { status });
            assert.equal(await recordHistory(item(status)), 'failed', String(status));
        }
        assert.equal(calls.length, 3);
    });

    it('an expired session stops further requests until the next sign-in', async () => {
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 401 });
        assert.equal(await recordHistory(item(1)), 'failed');
        assert.equal(storage.getItem(HINT), null);
        assert.equal(await recordHistory(item(2)), 'skipped');
        assert.equal(calls.length, 1);
    });
});

describe('session state', () => {
    it('a server answer of no user clears the hint', async () => {
        storage.setItem(HINT, '1');
        await refreshCurrentUser();
        assert.equal(storage.getItem(HINT), null);
    });

    it('a server answer with a user sets the hint', async () => {
        respond = () => Response.json({ user: USER });
        await refreshCurrentUser();
        assert.equal(storage.getItem(HINT), '1');
    });

    it('a server error does not sign anyone out', async () => {
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 500 });
        await refreshCurrentUser();
        assert.equal(storage.getItem(HINT), '1');
        respond = () => Response.json({ item: {} });
        assert.equal(await recordHistory(item()), 'sent');
    });

    it('sign-out clears the hint and makes recordHistory stop posting', async () => {
        primeCurrentUser(USER);
        await signOut();
        assert.equal(calls[0].path, '/api/auth/sign-out');
        assert.equal(storage.getItem(HINT), null);
        assert.equal(await recordHistory(item()), 'skipped');
        assert.equal(calls.length, 1);
    });
});

describe('requests', () => {
    it('sign-in asks for the callback and an error page on this site', async () => {
        respond = () => Response.json({ status: true });
        assert.equal(await requestSignInLink('a@example.com', '/recipes'), 200);
        assert.deepEqual(calls[0].body, {
            email: 'a@example.com',
            // Through the page that tells the browser who signed in, then on to /recipes.
            callbackURL: '/account/sign-in/done?next=%2Frecipes',
            errorCallbackURL: '/account/sign-in?next=%2Frecipes',
        });
    });

    it('includes the body hash CloudFront needs, and only on writes', async () => {
        primeCurrentUser(USER);
        respond = () => Response.json({ item: {} });
        await recordHistory(item());
        assert.match(calls[0].headers['x-amz-content-sha256'], /^[0-9a-f]{64}$/);
        await refreshCurrentUser();
        assert.equal(calls[1].headers['x-amz-content-sha256'], undefined);
    });
});

describe('data left in this browser', () => {
    const WORK = { selectedFoods: '[1]', 'nc.plan.v1': '{"v":2}', 'recipes.recent.v1': '[{"id":"r"}]', 'mnd.recentSearches.v1': '["rice"]' };
    const put = () => Object.entries(WORK).forEach(([k, v]) => storage.setItem(k, v));
    const left = () => Object.keys(WORK).filter(k => storage.getItem(k) !== null);
    const events: string[] = [];
    const realWindow = (globalThis as { window?: unknown }).window;

    beforeEach(() => {
        events.length = 0;
        // Only what the module needs: the "cleared" announcement.
        (globalThis as { window?: unknown }).window = {
            addEventListener() {},
            dispatchEvent: (e: Event) => { events.push(e.type); return true; },
        };
    });
    afterEach(() => { (globalThis as { window?: unknown }).window = realWindow; });

    it('stays for anonymous visitors, who make no requests', async () => {
        put();
        await recordHistory(item());
        clearCurrentUser();
        assert.deepEqual(left(), Object.keys(WORK));
        assert.equal(calls.length, 0);
        assert.deepEqual(events, []);
    });

    it('stays when someone signs in, and is not uploaded', async () => {
        put();
        primeCurrentUser(USER);
        respond = () => Response.json({ user: USER });
        await refreshCurrentUser();
        assert.deepEqual(left(), Object.keys(WORK));
        assert.ok(calls.every(c => c.path !== '/api/history'));
    });

    it('is cleared by signing out', async () => {
        put();
        primeCurrentUser(USER);
        respond = () => Response.json({ status: true });
        await signOut();
        assert.deepEqual(left(), []);
        assert.deepEqual(events, ['mnd:local-data-cleared']);
    });

    it('is cleared after account deletion (which ends in clearCurrentUser)', () => {
        put();
        primeCurrentUser(USER);
        clearCurrentUser();
        assert.deepEqual(left(), []);
    });

    it('is cleared when the session turns out to have ended', async () => {
        put();
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 401 });
        await recordHistory(item());
        assert.deepEqual(left(), []);
    });

    it('is cleared when the server says nobody is signed in any more', async () => {
        put();
        primeCurrentUser(USER);
        respond = () => Response.json({ user: null });
        await refreshCurrentUser();
        assert.deepEqual(left(), []);
    });

    it('is not cleared by a network or server problem', async () => {
        put();
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 500 });
        await refreshCurrentUser();
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        await refreshCurrentUser();
        assert.deepEqual(left(), Object.keys(WORK));
    });

    it('never reaches a second person signing in on the same browser', async () => {
        put();
        primeCurrentUser(USER);
        respond = () => Response.json({ user: { ...USER, id: 'u2', email: 'b@example.com' } });
        await refreshCurrentUser();
        assert.deepEqual(left(), []);
        assert.deepEqual(events, ['mnd:local-data-cleared']);
    });
});

describe('fetchHistoryItem', () => {
    it('asks nothing when signed out', async () => {
        assert.deepEqual(await fetchHistoryItem('plan', 'p1'), { status: 'signed-out' });
        assert.equal(calls.length, 0);
    });

    it('returns the item, read by kind and id', async () => {
        primeCurrentUser(USER);
        respond = () => Response.json({ item: { itemId: 'p1' } });
        const got = await fetchHistoryItem('plan', 'p 1');
        assert.equal(got.status, 'ok');
        assert.equal(calls[0].path, '/api/history?kind=plan&itemId=p+1');
    });

    it('tells apart gone, signed out and failed', async () => {
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 404 });
        assert.equal((await fetchHistoryItem('plan', 'p1')).status, 'not-found');
        respond = () => new Response('{}', { status: 500 });
        assert.equal((await fetchHistoryItem('plan', 'p1')).status, 'failed');
        respond = () => new Response('{}', { status: 401 });
        assert.equal((await fetchHistoryItem('plan', 'p1')).status, 'signed-out');
    });
});
