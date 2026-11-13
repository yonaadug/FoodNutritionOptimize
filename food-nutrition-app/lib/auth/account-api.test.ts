import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_LIMITS } from '@/lib/user-store/history';
import { deleteAccount, deleteHistory, getAccountExport, getHistory, getMe, patchMe, postHistory } from './handlers';
import { toErrorResponse } from './http';
import { backends, harnessOn, signIn, siteRequest, type Harness } from './testing/harness';
import type { AccountDeps } from './handlers';

type Handler = (request: Request, deps: AccountDeps) => Promise<Response>;

/** Run a handler the way lib/auth/server.ts does, so thrown errors become JSON responses. */
async function call(h: AccountDeps, handler: Handler, request: Request): Promise<Response> {
    try {
        return await handler(request, h);
    } catch (err) {
        return toErrorResponse(err, 'test');
    }
}

const food = (itemId: string | number, extra: Record<string, unknown> = {}) => ({
    kind: 'food', itemId, title: `Food ${itemId}`, href: `/food/${itemId}`, data: { kcal: 100 }, ...extra,
});

for (const backend of backends) {
    describe(`account API: ${backend.name}`, () => {
        let h: Harness;
        let n = 0;
        const newUser = async () => {
            const email = `user${++n}@example.com`;
            return { email, cookie: await signIn(h, email) };
        };
        const post = (cookie: string, body: unknown) => call(h, postHistory, siteRequest('/api/history', { method: 'POST', cookie, body }));
        const list = async (cookie: string, query = '') => (await call(h, getHistory, siteRequest(`/api/history${query}`, { cookie }))).json();

        before(async () => {
            const { table, close } = await backend.start();
            h = { ...harnessOn(table), close };
        });
        after(() => h.close());

        it('everything but /api/me needs a session', async () => {
            for (const [handler, method] of [[getHistory, 'GET'], [postHistory, 'POST'], [deleteHistory, 'DELETE'], [getAccountExport, 'GET'], [deleteAccount, 'DELETE'], [patchMe, 'PATCH']] as [Handler, string][]) {
                const res = await call(h, handler, siteRequest('/api/x?all=1', { method, ...(method === 'GET' ? {} : { body: {} }) }));
                assert.equal(res.status, 401, handler.name);
                assert.equal((await res.json()).code, 'unauthorized');
            }
        });

        it('reads one item by kind and id, for a second browser reopening it', async () => {
            const a = await newUser();
            const b = await newUser();
            await post(a.cookie, { kind: 'plan', itemId: 'p1', title: 'My plan', href: '/plan?open=p1', data: { reopen: { foods: [1] } } });
            const res = await call(h, getHistory, siteRequest('/api/history?kind=plan&itemId=p1', { cookie: a.cookie }));
            assert.equal(res.status, 200);
            const { item } = await res.json();
            assert.equal(item.title, 'My plan');
            assert.deepEqual(item.data, { reopen: { foods: [1] } });

            const missing = await call(h, getHistory, siteRequest('/api/history?kind=plan&itemId=nope', { cookie: a.cookie }));
            assert.equal(missing.status, 404);
            const other = await call(h, getHistory, siteRequest('/api/history?kind=plan&itemId=p1', { cookie: b.cookie }));
            assert.equal(other.status, 404, 'another person cannot read it');
            const noKind = await call(h, getHistory, siteRequest('/api/history?itemId=p1', { cookie: a.cookie }));
            assert.equal(noKind.status, 400);
        });

        it('/api/me is { user: null } when signed out', async () => {
            const res = await call(h, getMe, siteRequest('/api/me'));
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { user: null });
        });

        it('responses are never cacheable', async () => {
            const { cookie } = await newUser();
            for (const res of [await call(h, getMe, siteRequest('/api/me', { cookie })), await call(h, getHistory, siteRequest('/api/history', { cookie })), await call(h, getHistory, siteRequest('/api/history'))]) {
                assert.equal(res.headers.get('cache-control'), 'private, no-store');
            }
        });

        it('refuses state changes from another site', async () => {
            const { cookie } = await newUser();
            for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }]) {
                const res = await call(h, postHistory, siteRequest('/api/history', { method: 'POST', cookie, body: food(1), headers }));
                assert.equal(res.status, 403, JSON.stringify(headers));
            }
            const noOrigin = new Request('http://localhost:3604/api/history', {
                method: 'POST',
                headers: { cookie, 'content-type': 'application/json' },
                body: JSON.stringify(food(1)),
            });
            assert.equal((await call(h, postHistory, noOrigin)).status, 403);
            assert.equal((await call(h, deleteAccount, siteRequest('/api/account', { method: 'DELETE', cookie, body: {}, headers: { origin: 'https://evil.example' } }))).status, 403);
        });

        it('requires JSON and a size-limited body', async () => {
            const { cookie } = await newUser();
            const text = await call(h, postHistory, siteRequest('/api/history', { method: 'POST', cookie, body: 'kind=food', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
            assert.equal(text.status, 415);
            const broken = await call(h, postHistory, siteRequest('/api/history', { method: 'POST', cookie, body: '{not json' }));
            assert.equal(broken.status, 400);
            const huge = await post(cookie, food(1, { title: 'x', data: { blob: 'y'.repeat(HISTORY_LIMITS.bodyBytes) } }));
            assert.equal(huge.status, 413);
            assert.equal((await huge.json()).code, 'payload_too_large');
            const big = await post(cookie, food(1, { data: { blob: 'y'.repeat(HISTORY_LIMITS.dataBytes) } }));
            assert.equal(big.status, 413);
        });

        it('validates fields, with a stable error shape', async () => {
            const { cookie } = await newUser();
            const bad: [Record<string, unknown>, string][] = [
                [{ kind: 'Bad Kind' }, 'kind'],
                [{ itemId: 'has space' }, 'itemId'],
                [{ title: '' }, 'title'],
                [{ href: 'https://evil.example/' }, 'href'],
                [{ href: '//evil.example/' }, 'href'],
                [{ href: 'javascript:alert(1)' }, 'href'],
                [{ data: 'a string' }, 'data'],
            ];
            for (const [change, field] of bad) {
                const res = await post(cookie, food(1, change));
                assert.equal(res.status, 400, JSON.stringify(change));
                const body = await res.json();
                assert.equal(body.code, 'invalid_request');
                assert.equal(body.details.field, field);
                assert.equal(typeof body.error, 'string');
            }
            assert.equal((await post(cookie, [1, 2])).status, 400);
        });

        it('upserts, lists newest first, filters by kind and paginates', async () => {
            const { cookie } = await newUser();
            for (const id of [1, 2, 3]) {
                assert.equal((await post(cookie, food(id))).status, 200);
                await new Promise(r => setTimeout(r, 3));
            }
            await post(cookie, { kind: 'recipe', itemId: 'soup', title: 'Soup', href: '/recipes?id=soup', data: { caloriesPerServing: 320, proteinPerServing: 18 } });
            await new Promise(r => setTimeout(r, 3));
            await post(cookie, food(1, { title: 'Food 1 again' })); // moves to the top

            const all = await list(cookie);
            assert.deepEqual(all.items.map((i: { itemId: string }) => i.itemId), ['1', 'soup', '3', '2']);
            assert.equal(all.items[0].title, 'Food 1 again');
            assert.equal(all.items.length, 4, 'an upsert does not duplicate');
            assert.equal(all.nextCursor, null);
            assert.notEqual(all.items[0].createdAt, all.items[0].updatedAt);

            const recipes = await list(cookie, '?kind=recipe');
            assert.deepEqual(recipes.items.map((i: { itemId: string }) => i.itemId), ['soup']);
            assert.equal(recipes.items[0].data.proteinPerServing, 18);

            const first = await list(cookie, '?kind=food&limit=2');
            assert.deepEqual(first.items.map((i: { itemId: string }) => i.itemId), ['1', '3']);
            assert.ok(first.nextCursor);
            const second = await list(cookie, `?kind=food&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
            assert.deepEqual(second.items.map((i: { itemId: string }) => i.itemId), ['2']);
            assert.equal(second.nextCursor, null);
        });

        it('rejects bad list parameters', async () => {
            const { cookie } = await newUser();
            for (const query of ['?limit=0', '?limit=1000', '?limit=abc', '?kind=Not%20Valid', '?cursor=garbage']) {
                const res = await call(h, getHistory, siteRequest(`/api/history${query}`, { cookie }));
                assert.equal(res.status, 400, query);
            }
        });

        it("can't read or change another person's history, even with their cursor", async () => {
            const a = await newUser();
            const b = await newUser();
            await post(a.cookie, food(1));
            await post(a.cookie, food(2));
            assert.deepEqual((await list(b.cookie)).items, []);
            const del = await call(h, deleteHistory, siteRequest('/api/history?kind=food&itemId=1', { method: 'DELETE', cookie: b.cookie }));
            assert.equal(del.status, 404);
            assert.equal((await list(a.cookie)).items.length, 2);

            const { nextCursor } = await list(a.cookie, '?limit=1');
            const stolen = await call(h, getHistory, siteRequest(`/api/history?limit=1&cursor=${encodeURIComponent(nextCursor)}`, { cookie: b.cookie }));
            assert.equal(stolen.status, 400);
        });

        it('deletes one item, and only clears when explicitly asked', async () => {
            const { cookie } = await newUser();
            await post(cookie, food(1));
            await post(cookie, food(2));
            await post(cookie, { kind: 'recipe', itemId: 'r', title: 'R', href: '/recipes' });
            const del = (query: string) => call(h, deleteHistory, siteRequest(`/api/history${query}`, { method: 'DELETE', cookie }));

            assert.equal((await del('')).status, 400);
            assert.equal((await del('?kind=food')).status, 400);
            assert.equal((await list(cookie)).items.length, 3, 'nothing was removed by a malformed request');

            assert.equal((await del('?kind=food&itemId=1')).status, 200);
            assert.equal((await del('?kind=food&itemId=1')).status, 404);
            assert.equal((await list(cookie)).items.length, 2);

            const clearFood = await del('?all=1&kind=food');
            assert.deepEqual(await clearFood.json(), { removed: 1 });
            assert.equal((await list(cookie)).items.length, 1);
            const clear = await del('?all=1');
            assert.deepEqual(await clear.json(), { removed: 1 });
            assert.equal((await list(cookie)).items.length, 0);
        });

        it('updates the display name and preferences, with limits', async () => {
            const { cookie, email } = await newUser();
            const patch = (body: unknown) => call(h, patchMe, siteRequest('/api/me', { method: 'PATCH', cookie, body }));
            const ok = await (await patch({ displayName: '  Sam  ', preferences: { units: 'metric' } })).json();
            assert.equal(ok.user.displayName, 'Sam');
            assert.equal(ok.user.email, email);
            assert.deepEqual(ok.user.preferences, { units: 'metric' });
            const me = await (await call(h, getMe, siteRequest('/api/me', { cookie }))).json();
            assert.equal(me.user.displayName, 'Sam');

            assert.equal((await patch({})).status, 400);
            assert.equal((await patch({ displayName: 'x'.repeat(61) })).status, 400);
            assert.equal((await patch({ preferences: [] })).status, 400);
            assert.equal((await patch({ preferences: { a: 'x'.repeat(3000) } })).status, 413);
        });

        it('a profile survives the next sign-in', async () => {
            const email = `user${++n}@example.com`;
            const cookie = await signIn(h, email);
            await call(h, patchMe, siteRequest('/api/me', { method: 'PATCH', cookie, body: { displayName: 'Keep', preferences: { units: 'us' } } }));
            const again = await signIn(h, email);
            const me = await (await call(h, getMe, siteRequest('/api/me', { cookie: again }))).json();
            assert.equal(me.user.displayName, 'Keep');
            assert.deepEqual(me.user.preferences, { units: 'us' });
        });

        it('exports everything held, as a download, without internals', async () => {
            const { cookie, email } = await newUser();
            await post(cookie, food(1));
            await post(cookie, { kind: 'plan', itemId: 'p', title: 'Plan', href: '/', data: { foods: 3 } });
            const res = await call(h, getAccountExport, siteRequest('/api/account/export', { cookie }));
            assert.equal(res.status, 200);
            assert.match(String(res.headers.get('content-disposition')), /attachment/);
            const text = await res.clone().text();
            const data = JSON.parse(text);
            assert.equal(data.format, 'nanonutrition-account-export');
            assert.equal(data.profile.email, email);
            assert.deepEqual(data.history.map((i: { kind: string }) => i.kind).sort(), ['food', 'plan']);
            for (const internal of ['PK', 'SK', 'GSI1PK', '_v', '_ptrs']) assert.ok(!text.includes(`"${internal}"`), internal);
        });

        it('delete needs the typed email, then removes everything and ends the session', async () => {
            const { cookie, email } = await newUser();
            const me = await (await call(h, getMe, siteRequest('/api/me', { cookie }))).json();
            const id = me.user.id;
            await post(cookie, food(1));
            await post(cookie, food(2));
            const del = (body: unknown) => call(h, deleteAccount, siteRequest('/api/account', { method: 'DELETE', cookie, body }));

            assert.equal((await del({})).status, 400);
            assert.equal((await del({ confirmEmail: 'someone@else.example' })).status, 400);
            assert.ok(await h.store.getProfile(id), 'an unconfirmed request changes nothing');

            const res = await del({ confirmEmail: email.toUpperCase() });
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { deleted: true });
            assert.ok(res.headers.getSetCookie().some(c => /session_token=;/.test(c) && /Max-Age=0/i.test(c)));

            assert.equal((await (await call(h, getMe, siteRequest('/api/me', { cookie }))).json()).user, null, 'the session is gone');
            assert.equal((await call(h, getHistory, siteRequest('/api/history', { cookie }))).status, 401);
            assert.equal(await h.store.getProfile(id), null);
            assert.deepEqual((await h.table.query({ pk: `USER#${id}` })).items, [], 'nothing is left in the partition');
            assert.deepEqual((await h.table.query({ pk: `USER#${id}#HIST`, index: 'GSI1' })).items, []);
            assert.equal(await h.table.get({ PK: `EMAIL#${email}`, SK: 'EMAIL' }), null, 'the email no longer resolves');

            const fresh = await signIn(h, email);
            const again = await (await call(h, getMe, siteRequest('/api/me', { cookie: fresh }))).json();
            assert.notEqual(again.user.id, id, 'signing up again is a brand-new account');
            assert.deepEqual((await list(fresh)).items, [], 'and old history does not come back');
        });

        it('rate-limits per user, with Retry-After', async () => {
            const { cookie } = await newUser();
            const headers = { 'x-forwarded-for': `198.51.100.${n}` };
            let refused: Response | undefined;
            let accepted = 0;
            for (let i = 0; i < 130 && !refused; i++) {
                const res = await call(h, postHistory, siteRequest('/api/history', { method: 'POST', cookie, body: food(1), headers }));
                if (res.status === 429) refused = res;
                else accepted++;
            }
            assert.ok(refused, 'the limit was reached');
            assert.ok(accepted >= 60 && accepted <= 120, String(accepted)); // a window boundary can split the run
            const body = await refused!.json();
            assert.equal(body.code, 'rate_limited');
            assert.ok(Number(refused!.headers.get('retry-after')) > 0);
        });

        it('rate-limits export, which reads a whole partition', async () => {
            const { cookie } = await newUser();
            const statuses: number[] = [];
            for (let i = 0; i < 6; i++) statuses.push((await call(h, getAccountExport, siteRequest('/api/account/export', { cookie }))).status);
            assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
        });
    });
}

describe('per-IP rate limit', () => {
    it('applies across different signed-in accounts on one address', async () => {
        const { table, close } = await backends[0].start();
        const h = harnessOn(table);
        const headers = { 'x-forwarded-for': '198.51.100.250' };
        const a = await signIn(h, 'ip-a@example.com');
        const b = await signIn(h, 'ip-b@example.com');
        const statuses: number[] = [];
        for (let i = 0; i < 620; i++) {
            const res = await call(h, getHistory, siteRequest('/api/history', { cookie: i % 2 ? a : b, headers }));
            statuses.push(res.status);
            if (res.status === 429) break;
        }
        assert.equal(statuses.at(-1), 429);
        await close();
    });
});
