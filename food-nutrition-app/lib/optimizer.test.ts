import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeDiet } from './optimizer';
import { NUTRIENT_CONFIG } from './nutrient-defaults';
import { chicken, broccoli, oliveOil, mockFoods, makeFood, relaxedConstraints } from './testing/fixtures';

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

// ---------------------------------------------------------------------------
// Regression tests for bugs found in review. Each failed before its fix.
// ---------------------------------------------------------------------------

describe('optimizeDiet: constraint parsing regressions', () => {
    it('an object constraint is authoritative: {} clears the default minimum', () => {
        // The UI sends {min: undefined} when a field is cleared, which JSON drops,
        // so a cleared Vitamin D goal arrives as {} and must not fall back to 20 mcg.
        const constraints = relaxed();
        constraints.vitamin_d_ug = {};
        constraints.vitamin_b12_ug = { max: 100 };
        const result = optimizeDiet({ foods: [broccoli], customConstraints: constraints });
        assert.equal(result.success, true, result.message);
        assert.equal(result.constraintLimits.vitamin_d_ug, undefined);
        assert.deepEqual(result.constraintLimits.vitamin_b12_ug, { min: undefined, max: 100 });
    });

    it('null bounds mean "no bound" rather than NaN', () => {
        const constraints: Record<string, unknown> = relaxed();
        constraints.vitamin_d_ug = { min: null, max: null };
        const result = optimizeDiet({ foods: [broccoli], customConstraints: constraints });
        assert.equal(result.success, true, result.message);
        assert.equal(result.constraintLimits.vitamin_d_ug, undefined);
    });

    it('rejects non-numeric bounds instead of passing NaN to the solver', () => {
        const constraints: Record<string, unknown> = relaxed();
        constraints.protein_g = { min: 'lots' };
        const result = optimizeDiet({ foods: mockFoods, customConstraints: constraints });
        assert.equal(result.success, false);
        assert.match(result.error ?? '', /protein/i);
    });

    it('honours a legacy numeric constraint of 0', () => {
        const constraints: Record<string, unknown> = relaxed();
        constraints.vitamin_d_ug = 0;
        const result = optimizeDiet({ foods: [broccoli], customConstraints: constraints });
        assert.equal(result.success, true, result.message);
    });

    it('rejects negative or non-finite nutrient data', () => {
        const bad = { ...chicken, id: 99, calories: -50 };
        const result = optimizeDiet({ foods: [bad, broccoli], customConstraints: relaxed() });
        assert.equal(result.success, false);
        assert.ok(result.error);
    });

    it('rejects invalid guaranteed amounts', () => {
        const result = optimizeDiet({ foods: [broccoli], guaranteedFoods: [{ food: chicken, grams: Number.NaN }] });
        assert.equal(result.success, false);
        assert.ok(result.error);
    });
});

describe('optimizeDiet: per-food bound regressions', () => {
    it('a user minimum above the default 300 g cap raises the cap instead of making the LP infeasible', () => {
        const result = optimizeDiet({
            foods: mockFoods, customConstraints: relaxed(),
            foodConstraints: { [broccoli.id]: { min: 400 } },
        });
        assert.equal(result.success, true, result.message);
        assert.ok(result.diet!.find(d => d.food.id === broccoli.id)!.grams >= 400);
    });

    it('a user maximum of 0 excludes the food', () => {
        const constraints = relaxed();
        constraints.protein_g = { min: 20 };
        const result = optimizeDiet({
            foods: mockFoods, customConstraints: constraints,
            foodConstraints: { [chicken.id]: { max: 0 }, [broccoli.id]: { max: 2000 } },
        });
        assert.equal(result.success, true, result.message);
        assert.equal(result.diet!.find(d => d.food.id === chicken.id), undefined);
    });

    it('the default cap uses a typical (median) serving, not the largest one', () => {
        // Previously 3 x "1 cup" (648 g of oil) was allowed by default.
        const oil = {
            ...oliveOil,
            serving_sizes: [
                { id: 1, food_id: 3, label: '1 tbsp', weight_g: 13.5 },
                { id: 2, food_id: 3, label: '1 cup', weight_g: 216 },
            ],
        };
        const constraints = relaxed();
        constraints.total_fat_g = { min: 60 };
        const result = optimizeDiet({ foods: [oil], customConstraints: constraints });
        assert.equal(result.success, false, '3 tbsp (40.5 g) of oil cannot provide 60 g fat');
    });
});

