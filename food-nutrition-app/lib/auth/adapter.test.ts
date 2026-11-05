import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SingleTable } from '@/lib/user-store/table';
import { DuplicateRecordError, singleTableAdapter, UnsupportedAuthQueryError } from './adapter';
import { backends } from './testing/harness';

/** The adapter contract Better Auth relies on, driven through the same factory it uses. */
for (const backend of backends) {
    describe(`auth adapter: ${backend.name}`, () => {
        let table: SingleTable;
        let close: () => Promise<void>;
        let adapter: any;
        let n = 0;
        const uniq = () => `${++n}`;

        const createUser = (over: Record<string, unknown> = {}) => adapter.create({
            model: 'user',
            data: { email: `a${uniq()}@example.com`, name: '', emailVerified: true, createdAt: new Date(), updatedAt: new Date(), ...over },
        });
        const createAccount = (userId: string, over: Record<string, unknown> = {}) => adapter.create({
            model: 'account',
            data: { userId, providerId: 'google', accountId: `g${uniq()}`, createdAt: new Date(), updatedAt: new Date(), ...over },
        });

        before(async () => {
            ({ table, close } = await backend.start());
            adapter = singleTableAdapter(table)({} as never);
        });
        after(() => close());

        it('creates and finds a user by id and by email, with dates restored', async () => {
            const user = await createUser();
            assert.ok(user.id);
            assert.ok(user.createdAt instanceof Date);
            const byId = await adapter.findOne({ model: 'user', where: [{ field: 'id', value: user.id }] });
            assert.equal(byId.email, user.email);
            assert.ok(byId.createdAt instanceof Date);
            const byEmail = await adapter.findOne({ model: 'user', where: [{ field: 'email', value: user.email }] });
            assert.equal(byEmail.id, user.id);
            assert.equal(await adapter.findOne({ model: 'user', where: [{ field: 'email', value: 'nobody@example.com' }] }), null);
        });

        it('finds users by a list of ids', async () => {
            const [a, b] = [await createUser(), await createUser()];
            const rows = await adapter.findMany({ model: 'user', where: [{ field: 'id', value: [a.id, b.id, 'missing'], operator: 'in' }] });
            assert.deepEqual(rows.map((r: { id: string }) => r.id).sort(), [a.id, b.id].sort());
        });

        it('one email, one user, even when two sign-ups race', async () => {
            const email = `race${uniq()}@example.com`;
            const results = await Promise.allSettled([createUser({ email }), createUser({ email }), createUser({ email })]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
            assert.ok(rejected.reason instanceof DuplicateRecordError);
            await assert.rejects(createUser({ email: email.toUpperCase() }), DuplicateRecordError);
        });

        it('a failed create leaves nothing behind', async () => {
            const user = await createUser();
            const account = await createAccount(user.id);
            const id = 'fixed-id';
            await assert.rejects(adapter.create({
                model: 'account',
                forceAllowId: true,
                data: { id, userId: user.id, providerId: 'google', accountId: account.accountId, createdAt: new Date(), updatedAt: new Date() },
            }), DuplicateRecordError);
            assert.equal(await table.get({ PK: `ACCOUNTID#${id}`, SK: 'ACCOUNTID' }), null, 'the pointer written before the conflict was rolled back');
        });

        it('replaces an old orphaned pointer but respects a fresh one', async () => {
            const email = `orphan${uniq()}@example.com`;
            const key = { PK: `EMAIL#${email}`, SK: 'EMAIL' };
            await table.put({ ...key, targetPK: 'USER#gone', targetSK: 'PROFILE', createdAtMs: Date.now() });
            await assert.rejects(createUser({ email }), DuplicateRecordError);
            assert.equal(await adapter.findOne({ model: 'user', where: [{ field: 'email', value: email }] }), null, 'an orphan looks like no user');

            await table.put({ ...key, targetPK: 'USER#gone', targetSK: 'PROFILE', createdAtMs: Date.now() - 120_000 });
            const user = await createUser({ email });
            assert.equal((await adapter.findOne({ model: 'user', where: [{ field: 'email', value: email }] })).id, user.id);
        });

        it('finds accounts by provider identity, by id and by user', async () => {
            const user = await createUser();
            const a = await createAccount(user.id);
            const b = await createAccount(user.id, { providerId: 'other' });
            const byKey = await adapter.findMany({
                model: 'account',
                where: [{ field: 'providerId', value: 'google' }, { field: 'accountId', value: a.accountId }],
            });
            assert.deepEqual(byKey.map((r: { id: string }) => r.id), [a.id]);
            assert.equal((await adapter.findOne({ model: 'account', where: [{ field: 'id', value: b.id }] })).providerId, 'other');
            const mine = await adapter.findMany({ model: 'account', where: [{ field: 'userId', value: user.id }] });
            assert.equal(mine.length, 2);
            assert.equal(await adapter.count({ model: 'account', where: [{ field: 'userId', value: user.id }] }), 2);
        });

        it('sorts, offsets and limits findMany', async () => {
            const user = await createUser();
            for (const accountId of ['x1', 'x2', 'x3']) await createAccount(user.id, { accountId: `${accountId}${uniq()}` });
            const rows = await adapter.findMany({
                model: 'account',
                where: [{ field: 'userId', value: user.id }],
                sortBy: { field: 'accountId', direction: 'desc' },
                limit: 1,
                offset: 1,
            });
            assert.equal(rows.length, 1);
            assert.match(rows[0].accountId, /^x2/);
        });

        it('applies further where clauses, including OR and comparisons', async () => {
            const user = await createUser({ name: 'Ann' });
            const where = (extra: unknown[]) => adapter.findOne({ model: 'user', where: [{ field: 'id', value: user.id }, ...extra] });
            assert.equal(await where([{ field: 'name', value: 'Bob' }]), null);
            assert.ok(await where([{ field: 'name', value: 'Ann' }]));
            assert.ok(await where([{ field: 'name', value: 'ann', mode: 'insensitive' }]));
            assert.ok(await where([{ field: 'name', value: 'An', operator: 'starts_with' }]));
            assert.ok(await where([{ field: 'updatedAt', value: new Date(Date.now() + 60_000), operator: 'lt' }]));
            assert.equal(await where([{ field: 'updatedAt', value: new Date(Date.now() - 60_000), operator: 'lt' }]), null);
        });

        it('updates keep attributes the adapter does not know about, like preferences', async () => {
            const user = await createUser();
            const key = { PK: `USER#${user.id}`, SK: 'PROFILE' };
            const stored = await table.get(key);
            await table.put({ ...stored!, preferences: { units: 'metric' } }, { ifVersion: stored!._v });
            const updated = await adapter.update({ model: 'user', where: [{ field: 'id', value: user.id }], update: { name: 'New' } });
            assert.equal(updated.name, 'New');
            assert.deepEqual((await table.get(key))?.preferences, { units: 'metric' });
        });

        it('update returns null when nothing matches, and honours guards', async () => {
            const user = await createUser({ name: 'A' });
            assert.equal(await adapter.update({ model: 'user', where: [{ field: 'id', value: 'missing' }], update: { name: 'B' } }), null);
            assert.equal(await adapter.updateMany({ model: 'user', where: [{ field: 'id', value: user.id }, { field: 'name', value: 'Z' }], update: { name: 'B' } }), 0);
            assert.equal(await adapter.updateMany({ model: 'user', where: [{ field: 'id', value: user.id }, { field: 'name', value: 'A' }], update: { name: 'B' } }), 1);
        });

        it('changing an email moves the pointer, and cannot take someone else\'s', async () => {
            const a = await createUser();
            const b = await createUser();
            await assert.rejects(adapter.update({ model: 'user', where: [{ field: 'id', value: a.id }], update: { email: b.email } }), DuplicateRecordError);
            assert.equal((await adapter.findOne({ model: 'user', where: [{ field: 'id', value: a.id }] })).email, a.email);

            const next = `moved${uniq()}@example.com`;
            await adapter.update({ model: 'user', where: [{ field: 'id', value: a.id }], update: { email: next } });
            assert.equal((await adapter.findOne({ model: 'user', where: [{ field: 'email', value: next }] })).id, a.id);
            assert.equal(await adapter.findOne({ model: 'user', where: [{ field: 'email', value: a.email }] }), null);
        });

        it('delete and consumeOne remove the record and its pointers, and consume only once', async () => {
            const user = await createUser();
            await adapter.delete({ model: 'user', where: [{ field: 'id', value: user.id }] });
            assert.equal(await adapter.findOne({ model: 'user', where: [{ field: 'id', value: user.id }] }), null);
            assert.equal(await table.get({ PK: `EMAIL#${user.email}`, SK: 'EMAIL' }), null);

            const owner = await createUser();
            const account = await createAccount(owner.id);
            const results = await Promise.all(Array.from({ length: 4 }, () => adapter.consumeOne({ model: 'account', where: [{ field: 'id', value: account.id }] })));
            assert.equal(results.filter(Boolean).length, 1);
            assert.equal(await table.get({ PK: `ACCOUNTID#${account.id}`, SK: 'ACCOUNTID' }), null);
        });

        it('fails loudly on anything without an access path, instead of scanning', async () => {
            await assert.rejects(adapter.findMany({ model: 'user' }), UnsupportedAuthQueryError);
            await assert.rejects(adapter.findOne({ model: 'user', where: [{ field: 'name', value: 'x' }] }), UnsupportedAuthQueryError);
            await assert.rejects(adapter.findOne({ model: 'user', where: [{ field: 'email', value: 'x', connector: 'OR' }, { field: 'name', value: 'y', connector: 'OR' }] }), UnsupportedAuthQueryError);
            await assert.rejects(adapter.findMany({ model: 'account', where: [{ field: 'accountId', value: 'x' }] }), UnsupportedAuthQueryError);
        });
    });
}
