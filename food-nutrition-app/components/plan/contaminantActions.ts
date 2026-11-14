'use client';

import { fetchFoodsByFdcIds } from '@/hooks/useFoodSearch';
import { runPlan } from '@/hooks/usePlan';
import { getPlannerSnapshot, plannerActions } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { shortFoodName } from '@/components/planner/nutrients';
import type { SwapCandidate } from '@/lib/plan-contaminants';
import type { PlanContaminantActions } from './PlanContaminants';

/**
 * The contaminant panel's one-click fixes, applied to the planner's foods. Each one changes
 * the foods, makes the plan again and offers Undo. `replan` lets the week planner re-run its
 * own plan instead of the day's.
 */
export function plannerContaminantActions(replan: () => void = () => void runPlan(getPlannerSnapshot())): PlanContaminantActions {
    const change = (message: string, fn: () => void) => {
        const before = getPlannerSnapshot();
        fn();
        replan();
        notify(message, {
            action: {
                label: 'Undo',
                onClick: () => {
                    plannerActions.restoreFoods(before.foods, before.fixedFoods, before.foodLimits);
                    replan();
                },
            },
        });
    };
    const find = (key: number) => {
        const s = getPlannerSnapshot();
        const fixed = s.fixedFoods.find(f => f.food.id === key);
        const food = fixed?.food ?? s.foods.find(f => f.id === key);
        return { fixed, food, limit: s.foodLimits[key] };
    };

    const reduceTo = (key: number, grams: number) => {
        const { fixed, food, limit } = find(key);
        if (!food) return;
        const g = Math.max(0, Math.round(grams));
        change(`${shortFoodName(food.description)} is now at most ${g} g. Plan updated.`, () => {
            if (fixed) {
                plannerActions.setFixed(food, g);
                return;
            }
            if (limit?.min !== undefined && limit.min > g) plannerActions.setFoodLimit(key, 'min', undefined);
            plannerActions.setFoodLimit(key, 'max', g);
        });
    };

    return {
        onReduce(key, factor, grams) {
            const { fixed } = find(key);
            const current = fixed?.grams ?? grams;
            reduceTo(key, Math.floor((current * factor) / 5) * 5);
        },
        onExclude(key) {
            const { fixed, food } = find(key);
            if (!food) return;
            change(`${shortFoodName(food.description)} is left out. Plan updated.`, () => {
                if (fixed) plannerActions.removeFood(key);
                else {
                    plannerActions.setFoodLimit(key, 'min', undefined);
                    plannerActions.setFoodLimit(key, 'max', 0);
                }
            });
        },
        onSwap(key: number, to: SwapCandidate) {
            const { fixed, food } = find(key);
            if (!food) return;
            void fetchFoodsByFdcIds([to.fdcId]).then(([next]) => {
                if (!next) throw new Error('not found');
                change(`Swapped ${shortFoodName(food.description)} for ${shortFoodName(next.description)}. Plan updated.`, () => {
                    plannerActions.removeFood(key);
                    if (fixed) plannerActions.setFixed(next, fixed.grams);
                    else plannerActions.addFood(next);
                });
            }).catch(() => notify("Couldn't load that food. Check your connection, then try again.", { tone: 'info' }));
        },
    };
}
