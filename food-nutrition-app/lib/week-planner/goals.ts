/**
 * Which goals a week meets every day and which on average over the week. Pure (safe for
 * client components).
 *
 * The body stores vitamins A, D, E, K and B12 and folate for weeks to months, and iron and zinc
 * intake varies a lot from day to day, so for these a week's average is what matters. Meeting
 * them on average lets a plan put salmon (vitamin D) on two days instead of a little every day.
 * Everything else, and every upper limit, applies to each day: energy, protein, fiber, sodium,
 * saturated fat and the safe upper limits don't average out.
 */
import type { ConstraintLimit } from '../optimizer';
import type { GoalMode, WeekGoal } from './types';

export const WEEKLY_AVERAGE_KEYS: readonly string[] = [
    'vitamin_a_ug', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug', 'vitamin_b12_ug', 'folate_ug', 'iron_mg', 'zinc_mg',
];

/** Whether a goal's minimum is met each day or on average over the week. Maximums are always daily. */
export function goalMode(key: string, weeklyAverages: boolean): GoalMode {
    return weeklyAverages && WEEKLY_AVERAGE_KEYS.includes(key) ? 'weekly' : 'daily';
}

export function weekGoals(limits: Record<string, ConstraintLimit>, upperLimitKeys: readonly string[], weeklyAverages: boolean): WeekGoal[] {
    return Object.entries(limits).map(([key, lim]) => ({
        key,
        mode: lim.min !== undefined && lim.min > 0 ? goalMode(key, weeklyAverages) : 'daily',
        ...(lim.min !== undefined ? { min: lim.min } : {}),
        ...(lim.max !== undefined ? { max: lim.max } : {}),
        ...(upperLimitKeys.includes(key) ? { upperLimit: true } : {}),
    }));
}
