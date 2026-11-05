import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { backends } from '@/lib/auth/testing/harness';
import { HISTORY_LIMITS, HistoryValidationError, validateHistoryInput, validateHref } from './history';
import { defaultAppDbPath, UserStoreConfigError } from './index';
import type { SingleTable } from './table';
import { createKeyValueStore, UserStore } from './user-store';

const input = (itemId: string, kind = 'food', extra: Record<string, unknown> = {}) => ({
    kind, itemId, title: `Item ${itemId}`, href: `/x/${itemId}`, data: { n: 1 }, ...extra,
});
const tick = () => new Promise(r => setTimeout(r, 3));

for (const backend of backends) {
    describe(`UserStore: ${backend.name}`, () => {
        let table: SingleTable;
        let close: () => Promise<void>;
        let store: UserStore;
        let n = 0;
        const user = () => `u${++n}`;

        before(async () => {
            ({ table, close } = await backend.start());
            store = new UserStore(table);
        });
        after(() => close());

        it('an upsert keeps createdAt and replaces the rest', async () => {
            const id = user();
            const first = await store.upsertHistory(id, input('a'));
            await tick();
            const second = await store.upsertHistory(id, input('a', 'food', { title: 'New', data: { n: 2 } }));
            assert.equal(second.createdAt, first.createdAt);
            assert.ok(second.updatedAt > first.updatedAt);
            const { items } = await store.listHistory(id);
            assert.equal(items.length, 1);
            assert.equal(items[0].title, 'New');
            assert.deepEqual(items[0].data, { n: 2 });
        });

        it('stores null when there is no data', async () => {
            const id = user();
            await store.upsertHistory(id, { kind: 'food', itemId: 'a', title: 'A', href: '/a' });
            assert.equal((await store.listHistory(id)).items[0].data, null);
        });

        it('kinds are separate: the same itemId can exist under two kinds', async () => {
            const id = user();
            await store.upsertHistory(id, input('1', 'food'));
            await store.upsertHistory(id, input('1', 'recipe'));
            assert.equal((await store.listHistory(id)).items.length, 2);
            assert.equal((await store.listHistory(id, { kind: 'food' })).items.length, 1);
            assert.equal(await store.deleteHistory(id, 'food', '1'), true);
            assert.equal((await store.listHistory(id)).items[0].kind, 'recipe');
        });

        it('evicts the oldest items of a kind past the cap, and only that kind', async () => {
            const capped = new UserStore(table, { maxItemsPerKind: 3 });
            const id = user();
            await capped.upsertHistory(id, input('other', 'recipe'));
            for (const itemId of ['a', 'b', 'c', 'd', 'e']) {
                await capped.upsertHistory(id, input(itemId));
                await tick();
            }
            const { items } = await capped.listHistory(id, { kind: 'food' });
            assert.deepEqual(items.map(i => i.itemId), ['e', 'd', 'c']);
            assert.equal((await capped.listHistory(id, { kind: 'recipe' })).items.length, 1);

            // Updating an existing item isn't growth, and deleting makes room.
            await capped.upsertHistory(id, input('c'));
            assert.equal((await capped.listHistory(id, { kind: 'food' })).items.length, 3);
            await capped.deleteHistory(id, 'food', 'd');
            await tick();
            await capped.upsertHistory(id, input('f'));
            assert.deepEqual((await capped.listHistory(id, { kind: 'food' })).items.map(i => i.itemId).sort(), ['c', 'e', 'f']);
        });

        it('clearing resets the cap counter', async () => {
            const capped = new UserStore(table, { maxItemsPerKind: 2 });
            const id = user();
            await capped.upsertHistory(id, input('a'));
            await capped.upsertHistory(id, input('b'));
            await capped.clearHistory(id);
            await capped.upsertHistory(id, input('c'));
            await tick();
            await capped.upsertHistory(id, input('d'));
            assert.equal((await capped.listHistory(id)).items.length, 2);
        });

        it('concurrent upserts of one item leave a single consistent item', async () => {
            const id = user();
            await Promise.all(Array.from({ length: 4 }, (_, i) => store.upsertHistory(id, input('same', 'food', { title: `T${i}` })).catch(() => null)));
            const { items } = await store.listHistory(id);
            assert.equal(items.length, 1);
        });

        it('a deleted account leaves no history partition behind, across many items', async () => {
            const id = user();
            for (let i = 0; i < 30; i++) await store.upsertHistory(id, input(`i${i}`));
            assert.equal((await store.listHistory(id, { limit: 100 })).items.length, 30);
            await store.deleteAccountData(id);
            assert.equal((await store.listHistory(id, { limit: 100 })).items.length, 0);
            assert.equal((await table.query({ pk: `USER#${id}` })).items.length, 0);
        });

        it('key-value storage: get, set with TTL, getAndDelete once, increment', async () => {
            const kv = createKeyValueStore(table);
            const key = `k${user()}`;
            assert.equal(await kv.get(key), null);
            await kv.set(key, 'v', 60);
            assert.equal(await kv.get(key), 'v');
            const results = await Promise.all([kv.getAndDelete(key), kv.getAndDelete(key), kv.getAndDelete(key)]);
            assert.deepEqual(results.filter(Boolean), ['v']);
            assert.equal(await kv.get(key), null);

            await kv.set(`${key}x`, 'v', 60);
            await kv.delete(`${key}x`);
            assert.equal(await kv.get(`${key}x`), null);

            assert.equal(await kv.increment(`${key}c`, 60), 1);
            assert.equal(await kv.increment(`${key}c`, 60), 2);
            assert.equal(await kv.get(`${key}c`), '2');
        });
    });
}

