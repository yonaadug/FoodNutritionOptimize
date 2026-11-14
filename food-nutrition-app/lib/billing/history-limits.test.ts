import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backends } from '@/lib/auth/testing/harness';
import type { SingleTable } from '@/lib/user-store/table';
import { UserStore } from '@/lib/user-store/user-store';
import { FREE_HISTORY_LIMIT } from './entitlements';
import { historyItemVisible, listHistoryWithLimit } from './history-limits';

const tick = () => new Promise(r => setTimeout(r, 3));
const item = (kind: string, itemId: string) => ({ kind, itemId, title: `${kind} ${itemId}`, href: `/x/${itemId}`, data: null });

for (const backend of backends) {
    describe(`history limits: ${backend.name}`, () => {
        let table: SingleTable;
        let close: () => Promise<void>;
        let store: UserStore;
        let n = 0;

        /** 8 plans, 7 recipes and 3 foods, oldest first (p1 is the oldest plan). */
        const seed = async () => {
            const id = `h${++n}`;
            for (let i = 1; i <= 8; i++) { await store.upsertHistory(id, item('plan', `p${i}`)); await tick(); }
            for (let i = 1; i <= 7; i++) { await store.upsertHistory(id, item('recipe', `r${i}`)); await tick(); }
            for (let i = 1; i <= 3; i++) { await store.upsertHistory(id, item('food', `f${i}`)); await tick(); }
            return id;
        };

        before(async () => {
            ({ table, close } = await backend.start());
            store = new UserStore(table);
        });
        after(() => close());

        it('free: the 5 newest plans, with a count of the ones kept back', async () => {
            const id = await seed();
            const page = await listHistoryWithLimit(store, id, FREE_HISTORY_LIMIT, { kind: 'plan', limit: 20 });
            assert.deepEqual(page.items.map(i => i.itemId), ['p8', 'p7', 'p6', 'p5', 'p4']);
            assert.equal(page.nextCursor, null);
            assert.deepEqual(page.limited, { limit: 5, hidden: 3 });
            const recipes = await listHistoryWithLimit(store, id, FREE_HISTORY_LIMIT, { kind: 'recipe', limit: 20 });
            assert.deepEqual(recipes.limited, { limit: 5, hidden: 2 });
        });

        it('a smaller page than the limit still works, for "the latest plan"', async () => {
            const id = await seed();
            const page = await listHistoryWithLimit(store, id, FREE_HISTORY_LIMIT, { kind: 'plan', limit: 1 });
            assert.deepEqual(page.items.map(i => i.itemId), ['p8']);
        });

        it('foods are never limited', async () => {
            const id = await seed();
            const page = await listHistoryWithLimit(store, id, FREE_HISTORY_LIMIT, { kind: 'food', limit: 20 });
            assert.equal(page.items.length, 3);
            assert.equal(page.limited, undefined);
        });

        it('the mixed list drops plans and recipes past the limit, page by page', async () => {
            const id = await seed();
            const seen: string[] = [];
            let cursor: string | undefined;
            do {
                const page = await listHistoryWithLimit(store, id, FREE_HISTORY_LIMIT, { limit: 4, cursor });
                seen.push(...page.items.map(i => i.itemId));
                cursor = page.nextCursor ?? undefined;
            } while (cursor);
            assert.deepEqual(seen, ['f3', 'f2', 'f1', 'r7', 'r6', 'r5', 'r4', 'r3', 'p8', 'p7', 'p6', 'p5', 'p4']);
        });

        it('Plus sees everything, and nothing was deleted', async () => {
            const id = await seed();
            const page = await listHistoryWithLimit(store, id, null, { kind: 'plan', limit: 20 });
            assert.equal(page.items.length, 8);
            assert.equal(page.limited, undefined);
            assert.equal((await store.exportAccount(id)).history.length, 18, 'export always has everything');
        });

        it('a kept-back plan can\'t be reopened on free, and can on Plus', async () => {
            const id = await seed();
            assert.equal(await historyItemVisible(store, id, FREE_HISTORY_LIMIT, 'plan', 'p8'), true);
            assert.equal(await historyItemVisible(store, id, FREE_HISTORY_LIMIT, 'plan', 'p1'), false);
            assert.equal(await historyItemVisible(store, id, FREE_HISTORY_LIMIT, 'food', 'f1'), true);
            assert.equal(await historyItemVisible(store, id, null, 'plan', 'p1'), true);
            // Reopening an old plan moves it to the top, which brings it back into view.
            await store.upsertHistory(id, item('plan', 'p1'));
            assert.equal(await historyItemVisible(store, id, FREE_HISTORY_LIMIT, 'plan', 'p1'), true);
        });
    });
}
