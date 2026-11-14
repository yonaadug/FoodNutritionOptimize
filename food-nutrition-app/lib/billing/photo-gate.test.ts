import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { harnessOn, signIn, siteRequest, type Harness } from '@/lib/auth/testing/harness';
import { SqliteTable } from '@/lib/user-store/sqlite-table';
import { EntitlementStore } from '@/lib/user-store/entitlements';
import { openPhotoRead, SIGN_IN_FOR_PHOTOS } from './photo-gate';

describe('photo gate', () => {
    let h: Harness;
    let n = 0;
    before(() => {
        const table = new SqliteTable(':memory:');
        h = { ...harnessOn(table), close: async () => table.close() };
    });
    after(() => h.close());

    const photoRequest = (cookie?: string) => siteRequest('/api/recipes/parse', { method: 'POST', cookie });

    it('photos need an account; the message says what a free one gets', async () => {
        const res = await openPhotoRead(photoRequest(), h);
        assert.equal(res.ok, false);
        if (!res.ok) {
            assert.equal(res.status, 401);
            assert.equal(res.code, 'sign_in_required');
            assert.equal(res.message, SIGN_IN_FOR_PHOTOS);
        }
        // A stale cookie is the same as none.
        assert.equal((await openPhotoRead(photoRequest('md.session_token=stale'), h)).ok, false);
    });

    it('a new account reads 10 photos in its trial, then sees the gate', async () => {
        const cookie = await signIn(h, `photo${++n}@example.com`);
        for (let i = 0; i < 10; i++) assert.equal((await openPhotoRead(photoRequest(cookie), h)).ok, true, `read ${i + 1}`);
        const gate = await openPhotoRead(photoRequest(cookie), h);
        assert.equal(gate.ok, false);
        if (!gate.ok) {
            assert.equal(gate.status, 403);
            assert.equal(gate.code, 'photo_quota');
            assert.match(gate.message, /used the 10 photo reads in your trial/);
            assert.equal(gate.usage?.remaining, 0);
        }
    });

    it('after the trial, the free monthly reads apply', async () => {
        const cookie = await signIn(h, `photo${++n}@example.com`);
        const userId = (await h.auth.api.getSession({ headers: new Headers({ cookie }) }))!.user.id;
        await new EntitlementStore(h.table).ensure(userId, new Date(Date.now() - 20 * 86_400_000));
        const results = [];
        for (let i = 0; i < 4; i++) results.push(await openPhotoRead(photoRequest(cookie), h));
        assert.deepEqual(results.map(r => r.ok), [true, true, true, false]);
        const last = results[3];
        if (!last.ok) assert.match(last.message, /^You've used your 3 photo reads this month\. You get 3 more on .+, or 50 a month with Plus\.$/);
    });

    it('a released read is given back', async () => {
        const cookie = await signIn(h, `photo${++n}@example.com`);
        const first = await openPhotoRead(photoRequest(cookie), h);
        assert.ok(first.ok);
        await first.release();
        const second = await openPhotoRead(photoRequest(cookie), h);
        assert.ok(second.ok);
        assert.equal(second.usage.used, 1);
    });

    it('with accounts unavailable, says so instead of failing', async () => {
        const res = await openPhotoRead(photoRequest('md.session_token=x'), null);
        assert.equal(res.ok, false);
        if (!res.ok) assert.equal(res.status, 503);
    });
});
