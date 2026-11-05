import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    __resetClientState, clearCurrentUser, flushQueue, primeCurrentUser, recordHistory, refreshCurrentUser, requestSignInLink, signOut,
} from './client';

class MemoryStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

const QUEUE = 'md.historyQueue.v1';
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
    it('signed out: stays on this device, with no network request at all', async () => {
        assert.equal(await recordHistory(item()), 'queued');
        assert.equal(calls.length, 0);
        assert.equal(JSON.parse(storage.getItem(QUEUE)!).length, 1);
    });

    it('signed in: posts the item', async () => {
        primeCurrentUser(USER);
        respond = () => Response.json({ item: {} });
        assert.equal(await recordHistory(item(7)), 'sent');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].path, '/api/history');
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(calls[0].body, item(7));
        assert.equal(storage.getItem(QUEUE), null);
    });

    it('never throws, even if fetch and storage both fail', async () => {
        primeCurrentUser(USER);
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        assert.equal(await recordHistory(item()), 'queued');

        const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        Object.defineProperty(globalThis, 'localStorage', { value: broken, configurable: true, writable: true });
        try {
            assert.ok(['queued', 'dropped'].includes(await recordHistory(item())));
        } finally {
            Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
        }
    });

    it('a transient failure queues the item, and a rejected item is dropped', async () => {
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 503 });
        assert.equal(await recordHistory(item(1)), 'queued');
        respond = () => new Response('{}', { status: 429 });
        assert.equal(await recordHistory(item(2)), 'queued');
        respond = () => new Response('{}', { status: 400 });
        assert.equal(await recordHistory(item(3)), 'dropped');
        assert.equal(JSON.parse(storage.getItem(QUEUE)!).length, 2);
    });

    it('an expired session queues the item and stops treating the visitor as signed in', async () => {
        primeCurrentUser(USER);
        respond = () => new Response('{}', { status: 401 });
        assert.equal(await recordHistory(item(1)), 'queued');
        assert.equal(storage.getItem(HINT), null);
        const before = calls.length;
        assert.equal(await recordHistory(item(2)), 'queued');
        assert.equal(calls.length, before, 'no more requests until the next sign-in');
    });

    it('the queue keeps one entry per item, is capped, and drops old entries', async () => {
        await recordHistory(item(1));
        await recordHistory(item(1));
        assert.equal(JSON.parse(storage.getItem(QUEUE)!).length, 1);

        for (let i = 0; i < 60; i++) await recordHistory(item(i));
        const queue = JSON.parse(storage.getItem(QUEUE)!);
        assert.equal(queue.length, 50);
        assert.equal(queue.at(-1).itemId, 59);

        storage.setItem(QUEUE, JSON.stringify([{ ...item(1), queuedAt: Date.now() - 40 * 24 * 3600 * 1000 }]));
        await recordHistory(item(2));
        assert.deepEqual(JSON.parse(storage.getItem(QUEUE)!).map((q: { itemId: number }) => q.itemId), [2]);
    });

    it('survives a corrupt queue', async () => {
        storage.setItem(QUEUE, '{not json');
        assert.equal(await recordHistory(item()), 'queued');
        storage.setItem(QUEUE, '"a string"');
        assert.equal(await recordHistory(item()), 'queued');
    });
});

describe('after sign-in', () => {
    it('uploads the queue once, then clears it', async () => {
        await recordHistory(item(1));
        await recordHistory(item(2));
        respond = () => Response.json({ item: {} });
        primeCurrentUser(USER);
        await flushQueue();
        assert.deepEqual(calls.map(c => (c.body as { itemId: number }).itemId), [1, 2]);
        assert.ok(calls.every(c => !('queuedAt' in (c.body as object))), 'internal fields stay local');
        assert.equal(storage.getItem(QUEUE), null);
    });

    it('stops on a transient failure and keeps what is left', async () => {
        await recordHistory(item(1));
        await recordHistory(item(2));
        respond = () => new Response('{}', { status: 503 });
        primeCurrentUser(USER);
        await flushQueue();
        assert.equal(calls.length, 1);
        assert.equal(JSON.parse(storage.getItem(QUEUE)!).length, 2);
    });

    it('skips an item the server rejects and carries on', async () => {
        await recordHistory(item(1));
        await recordHistory(item(2));
        respond = (() => {
            let n = 0;
            return () => (n++ === 0 ? new Response('{}', { status: 400 }) : Response.json({ item: {} }));
        })();
        primeCurrentUser(USER);
        await flushQueue();
        assert.equal(calls.length, 2);
        assert.equal(storage.getItem(QUEUE), null);
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

    it('sign-out clears the hint and any queue, so the next person on this browser starts clean', async () => {
        primeCurrentUser(USER);
        storage.setItem(QUEUE, JSON.stringify([{ ...item(), queuedAt: Date.now() }]));
        await signOut();
        assert.equal(calls[0].path, '/api/auth/sign-out');
        assert.equal(storage.getItem(HINT), null);
        assert.equal(storage.getItem(QUEUE), null);
    });

    it('clearCurrentUser makes recordHistory stop posting', async () => {
        primeCurrentUser(USER);
        clearCurrentUser();
        assert.equal(await recordHistory(item()), 'queued');
        assert.equal(calls.length, 0);
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