describe('optimizeDiet: result regressions', () => {
    it('totalNutrients.calories includes guaranteed foods (matches totalCalories)', () => {
        const constraints = relaxed();
        constraints.protein_g = { min: 50 };
        const result = optimizeDiet({
            foods: mockFoods, customConstraints: constraints,
            guaranteedFoods: [{ food: chicken, grams: 100 }],
        });
        assert.equal(result.success, true, result.message);
        assert.ok(Math.abs(result.totalNutrients.calories - result.totalCalories!) <= 1);
    });

    it('keeps foods used in sub-gram amounts so reported totals still meet the goals', () => {
        // Found on real data: 0.4 g of a vitamin-K-dense food was dropped by
        // Math.round(grams) and the reported Vitamin K total fell below its minimum.
        const herb = makeFood({ id: 30, description: 'Dried herb', calories: 300, vitamin_k_ug: 30000 });
        const lettuce = makeFood({ id: 31, description: 'Lettuce', calories: 15, vitamin_k_ug: 100 });
        const constraints = relaxed();
        constraints.vitamin_k_ug = { min: 120 };
        const result = optimizeDiet({
            foods: [herb, lettuce], customConstraints: constraints,
            foodConstraints: { [lettuce.id]: { max: 100 } },
        });
        assert.equal(result.success, true, result.message);
        assert.ok(result.totalNutrients.vitamin_k_ug >= 119.99, `vitamin K ${result.totalNutrients.vitamin_k_ug}`);
        const h = result.diet!.find(d => d.food.id === herb.id);
        assert.ok(h && h.grams > 0 && h.grams < 1, `herb grams ${h?.grams}`);
        const summed = result.diet!.reduce((s, d) => s + d.nutrients.vitamin_k_ug, 0);
        assert.ok(Math.abs(summed - result.totalNutrients.vitamin_k_ug) < 1e-9);
    });

    it('tracks optional nutrients that have an FDA DV (phosphorus) when constrained', () => {
        const constraints = relaxed();
        constraints.phosphorus_mg = { min: 500 };
        const result = optimizeDiet({ foods: mockFoods, customConstraints: constraints });
        assert.equal(result.success, true, result.message);
        assert.ok(result.totalNutrients.phosphorus_mg >= 499.9, `phosphorus ${result.totalNutrients.phosphorus_mg}`);
    });
});

// Deterministic pseudo-random foods with realistic magnitudes per nutrient.
function syntheticFoods(seed: number, count: number) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const typical: Record<string, number> = {
        protein_g: 20, total_fat_g: 10, carbohydrate_g: 30, fiber_g: 3, sugars_g: 5, saturated_g: 3,
        cholesterol_mg: 50, vitamin_a_ug: 100, vitamin_c_mg: 20, vitamin_d_ug: 0.5, vitamin_e_mg: 1,
        vitamin_k_ug: 20, thiamin_mg: 0.1, riboflavin_mg: 0.1, niacin_mg: 2, vitamin_b6_mg: 0.2,
        folate_ug: 30, vitamin_b12_ug: 0.3, calcium_mg: 50, iron_mg: 1, magnesium_mg: 30,
        potassium_mg: 300, sodium_mg: 100, zinc_mg: 1, copper_mg: 0.1, manganese_mg: 0.3, selenium_ug: 10,
    };
    return Array.from({ length: count }, (_, i) => {
        const f: Record<string, unknown> = { id: i + 1, description: `Food ${i}`, calories: 20 + rnd() * 400 };
        for (const [k, v] of Object.entries(typical)) f[k] = rnd() < 0.3 ? 0 : v * rnd() * 2;
        return makeFood(f as Parameters<typeof makeFood>[0]);
    });
}

