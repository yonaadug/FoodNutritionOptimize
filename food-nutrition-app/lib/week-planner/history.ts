/**
 * Week plans in a signed-in person's history (kind "week-plan"). Unlike a day plan, a week is
 * stored as it came out, day by day: re-solving could give a different week, and people lock
 * days they like. Foods are kept by fdc id and amounts in grams; reopening fetches the foods
 * fresh and recomputes every total with today's data. Size-capped like lib/plan-history.ts.
 */
import type { HistoryRecord } from '@/lib/auth/client';
import { presetTitle, type CalorieRange, type Goals, type PortionCap, type PresetId } from '@/components/planner/goals';
import { fmtNumber } from '@/components/planner/nutrients';
import type { FixedFood, PlannerState } from '@/hooks/usePlannerState';
import { plannerStateFromSaved, type ReopenedPlanner } from '@/lib/plan-history';
import { HISTORY_LIMITS } from '@/lib/user-store/history';
import type { Food } from '../food-types';
import { shortHash } from '../recipes/nutrition';
import { dayTotals, weekGoalProgress, weekTotals } from './totals';
import { DEFAULT_WEEK_SETTINGS, type WeekDay, type WeekEntry, type WeekGoal, type WeekResult, type WeekRole, type WeekSettings } from './types';

export const WEEK_HISTORY_KIND = 'week-plan';

const ROLES: WeekRole[] = ['planned', 'fixed', 'cooked', 'leftover'];

/** [food, grams, role, servings, cooked, locked]: food is an fdc id, or "r:<recipe id>" for a recipe. */
type StoredEntry = [number | string, number, number, number?, number?, 1?];
/** [key, 0 daily | 1 weekly, min | null, max | null, 1 when a safe upper limit] */
type StoredGoal = [string, 0 | 1, number | null, number | null, 0 | 1];

export interface SavedWeek {
    v: 1;
    settings: WeekSettings;
    foods: number[];
    fixed: [number, number][];
    limits: Record<string, { min?: number; max?: number }>;
    presetId: PresetId;
    goals?: Goals;
    calories?: CalorieRange;
    portionCap: PortionCap;
    upperLimits: boolean;
    weekGoals: StoredGoal[];
    days: StoredEntry[][];
    locked: number[];
}

function foodRef(food: Food | undefined): number | string | null {
    if (!food) return null;
    if (food.recipe) return `r:${food.recipe.id}`;
    return Number.isSafeInteger(food.fdc_id) && food.fdc_id > 0 ? food.fdc_id : null;
}

export function savedWeek(s: PlannerState, result: WeekResult): SavedWeek {
    const foods = result.foods ?? {};
    const limits: SavedWeek['limits'] = {};
    for (const f of s.foods) {
        const l = s.foodLimits[f.id];
        if (l && f.fdc_id > 0) limits[String(f.fdc_id)] = l;
    }
    return {
        v: 1,
        settings: result.settings,
        foods: s.foods.filter(f => !f.recipe && f.fdc_id > 0).map(f => f.fdc_id),
        fixed: s.fixedFoods.filter(f => !f.food.recipe && f.food.fdc_id > 0).map(f => [f.food.fdc_id, f.grams]),
        limits,
        presetId: s.presetId,
        ...(s.presetId === 'custom' ? { goals: s.goals, calories: s.calories } : {}),
        portionCap: s.portionCap,
        upperLimits: s.upperLimits,
        weekGoals: result.goals.map(g => [g.key, g.mode === 'weekly' ? 1 : 0, g.min ?? null, g.max ?? null, g.upperLimit ? 1 : 0]),
        days: (result.days ?? []).map(d => d.entries.flatMap((e): StoredEntry[] => {
            const ref = foodRef(foods[String(e.foodId)]);
            if (ref === null) return [];
            const row: StoredEntry = [ref, Math.round(e.grams * 10) / 10, ROLES.indexOf(e.role)];
            if (e.servings !== undefined || e.cooked !== undefined || e.locked) row.push(e.servings ?? 0);
            if (e.cooked !== undefined || e.locked) row.push(e.cooked ?? 0);
            if (e.locked) row.push(1);
            return [row];
        })),
        locked: (result.days ?? []).filter(d => d.locked).map(d => d.index),
    };
}

/** The same week gives the same id, so saving it again moves one row to the top. */
export function weekItemId(saved: SavedWeek): string {
    return `w-${shortHash(JSON.stringify(saved.days))}`;
}

function summary(result: WeekResult, s: PlannerState): { label: string; value: string }[] {
    const days = result.days ?? [];
    const progress = weekGoalProgress(days, result.goals).filter(p => p.key !== 'calories' && !p.upperLimit);
    const met = progress.filter(p => p.status === 'met').length;
    const totals = weekTotals(days);
    const distinct = new Set(days.flatMap(d => d.entries.map(e => e.foodId))).size;
    return [
        { label: 'Calories', value: `${fmtNumber((totals.calories ?? 0) / Math.max(1, days.length), { decimals: 0 })} kcal a day` },
        ...(progress.length ? [{ label: 'Goals met', value: `${met} of ${progress.length}` }] : []),
        { label: 'Foods', value: `${distinct} across ${days.length} days` },
        { label: 'Goals', value: presetTitle(s.presetId) },
    ];
}

function fits(data: unknown): boolean {
    return new TextEncoder().encode(JSON.stringify(data)).length <= HISTORY_LIMITS.dataBytes;
}

