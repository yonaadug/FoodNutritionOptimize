import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeDiet } from './optimizer';
import { parseOptimizeRequest } from './optimize-request';
import { NUTRIENT_CONFIG } from './nutrient-defaults';
import { buildPayload } from '@/components/planner/payload';
import { DEFAULT_PORTION_CAP, DEFAULT_PRESET } from '@/components/planner/goals';
import { chicken, broccoli, relaxedConstraints } from './testing/fixtures';

const relaxed = () => relaxedConstraints(Object.keys(NUTRIENT_CONFIG));
// 1 cup = 100 g, so "3 servings" = 300 g = 495 kcal of chicken.
const cupChicken = { ...chicken, serving_sizes: [{ id: 1, food_id: 1, label: '1 cup', weight_g: 100 }] };
const grams = (r: ReturnType<typeof optimizeDiet>, id: number) => r.diet?.find(d => d.food.id === id)?.grams ?? 0;

describe('portionCap: the user-facing portion controls govern the per-food cap', () => {
    it('off ({}) removes the hidden 3-serving cap (regression: switching it off changed nothing)', () => {
        const result = optimizeDiet({ foods: [cupChicken], minCalories: 1000, customConstraints: relaxed(), portionCap: {} });
        assert.equal(result.success, true, result.message ?? 'expected success');
        assert.ok(grams(result, chicken.id) > 600, `chicken ${grams(result, chicken.id)} g`);
    });

    it('caps each food at N typical servings', () => {
        const constraints = relaxed();
        constraints.protein_g = { min: 120 };
        const three = optimizeDiet({ foods: [cupChicken, broccoli], customConstraints: constraints, portionCap: { servings: 3 } });
        assert.ok(grams(three, chicken.id) <= 300 + 1e-6, `3 servings: ${grams(three, chicken.id)} g`);
        const six = optimizeDiet({ foods: [cupChicken, broccoli], customConstraints: constraints, portionCap: { servings: 6 } });
        assert.equal(six.success, true, six.message ?? 'expected success');
        assert.ok(grams(six, chicken.id) > 300, `6 servings: ${grams(six, chicken.id)} g`);
    });

    it('also caps at a gram limit, whichever is lower', () => {
        const capped = optimizeDiet({
            foods: [cupChicken], minCalories: 450, customConstraints: relaxed(), portionCap: { servings: 10, grams: 250 },
        });
        assert.equal(capped.success, false, '250 g of chicken = 412 kcal < 450 kcal');
        const fine = optimizeDiet({
            foods: [cupChicken], minCalories: 400, customConstraints: relaxed(), portionCap: { servings: 10, grams: 250 },
        });
        assert.equal(fine.success, true, fine.message ?? 'expected success');
    });

    it('foods without a household serving count 100 g as one serving', () => {
        const result = optimizeDiet({ foods: [broccoli], minCalories: 200, customConstraints: relaxed(), portionCap: { servings: 5 } });
        assert.equal(result.success, false, '5 x 100 g broccoli = 170 kcal < 200 kcal');
        const ok = optimizeDiet({ foods: [broccoli], minCalories: 160, customConstraints: relaxed(), portionCap: { servings: 5 } });
        assert.equal(ok.success, true, ok.message ?? 'expected success');
    });

    it("a food's own limits still override the general cap", () => {
        const result = optimizeDiet({
            foods: [cupChicken], minCalories: 1000, customConstraints: relaxed(),
            portionCap: { servings: 3, grams: 300 }, foodConstraints: { [chicken.id]: { max: 900 } },
        });
        assert.equal(result.success, true, result.message ?? 'expected success');
    });

    it('says when the portion cap is what blocks the plan', () => {
        const blocked = optimizeDiet({ foods: [cupChicken], minCalories: 1000, customConstraints: relaxed(), portionCap: { servings: 3, grams: 300 } });
        assert.equal(blocked.success, false);
        assert.equal(blocked.portionCapBinding, true);

        const constraints = relaxed();
        constraints.vitamin_c_mg = { min: 50 };
        const other = optimizeDiet({ foods: [cupChicken], customConstraints: constraints, portionCap: { servings: 3, grams: 300 } });
        assert.equal(other.success, false);
        assert.equal(other.portionCapBinding, false, 'chicken has no vitamin C at any portion size');
    });

    it('keeps the legacy default (about 3 servings) for API clients that do not send portionCap', () => {
        const result = optimizeDiet({ foods: [cupChicken], minCalories: 1000, customConstraints: relaxed() });
        assert.equal(result.success, false);
    });

    it('is accepted and validated by the request parser', () => {
        const p = parseOptimizeRequest({ foods: [chicken], portionCap: { servings: 3, grams: '300' } });
        assert.deepEqual(p.portionCap, { servings: 3, grams: '300' });
        assert.throws(() => parseOptimizeRequest({ foods: [chicken], portionCap: 5 }));
        assert.throws(() => parseOptimizeRequest({ foods: [chicken], portionCap: { grams: { x: 1 } } }));
        const bad = optimizeDiet({ foods: [chicken], portionCap: { servings: -1 } });
        assert.ok(bad.error, 'negative servings are rejected');
    });
});

describe('buildPayload: what the UI sends for the portion setting', () => {
    const base = {
        foods: [chicken], fixedFoods: [], foodLimits: {}, presetId: DEFAULT_PRESET.id, goals: DEFAULT_PRESET.goals,
        calories: DEFAULT_PRESET.calories, portionCap: DEFAULT_PORTION_CAP, upperLimits: false, hydrated: true,
    };

    it('sends servings and grams when "Keep portions realistic" is on', () => {
        assert.deepEqual(buildPayload(base).portionCap, { servings: 3, grams: 300 });
    });

    it('sends no cap at all when it is off', () => {
        assert.deepEqual(buildPayload({ ...base, portionCap: { ...DEFAULT_PORTION_CAP, enabled: false } }).portionCap, {});
    });

    it('fills in 3 servings for state saved before servings existed', () => {
        assert.deepEqual(buildPayload({ ...base, portionCap: { enabled: true, grams: 450 } }).portionCap, { servings: 3, grams: 450 });
    });
});
