'use client';

import { fetchFoodsByFdcIds } from '@/hooks/useFoodSearch';
import { getPlanSnapshot, restorePlanSnapshot, runPlan } from '@/hooks/usePlan';
import { getPlannerSnapshot, plannerActions } from '@/hooks/usePlannerState';
import { setStep } from '@/hooks/useStep';
import { notify } from '@/hooks/useToasts';
import { plannerStateFromSaved, savedPlanFrom } from '@/lib/plan-history';
import type { HistoryItem } from '@/lib/user-store/history';

export type ReopenResult = 'opened' | 'too-long' | 'failed';

/**
 * Make a saved plan the current one and run it again with today's data. What was on
 * screen isn't lost: the message that follows offers Undo.
 */
export async function reopenPlan(item: HistoryItem): Promise<ReopenResult> {
    const saved = savedPlanFrom(item.data);
    if (!saved) return 'too-long';
    try {
        const foods = await fetchFoodsByFdcIds([...saved.foods, ...saved.fixed.map(([id]) => id)]);
        const { missing, ...next } = plannerStateFromSaved(saved, new Map(foods.map(f => [f.fdc_id, f])));

        const before = getPlannerSnapshot();
        const planBefore = getPlanSnapshot();
        const hadFoods = before.foods.length + before.fixedFoods.length > 0;

        plannerActions.replaceAll(next);
        setStep('plan');
        void runPlan(getPlannerSnapshot());

        const gone = missing > 0 ? ` ${missing} ${missing === 1 ? 'food is' : 'foods are'} no longer in the database, so ${missing === 1 ? 'it was' : 'they were'} left out.` : '';
        notify(`Opened your saved plan.${gone}`, hadFoods ? {
            action: {
                label: 'Undo',
                onClick: () => {
                    const { hydrated: _hydrated, ...previous } = before;
                    plannerActions.replaceAll(previous);
                    restorePlanSnapshot(planBefore);
                },
            },
        } : undefined);
        return 'opened';
    } catch {
        return 'failed';
    }
}
