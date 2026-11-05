import type { PlannerState } from '@/hooks/usePlannerState';
import { DEFAULT_PORTION_SERVINGS, goalsToPayload } from './goals';

/** The POST /api/optimize body for the current planner state. */
export function buildPayload(s: PlannerState) {
    return {
        foods: s.foods,
        guaranteedFoods: s.fixedFoods,
        customConstraints: goalsToPayload(s.goals),
        minCalories: s.calories.min !== undefined ? String(s.calories.min) : undefined,
        maxCalories: s.calories.max !== undefined ? String(s.calories.max) : undefined,
        // Authoritative: {} means "no general cap" (the optimizer otherwise applies its legacy default).
        portionCap: s.portionCap.enabled
            ? { servings: s.portionCap.servings ?? DEFAULT_PORTION_SERVINGS, grams: s.portionCap.grams }
            : {},
        foodConstraints: s.foodLimits,
        applyUpperLimits: s.upperLimits || undefined,
    };
}

/** A cheap fingerprint of the inputs, used to detect an out-of-date plan. */
export function payloadKey(s: PlannerState): string {
    return JSON.stringify({
        f: s.foods.map(f => f.id),
        x: s.fixedFoods.map(f => [f.food.id, f.grams, f.food.recipe?.fingerprint]),
        g: s.goals, c: s.calories, p: s.portionCap, l: s.foodLimits, u: s.upperLimits,
    });
}
