/**
 * Day and week totals, and how a week plan stands against its goals. Pure (safe for client
 * components): the browser recomputes a reopened week from today's data with these.
 */
import { nutrientValue, type Food } from '../food-types';
import { ALL_NUTRIENT_CONFIG } from '../nutrient-defaults';
import type { GoalMode, WeekDay, WeekEntry, WeekGoal } from './types';

const NUTRIENT_KEYS = Object.keys(ALL_NUTRIENT_CONFIG).filter(k => k !== 'calories');

export function dayTotals(foods: ReadonlyMap<number, Food> | Readonly<Record<string, Food>>, index: number, entries: WeekEntry[], locked = false): WeekDay {
    const get = (id: number) => (foods instanceof Map ? foods.get(id) : (foods as Record<string, Food>)[String(id)]);
    const nutrients: Record<string, number> = {};
    for (const k of NUTRIENT_KEYS) nutrients[k] = 0;
    let calories = 0;
    for (const e of entries) {
        const food = get(e.foodId);
        if (!food) continue;
        calories += (nutrientValue(food, 'calories') ?? 0) * e.grams / 100;
        for (const k of NUTRIENT_KEYS) nutrients[k] += (nutrientValue(food, k) ?? 0) * e.grams / 100;
    }
    nutrients.calories = calories;
    return { index, locked, entries, calories: Math.round(calories), nutrients };
}

export function weekTotals(days: readonly WeekDay[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of days) for (const [k, v] of Object.entries(d.nutrients)) out[k] = (out[k] ?? 0) + v;
    return out;
}

export interface WeekGoalProgress {
    key: string;
    mode: GoalMode;
    min?: number;
    max?: number;
    upperLimit?: boolean;
    /** Per day. */
    average: number;
    /** Days within the goal (for a weekly goal: whether the week's total is enough). */
    daysMet: number;
    days: number;
    status: 'met' | 'low' | 'high';
}

const within = (v: number, min?: number, max?: number) =>
    (min === undefined || v >= min * 0.995) && (max === undefined || v <= max * 1.005);

/** Each goal: met every day (daily goals), or on average over the week (weekly goals). */
export function weekGoalProgress(days: readonly WeekDay[], goals: readonly WeekGoal[]): WeekGoalProgress[] {
    const n = Math.max(1, days.length);
    return goals.map(g => {
        const values = days.map(d => (g.key === 'calories' ? d.nutrients.calories ?? d.calories : d.nutrients[g.key] ?? 0));
        const average = values.reduce((s, v) => s + v, 0) / n;
        // A weekly goal: the minimum on average, any maximum on each day.
        const daysMet = values.filter(v => within(v, g.mode === 'weekly' ? undefined : g.min, g.max)).length;
        const overDays = g.max !== undefined ? values.filter(v => v > g.max! * 1.005).length : 0;
        let status: WeekGoalProgress['status'] = 'met';
        if (overDays > 0) status = 'high';
        else if (g.mode === 'weekly' ? g.min !== undefined && average < g.min * 0.995 : daysMet < n) status = 'low';
        return {
            key: g.key, mode: g.mode,
            ...(g.min !== undefined ? { min: g.min } : {}),
            ...(g.max !== undefined ? { max: g.max } : {}),
            ...(g.upperLimit ? { upperLimit: true } : {}),
            average, daysMet, days: n, status,
        };
    }).sort((a, b) => (a.key === 'calories' ? -1 : b.key === 'calories' ? 1 : 0));
}

/** How many days each food appears on (recipes: days eaten, leftovers included). */
export function daysPerFood(days: readonly WeekDay[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const d of days) {
        for (const id of new Set(d.entries.map(e => e.foodId))) out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}
