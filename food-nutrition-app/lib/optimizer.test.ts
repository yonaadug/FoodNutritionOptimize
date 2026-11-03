import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeDiet } from './optimizer';
import { NUTRIENT_CONFIG } from './nutrient-defaults';
import { chicken, broccoli, oliveOil, mockFoods, relaxedConstraints } from './testing/fixtures';

const relaxed = () => relaxedConstraints(Object.keys(NUTRIENT_CONFIG));

describe('optimizeDiet: basic mechanics', () => {
    it('minimizes calories while meeting a protein minimum', () => {
        const constraints = relaxed();
        constraints.protein_g = { min: 50 };
        const result = optimizeDiet({ foods: mockFoods, customConstraints: constraints });

        assert.equal(result.success, true);
        assert.ok(result.totalNutrients.protein_g >= 49.9, `protein ${result.totalNutrients.protein_g}`);
        assert.ok(result.diet?.some(d => d.food.id === chicken.id), 'chicken is the most calorie-efficient protein');
    });

    it('reports infeasibility when no selected food supplies a required nutrient', () => {
        const constraints = relaxed();
        constraints.vitamin_c_mg = { min: 50 };
        const result = optimizeDiet({ foods: [chicken, oliveOil], customConstraints: constraints });

        assert.equal(result.success, false);
        assert.match(result.message ?? '', /Cannot meet Vitamin C target/);
    });

    it('returns an error when no foods are provided at all', () => {
        const result = optimizeDiet({ foods: [] });
        assert.equal(result.success, false);
        assert.ok(result.error);
    });
});

describe('optimizeDiet: calorie bounds', () => {
    it('honours maxCalories', () => {
        const result = optimizeDiet({ foods: mockFoods, maxCalories: 500, customConstraints: relaxed() });
        assert.equal(result.success, true);
        assert.ok(result.totalCalories! <= 500);
    });

    it('honours minCalories', () => {
        const result = optimizeDiet({ foods: mockFoods, minCalories: 1000, customConstraints: relaxed() });
        assert.equal(result.success, true, result.message);
        assert.ok(result.totalCalories! >= 999, `got ${result.totalCalories}`);
    });
});

describe('optimizeDiet: per-food bounds', () => {
    it('diversity mode caps every food at maxFoodAmount', () => {
        const result = optimizeDiet({
            foods: mockFoods, minCalories: 1500, customConstraints: relaxed(),
            diversityMode: true, maxFoodAmount: 1000,
        });
        assert.equal(result.success, true, result.message);
        assert.ok(Math.max(...result.diet!.map(d => d.grams)) <= 1000);
    });

    it('diversity mode forces several foods when one food cannot reach the target', () => {
        const result = optimizeDiet({
            foods: mockFoods, minCalories: 2000, customConstraints: relaxed(),
            diversityMode: true, maxFoodAmount: 200,
        });
        assert.equal(result.success, true, result.message);
        assert.ok(result.diet!.length > 1);
    });

    it('enforces a user per-food minimum', () => {
        const result = optimizeDiet({
            foods: mockFoods, minCalories: 500, customConstraints: relaxed(),
            foodConstraints: { [broccoli.id]: { min: 200 } },
        });
        assert.equal(result.success, true, result.message);
        const b = result.diet!.find(d => d.food.id === broccoli.id);
        assert.ok(b && b.grams >= 200, `broccoli ${b?.grams}`);
    });

    it('enforces a user per-food maximum', () => {
        const result = optimizeDiet({
            foods: mockFoods, minCalories: 2000, customConstraints: relaxed(),
            // Default cap is 300 g/food; let chicken go higher so 2000 kcal is reachable.
            foodConstraints: { [oliveOil.id]: { max: 50 }, [chicken.id]: { max: 1500 } },
        });
        assert.equal(result.success, true, result.message);
        const oil = result.diet!.find(d => d.food.id === oliveOil.id);
        assert.ok(!oil || oil.grams <= 50);
    });

    it('defaults to at most 3 servings per food, overridable by the user', () => {
        const withServing = { ...chicken, serving_sizes: [{ id: 1, food_id: 1, label: '1 cup', weight_g: 100 }] };
        const capped = optimizeDiet({ foods: [withServing], minCalories: 1000, customConstraints: relaxed() });
        assert.equal(capped.success, false, '300 g of chicken = 495 kcal < 1000 kcal');

        const overridden = optimizeDiet({
            foods: [withServing], minCalories: 1000, customConstraints: relaxed(),
            foodConstraints: { [chicken.id]: { max: 2000 } },
        });
        assert.equal(overridden.success, true, overridden.message);
        assert.ok(overridden.diet!.find(d => d.food.id === chicken.id)!.grams > 300);
    });
});

describe('optimizeDiet: guaranteed foods', () => {
    it('solves only for the remainder after guaranteed foods', () => {
        const constraints = relaxed();
        constraints.protein_g = { min: 50 };
        const result = optimizeDiet({
            foods: mockFoods, customConstraints: constraints,
            guaranteedFoods: [{ food: chicken, grams: 100 }],
        });
        assert.equal(result.success, true, result.message);
        assert.ok(result.totalNutrients.protein_g >= 49.9);
        const added = result.diet!.reduce((s, d) => s + d.nutrients.protein_g, 0);
        assert.ok(added > 0 && added < 40, `added protein ${added}`);
    });

    it('returns guaranteed totals when there is nothing to optimize', () => {
        const result = optimizeDiet({ foods: [], guaranteedFoods: [{ food: chicken, grams: 200 }] });
        assert.equal(result.success, true);
        assert.equal(result.totalCalories, 330);
        assert.ok(Math.abs(result.totalNutrients.protein_g - 62) < 1e-9);
    });
});
