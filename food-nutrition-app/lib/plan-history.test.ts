import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { historySummary, isSafeHref } from '@/lib/auth/history-summary';
import { HISTORY_LIMITS, validateHistoryInput } from '@/lib/user-store/history';
import { DEFAULT_PORTION_CAP, GOAL_PRESETS, presetTitle } from '@/components/planner/goals';
import type { PlanResult } from '@/hooks/usePlan';
import type { PlannerState } from '@/hooks/usePlannerState';
import { planHistoryItem, planItemId, plannerStateFromSaved, savedPlanFrom } from './plan-history';
import { computeRecipeNutrition, recipeAsFood, recipeFoodId } from './recipes/nutrition';
import { broccoli, chicken, makeFood } from './testing/fixtures';
import type { Food } from './food-types';

const preset = GOAL_PRESETS[0];
const state = (over: Partial<PlannerState> = {}): PlannerState => ({
    foods: [chicken, broccoli], fixedFoods: [], foodLimits: {}, presetId: preset.id, goals: preset.goals,
    calories: preset.calories, portionCap: DEFAULT_PORTION_CAP, upperLimits: false, hydrated: true, ...over,
});
const result = (over: Partial<PlanResult> = {}): PlanResult => ({
    success: true,
    diet: [{ food: chicken, grams: 150, calories: 248, nutrients: {} }, { food: broccoli, grams: 200, calories: 68, nutrients: {} }],
    totalCalories: 2140.4,
    totalNutrients: { protein_g: 94.2 },
    constraintLimits: { protein_g: { min: 50 }, iron_mg: { min: 18 } },
    ...over,
});
const stored = (item: ReturnType<typeof planHistoryItem>) => validateHistoryInput(item);

describe('planItemId', () => {
    it('is the same for the same foods and goals, so re-running moves one row to the top', () => {
        assert.equal(planItemId(state()), planItemId(state()));
    });
    it('differs when the foods or goals differ', () => {
        assert.notEqual(planItemId(state()), planItemId(state({ foods: [chicken] })));
        assert.notEqual(planItemId(state()), planItemId(state({ calories: { min: 1000 } })));
        assert.notEqual(planItemId(state()), planItemId(state({ fixedFoods: [{ food: chicken, grams: 50 }], foods: [broccoli] })));
    });
    it('passes the history id rules', () => {
        assert.match(planItemId(state()), /^[A-Za-z0-9._:~-]+$/);
    });
});

describe('planHistoryItem', () => {
    it('makes a valid row that links to reopening it', () => {
        const item = stored(planHistoryItem(state(), result()));
        assert.equal(item.kind, 'plan');
        assert.equal(item.title, `${presetTitle(preset.id)}: 2 foods`);
        assert.equal(item.href, `/plan?open=${planItemId(state())}#plan`);
        assert.ok(isSafeHref(item.href));
    });

    it('the row shows calories, protein, goals met and the foods', () => {
        const facts = historySummary(stored(planHistoryItem(state(), result())).data);
        assert.deepEqual(facts, [
            { label: 'Calories', value: '2,140 kcal' },
            { label: 'Protein', value: '94 g' },
            { label: 'Goals met', value: '1 of 2' },
            { label: 'Foods', value: 'Chicken Breast, Broccoli' },
        ]);
    });

    it('a plan that could not meet every goal says so rather than showing zeros', () => {
        const facts = historySummary(stored(planHistoryItem(state(), { success: false, message: 'x', constraintLimits: {} })).data);
        assert.deepEqual(facts.map(f => f.label), ['Status', 'Foods']);
        assert.equal(facts[0].value, 'Needs changes');
    });

    it('stays within the size cap with the most foods the planner allows', () => {
        const foods = Array.from({ length: 100 }, (_, i) => makeFood({ id: i + 1, fdc_id: 2_000_000 + i, description: `Food number ${i}` }));
        const item = stored(planHistoryItem(state({ foods }), result()));
        assert.ok(Buffer.byteLength(JSON.stringify(item.data)) <= HISTORY_LIMITS.dataBytes);
        assert.equal(savedPlanFrom(item.data)?.foods.length, 100);
    });

    it('holds a day of recipes in full, even with every nutrient known and some from older entries', () => {
        const filled = Object.fromEntries(Object.keys(chicken).filter(k => /_(g|mg|ug)$/.test(k)).map(k => [k, 168462]));
        const recipes = Array.from({ length: 8 }, (_, i) => {
            const n = computeRecipeNutrition([
                { name: 'c', food: { ...chicken, calories: 165.123 + i, protein_g: 31.456 + i, filledFrom: filled }, grams: 123.4 },
                { name: 'salt', food: null, grams: null },
            ], 3);
            return { food: recipeAsFood(n, `A recipe with quite a long name ${i}`, recipeFoodId(`6f1c2a54-9f0b-4d7e-8a11-0d9a7c1b2e${i}`), `6f1c2a54-9f0b-4d7e-8a11-0d9a7c1b2e${i}`), grams: 100 };
        });
        const item = stored(planHistoryItem(state({ fixedFoods: recipes }), result()));
        const saved = savedPlanFrom(item.data);
        assert.equal(saved?.recipes.length, 8, `${Buffer.byteLength(JSON.stringify(item.data))} bytes`);
        const [back] = plannerStateFromSaved(saved!, new Map(database)).fixedFoods.filter(f => f.food.recipe);
        assert.equal(back.food.filledFrom?.protein_g, 168462);
    });

    it('when a plan is too big to keep whole, keeps the summary and never a partial plan', () => {
        const recipes = Array.from({ length: 50 }, (_, i) => {
            const n = computeRecipeNutrition([{ name: 'c', food: { ...chicken, calories: 165.123 + i, protein_g: 31.456 + i }, grams: 100 }], 1);
            return { food: recipeAsFood(n, `Recipe with a long name ${i}`, recipeFoodId(`r${i}`), `r${i}`), grams: 100 };
        });
        const item = stored(planHistoryItem(state({ fixedFoods: recipes }), result()));
        assert.ok(Buffer.byteLength(JSON.stringify(item.data)) <= HISTORY_LIMITS.dataBytes);
        assert.equal(savedPlanFrom(item.data), null);
        assert.equal((item.data as { tooLong?: boolean }).tooLong, true);
        assert.equal(item.href, '/plan');
        assert.equal(historySummary(item.data)[0].label, 'Calories');
    });
});

