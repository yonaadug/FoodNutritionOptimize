/**
 * Plans in a signed-in person's history: a small summary for the Plans tab, plus what's
 * needed to make the same plan again on any device. Stored are the inputs, not the result:
 * foods by id, amounts and goals. Reopening runs the planner again with today's data, so
 * a saved plan can't quietly disagree with the rest of the site.
 */
import type { HistoryRecord } from '@/lib/auth/client';
import { goalProgress, goalSummary } from '@/components/plan/analysis';
import {
    DEFAULT_PORTION_CAP, presetById, presetTitle, type CalorieRange, type Goals, type PortionCap, type PresetId,
} from '@/components/planner/goals';
import { fmtNumber, shortFoodName } from '@/components/planner/nutrients';
import type { PlanResult } from '@/hooks/usePlan';
import type { FixedFood, FoodLimits, PlannerState } from '@/hooks/usePlannerState';
import { HISTORY_LIMITS } from '@/lib/user-store/history';
import type { Food } from './food-types';
import { RECIPE_NUTRIENTS, shortHash } from './recipes/nutrition';

/**
 * A recipe in a saved plan. A plan can hold several and each has about 40 values, so nutrients
 * are by position in RECIPE_NUTRIENTS, not by name. That list must only ever be added to.
 */
interface StoredRecipe {
    /** The planner's id for it. */
    id: number;
    name: string;
    grams: number;
    /** The recipe's record id, for its link. */
    rid: string;
    serving: number;
    uncounted: string[];
    fingerprint: string;
    /** Per 100 g, null where there is no data. */
    values: (number | null)[];
    /** Positions of nutrients that are only a lower bound. */
    lower: number[];
    /** [position, older entry's fdc_id] of values from an older USDA entry. */
    older: [number, number][];
}

export interface SavedPlan {
    /** fdc ids of the foods the planner sets amounts for. */
    foods: number[];
    /** [fdc id, grams] of foods fixed at an amount. */
    fixed: [number, number][];
    /** Limits by fdc id: row ids can differ between devices and database builds. */
    limits: Record<string, { min?: number; max?: number }>;
    recipes: StoredRecipe[];
    presetId: PresetId;
    /** Only for custom goals. A preset is stored by name. */
    goals?: Goals;
    calories?: CalorieRange;
    portionCap: PortionCap;
    upperLimits: boolean;
}

