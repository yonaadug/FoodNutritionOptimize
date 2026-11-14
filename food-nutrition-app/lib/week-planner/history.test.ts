import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Food } from '../food-types';
import { DEFAULT_PORTION_CAP, goalsToPayload } from '@/components/planner/goals';
import type { PlannerState } from '@/hooks/usePlannerState';
import { HISTORY_LIMITS, validateHistoryInput } from '@/lib/user-store/history';
import { planWeek } from './solve';
import { WEEK_HISTORY_KIND, savedWeekFrom, weekFromSaved, weekHistoryItem } from './history';
import type { WeekResult } from './types';

function food(id: number, fdc: number, protein: number, kcal: number): Food {
    const f: Record<string, unknown> = {
        id, fdc_id: fdc, description: `Food ${fdc}`, data_type: 'foundation_food', food_category: 'Legumes and Legume Products',
        brand_owner: null, serving_size: null, serving_size_unit: null, calories: kcal, serving_sizes: [],
    };
    for (const k of ['total_fat_g', 'carbohydrate_g', 'fiber_g', 'sugars_g', 'saturated_g', 'sodium_mg', 'calcium_mg', 'iron_mg', 'potassium_mg', 'vitamin_a_ug', 'vitamin_c_mg']) f[k] = 1;
    f.protein_g = protein;
    return f as unknown as Food;
}

const foods = Array.from({ length: 6 }, (_, i) => food(i + 1, 5000 + i, 25 + i, 120 + i * 5));
const state: PlannerState = {
    foods, fixedFoods: [], foodLimits: { 2: { max: 250 } }, presetId: 'custom',
    goals: { protein_g: { min: 60 } }, calories: {}, portionCap: DEFAULT_PORTION_CAP, upperLimits: false, hydrated: true,
};

async function week(): Promise<WeekResult> {
    const custom: Record<string, unknown> = goalsToPayload({ protein_g: { min: 60 } });
    custom.calories = { min: '', max: '' };
    const r = await planWeek({ foods, customConstraints: custom, portionCap: { grams: 300 }, foodConstraints: state.foodLimits, settings: { maxDaysPerFood: 3 } });
    assert.equal(r.success, true, r.message ?? '');
    // Mark a day and a food locked, as the page does before re-planning.
    r.days![1].locked = true;
    r.days![4].entries[0].locked = true;
    return r;
}

describe('week plans in history', () => {
    it('records a week that fits the size cap and passes the history validator', async () => {
        const item = weekHistoryItem(state, await week());
        assert.equal(item.kind, WEEK_HISTORY_KIND);
        assert.match(item.href, /^\/plan\/week\?open=w-/);
        assert.ok(new TextEncoder().encode(JSON.stringify(item.data)).length <= HISTORY_LIMITS.dataBytes);
        assert.doesNotThrow(() => validateHistoryInput({ ...item, itemId: String(item.itemId) }));
        const facts = (item.data as { summary: { label: string; value: string }[] }).summary;
        assert.ok(facts.some(f => f.label === 'Goals met'));
    });

    it('reopens the same week on another device, where food ids differ', async () => {
        const original = await week();
        const item = weekHistoryItem(state, original);
        const saved = savedWeekFrom(JSON.parse(JSON.stringify(item.data)));
        assert.ok(saved);
        // Another database build: same fdc ids, different row ids.
        const fresh = new Map(foods.map(f => [f.fdc_id, { ...f, id: f.id + 100 }]));
        const { planner, result, missing } = weekFromSaved(saved!, fresh);
        assert.equal(missing, 0);
        assert.deepEqual(planner.foods.map(f => f.id), foods.map(f => f.id + 100));
        assert.deepEqual(planner.foodLimits, { 102: { max: 250 } });
        assert.deepEqual(planner.goals, state.goals);
        assert.equal(result.days!.length, 7);
        for (const [d, day] of result.days!.entries()) {
            assert.deepEqual(day.entries.map(e => [e.foodId - 100, e.grams, e.role]), original.days![d].entries.map(e => [e.foodId, e.grams, e.role]));
            assert.ok(Math.abs(day.nutrients.protein_g - original.days![d].nutrients.protein_g) < 0.5);
        }
        assert.equal(result.days![1].locked, true);
        assert.equal(result.days![4].entries[0].locked, true);
        assert.deepEqual(result.goals.map(g => [g.key, g.mode]), original.goals.map(g => [g.key, g.mode]));
        assert.equal(result.settings.maxDaysPerFood, 3);
    });

    it('counts foods the database no longer has, and refuses rows it cannot read', async () => {
        const saved = savedWeekFrom(weekHistoryItem(state, await week()).data)!;
        const fewer = new Map(foods.slice(1).map(f => [f.fdc_id, f]));
        assert.equal(weekFromSaved(saved, fewer).missing, 1);
        assert.equal(savedWeekFrom(null), null);
        assert.equal(savedWeekFrom({ reopen: { v: 2 } }), null);
        assert.equal(savedWeekFrom({ reopen: { ...saved, days: [[['x', 1, 0]]] } }), null);
        assert.equal(savedWeekFrom({ summary: [], tooLong: true }), null);
    });
});
