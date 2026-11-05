import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteTable } from './sqlite-table';
import { InvalidCursorError, nowSeconds, type SingleTable } from './table';
import { startDynalite, type DynaliteHarness } from './testing/dynalite';

/** The same contract, on both backends: this is what keeps dev and production honest. */
function contract(name: string, setup: () => Promise<{ table: SingleTable; close: () => Promise<void> }>) {
    describe(`SingleTable contract: ${name}`, () => {
        let table: SingleTable;
        let close: () => Promise<void>;
        let n = 0;
        let pk: string;

        before(async () => {
            ({ table, close } = await setup());
        });
        after(async () => close());
        beforeEach(() => {
            pk = `T#${++n}`;
        });

        it('stores and reads an item, including nested JSON', async () => {
            assert.equal(await table.get({ PK: pk, SK: 'a' }), null);
            assert.equal(await table.put({ PK: pk, SK: 'a', data: { x: [1, { y: 'z' }], ok: true, nothing: null } }), true);
            const item = await table.get({ PK: pk, SK: 'a' });
            assert.deepEqual(item?.data, { x: [1, { y: 'z' }], ok: true, nothing: null });
        });

        it('ifNotExists refuses to overwrite a live item but replaces an expired one', async () => {
            assert.equal(await table.put({ PK: pk, SK: 'a', v: 1 }, { ifNotExists: true }), true);
            assert.equal(await table.put({ PK: pk, SK: 'a', v: 2 }, { ifNotExists: true }), false);
            assert.equal((await table.get({ PK: pk, SK: 'a' }))?.v, 1);

            await table.put({ PK: pk, SK: 'old', v: 1, expiresAt: nowSeconds() - 5 });
            assert.equal(await table.put({ PK: pk, SK: 'old', v: 2 }, { ifNotExists: true }), true);
            assert.equal((await table.get({ PK: pk, SK: 'old' }))?.v, 2);
        });

        it('ifVersion is a compare-and-set', async () => {
            await table.put({ PK: pk, SK: 'a', v: 1 }, { ifNotExists: true });
            const first = await table.get({ PK: pk, SK: 'a' });
            assert.equal(first?._v, 1);
            assert.equal(await table.put({ ...first!, v: 2 }, { ifVersion: 1 }), true);
            assert.equal(await table.put({ ...first!, v: 3 }, { ifVersion: 1 }), false, 'a stale writer loses');
            const second = await table.get({ PK: pk, SK: 'a' });
            assert.equal(second?.v, 2);
            assert.equal(second?._v, 2);
        });

        it('expired items are invisible to get and query', async () => {
            await table.put({ PK: pk, SK: 'gone', expiresAt: nowSeconds() - 1, GSI1PK: `${pk}#i`, GSI1SK: '1' });
            await table.put({ PK: pk, SK: 'here', expiresAt: nowSeconds() + 60, GSI1PK: `${pk}#i`, GSI1SK: '2' });
            assert.equal(await table.get({ PK: pk, SK: 'gone' }), null);
            assert.deepEqual((await table.query({ pk })).items.map(i => i.SK), ['here']);
            assert.deepEqual((await table.query({ pk: `${pk}#i`, index: 'GSI1' })).items.map(i => i.SK), ['here']);
        });

        it('take is atomic: concurrent callers get the item at most once', async () => {
            await table.put({ PK: pk, SK: 'token', v: 'secret' });
            const results = await Promise.all(Array.from({ length: 8 }, () => table.take({ PK: pk, SK: 'token' })));
            assert.equal(results.filter(Boolean).length, 1);
            assert.equal(await table.get({ PK: pk, SK: 'token' }), null);
            assert.equal(await table.take({ PK: pk, SK: 'token' }), null);
        });

        it('take does not return an expired item, and honours ifVersion', async () => {
            await table.put({ PK: pk, SK: 'old', expiresAt: nowSeconds() - 1 });
            assert.equal(await table.take({ PK: pk, SK: 'old' }), null);
            await table.put({ PK: pk, SK: 'a' }, { ifNotExists: true });
            assert.equal(await table.take({ PK: pk, SK: 'a' }, { ifVersion: 99 }), null);
            assert.ok(await table.get({ PK: pk, SK: 'a' }), 'a failed condition leaves the item alone');
            assert.ok(await table.take({ PK: pk, SK: 'a' }, { ifVersion: 1 }));
        });

        it('queries by prefix, in order, with exact pagination', async () => {
            for (const sk of ['A#1', 'A#2', 'A#3', 'A#4', 'A#5', 'B#1']) await table.put({ PK: pk, SK: sk });
            const seen: string[] = [];
            let cursor: string | undefined;
            let pages = 0;
            do {
                const page = await table.query({ pk, skPrefix: 'A#', limit: 2, cursor });
                seen.push(...page.items.map(i => i.SK));
                cursor = page.cursor;
                pages++;
            } while (cursor);
            assert.deepEqual(seen, ['A#1', 'A#2', 'A#3', 'A#4', 'A#5']);
            assert.equal(pages, 3);

            const exact = await table.query({ pk, skPrefix: 'A#', limit: 5 });
            assert.equal(exact.items.length, 5);
            assert.equal(exact.cursor, undefined, 'no cursor when the page ends exactly at the last item');

            const desc = await table.query({ pk, skPrefix: 'A#', limit: 2, descending: true });
            assert.deepEqual(desc.items.map(i => i.SK), ['A#5', 'A#4']);
        });

        it('paginates an index descending, including equal sort keys', async () => {
            const gsi = `${pk}#i`;
            for (const [sk, order] of [['a', '1'], ['b', '2'], ['c', '2'], ['d', '3']]) {
                await table.put({ PK: `${pk}#${sk}`, SK: 'x', GSI2PK: gsi, GSI2SK: order });
            }
            const seen: string[] = [];
            let cursor: string | undefined;
            do {
                const page = await table.query({ pk: gsi, index: 'GSI2', limit: 1, descending: true, cursor });
                seen.push(...page.items.map(i => String(i.GSI2SK)));
                cursor = page.cursor;
            } while (cursor);
            assert.deepEqual(seen, ['3', '2', '2', '1']);
        });

        it('rejects a cursor issued for a different partition or garbage', async () => {
            for (const sk of ['1', '2', '3']) await table.put({ PK: pk, SK: sk });
            const { cursor } = await table.query({ pk, limit: 1 });
            assert.ok(cursor);
            await assert.rejects(table.query({ pk: 'T#someone-else', cursor }), InvalidCursorError);
            await assert.rejects(table.query({ pk, cursor: 'not-a-cursor' }), InvalidCursorError);
        });

        it('increment is atomic and creates, then counts, then restarts after expiry', async () => {
            const key = { PK: pk, SK: 'counter' };
            const values = await Promise.all(Array.from({ length: 10 }, () => table.increment(key, 1, 60)));
            assert.deepEqual([...values].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            assert.equal(await table.increment(key, -3), 7);

            const expired = { PK: pk, SK: 'expired' };
            await table.put({ ...expired, count: 40, expiresAt: nowSeconds() - 1 });
            assert.equal(await table.increment(expired, 1, 60), 1);
            const item = await table.get(expired);
            assert.ok((item?.expiresAt as number) > nowSeconds());
        });

        it('later increments do not extend the expiry', async () => {
            const key = { PK: pk, SK: 'window' };
            await table.increment(key, 1, 60);
            const before = (await table.get(key))?.expiresAt;
            await table.increment(key, 1, 6000);
            assert.equal((await table.get(key))?.expiresAt, before);
        });

        it('deleteMany removes across pages of the batch limit', async () => {
            const keys = Array.from({ length: 60 }, (_, i) => ({ PK: pk, SK: `k${String(i).padStart(3, '0')}` }));
            for (const key of keys) await table.put(key);
            await table.deleteMany(keys);
            assert.equal((await table.query({ pk })).items.length, 0);
        });
    });
}

contract('SQLite', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'md-table-'));
    const table = new SqliteTable(path.join(dir, 'nested', 'app.db'));
    return {
        table,
        close: async () => {
            table.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
});

contract('DynamoDB (dynalite)', async () => {
    const harness: DynaliteHarness = await startDynalite();
    return { table: harness.table, close: () => harness.close() };
});

describe('SQLite store', () => {
    it('purges expired rows without touching live ones', async () => {
        const table = new SqliteTable(':memory:');
        await table.put({ PK: 'a', SK: 'old', expiresAt: nowSeconds() - 1 });
        await table.put({ PK: 'a', SK: 'new', expiresAt: nowSeconds() + 60 });
        table.purgeExpired();
        assert.deepEqual((await table.query({ pk: 'a' })).items.map(i => i.SK), ['new']);
        table.close();
    });
});