// On another device the row ids can differ; only fdc ids travel.
const onOtherDevice = (f: Food) => ({ ...f, id: f.id + 1000 });
const database = new Map([chicken, broccoli].map(f => [f.fdc_id, onOtherDevice(f)]));

describe('reopening a saved plan', () => {
    const custom = state({
        presetId: 'custom',
        goals: { protein_g: { min: 77 }, sodium_mg: { max: 1500 } },
        calories: { min: 1500 },
        portionCap: { enabled: false, grams: 300 },
        upperLimits: true,
        foods: [chicken],
        fixedFoods: [{ food: broccoli, grams: 120 }],
        foodLimits: { [chicken.id]: { min: 30, max: 90 } },
    });

    it('brings back the foods, fixed amounts, limits and goals', () => {
        const saved = savedPlanFrom(stored(planHistoryItem(custom, result())).data)!;
        const next = plannerStateFromSaved(saved, database);
        assert.deepEqual(next.foods.map(f => f.fdc_id), [chicken.fdc_id]);
        assert.deepEqual(next.fixedFoods.map(f => [f.food.fdc_id, f.grams]), [[broccoli.fdc_id, 120]]);
        assert.deepEqual(next.foodLimits, { [chicken.id + 1000]: { min: 30, max: 90 } }, 'limits follow the row id on this device');
        assert.equal(next.presetId, 'custom');
        assert.deepEqual(next.goals, custom.goals);
        assert.deepEqual(next.calories, { min: 1500 });
        assert.deepEqual(next.portionCap, { enabled: false, grams: 300 });
        assert.equal(next.upperLimits, true);
        assert.equal(next.missing, 0);
    });

    it('a preset comes back by name, without storing every goal', () => {
        const data = stored(planHistoryItem(state(), result())).data;
        assert.ok(!JSON.stringify(data).includes('"goals"'));
        const next = plannerStateFromSaved(savedPlanFrom(data)!, database);
        assert.equal(next.presetId, preset.id);
        assert.deepEqual(next.goals, preset.goals);
        assert.deepEqual(next.calories, preset.calories);
    });

    it('recipes come back whole: nutrition, serving, caveats and link', () => {
        const n = computeRecipeNutrition([
            { name: 'chicken', food: chicken, grams: 200 },
            { name: 'salt', food: null, grams: null },
        ], 2);
        const food = recipeAsFood(n, 'Dinner', recipeFoodId('rec-1'), 'rec-1');
        const saved = savedPlanFrom(stored(planHistoryItem(state({ foods: [], fixedFoods: [{ food, grams: 200 }] }), result())).data)!;
        const [back] = plannerStateFromSaved(saved, database).fixedFoods;
        assert.equal(back.grams, 200);
        assert.equal(back.food.id, food.id);
        assert.equal(back.food.description, 'Recipe: Dinner');
        assert.equal(back.food.protein_g, food.protein_g);
        assert.equal(back.food.recipe?.id, 'rec-1');
        assert.deepEqual(back.food.recipe?.uncounted, ['salt']);
        assert.equal(back.food.recipe?.fingerprint, food.recipe?.fingerprint);
    });

    it('a food no longer in the database is dropped and counted, not an error', () => {
        const saved = savedPlanFrom(stored(planHistoryItem(state(), result())).data)!;
        const next = plannerStateFromSaved(saved, new Map([[chicken.fdc_id, chicken]]));
        assert.equal(next.foods.length, 1);
        assert.equal(next.missing, 1);
    });

    it('rejects anything malformed', () => {
        for (const data of [null, 'x', [], {}, { reopen: null }, { reopen: {} }, { reopen: { foods: 'x', fixed: [], recipes: [] } }, { reopen: { foods: ['x'], fixed: [], recipes: [] } }, { reopen: { foods: [], fixed: [[1]], recipes: [] } }, { reopen: { foods: [], fixed: [], recipes: [{}] } }, { reopen: { foods: [], fixed: [], recipes: [{ id: 1, name: 'x', grams: 1, rid: 'r', serving: 1, fingerprint: 'f', uncounted: [1], values: [], lower: [], older: [] }] } }]) {
            assert.equal(savedPlanFrom(data), null, JSON.stringify(data));
        }
    });
});