/** The history entry for a week that has just been planned. Too big to keep whole: the summary only. */
export function weekHistoryItem(s: PlannerState, result: WeekResult): HistoryRecord {
    const reopen = savedWeek(s, result);
    const itemId = weekItemId(reopen);
    const facts = summary(result, s);
    const title = `Week plan: ${presetTitle(s.presetId)}`;
    const whole = { summary: facts, reopen };
    if (fits(whole)) return { kind: WEEK_HISTORY_KIND, itemId, title, href: `/plan/week?open=${itemId}`, data: whole };
    return { kind: WEEK_HISTORY_KIND, itemId, title, href: '/plan/week', data: { summary: facts, tooLong: true } };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validEntry(e: unknown): e is StoredEntry {
    return Array.isArray(e) && e.length >= 3 && (isNum(e[0]) || (typeof e[0] === 'string' && e[0].startsWith('r:')))
        && isNum(e[1]) && e[1] >= 0 && Number.isInteger(e[2]) && e[2] >= 0 && e[2] < ROLES.length;
}

/** The week stored in a history row, checked. Null when it can't be reopened. */
export function savedWeekFrom(data: unknown): SavedWeek | null {
    if (!isObject(data) || !isObject(data.reopen)) return null;
    const r = data.reopen;
    if (r.v !== 1 || !Array.isArray(r.days) || !r.days.every(d => Array.isArray(d) && d.every(validEntry))) return null;
    if (!Array.isArray(r.foods) || !r.foods.every(isNum)) return null;
    if (!Array.isArray(r.fixed) || !r.fixed.every(f => Array.isArray(f) && f.length === 2 && f.every(isNum))) return null;
    if (!Array.isArray(r.weekGoals)) return null;
    return {
        v: 1,
        settings: { ...DEFAULT_WEEK_SETTINGS, ...(isObject(r.settings) ? r.settings as Partial<WeekSettings> : {}), days: r.days.length },
        foods: r.foods,
        fixed: r.fixed as [number, number][],
        limits: isObject(r.limits) ? r.limits as SavedWeek['limits'] : {},
        presetId: typeof r.presetId === 'string' ? r.presetId as PresetId : 'custom',
        goals: isObject(r.goals) ? r.goals as Goals : undefined,
        calories: isObject(r.calories) ? r.calories as CalorieRange : undefined,
        portionCap: isObject(r.portionCap) ? r.portionCap as unknown as PortionCap : { enabled: true, grams: 300, servings: 3 },
        upperLimits: r.upperLimits === true,
        weekGoals: (r.weekGoals as unknown[]).filter((g): g is StoredGoal => Array.isArray(g) && typeof g[0] === 'string'),
        days: r.days as StoredEntry[][],
        locked: Array.isArray(r.locked) ? r.locked.filter(isNum) : [],
    };
}

export interface ReopenedWeek {
    planner: Omit<ReopenedPlanner, 'missing'>;
    result: WeekResult;
    /** Foods (or recipes) in the saved week that couldn't be found now. */
    missing: number;
}

/**
 * Planner state and the week itself, from a saved week. `foods` are fetched fresh by fdc id;
 * `recipes` are the recipes this browser's planner has (by recipe id). Totals are recomputed.
 */
export function weekFromSaved(saved: SavedWeek, foods: ReadonlyMap<number, Food>, recipes: readonly FixedFood[] = []): ReopenedWeek {
    const { missing: missingFoods, ...planner } = plannerStateFromSaved(
        { foods: saved.foods, fixed: saved.fixed, limits: saved.limits, recipes: [], presetId: saved.presetId, goals: saved.goals, calories: saved.calories, portionCap: saved.portionCap, upperLimits: saved.upperLimits },
        foods,
    );
    const byRecipe = new Map(recipes.filter(r => r.food.recipe).map(r => [r.food.recipe!.id, r]));
    planner.fixedFoods = [...planner.fixedFoods, ...byRecipe.values()];
    // Planner ids for fdc ids: the foods in the planner, or the fetched row for anything else.
    const idFor = new Map<number, Food>();
    for (const f of [...planner.foods, ...planner.fixedFoods.map(x => x.food)]) if (!f.recipe) idFor.set(f.fdc_id, f);
    for (const [fdc, f] of foods) if (!idFor.has(fdc)) idFor.set(fdc, f);
    const used: Record<string, Food> = {};
    let missing = missingFoods;
    const lost = new Set<string>();
    const days: WeekDay[] = saved.days.map((stored, index) => {
        const entries: WeekEntry[] = [];
        for (const [ref, grams, role, servings, cooked, locked] of stored) {
            const food = typeof ref === 'string' ? byRecipe.get(ref.slice(2))?.food : idFor.get(ref);
            if (!food) { lost.add(String(ref)); continue; }
            used[String(food.id)] = food;
            entries.push({
                foodId: food.id, grams, role: ROLES[role],
                ...(servings ? { servings } : {}),
                ...(cooked ? { cooked } : {}),
                locked: locked === 1,
            });
        }
        return dayTotals(used, index, entries, saved.locked.includes(index));
    });
    // Missing planner foods are already counted; add recipes this browser doesn't have.
    missing += [...lost].filter(r => r.startsWith('r:')).length;
    const goals: WeekGoal[] = saved.weekGoals.map(([key, mode, min, max, ul]) => ({
        key, mode: mode === 1 ? 'weekly' : 'daily',
        ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}), ...(ul ? { upperLimit: true } : {}),
    }));
    return {
        planner,
        missing,
        result: {
            success: true,
            days,
            foods: used,
            weekTotals: weekTotals(days),
            goals,
            settings: saved.settings,
            solver: { ms: 0, status: 'optimal', variables: 0, integers: 0, constraints: 0 },
        },
    };
}
