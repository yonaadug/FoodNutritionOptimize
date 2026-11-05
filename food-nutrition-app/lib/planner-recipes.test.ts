import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addRecipeServing, recipeServingsInPlan, removeRecipeServing, syncRecipeInPlan } from './planner-recipes';
import { computeRecipeNutrition, recipeAsFood, recipeFoodId } from './recipes/nutrition';
import { chicken } from './testing/fixtures';

const ID = recipeFoodId('rec-1');
const recipe = (servings: number, grams = 516.2, title = 'Pancakes') =>
    recipeAsFood(computeRecipeNutrition([{ name: 'c', food: chicken, grams }], servings), title, ID, 'rec-1');

describe('a recipe in the plan', () => {
    it('adding it twice is two servings (regression: it stayed at one)', () => {
        const one = addRecipeServing([], recipe(2));
        assert.equal(one.length, 1);
        assert.equal(one[0].grams, 258.1);
        const two = addRecipeServing(one, recipe(2));
        assert.equal(two.length, 1);
        assert.equal(two[0].grams, 516.2);
        assert.equal(recipeServingsInPlan(two, ID), 2);
    });

    it('removing a serving goes back down, and off the list at zero', () => {
        const two = addRecipeServing(addRecipeServing([], recipe(2)), recipe(2));
        const one = removeRecipeServing(two, ID);
        assert.equal(recipeServingsInPlan(one, ID), 1);
        assert.deepEqual(removeRecipeServing(one, ID), []);
    });

    it('is zero servings when it is not in the plan', () => {
        assert.equal(recipeServingsInPlan([], ID), 0);
    });

    it('leaves other foods alone', () => {
        const other = { food: chicken, grams: 50 };
        const list = addRecipeServing([other], recipe(2));
        assert.deepEqual(list[0], other);
        assert.equal(syncRecipeInPlan(list, recipe(1))[0], other);
    });

    it('an edit reaches the plan, keeping the number of servings', () => {
        const two = addRecipeServing(addRecipeServing([], recipe(2)), recipe(2));
        const edited = syncRecipeInPlan(two, recipe(1));
        assert.equal(edited[0].grams, 1032.4, 'one serving is now the whole batch, so two servings double');
        assert.equal(recipeServingsInPlan(edited, ID), 2);
        assert.equal(edited[0].food.recipe?.servingGrams, 516.2);
    });

    it('a new title or ingredient reaches the plan too', () => {
        const one = addRecipeServing([], recipe(2));
        const renamed = syncRecipeInPlan(one, recipe(2, 516.2, 'Better pancakes'));
        assert.equal(renamed[0].food.description, 'Recipe: Better pancakes');
        assert.equal(renamed[0].grams, 258.1);
        const bigger = syncRecipeInPlan(one, recipe(2, 600));
        assert.equal(bigger[0].grams, 300);
    });

    it('does nothing when the recipe is not in the plan, or has not changed', () => {
        assert.deepEqual(syncRecipeInPlan([], recipe(2)), []);
        const one = addRecipeServing([], recipe(2));
        assert.equal(syncRecipeInPlan(one, recipe(2)), one, 'same array, so nothing re-renders or reads as changed');
    });

    it('someone typing a weight by hand gives a fractional count, kept when the recipe changes', () => {
        const typed = [{ food: recipe(2), grams: 129.05 }];
        assert.equal(recipeServingsInPlan(typed, ID), 0.5);
        assert.equal(syncRecipeInPlan(typed, recipe(1))[0].grams, 258.1);
    });
});
