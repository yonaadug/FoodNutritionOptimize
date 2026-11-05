import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecipeNutrition, recipeAsFood, recipeFoodId, roundedNutrition, summarizeForRecord } from './nutrition';
import { broccoli, chicken, makeFood, oliveOil } from '../testing/fixtures';

describe('computeRecipeNutrition', () => {
    it('sums per-100 g values by weight and divides by servings', () => {
        const n = computeRecipeNutrition([
            { name: 'chicken', food: chicken, grams: 200 },
            { name: 'oil', food: oliveOil, grams: 10 },
        ], 2);
        assert.equal(n.totals.calories.value, 165 * 2 + 88.4);
        assert.equal(n.perServing.calories.value, (165 * 2 + 88.4) / 2);
        assert.equal(n.totalGrams, 210);
        assert.equal(n.servingGrams, 105);
        assert.deepEqual(n.uncounted, []);
    });
    it('flags a total as incomplete when an ingredient has no data, and keeps the known part', () => {
        const noIron = makeFood({ id: 9, description: 'Mystery', calories: 100, iron_mg: null });
        const n = computeRecipeNutrition([
            { name: 'broccoli', food: broccoli, grams: 100 },
            { name: 'mystery', food: noIron, grams: 100 },
        ], 1);
        assert.equal(n.totals.iron_mg.value, 0.73);
        assert.equal(n.totals.iron_mg.incomplete, true);
        assert.equal(n.totals.calories.incomplete, false);
    });
    it('reports null, not zero, when nothing has data', () => {
        const noIron = makeFood({ id: 9, description: 'Mystery', calories: 100, iron_mg: null });
        const n = computeRecipeNutrition([{ name: 'mystery', food: noIron, grams: 100 }], 1);
        assert.equal(n.totals.iron_mg.value, null);
        assert.equal(n.perServing.iron_mg.value, null);
        assert.equal(n.totals.iron_mg.incomplete, true);
    });
    it('treats a measured zero as a zero', () => {
        const n = computeRecipeNutrition([{ name: 'oil', food: oliveOil, grams: 10 }], 1);
        assert.equal(n.totals.vitamin_c_mg.value, 0);
        assert.equal(n.totals.vitamin_c_mg.incomplete, false);
    });
    it('does not treat an ingredient of 0 g as missing data', () => {
        const noIron = makeFood({ id: 9, description: 'Mystery', calories: 100, iron_mg: null });
        const n = computeRecipeNutrition([
            { name: 'broccoli', food: broccoli, grams: 100 },
            { name: 'mystery', food: noIron, grams: 0 },
        ], 1);
        assert.equal(n.totals.iron_mg.incomplete, false);
    });
    it('lists what could not be counted', () => {
        const n = computeRecipeNutrition([
            { name: 'chicken', food: chicken, grams: 100 },
            { name: 'unmatched', food: null, grams: 50 },
            { name: 'salt', food: oliveOil, grams: null },
        ], 1);
        assert.deepEqual(n.uncounted, ['unmatched', 'salt']);
        assert.equal(n.totalGrams, 100);
        assert.equal(n.totals.calories.value, 165);
    });
    it('falls back to one serving for nonsense servings', () => {
        for (const s of [0, -2, NaN]) {
            assert.equal(computeRecipeNutrition([{ name: 'c', food: chicken, grams: 100 }], s).servings, 1);
        }
    });
    it('handles an empty recipe', () => {
        const n = computeRecipeNutrition([], 4);
        assert.equal(n.totals.calories.value, null);
        assert.equal(n.totalGrams, 0);
    });
    it('skips optional columns this database does not have', () => {
        const n = computeRecipeNutrition([{ name: 'c', food: chicken, grams: 100 }], 1);
        assert.equal(n.totals.choline_mg.value, null);
        assert.equal(n.totals.choline_mg.incomplete, false);
    });
    it('is deterministic', () => {
        const items = [{ name: 'c', food: chicken, grams: 123.4 }, { name: 'b', food: broccoli, grams: 56.7 }];
        assert.deepEqual(computeRecipeNutrition(items, 3), computeRecipeNutrition(items, 3));
    });
});

