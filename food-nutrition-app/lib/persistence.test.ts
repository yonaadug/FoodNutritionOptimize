import { afterEach, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initialStep } from '@/hooks/useStep';
import { getPlanSnapshot, resetPlan, restorePlan, restorePlanSnapshot, runPlan } from '@/hooks/usePlan';
import { payloadKey } from '@/components/planner/payload';
import { DEFAULT_PORTION_CAP, GOAL_PRESETS } from '@/components/planner/goals';
import type { PlannerState } from '@/hooks/usePlannerState';
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
    v: 2,
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
        for (const bad of ['{', 'null', '[]', JSON.stringify({ v: 2 }), savedPlan({ v: 1 }), savedPlan({ run: null }), savedPlan({ result: null })]) {
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

describe('a plan with no foods left (regression: Update plan did nothing, and the old plan stayed)', () => {
    const preset = GOAL_PRESETS[0];
    const state = (foods: PlannerState['foods']): PlannerState => ({
        foods, fixedFoods: [], foodLimits: {}, presetId: preset.id, goals: preset.goals, calories: preset.calories,
        portionCap: DEFAULT_PORTION_CAP, upperLimits: false, hydrated: true,
    });
    const realFetch = globalThis.fetch;
    const okPlan = async () => Response.json({ success: true, diet: [], totalCalories: 100, totalNutrients: {} });

    beforeEach(() => { storage.clear(); resetPlan(); });
    afterEach(() => { globalThis.fetch = realFetch; });

    it('running it forgets the old plan, on screen and in storage', async () => {
        globalThis.fetch = okPlan as typeof fetch;
        await runPlan(state([chicken]));
        assert.equal(getPlanSnapshot().status, 'success');
        assert.ok(storage.getItem('nc.plan.v1'));

        let asked = 0;
        globalThis.fetch = (async () => { asked++; return okPlan(); }) as typeof fetch;
        await runPlan(state([]));
        assert.equal(getPlanSnapshot().status, 'idle');
        assert.equal(getPlanSnapshot().result, null);
        assert.equal(storage.getItem('nc.plan.v1'), null);
        assert.equal(asked, 0, 'there is nothing to send');
    });

    it('Undo after Clear all can bring the same plan back', async () => {
        globalThis.fetch = okPlan as typeof fetch;
        await runPlan(state([chicken]));
        const before = getPlanSnapshot();
        resetPlan();
        assert.equal(getPlanSnapshot().status, 'idle');
        restorePlanSnapshot(before);
        assert.equal(getPlanSnapshot().status, 'success');
        assert.equal(getPlanSnapshot().run?.key, payloadKey(state([chicken])));
        assert.ok(storage.getItem('nc.plan.v1'), 'and it is saved again');
    });

    it('a fixed food the server returns replaces the browser’s copy, so totals and rows agree', async () => {
        const stale = { ...chicken, protein_g: 1 };
        const fresh = { ...chicken, protein_g: 31 };
        globalThis.fetch = (async () => Response.json({
            success: true, diet: [], totalCalories: 100, totalNutrients: {}, guaranteedFoods: [{ food: fresh, grams: 50 }],
        })) as typeof fetch;
        await runPlan({ ...state([]), fixedFoods: [{ food: stale, grams: 50 }] });
        assert.equal(getPlanSnapshot().run?.fixed[0].food.protein_g, 31);
    });
});

describe('payloadKey', () => {
    const preset = GOAL_PRESETS[0];
    const recipeFood = (fingerprint: string) => ({
        ...chicken, id: -9, recipe: { id: 'r', servingGrams: 100, uncounted: [], incomplete: [], fingerprint },
    });
    const state = (fingerprint: string): PlannerState => ({
        foods: [], fixedFoods: [{ food: recipeFood(fingerprint), grams: 100 }], foodLimits: {}, presetId: preset.id, goals: preset.goals,
        calories: preset.calories, portionCap: DEFAULT_PORTION_CAP, upperLimits: false, hydrated: true,
    });

    it('changes when a recipe in the plan is edited, even at the same weight', () => {
        assert.notEqual(payloadKey(state('a')), payloadKey(state('b')));
        assert.equal(payloadKey(state('a')), payloadKey(state('a')));
    });
});
