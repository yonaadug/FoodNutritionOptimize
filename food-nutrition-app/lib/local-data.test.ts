import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearPersonalData, LOCAL_OWNER_KEY, PERSONAL_KEYS, reconcileLocalData } from './local-data';

function memory(initial: Record<string, string> = {}) {
    const m = new Map(Object.entries(initial));
    return {
        m,
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => { m.set(k, v); },
        removeItem: (k: string) => { m.delete(k); },
    };
}

const WORK = {
    selectedFoods: '[1]',
    guaranteedFoods: '[]',
    foodConstraints: '{}',
    'nc.goals.v2': '{}',
    'nc.plan.v1': '{}',
    'nc.step': 'plan',
    'recipes.recent.v1': '[]',
    'mnd.recentSearches.v1': '["rice"]',
};

describe('clearPersonalData', () => {
    it('removes foods, goals, the plan, recipes and recent searches', () => {
        const s = memory({ ...WORK, customConstraints: '{}', minCalories: '1', maxCalories: '2' });
        clearPersonalData(s);
        assert.equal(s.m.size, 0);
    });

    it('covers every key the planner, recipes and search use', () => {
        for (const key of Object.keys(WORK)) assert.ok(PERSONAL_KEYS.includes(key), key);
    });

    it('leaves the theme, which is about the device and not the person', () => {
        const s = memory({ ...WORK, theme: 'dark' });
        clearPersonalData(s);
        assert.deepEqual([...s.m.keys()], ['theme']);
    });

    it('never throws when storage is blocked', () => {
        const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        clearPersonalData(broken);
        assert.equal(reconcileLocalData(broken, 'a'), false);
        assert.equal(reconcileLocalData(null, 'a'), false);
    });
});

describe('reconcileLocalData: whose data is in this browser', () => {
    it('an anonymous visitor keeps working: nothing is ever cleared', () => {
        const s = memory(WORK);
        assert.equal(reconcileLocalData(s, null), false);
        assert.equal(s.m.size, Object.keys(WORK).length);
        assert.equal(s.getItem(LOCAL_OWNER_KEY), null);
    });

    it('signing in keeps anonymous work in this browser, and it now goes with that person', () => {
        const s = memory(WORK);
        assert.equal(reconcileLocalData(s, 'a'), false);
        assert.equal(s.getItem('selectedFoods'), '[1]');
        assert.equal(s.getItem(LOCAL_OWNER_KEY), 'a');
    });

    it('the same person returning changes nothing', () => {
        const s = memory({ ...WORK, [LOCAL_OWNER_KEY]: 'a' });
        assert.equal(reconcileLocalData(s, 'a'), false);
        assert.equal(s.getItem('selectedFoods'), '[1]');
    });

    it('signing out clears it (also when the session ended some other way)', () => {
        const s = memory({ ...WORK, [LOCAL_OWNER_KEY]: 'a', theme: 'dark' });
        assert.equal(reconcileLocalData(s, null), true);
        assert.deepEqual([...s.m.keys()], ['theme']);
    });

    it('someone else signing in never sees the last person’s work', () => {
        const s = memory({ ...WORK, [LOCAL_OWNER_KEY]: 'a' });
        assert.equal(reconcileLocalData(s, 'b'), true);
        assert.equal(s.getItem('selectedFoods'), null);
        assert.equal(s.getItem('recipes.recent.v1'), null);
        assert.equal(s.getItem(LOCAL_OWNER_KEY), 'b');
    });
});
