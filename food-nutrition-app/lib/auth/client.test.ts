import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    __resetClientState, clearCurrentUser, primeCurrentUser, recordHistory, refreshCurrentUser, requestSignInLink, signOut,
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
        assert.deepEqual(calls[0].body, { email: 'a@example.com', callbackURL: '/recipes', errorCallbackURL: '/account/sign-in' });
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