describe('recipeAsFood', () => {
    const n = computeRecipeNutrition([
        { name: 'chicken', food: chicken, grams: 200 },
        { name: 'oil', food: oliveOil, grams: 10 },
    ], 2);
    it('gives per-100 g values that reproduce the per-serving amount', () => {
        const food = recipeAsFood(n, 'Dinner', -5);
        const perServing = ((food.protein_g as number) * n.servingGrams) / 100;
        assert.ok(Math.abs(perServing - (n.perServing.protein_g.value as number)) < 1e-9);
        assert.equal(food.id, -5);
        assert.equal(food.fdc_id, -5);
        assert.equal(food.description, 'Recipe: Dinner');
        assert.equal(food.serving_sizes?.[0].label, '1 serving');
        assert.equal(food.serving_sizes?.[0].weight_g, 105);
    });
    it('keeps nulls as nulls', () => {
        const noIron = makeFood({ id: 9, description: 'Mystery', calories: 100, iron_mg: null });
        const food = recipeAsFood(computeRecipeNutrition([{ name: 'm', food: noIron, grams: 100 }], 1), 'x', -1);
        assert.equal(food.iron_mg, null);
    });
    it('survives an empty recipe', () => {
        const food = recipeAsFood(computeRecipeNutrition([], 1), '', -1);
        assert.equal(food.description, 'Recipe: Untitled recipe');
        assert.deepEqual(food.serving_sizes, []);
    });
});

describe('a recipe as a planner food', () => {
    const noIron = makeFood({ id: 9, description: 'Mystery', calories: 100, iron_mg: null });
    const milk = makeFood({ id: 10, description: 'Milk', calories: 50, filledFrom: { sugars_g: 555 }, sugars_g: 5 });
    const items = [
        { name: 'mystery', food: noIron, grams: 100 },
        { name: 'milk', food: milk, grams: 100 },
        { name: 'salt', food: null, grams: null },
    ];
    const food = recipeAsFood(computeRecipeNutrition(items, 2), 'Dinner', recipeFoodId('rec-1'), 'rec-1');

    it('knows which recipe it came from, and how big a serving is', () => {
        assert.equal(food.recipe?.id, 'rec-1');
        assert.equal(food.recipe?.servingGrams, 100);
    });
    it('carries what was not counted, and which totals are only lower bounds', () => {
        assert.deepEqual(food.recipe?.uncounted, ['salt']);
        assert.ok(food.recipe?.incomplete.includes('iron_mg'));
        assert.ok(!food.recipe?.incomplete.includes('calories'));
    });
    it('says which values came from an older USDA entry', () => {
        assert.deepEqual(food.filledFrom, { sugars_g: 555 });
    });
    it('the fingerprint moves when the nutrition, the serving or what is left out does', () => {
        const again = recipeAsFood(computeRecipeNutrition(items, 2), 'Dinner', -1, 'rec-1');
        assert.equal(again.recipe?.fingerprint, food.recipe?.fingerprint);
        const servings = recipeAsFood(computeRecipeNutrition(items, 1), 'Dinner', -1, 'rec-1');
        assert.notEqual(servings.recipe?.fingerprint, food.recipe?.fingerprint);
        const more = recipeAsFood(computeRecipeNutrition([...items, { name: 'broccoli', food: broccoli, grams: 50 }], 2), 'Dinner', -1, 'rec-1');
        assert.notEqual(more.recipe?.fingerprint, food.recipe?.fingerprint);
        const left = recipeAsFood(computeRecipeNutrition(items.slice(0, 2), 2), 'Dinner', -1, 'rec-1');
        assert.notEqual(left.recipe?.fingerprint, food.recipe?.fingerprint);
    });
});

describe('record helpers', () => {
    it('recipeFoodId is stable, negative and never zero', () => {
        assert.equal(recipeFoodId('abc'), recipeFoodId('abc'));
        assert.notEqual(recipeFoodId('abc'), recipeFoodId('abd'));
        assert.ok(recipeFoodId('') < 0);
    });
    it('summarizeForRecord lists lower-bound nutrients', () => {
        const noIron = makeFood({ id: 9, description: 'Mystery', calories: 100, iron_mg: null });
        const s = summarizeForRecord(computeRecipeNutrition([{ name: 'm', food: noIron, grams: 100 }], 2));
        assert.ok(s.incomplete.includes('iron_mg'));
        assert.equal(s.perServing.calories, 50);
        assert.equal(s.servingGrams, 50);
    });
    it('roundedNutrition removes float noise and survives JSON', () => {
        const r = roundedNutrition(computeRecipeNutrition([{ name: 'b', food: broccoli, grams: 33.3 }], 3));
        assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
        assert.equal(r.totals.calories.value, Math.round(((34 * 33.3) / 100) * 1000) / 1000);
    });
});