describe('optimizeDiet: infeasibility diagnostics', () => {
    it('finish quickly and identify the binding nutrient (badly scaled elastic LP used to take seconds)', () => {
        const foods = syntheticFoods(5, 30);
        const t0 = performance.now();
        const result = optimizeDiet({ foods });
        const ms = performance.now() - t0;
        assert.equal(result.success, false);
        assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
        assert.match(result.message ?? '', /Vitamin D/);
    });

    it('do not round small shortages down to 0', () => {
        for (const seed of [3, 5, 11, 17, 23]) {
            const result = optimizeDiet({ foods: syntheticFoods(seed, 30) });
            assert.doesNotMatch(result.message ?? '', /by 0(mg|mcg|g|kcal)?\)/, `seed ${seed}: ${result.message}`);
        }
    });

    it('blame missing nutrients rather than absurd per-food cap violations', () => {
        const result = optimizeDiet({ foods: mockFoods });
        assert.equal(result.success, false);
        assert.match(result.message ?? '', /Vitamin D/);
        assert.doesNotMatch(result.message ?? '', /limit for Broccoli/);
    });
});

describe('optimizeDiet: missing data (null nutrients)', () => {
    const noVitC = makeFood({ id: 10, description: 'Mystery greens', calories: 20, vitamin_c_mg: null, selenium_ug: null });

    it('treats null as 0 inside constraints', () => {
        const constraints = relaxed();
        constraints.vitamin_c_mg = { min: 50 };
        const result = optimizeDiet({ foods: [noVitC, broccoli], customConstraints: constraints });
        assert.equal(result.success, true, result.message);
        assert.ok(result.diet!.some(d => d.food.id === broccoli.id));
        assert.ok(result.totalNutrients.vitamin_c_mg >= 49.9);
    });

    it('warns about selected foods that lack data for constrained nutrients only', () => {
        const constraints = relaxed();
        constraints.vitamin_c_mg = { min: 50 };
        const result = optimizeDiet({
            foods: [noVitC, broccoli], customConstraints: constraints,
            guaranteedFoods: [{ food: makeFood({ id: 11, description: 'Plain rice', calories: 130, iron_mg: null }), grams: 100 }],
        });
        assert.ok(Array.isArray(result.warnings));
        const w = result.warnings!.find(x => x.foodId === noVitC.id);
        assert.ok(w, 'warning for Mystery greens');
        assert.deepEqual([...w.nutrients].sort(), ['selenium_ug', 'vitamin_c_mg']);
        assert.match(w.message, /Mystery greens/);
        assert.match(w.message, /Vitamin C/);
        const rice = result.warnings!.find(x => x.foodId === 11);
        assert.ok(rice && rice.role === 'guaranteed' && rice.nutrients.includes('iron_mg'));
        assert.equal(result.warnings!.find(x => x.foodId === broccoli.id), undefined);
    });

    it('does not warn about unconstrained nutrients', () => {
        const constraints = relaxed();
        constraints.vitamin_c_mg = {};
        constraints.selenium_ug = {};
        const result = optimizeDiet({ foods: [noVitC, broccoli], customConstraints: constraints });
        assert.deepEqual(result.warnings, []);
    });

    it('includes warnings on infeasible results too', () => {
        const constraints = relaxed();
        constraints.vitamin_c_mg = { min: 50 };
        const result = optimizeDiet({ foods: [noVitC], customConstraints: constraints });
        assert.equal(result.success, false);
        assert.ok(result.warnings!.some(x => x.foodId === noVitC.id));
    });
});

describe('optimizeDiet: tolerable upper intake levels', () => {
    it('applyUpperLimits caps total-intake ULs (iron) but never supplement-only ULs (magnesium)', () => {
        const ironBomb = makeFood({ id: 20, description: 'Iron bomb', calories: 50, iron_mg: 40, magnesium_mg: 400, protein_g: 10 });
        const constraints = relaxed();
        for (const k of Object.keys(constraints)) constraints[k] = {};
        constraints.protein_g = { min: 20 };
        const capped = optimizeDiet({ foods: [ironBomb, chicken], customConstraints: constraints, applyUpperLimits: true });
        assert.equal(capped.success, true, capped.message);
        assert.ok(capped.totalNutrients.iron_mg <= 45 + 1e-6, `iron ${capped.totalNutrients.iron_mg}`);
        assert.equal(capped.constraintLimits.iron_mg.max, 45);
        assert.equal(capped.constraintLimits.magnesium_mg, undefined);
    });
});
