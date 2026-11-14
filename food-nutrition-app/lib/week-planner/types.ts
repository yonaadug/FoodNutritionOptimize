/**
 * Week planner types. No runtime imports (safe for client components).
 */
import type { Food } from '../food-types';
import type { ConstraintLimit, OptimizationIssue, OptimizationParams, OptimizationWarning } from '../optimizer';

export interface WeekSettings {
    /** Days in the plan (7 for a week; tests use fewer). */
    days: number;
    /** Variety: the most days any one food (or recipe cooking) appears in the week. */
    maxDaysPerFood: number;
    /** Recipes: cook once, eat that day and the next. */
    leftovers: boolean;
    /** Vitamins A, D, E, K, B12, folate, iron and zinc: met on average over the week rather than every day. */
    weeklyAverages: boolean;
    /** A small penalty for the same food on two days in a row. */
    avoidBackToBack: boolean;
}

export const DEFAULT_WEEK_SETTINGS: WeekSettings = {
    days: 7,
    maxDaysPerFood: 3,
    leftovers: true,
    weeklyAverages: true,
    avoidBackToBack: true,
};

export const WEEK_LIMITS = {
    minDays: 2,
    maxDays: 7,
    maxFoods: 60,
    maxRecipes: 8,
    maxLockedItems: 300,
    /** Most servings of one recipe eaten in a day, and cooked in one batch. */
    recipeServingsPerDay: 2,
    recipeServingsPerBatch: 4,
    /** The whole request's solver budget; one solve gets at most 2 s of it. */
    timeLimitMs: 6000,
} as const;

/** A food fixed on one day, as it was in the plan being re-planned. */
export interface WeekLockItem {
    day: number;
    /** The planner's food id. */
    foodId: number;
    grams: number;
    /** Recipes: servings (grams = servings x serving grams). */
    servings?: number;
    /** A recipe serving eaten as the previous day's leftovers. */
    leftover?: boolean;
}

export interface WeekLocks {
    /** Days kept exactly as they are. Their items are all in `items`. */
    days: number[];
    /** Foods kept at their amount on one day (locked days list all their foods here). */
    items: WeekLockItem[];
}

export interface WeekParams extends Pick<OptimizationParams,
    'customConstraints' | 'minCalories' | 'maxCalories' | 'applyUpperLimits' | 'portionCap' | 'foodConstraints'> {
    /** Foods the planner sets amounts for. */
    foods: Food[];
    /** Fixed foods: eaten every day at this amount. Recipes here become dishes the week plans in whole servings. */
    fixedFoods?: { food: Food; grams: number }[];
    settings?: Partial<WeekSettings>;
    locks?: WeekLocks;
    /** Re-planning: food-days to steer away from (a soft penalty), so the rest of the week changes. */
    avoid?: { day: number; foodId: number }[];
    timeLimitMs?: number;
}

export type WeekRole = 'planned' | 'fixed' | 'cooked' | 'leftover';

export interface WeekEntry {
    foodId: number;
    grams: number;
    /** Recipes only. */
    servings?: number;
    /** Recipes cooked this day: servings in the batch, when more than are eaten today (the rest is tomorrow's leftovers). */
    cooked?: number;
    role: WeekRole;
    locked: boolean;
}

export interface WeekDay {
    index: number;
    locked: boolean;
    entries: WeekEntry[];
    calories: number;
    nutrients: Record<string, number>;
}

export type GoalMode = 'daily' | 'weekly';

export interface WeekGoal {
    key: string;
    mode: GoalMode;
    /** Per day. A weekly goal's min is met by the week's total: min x days. */
    min?: number;
    max?: number;
    /** A safe upper limit added by applyUpperLimits rather than a goal. */
    upperLimit?: boolean;
}

export type WeekDiagnosis = 'nutrients' | 'variety' | 'portions' | 'locks' | 'time';

export interface WeekSolverInfo {
    ms: number;
    /** 'time_limit': the best plan found when time ran out (good, but not proven the best). */
    status: 'optimal' | 'time_limit' | 'infeasible' | 'error';
    variables: number;
    integers: number;
    constraints: number;
}

export interface WeekResult {
    success: boolean;
    /** Malformed input; the API maps it to 400. */
    error?: string;
    message?: string;
    issues?: OptimizationIssue[];
    diagnosis?: WeekDiagnosis;
    /** Infeasible only: what the variety limit would need to be for the week to work, if raising it helps. */
    varietyNeeded?: number;
    /**
     * Set when the week couldn't meet every goal with the variety asked for: the plan uses
     * the smallest limit (days per food) that works instead.
     */
    varietyUsed?: number;
    portionCapBinding?: boolean;
    days?: WeekDay[];
    /** Every food the plan uses, by planner id, as the server read it. */
    foods?: Record<string, Food>;
    weekTotals?: Record<string, number>;
    goals: WeekGoal[];
    constraintLimits?: Record<string, ConstraintLimit>;
    settings: WeekSettings;
    solver: WeekSolverInfo;
    warnings?: OptimizationWarning[];
}
