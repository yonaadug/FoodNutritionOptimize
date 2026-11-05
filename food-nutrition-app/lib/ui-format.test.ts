import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasCoreData, householdAmount, splitFoodName } from '@/components/planner/nutrients';
import { goalProgress, goalSummary, parseIssues, unusedFoods } from '@/components/plan/analysis';
import type { PlanResult } from '@/hooks/usePlan';
import { makeFood, chicken, broccoli } from './testing/fixtures';
import type { Food } from './food-types';

const withServings = (f: Food, rows: [string, number][]): Food => ({
    ...f, serving_sizes: rows.map(([label, weight_g], i) => ({ id: i + 1, food_id: f.id, label, weight_g })),
});

describe('household amounts read naturally', () => {
    it('prefers a count of eggs over cups of chopped egg (regression: "≈ 1 cup, chopped" for 150 g)', () => {
        const egg = withServings(makeFood({ id: 1, description: 'Egg, whole, cooked, hard-boiled', calories: 155 }),
            [['1 cup, chopped', 136], ['1 large', 50], ['1 medium', 44], ['1 tbsp', 8.5]]);
        assert.equal(householdAmount(egg, 150), '≈ 3 large');
    });

    it('drops plain weights such as "3 oz" (regression: "≈ ¾ oz" for 19 g of salmon)', () => {
        const salmon = withServings(makeFood({ id: 2, description: 'Fish, salmon', calories: 200 }), [['3 oz', 85], ['1 oz', 28.35]]);
        assert.equal(householdAmount(salmon, 19), null);
    });

    it('cleans USDA labels (regression: "12½ cups, pieces of ~1"" and "bananas, Peeled")', () => {
        const kale = withServings(makeFood({ id: 3, description: 'Kale, raw', calories: 35 }), [['1 cup, pieces of ~1"', 20.6], ['1 RACC', 85]]);
        assert.equal(householdAmount(kale, 255), '≈ 12 cups, bite-size pieces');
        const banana = withServings(makeFood({ id: 4, description: 'Bananas, raw', calories: 89 }), [['1 banana, Peeled', 118]]);
        assert.equal(householdAmount(banana, 150), '≈ 1¼ bananas, peeled');
    });
});

describe('food names', () => {
    it('names the food, not the USDA group word', () => {
        assert.deepEqual(splitFoodName('Fish, salmon, sockeye, raw'), { name: 'Salmon', detail: 'sockeye, raw' });
        assert.deepEqual(splitFoodName('Beverages, tea, green, brewed'), { name: 'Tea', detail: 'green, brewed' });
        assert.equal(splitFoodName('Seeds, sunflower seed kernels, dry roasted').name, 'Sunflower seed kernels');
        assert.equal(splitFoodName('Cheese, cheddar').name, 'Cheddar cheese');
        assert.deepEqual(splitFoodName('Chicken, broilers or fryers, breast, meat only, cooked'), { name: 'Chicken', detail: 'breast, meat only, cooked' });
        assert.deepEqual(splitFoodName('Tempeh'), { name: 'Tempeh', detail: '' });
    });
});

describe('"Limited data" badge', () => {
    it('is not shown for genuinely zero-calorie foods (regression: tea, water and salt were flagged)', () => {
        assert.equal(hasCoreData(makeFood({ id: 5, description: 'Beverages, tea, green, brewed', calories: 0, water_g: 99.9 })), true);
        assert.equal(hasCoreData(makeFood({ id: 6, description: 'Salt, table', calories: 0, protein_g: null, total_fat_g: null, carbohydrate_g: null, water_g: 0.2 })), true);
        assert.equal(hasCoreData(makeFood({ id: 7, description: 'Mystery', calories: 0, protein_g: null, total_fat_g: null, carbohydrate_g: null, water_g: null })), false);
    });
});

describe('missing data is shown honestly', () => {
    const result = (): PlanResult => ({
        success: true,
        diet: [{ food: chicken, grams: 200, calories: 330, nutrients: {} }, { food: broccoli, grams: 300, calories: 102, nutrients: {} }],
        totalCalories: 432,
        totalNutrients: { saturated_g: 2, protein_g: 70, fiber_g: 8 },
        constraintLimits: { saturated_g: { max: 20 }, protein_g: { min: 50 }, fiber_g: { min: 28 } },
        warnings: [
            { code: 'missing_nutrient_data', foodId: broccoli.id, description: 'Broccoli, raw', nutrients: ['saturated_g', 'fiber_g'], inDiet: true, role: 'optimized' },
            { code: 'missing_nutrient_data', foodId: 99, description: 'Unused oats', nutrients: ['protein_g'], inDiet: false, role: 'optimized' },
        ],
    });

    it('marks a limit that includes unmeasured foods as uncertain (it could be exceeded)', () => {
        const sat = goalProgress(result()).find(p => p.key === 'saturated_g')!;
        assert.equal(sat.status, 'met');
        assert.equal(sat.uncertain, true);
        assert.deepEqual(sat.missing, ['Broccoli']);
        assert.equal(goalSummary(goalProgress(result())).uncertain.length, 1);
    });

    it('marks minimums as "at least" floors, and ignores foods the plan did not use', () => {
        const rows = goalProgress(result());
        assert.deepEqual(rows.find(p => p.key === 'fiber_g')!.missing, ['Broccoli']);
        assert.equal(rows.find(p => p.key === 'fiber_g')!.uncertain, false, 'a floor that is short stays "short"');
        assert.deepEqual(rows.find(p => p.key === 'protein_g')!.missing, [], 'unused oats do not affect the totals');
    });
});

describe('unused foods', () => {
    it('lists chosen foods the plan left out, with a reason', () => {
        const oats = makeFood({ id: 60, description: 'Oats', calories: 380, fiber_g: 10, iron_mg: 4.7 });
        const soda = makeFood({ id: 61, description: 'Soda', calories: 40, carbohydrate_g: 10 });
        const yogurt = makeFood({ id: 62, description: 'Yogurt', calories: 60, protein_g: 10 });
        const r: PlanResult = {
            success: true, diet: [{ food: chicken, grams: 100, calories: 165, nutrients: {} }],
            constraintLimits: { fiber_g: { min: 28 }, iron_mg: { min: 18 }, protein_g: { min: 50 } },
            totalNutrients: { fiber_g: 28, iron_mg: 18, protein_g: 90 },
        };
        const out = unusedFoods([chicken, oats, soda, yogurt], r, ['fiber_g', 'iron_mg', 'protein_g']);
        assert.deepEqual(out.map(u => u.food.id), [60, 61, 62]);
        assert.match(out[0].reason, /same fiber and iron for fewer calories/);
        assert.match(out[1].reason, /adds calories/);
        assert.match(out[2].reason, /protein goal was already met/);
    });
});

describe('infeasible issues', () => {
    it('uses the structured issues (all of them, with amounts) when the API sends them', () => {
        const { issues, more } = parseIssues({
            success: false, message: 'Optimization Failed:\n• x\n...and 3 more issues.',
            issues: [
                { kind: 'excess', nutrient: 'sodium_mg', amount: 700, cause: 'fixed_foods' },
                { kind: 'short', nutrient: 'vitamin_d_ug', amount: 18 },
            ],
        });
        assert.equal(more, 0);
        assert.equal(issues[0].fixedFoodsCause, true);
        assert.equal(issues[0].amount, 700);
        assert.equal(issues[1].kind, 'short');
    });
});
