import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeDiet } from './optimizer';
import { goalProgress, goalSummary } from '@/components/plan/analysis';
import { GOAL_PRESETS, goalsToPayload } from '@/components/planner/goals';
import type { PlanResult } from '@/hooks/usePlan';
import { chicken, broccoli, makeFood } from './testing/fixtures';

const essentials = GOAL_PRESETS.find(p => p.id === 'essentials')!;

// A small, varied set that meets "Everyday essentials" comfortably.
const foods = [
    chicken,
    broccoli,
    makeFood({
        id: 40, description: 'Lentils, cooked', calories: 116, protein_g: 9, carbohydrate_g: 20, fiber_g: 8,
        iron_mg: 3.3, potassium_mg: 369, calcium_mg: 19, sodium_mg: 2, saturated_g: 0.05, vitamin_d_ug: 0,
    }),
    makeFood({
        id: 41, description: 'Milk, fortified', calories: 50, protein_g: 3.4, carbohydrate_g: 5, calcium_mg: 120,
        potassium_mg: 150, sodium_mg: 44, saturated_g: 1.2, vitamin_a_ug: 60, vitamin_d_ug: 1.1,
    }),
    makeFood({
        id: 42, description: 'Sweet potato, baked', calories: 90, protein_g: 2, carbohydrate_g: 21, fiber_g: 3.3,
        vitamin_a_ug: 960, vitamin_c_mg: 20, potassium_mg: 475, calcium_mg: 38, iron_mg: 0.7, sodium_mg: 36,
    }),
    makeFood({
        id: 43, description: 'Spinach, raw', calories: 23, protein_g: 2.9, carbohydrate_g: 3.6, fiber_g: 2.2,
        iron_mg: 2.7, calcium_mg: 99, potassium_mg: 558, vitamin_a_ug: 469, vitamin_c_mg: 28, sodium_mg: 79,
    }),
];

function plan(applyUpperLimits: boolean): PlanResult {
    const result = optimizeDiet({
        foods,
        customConstraints: goalsToPayload(essentials.goals),
        minCalories: 1200,
        maxCalories: 2600,
        foodConstraints: Object.fromEntries(foods.map(f => [f.id, { max: 800 }])),
        applyUpperLimits,
    });
    assert.equal(result.success, true, result.message ?? 'expected a plan');
    return result as unknown as PlanResult;
}

describe('goal progress with "Respect safe upper limits"', () => {
    it('counts only the user\'s goals, not ceiling-only safety limits (regression: 9/9 became 17/17)', () => {
        const without = goalSummary(goalProgress(plan(false)));
        const withUl = goalSummary(goalProgress(plan(true)));
        assert.equal(without.total, 9);
        assert.equal(withUl.total, 9, 'turning on upper limits must not add goals');
        assert.ok(withUl.safety.length >= 5, `expected UL-only rows, got ${withUl.safety.length}`);
    });

    it('does not report vitamin D as an "on target" goal when only its upper limit applies', () => {
        const rows = goalProgress(plan(true));
        const d = rows.find(r => r.key === 'vitamin_d_ug');
        assert.ok(d, 'vitamin D is still listed (as a safety check)');
        assert.equal(d.kind, 'safety');
        assert.equal(d.min, undefined);
        assert.equal(d.max, undefined, 'the UL is not presented as the user\'s "at most" goal');
        assert.equal(d.safeMax, 100);
    });

    it('keeps the user\'s minimum as the goal and the UL as a separate safety ceiling', () => {
        const rows = goalProgress(plan(true));
        const calcium = rows.find(r => r.key === 'calcium_mg')!;
        assert.equal(calcium.kind, 'goal');
        assert.equal(calcium.min, 1300);
        assert.equal(calcium.max, undefined);
        assert.equal(calcium.safeMax, 2500);
    });

    it('a safety ceiling that is exceeded is flagged even though it is not a goal', () => {
        const result = plan(true);
        result.totalNutrients = { ...result.totalNutrients, zinc_mg: 55 };
        const zinc = goalProgress(result).find(r => r.key === 'zinc_mg')!;
        assert.equal(zinc.kind, 'safety');
        assert.equal(zinc.status, 'high');
    });
});
