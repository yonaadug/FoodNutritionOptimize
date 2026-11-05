import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initialStep } from '@/hooks/useStep';
import { restorePlan } from '@/hooks/usePlan';
import { chicken } from './testing/fixtures';

/** Minimal in-memory localStorage for the store modules. */
class MemoryStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

const savedPlan = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    v: 1,
    status: 'success',
    result: { success: true, diet: [{ food: chicken, grams: 150, calories: 248, nutrients: {} }], totalCalories: 248 },
    run: { key: '{"f":[1]}', fixed: [], foodIds: [1], presetId: 'essentials', at: 1 },
    ...overrides,
});

describe('reopening the site', () => {
    beforeEach(() => storage.clear());

    it('restores the last computed plan (regression: the plan was lost on reload)', () => {
        storage.setItem('nc.plan.v1', savedPlan());
        const s = restorePlan();
        assert.equal(s.status, 'success');
        assert.equal(s.result?.diet?.[0].grams, 150);
        assert.equal(s.run?.presetId, 'essentials');
        assert.equal(s.finished, 0, 'a restored plan is not a "just finished" run (no focus jump)');
    });

    it('restores an infeasible result too, but never a loading or error state', () => {
        storage.setItem('nc.plan.v1', savedPlan({ status: 'infeasible', result: { success: false, message: 'x' } }));
        assert.equal(restorePlan().status, 'infeasible');
        storage.setItem('nc.plan.v1', savedPlan({ status: 'loading' }));
        assert.equal(restorePlan().status, 'idle');
    });

    it('starts empty for state saved by older versions, or anything malformed', () => {
        storage.setItem('selectedFoods', JSON.stringify([chicken]));
        assert.equal(restorePlan().status, 'idle', 'no saved plan yet');
        for (const bad of ['{', 'null', '[]', JSON.stringify({ v: 2 }), savedPlan({ run: null }), savedPlan({ result: null })]) {
            storage.setItem('nc.plan.v1', bad);
            assert.equal(restorePlan().status, 'idle', bad);
        }
    });

    it('reopens on the step the user was on, unless the address names one', () => {
        assert.equal(initialStep('', null), 'foods');
        assert.equal(initialStep('', 'plan'), 'plan');
        assert.equal(initialStep('#goals', 'plan'), 'goals');
        assert.equal(initialStep('#main', 'goals'), 'goals', 'the skip link is not a step');
        assert.equal(initialStep('', 'nonsense'), 'foods');
    });
});