function realFoods(foods: Food[]): Food[] {
    return foods.filter(f => !f.recipe && Number.isSafeInteger(f.fdc_id) && f.fdc_id > 0);
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function storedRecipe(food: Food, recipe: NonNullable<Food['recipe']>, grams: number): StoredRecipe {
    const own = food as unknown as Record<string, unknown>;
    const position = (key: string) => (RECIPE_NUTRIENTS as readonly string[]).indexOf(key);
    return {
        id: food.id,
        name: food.description,
        grams,
        rid: recipe.id,
        serving: recipe.servingGrams,
        uncounted: recipe.uncounted,
        fingerprint: recipe.fingerprint,
        values: RECIPE_NUTRIENTS.map(k => {
            const v = own[k];
            return typeof v === 'number' && Number.isFinite(v) ? round3(v) : null;
        }),
        lower: recipe.incomplete.map(position).filter(i => i >= 0),
        older: Object.entries(food.filledFrom ?? {}).flatMap(([k, fdc]): [number, number][] => (position(k) >= 0 ? [[position(k), fdc]] : [])),
    };
}

function savedPlan(s: PlannerState): SavedPlan {
    const fixedReal = s.fixedFoods.filter(f => !f.food.recipe && f.food.fdc_id > 0);
    const limits: SavedPlan['limits'] = {};
    for (const f of s.foods) {
        const limit = s.foodLimits[f.id];
        if (limit && f.fdc_id > 0) limits[String(f.fdc_id)] = limit;
    }
    return {
        foods: realFoods(s.foods).map(f => f.fdc_id),
        fixed: fixedReal.map(f => [f.food.fdc_id, f.grams]),
        limits,
        recipes: s.fixedFoods.flatMap(f => (f.food.recipe ? [storedRecipe(f.food, f.food.recipe, f.grams)] : [])),
        presetId: s.presetId,
        ...(s.presetId === 'custom' ? { goals: s.goals, calories: s.calories } : {}),
        portionCap: s.portionCap,
        upperLimits: s.upperLimits,
    };
}

/** The same foods and goals give the same id, so making a plan again moves one row to the top. */
export function planItemId(s: PlannerState): string {
    const plan = savedPlan(s);
    return `p-${shortHash(JSON.stringify({
        ...plan,
        foods: [...plan.foods].sort((a, b) => a - b),
        fixed: [...plan.fixed].sort((a, b) => a[0] - b[0]),
        recipes: plan.recipes.map(r => [r.rid, r.grams, r.fingerprint]),
        goals: s.goals,
        calories: s.calories,
    }))}`;
}

const SHOWN_FOODS = 3;

function foodsFact(names: string[]): string {
    const shown = names.slice(0, SHOWN_FOODS).join(', ');
    return names.length > SHOWN_FOODS ? `${shown} +${names.length - SHOWN_FOODS} more` : shown;
}

/** What the Plans tab shows for this plan. */
function planSummary(s: PlannerState, result: PlanResult, used: Food[]): { label: string; value: string }[] {
    const chosen = [...s.foods, ...s.fixedFoods.map(f => f.food)];
    if (!result.success) {
        return [
            { label: 'Status', value: 'Needs changes' },
            { label: 'Foods', value: foodsFact(chosen.map(f => shortFoodName(f.description))) },
        ];
    }
    const { met, total } = goalSummary(goalProgress(result));
    const facts = [{ label: 'Calories', value: `${fmtNumber(result.totalCalories ?? null, { decimals: 0 })} kcal` }];
    const protein = result.totalNutrients?.protein_g;
    if (typeof protein === 'number') facts.push({ label: 'Protein', value: `${fmtNumber(protein, { decimals: 0 })} g` });
    if (total > 0) facts.push({ label: 'Goals met', value: `${met} of ${total}` });
    facts.push({ label: 'Foods', value: foodsFact(used.map(f => shortFoodName(f.description))) });
    return facts;
}

function fits(data: unknown): boolean {
    return new TextEncoder().encode(JSON.stringify(data)).length <= HISTORY_LIMITS.dataBytes;
}

/**
 * The history entry for a plan that has just been computed. If it can't fit the size
 * cap, only the summary is kept: a plan with some foods missing wouldn't be the same plan.
 */
export function planHistoryItem(s: PlannerState, result: PlanResult): HistoryRecord {
    const used = [...s.fixedFoods.filter(f => f.grams > 0).map(f => f.food), ...(result.diet ?? []).map(d => d.food)];
    const count = s.foods.length + s.fixedFoods.length;
    const summary = planSummary(s, result, used);
    const itemId = planItemId(s);
    const reopen = savedPlan(s);
    const whole = { summary, reopen };
    const title = `${presetTitle(s.presetId)}: ${count} ${count === 1 ? 'food' : 'foods'}`;
    if (fits(whole)) {
        return { kind: 'plan', itemId, title, href: `/plan?open=${itemId}#plan`, data: whole };
    }
    return { kind: 'plan', itemId, title, href: '/plan', data: { summary, tooLong: true } };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validRecipe(r: unknown): r is StoredRecipe {
    if (!isObject(r) || !isFiniteNumber(r.id) || typeof r.name !== 'string' || !isFiniteNumber(r.grams)) return false;
    return typeof r.rid === 'string' && isFiniteNumber(r.serving) && typeof r.fingerprint === 'string'
        && Array.isArray(r.uncounted) && r.uncounted.every(u => typeof u === 'string')
        && Array.isArray(r.values) && Array.isArray(r.lower) && Array.isArray(r.older);
}

/** The plan stored in a history row, checked. Null when the row can't be reopened. */
export function savedPlanFrom(data: unknown): SavedPlan | null {
    if (!isObject(data) || !isObject(data.reopen)) return null;
    const r = data.reopen;
    if (!Array.isArray(r.foods) || !r.foods.every(isFiniteNumber)) return null;
    if (!Array.isArray(r.fixed) || !r.fixed.every(f => Array.isArray(f) && f.length === 2 && f.every(isFiniteNumber))) return null;
    if (!Array.isArray(r.recipes) || !r.recipes.every(validRecipe)) return null;
    return {
        foods: r.foods,
        fixed: r.fixed as [number, number][],
        limits: isObject(r.limits) ? r.limits as SavedPlan['limits'] : {},
        recipes: r.recipes,
        presetId: typeof r.presetId === 'string' ? r.presetId as PresetId : 'custom',
        goals: isObject(r.goals) ? r.goals as Goals : undefined,
        calories: isObject(r.calories) ? r.calories as CalorieRange : undefined,
        portionCap: isObject(r.portionCap) ? r.portionCap as unknown as PortionCap : DEFAULT_PORTION_CAP,
        upperLimits: r.upperLimits === true,
    };
}

export interface ReopenedPlanner extends Omit<PlannerState, 'hydrated'> {
    /** Foods in the saved plan that this database no longer has. */
    missing: number;
}

/** Planner state for a saved plan, given its foods fetched fresh by fdc id. */
export function plannerStateFromSaved(saved: SavedPlan, foods: ReadonlyMap<number, Food>): ReopenedPlanner {
    const preset = presetById(saved.presetId);
    const planned = saved.foods.flatMap(id => (foods.has(id) ? [foods.get(id)!] : []));
    const fixed: FixedFood[] = saved.fixed.flatMap(([id, grams]) => (foods.has(id) ? [{ food: foods.get(id)!, grams }] : []));
    const recipes: FixedFood[] = saved.recipes.map(r => ({
        grams: r.grams,
        food: {
            ...Object.fromEntries(RECIPE_NUTRIENTS.map((k, i) => [k, isFiniteNumber(r.values[i]) ? r.values[i] : null])),
            id: r.id,
            fdc_id: r.id,
            description: r.name,
            data_type: 'recipe',
            food_category: 'Recipes',
            brand_owner: null,
            serving_size: null,
            serving_size_unit: null,
            calories: r.values[RECIPE_NUTRIENTS.indexOf('calories')] ?? 0,
            serving_sizes: r.serving > 0 ? [{ id: r.id, food_id: r.id, label: '1 serving', weight_g: r.serving }] : [],
            recipe: {
                id: r.rid,
                servingGrams: r.serving,
                uncounted: r.uncounted,
                incomplete: r.lower.map(i => RECIPE_NUTRIENTS[i]).filter(Boolean),
                fingerprint: r.fingerprint,
            },
            ...(r.older.length > 0 ? { filledFrom: Object.fromEntries(r.older.map(([i, fdc]) => [RECIPE_NUTRIENTS[i], fdc])) } : {}),
        } as unknown as Food,
    }));
    const foodLimits: FoodLimits = {};
    for (const f of planned) {
        const limit = saved.limits[String(f.fdc_id)];
        if (limit) foodLimits[f.id] = limit;
    }
    return {
        foods: planned,
        fixedFoods: [...fixed, ...recipes],
        foodLimits,
        presetId: preset ? preset.id : 'custom',
        goals: preset ? preset.goals : saved.goals ?? {},
        calories: preset ? preset.calories : saved.calories ?? {},
        portionCap: saved.portionCap,
        upperLimits: saved.upperLimits,
        missing: saved.foods.length + saved.fixed.length - planned.length - fixed.length,
    };
}