describe('history validation', () => {
    const fails = (body: unknown, field: string) => assert.throws(() => validateHistoryInput(body), (e: Error) => e instanceof HistoryValidationError && e.field === field, JSON.stringify(body));
    const good = { kind: 'food', itemId: '123', title: 'Salmon', href: '/food/123' };

    it('accepts a normal item and a numeric itemId', () => {
        assert.deepEqual(validateHistoryInput(good), { ...good, data: null });
        assert.equal(validateHistoryInput({ ...good, itemId: 123 }).itemId, '123');
        assert.equal(validateHistoryInput({ ...good, kind: 'meal-plan' }).kind, 'meal-plan');
    });

    it('rejects bad kinds, ids and titles', () => {
        for (const kind of ['', 'Food', '1food', 'a b', 'a#b', 'x'.repeat(HISTORY_LIMITS.kindLength + 1), 5, null]) fails({ ...good, kind }, 'kind');
        for (const itemId of ['', 'a b', 'a#b', 'a/b', 'x'.repeat(HISTORY_LIMITS.itemIdLength + 1), 1.5, null, {}]) fails({ ...good, itemId }, 'itemId');
        for (const title of ['', '   ', 'x'.repeat(HISTORY_LIMITS.titleLength + 1), 5, null, '\u0001\u0002']) fails({ ...good, title }, 'title');
    });

    it('strips control characters from titles', () => {
        assert.equal(validateHistoryInput({ ...good, title: 'Sal\nmon\u0000 ' }).title, 'Sal mon');
    });

    it('only accepts paths on this site as links', () => {
        for (const href of ['/', '/food/1', '/recipes?id=a&b=c#top', '/a%20b']) assert.equal(validateHref(href), href);
        for (const href of [
            'https://evil.example', 'http://evil.example/', '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example',
            'javascript:alert(1)', 'data:text/html,x', 'food/1', '', ' /food', '/a\nb', '/a\tb', 'x'.repeat(HISTORY_LIMITS.hrefLength + 1), `/${'x'.repeat(HISTORY_LIMITS.hrefLength)}`, 5, null,
        ]) {
            assert.throws(() => validateHref(href), HistoryValidationError, String(href));
        }
    });

    it('caps data by serialized UTF-8 size and refuses non-objects', () => {
        const atLimit = { a: 'x'.repeat(HISTORY_LIMITS.dataBytes - '{"a":""}'.length) };
        assert.ok(validateHistoryInput({ ...good, data: atLimit }).data);
        assert.throws(() => validateHistoryInput({ ...good, data: { a: 'é'.repeat(HISTORY_LIMITS.dataBytes / 2) } }), (e: HistoryValidationError) => e.tooLarge === true);
        for (const data of ['text', 5, true]) fails({ ...good, data }, 'data');
    });

    it('refuses bodies that are not objects', () => {
        for (const body of [null, 5, 'x', []]) fails(body, 'body');
    });
});

describe('store selection', () => {
    it('keeps the default database beside the app, also when running from the standalone bundle', () => {
        const app = path.join(path.sep, 'srv', 'app');
        assert.equal(defaultAppDbPath(app), path.join(app, '.data', 'app.db'));
        assert.equal(defaultAppDbPath(path.join(app, '.next', 'standalone')), path.join(app, '.data', 'app.db'));
    });

    it('has a distinct config error type', () => {
        assert.equal(new UserStoreConfigError('x').name, 'UserStoreConfigError');
    });
});
