import solver, { type SolveResult } from 'javascript-lp-solver';
import type { Food } from '@/lib/food-types';
import { nutrientValue } from '@/lib/food-types';
import { ALL_NUTRIENT_CONFIG, isFoodSafeUpperLimit } from '@/lib/nutrient-defaults';
import { referenceServingGrams } from '@/lib/servings';

/*
 * Linear-programming diet optimizer.
 *
 * Formulation
 * -----------
 *   Decision variable x_f >= 0 for each food f, in units of 100 g (the DB
 *   stores every nutrient per 100 g, so coefficients are used as-is and
 *   grams = 100 * x_f).
 *   minimize    sum_f kcal_f * x_f
 *   subject to  min_n - G_n <= sum_f a_{n,f} * x_f <= max_n - G_n   (each goal n)
 *               minKcal - G_kcal <= sum_f kcal_f * x_f <= maxKcal - G_kcal
 *               lo_f <= x_f <= hi_f                                 (per-food bounds)
 *   where G_* is the contribution of the user's fixed ("guaranteed") foods.
 *   Missing nutrient data (null) counts as 0 and is reported in `warnings`.
 *
 * Each constraint row is divided by its bound magnitude before solving
 * (row scaling). javascript-lp-solver is very sensitive to scaling: without it
 * the elastic diagnostic model below took seconds and then reported a bogus
 * "infeasible". The unscaled model is still returned as `lpModel` for display.
 */

export type BoundInput = number | string | null | undefined;

export interface OptimizationParams {
    foods: Food[];
    guaranteedFoods?: { food: Food; grams: number }[];
    /**
     * Per-nutrient goals. Accepted shapes (per key):
     *   { min?, max? }       authoritative: a missing/null/'' side means "no bound"
     *   { value, type }      legacy
     *   number | string      legacy: applies to the nutrient's default side
     *   null                 no goal
     * Keys that are absent fall back to the nutrient's default (if enabled).
     */
    customConstraints?: Record<string, unknown>;
    maxCalories?: BoundInput;
    minCalories?: BoundInput;
    diversityMode?: boolean;
    /** Grams; with diversityMode, caps every food (unless the user set a per-food max). */
    maxFoodAmount?: BoundInput;
    /** Per-food bounds in grams, keyed by food id. max 0 excludes the food. */
    foodConstraints?: Record<number | string, { min?: BoundInput; max?: BoundInput } | undefined>;
    /** Add Tolerable Upper Intake Levels that apply to total intake as caps. */
    applyUpperLimits?: boolean;
    /**
     * The general per-food portion cap. When present it is authoritative and
     * replaces the legacy default (about 3 reference servings, `diversityMode`):
     *   servings  at most this many typical servings of each food (100 g counts
     *             as one serving for foods without a household serving)
     *   grams     at most this many grams of each food
     * Whichever is lower applies; `{}` means no general cap. Per-food limits in
     * `foodConstraints` override it either way.
     */
    portionCap?: { servings?: BoundInput; grams?: BoundInput } | null;
}

export interface ConstraintLimit {
    min?: number;
    max?: number;
}

export interface DietItem {
    food: Food;
    grams: number;
    calories: number;
    nutrients: Record<string, number>;
}

export interface OptimizationWarning {
    code: 'missing_nutrient_data';
    message: string;
    foodId: number;
    description: string;
    /** Constrained nutrient keys (or 'calories') this food has no data for. */
    nutrients: string[];
    role: 'optimized' | 'guaranteed';
    /** Whether the food is part of the returned diet (guaranteed foods always are). */
    inDiet: boolean;
}

/** One reason a plan is infeasible (every issue, unlike the 5-line `message`). */
export interface OptimizationIssue {
    /** 'short' / 'excess': a nutrient (or 'calories') goal. 'food_min' / 'food_max': a per-food bound. */
    kind: 'short' | 'excess' | 'food_min' | 'food_max';
    /** Nutrient key or 'calories' (nutrient issues). */
    nutrient?: string;
    /** Food id (per-food issues). */
    foodId?: number;
    /** How far off, in the nutrient's unit (grams for per-food issues). */
    amount: number;
    /** 'fixed_foods': the user's fixed-amount foods alone already break this limit. */
    cause?: 'fixed_foods';
}

export interface OptimizationResult {
    success: boolean;
    message?: string;
    diet?: DietItem[];
    guaranteedStats?: { calories: number; nutrients: Record<string, number> };
    totalCalories?: number;
    totalNutrients?: Record<string, number>;
    constraintLimits?: Record<string, ConstraintLimit>;
    /**
     * Nutrients whose `max` in constraintLimits is a Tolerable Upper Intake
     * Level added by `applyUpperLimits`, not a goal the client asked for.
     * A key listed here with no `min` is a safety ceiling only.
     */
    upperLimitKeys?: string[];
    debugEquations?: string[];
    lpModel?: LpModel;
    /** Set (with success=false) for malformed input; the API maps it to HTTP 400. */
    error?: string;
    warnings?: OptimizationWarning[];
    /** Infeasible results only: every blocking issue, most severe first. */
    issues?: OptimizationIssue[];
    /**
     * Infeasible results only: true when the plan would work if the general
     * portion cap were lifted (the user's own per-food limits still applied).
     */
    portionCapBinding?: boolean;
}

interface LpModel {
    optimize: string;
    opType: 'min' | 'max';
    constraints: Record<string, ConstraintLimit>;
    variables: Record<string, Record<string, number>>;
}

// javascript-lp-solver >= 1.0 ships its own types, but Solve() is typed as
// returning `unknown` (it can also return a full Solution object). We always
// call it in the default "simplified result" mode, which yields a SolveResult.
function solveLp(model: LpModel): SolveResult {
    return solver.Solve(model) as SolveResult;
}

export class OptimizationInputError extends Error {}

const DEFAULT_SERVINGS = 3;
const DEFAULT_CAP_GRAMS = 300;
/** Grams treated as "one serving" for foods without a household serving. */
const FALLBACK_SERVING_GRAMS = 100;
const MAX_NUTRIENT_PER_100G = 1e6;
const MAX_GRAMS = 100_000;
const CALORIE_ROW = 'constraint_calories';
const FOOD_BOUND_PENALTY = 10;
const NUTRIENT_KEYS = Object.keys(ALL_NUTRIENT_CONFIG).filter(k => k !== 'calories');

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function parseBound(value: unknown, what: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    let n: number;
    if (typeof value === 'number') {
        n = value;
    } else if (typeof value === 'string') {
        if (value.trim() === '') return undefined;
        n = Number(value);
    } else {
        throw new OptimizationInputError(`Invalid ${what}: expected a number`);
    }
    if (!Number.isFinite(n)) throw new OptimizationInputError(`Invalid ${what}: expected a finite number`);
    if (n < 0) throw new OptimizationInputError(`Invalid ${what}: must not be negative`);
    return n;
}

function resolveBounds(key: string, custom: unknown, hasCustom: boolean): ConstraintLimit {
    const config = ALL_NUTRIENT_CONFIG[key];
    const what = `${key} constraint`;
    if (!hasCustom) {
        if (!config || config.defaultEnabled === false) return {};
        return { [config.defaultType]: config.defaultValue };
    }
    if (custom === null || custom === undefined) return {};
    if (typeof custom === 'number' || typeof custom === 'string') {
        const v = parseBound(custom, what);
        if (v === undefined) return {};
        return { [config?.defaultType ?? 'min']: v };
    }
    if (typeof custom === 'object' && !Array.isArray(custom)) {
        const c = custom as Record<string, unknown>;
        if ('value' in c && !('min' in c) && !('max' in c)) {
            const v = parseBound(c.value, what);
            if (v === undefined) return {};
            return c.type === 'max' ? { max: v } : { min: v };
        }
        return { min: parseBound(c.min, `${key} minimum`), max: parseBound(c.max, `${key} maximum`) };
    }
    throw new OptimizationInputError(`Invalid ${what}`);
}

export function validateFood(food: unknown, where: string): Food {
    if (!food || typeof food !== 'object') throw new OptimizationInputError(`${where}: food must be an object`);
    const f = food as Record<string, unknown>;
    if (typeof f.id !== 'number' || !Number.isSafeInteger(f.id)) {
        throw new OptimizationInputError(`${where}: food id must be an integer`);
    }
    for (const key of ['calories', ...NUTRIENT_KEYS]) {
        const v = f[key];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_NUTRIENT_PER_100G) {
            throw new OptimizationInputError(`${where}: invalid ${key} value for food ${f.id}`);
        }
    }
    return food as Food;
}

function label(key: string): string {
    if (key === CALORIE_ROW || key === 'calories') return 'Calories';
    return ALL_NUTRIENT_CONFIG[key]?.label ?? key;
}

function unit(key: string): string {
    if (key === CALORIE_ROW || key === 'calories') return 'kcal';
    return ALL_NUTRIENT_CONFIG[key]?.unit ?? '';
}

function describe(food: Food): string {
    return typeof food.description === 'string' && food.description ? food.description : `Food ${food.id}`;
}

/** Human-friendly amount: never rounds a non-zero amount down to "0". */
function fmt(n: number): string {
    const a = Math.abs(n);
    if (a >= 100) return String(Math.round(n));
    if (a >= 10) return String(Math.round(n * 10) / 10);
    if (a === 0) return '0';
    return String(Number(n.toPrecision(2)));
}

/** Integer grams from 10 g up, one decimal from 1-10 g, two significant digits below 1 g. */
function displayGrams(g: number): number {
    if (g >= 10) return Math.round(g);
    if (g >= 1) return Math.round(g * 10) / 10;
    return Number(g.toPrecision(2));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function optimizeDiet(params: OptimizationParams): OptimizationResult {
    try {
        return optimizeDietUnchecked(params);
    } catch (e) {
        if (e instanceof OptimizationInputError) return { success: false, error: e.message };
        throw e;
    }
}

function optimizeDietUnchecked(params: OptimizationParams): OptimizationResult {
    const { customConstraints, foodConstraints } = params ?? ({} as OptimizationParams);
    const rawFoods: unknown = params?.foods ?? [];
    const rawGuaranteed: unknown = params?.guaranteedFoods ?? [];

    if (!Array.isArray(rawFoods)) throw new OptimizationInputError('foods must be an array');
    if (!Array.isArray(rawGuaranteed)) throw new OptimizationInputError('guaranteedFoods must be an array');
    if (customConstraints !== undefined && customConstraints !== null &&
        (typeof customConstraints !== 'object' || Array.isArray(customConstraints))) {
        throw new OptimizationInputError('customConstraints must be an object');
    }
    if (foodConstraints !== undefined && foodConstraints !== null &&
        (typeof foodConstraints !== 'object' || Array.isArray(foodConstraints))) {
        throw new OptimizationInputError('foodConstraints must be an object');
    }

    // Deduplicate by id (first occurrence wins).
    const foods: Food[] = [];
    const seen = new Set<number>();
    rawFoods.forEach((f, i) => {
        const food = validateFood(f, `foods[${i}]`);
        if (!seen.has(food.id)) {
            seen.add(food.id);
            foods.push(food);
        }
    });

    const guaranteed = rawGuaranteed.map((item: unknown, i: number) => {
        if (!item || typeof item !== 'object') throw new OptimizationInputError(`guaranteedFoods[${i}] must be an object`);
        const it = item as { food?: unknown; grams?: unknown };
        const food = validateFood(it.food, `guaranteedFoods[${i}]`);
        const grams = typeof it.grams === 'number' ? it.grams : Number.NaN;
        if (!Number.isFinite(grams) || grams < 0 || grams > MAX_GRAMS) {
            throw new OptimizationInputError(`guaranteedFoods[${i}]: grams must be between 0 and ${MAX_GRAMS}`);
        }
        return { food, grams };
    });

    if (foods.length === 0 && guaranteed.length === 0) {
        return { success: false, error: 'No foods selected' };
    }

    // 0. Contribution of guaranteed foods.
    const guaranteedNutrients: Record<string, number> = {};
    for (const key of NUTRIENT_KEYS) guaranteedNutrients[key] = 0;
    let guaranteedCalories = 0;
    for (const { food, grams } of guaranteed) {
        const m = grams / 100;
        guaranteedCalories += (nutrientValue(food, 'calories') ?? 0) * m;
        for (const key of NUTRIENT_KEYS) guaranteedNutrients[key] += (nutrientValue(food, key) ?? 0) * m;
    }

    // 1. Resolve goals.
    const { constraintLimits, upperLimitKeys } = resolveGoalLimits(params);
    const generalCapGrams = generalCapResolver(params);
    const fc = (foodConstraints ?? {}) as Record<string, { min?: BoundInput; max?: BoundInput } | undefined>;

    // 2. Missing-data warnings (for every user-selected food).
    const constrainedKeys = Object.keys(constraintLimits);
    const buildWarnings = (dietIds: Set<number>): OptimizationWarning[] => {
        const out: OptimizationWarning[] = [];
        const add = (food: Food, role: 'optimized' | 'guaranteed', inDiet: boolean) => {
            // A recipe has a number for a nutrient one ingredient lacks, but it is only a lower bound.
            const lowerBound = Array.isArray(food.recipe?.incomplete) ? food.recipe.incomplete : [];
            const missing = constrainedKeys.filter(k => nutrientValue(food, k) === null || lowerBound.includes(k));
            if (missing.length === 0) return;
            const name = describe(food);
            out.push({
                code: 'missing_nutrient_data',
                message: `"${name}" has no data for ${missing.map(label).join(', ')}; ` +
                    `it was counted as 0 toward ${missing.length === 1 ? 'that goal' : 'those goals'}, so actual totals may differ.`,
                foodId: food.id,
                description: name,
                nutrients: missing,
                role,
                inDiet,
            });
        };
        for (const { food } of guaranteed) add(food, 'guaranteed', true);
        for (const food of foods) add(food, 'optimized', dietIds.has(food.id));
        return out;
    };

    const roundedGuaranteedStats = {
        calories: Math.round(guaranteedCalories),
        nutrients: guaranteedNutrients,
    };

    // Contradictory goals are reported directly rather than as "infeasible".
    for (const [key, lim] of Object.entries(constraintLimits)) {
        if (lim.min !== undefined && lim.max !== undefined && lim.min > lim.max) {
            return {
                success: false,
                message: `Optimization Failed:\n• ${label(key)}: minimum (${fmt(lim.min)}${unit(key)}) is greater than maximum (${fmt(lim.max)}${unit(key)}).`,
                constraintLimits,
                upperLimitKeys,
                warnings: buildWarnings(new Set()),
            };
        }
    }

    if (foods.length === 0) {
        return {
            success: true,
            diet: [],
            guaranteedStats: roundedGuaranteedStats,
            totalCalories: Math.round(guaranteedCalories),
            totalNutrients: { ...guaranteedNutrients, calories: guaranteedCalories },
            constraintLimits,
            upperLimitKeys,
            message: 'Only guaranteed foods provided.',
            warnings: buildWarnings(new Set()),
        };
    }

    // 3. Build the (unscaled) model.
    const model: LpModel = { optimize: 'calories', opType: 'min', constraints: {}, variables: {} };
    for (const [key, lim] of Object.entries(constraintLimits)) {
        const row = key === 'calories' ? CALORIE_ROW : key;
        const g = key === 'calories' ? guaranteedCalories : guaranteedNutrients[key] ?? 0;
        const c: ConstraintLimit = {};
        if (lim.min !== undefined) c.min = Math.max(0, lim.min - g);
        if (lim.max !== undefined) c.max = lim.max - g;
        model.constraints[row] = c;
    }

    const foodByVar = new Map<string, Food>();
    /** Food rows whose max comes from the general portion cap (not the user). */
    const generalCapped = new Set<string>();
    for (const food of foods) {
        const key = `food_${food.id}`;
        foodByVar.set(key, food);
        const kcal = nutrientValue(food, 'calories') ?? 0;
        const variable: Record<string, number> = { calories: kcal, [CALORIE_ROW]: kcal, [key]: 1 };
        for (const n of NUTRIENT_KEYS) variable[n] = nutrientValue(food, n) ?? 0;
        model.variables[key] = variable;

        // Per-food bounds (grams).
        const { capGrams, userMin, generalCap } = foodBoundsGrams(food, fc[String(food.id)], generalCapGrams);
        if (generalCap) generalCapped.add(key);

        const bound: ConstraintLimit = {};
        if (capGrams !== undefined) bound.max = capGrams / 100;
        if (userMin !== undefined && userMin > 0) bound.min = userMin / 100;
        if (bound.min !== undefined || bound.max !== undefined) model.constraints[key] = bound;
    }

    // 4. Solve a row-scaled copy.
    const { scaled, scale } = scaleModel(model);
    const results = solveLp(scaled);

    if (!results.feasible || results.bounded === false) {
        const diagnosis = results.feasible
            ? { message: 'The problem is unbounded; check the nutrient data for the selected foods.', issues: [] }
            : diagnoseInfeasibility(scaled, scale, constraintLimits, guaranteedCalories, guaranteedNutrients, foodByVar);
        const { message, issues } = diagnosis;
        let portionCapBinding = false;
        if (!results.feasible && generalCapped.size > 0) {
            const constraints = { ...scaled.constraints };
            for (const row of generalCapped) {
                const { max: _max, ...rest } = constraints[row];
                void _max;
                if (rest.min !== undefined) constraints[row] = rest; else delete constraints[row];
            }
            portionCapBinding = solveLp({ ...scaled, constraints }).feasible === true;
        }
        return {
            success: false,
            message,
            issues,
            portionCapBinding,
            lpModel: model,
            debugEquations: failureEquations(model),
            constraintLimits,
            upperLimitKeys,
            warnings: buildWarnings(new Set()),
        };
    }

    // 5. Format results.
    const diet: DietItem[] = [];
    let optimizedCaloriesExact = 0;
    for (const [key, food] of foodByVar) {
        const value = results[key];
        if (typeof value !== 'number' || !(value > 1e-9)) continue;
        // Keep sub-gram amounts (dense foods such as dried herbs): dropping
        // them made reported totals fall below the goals they satisfy.
        const grams = displayGrams(value * 100);
        const kcal = (nutrientValue(food, 'calories') ?? 0) * value;
        const nutrients: Record<string, number> = { calories: Math.round(kcal) };
        for (const n of NUTRIENT_KEYS) nutrients[n] = (nutrientValue(food, n) ?? 0) * value;
        diet.push({ food, grams, calories: nutrients.calories, nutrients });
        optimizedCaloriesExact += kcal;
    }

    const totalNutrients: Record<string, number> = { ...guaranteedNutrients };
    for (const item of diet) {
        for (const n of NUTRIENT_KEYS) totalNutrients[n] += item.nutrients[n];
    }
    totalNutrients.calories = guaranteedCalories + optimizedCaloriesExact;

    return {
        success: true,
        diet,
        guaranteedStats: roundedGuaranteedStats,
        totalCalories: Math.round(guaranteedCalories + optimizedCaloriesExact),
        totalNutrients,
        constraintLimits,
        upperLimitKeys,
        debugEquations: successEquations(model, diet),
        lpModel: model,
        warnings: buildWarnings(new Set(diet.map(d => d.food.id))),
    };
}

// ---------------------------------------------------------------------------
// Goal and per-food bound resolution (shared with lib/week-planner)
// ---------------------------------------------------------------------------

/**
 * The goals a request asks for, as limits per nutrient key (and 'calories'), plus the keys
 * whose max is a safe upper limit added by `applyUpperLimits`. Throws OptimizationInputError
 * for malformed bounds. The week planner uses this so both planners read goals the same way.
 */
export function resolveGoalLimits(params: Pick<OptimizationParams, 'customConstraints' | 'minCalories' | 'maxCalories' | 'applyUpperLimits'>): {
    constraintLimits: Record<string, ConstraintLimit>;
    upperLimitKeys: string[];
} {
    const { customConstraints, maxCalories, minCalories, applyUpperLimits } = params;
    const custom = (customConstraints ?? {}) as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(custom, k);
    const constraintLimits: Record<string, ConstraintLimit> = {};
    const upperLimitKeys: string[] = [];

    for (const key of NUTRIENT_KEYS) {
        const bounds = resolveBounds(key, custom[key], has(key));
        const config = ALL_NUTRIENT_CONFIG[key];
        if (applyUpperLimits && bounds.max === undefined && config.ul && isFoodSafeUpperLimit(config)) {
            bounds.max = config.ul.value;
            upperLimitKeys.push(key);
        }
        if (bounds.min !== undefined || bounds.max !== undefined) {
            constraintLimits[key] = { min: bounds.min, max: bounds.max };
        }
    }

    const calBounds = resolveBounds('calories', custom.calories, has('calories'));
    const legacyMin = parseBound(minCalories, 'minCalories');
    const legacyMax = parseBound(maxCalories, 'maxCalories');
    if (legacyMin !== undefined) calBounds.min = legacyMin;
    if (legacyMax !== undefined) calBounds.max = legacyMax;
    if (calBounds.min !== undefined || calBounds.max !== undefined) {
        constraintLimits.calories = { min: calBounds.min, max: calBounds.max };
    }
    return { constraintLimits, upperLimitKeys };
}

/** The general (non-user) per-food cap in grams for a request; the function returns undefined for "no cap". */
export function generalCapResolver(params: Pick<OptimizationParams, 'portionCap' | 'diversityMode' | 'maxFoodAmount'>): (food: Food) => number | undefined {
    const { portionCap, diversityMode, maxFoodAmount } = params;
    if (portionCap !== undefined && portionCap !== null && (typeof portionCap !== 'object' || Array.isArray(portionCap))) {
        throw new OptimizationInputError('portionCap must be an object');
    }
    const portion = portionCap
        ? { servings: parseBound(portionCap.servings, 'portionCap.servings'), grams: parseBound(portionCap.grams, 'portionCap.grams') }
        : null;
    const diversityCap = diversityMode ? parseBound(maxFoodAmount, 'maxFoodAmount') : undefined;
    return (food: Food): number | undefined => {
        const ref = referenceServingGrams(food.serving_sizes);
        if (portion) {
            const caps: number[] = [];
            if (portion.servings !== undefined) caps.push(portion.servings * (ref ?? FALLBACK_SERVING_GRAMS));
            if (portion.grams !== undefined) caps.push(portion.grams);
            return caps.length ? Math.min(...caps) : undefined;
        }
        const legacy = ref !== undefined ? DEFAULT_SERVINGS * ref : DEFAULT_CAP_GRAMS;
        return diversityCap !== undefined ? Math.min(legacy, diversityCap) : legacy;
    };
}

/**
 * One food's bounds in grams: an explicit user max overrides every default, and so does a
 * user min above the general cap. `generalCap` is true when the cap is the general one.
 */
export function foodBoundsGrams(
    food: Food,
    user: { min?: BoundInput; max?: BoundInput } | undefined,
    generalCapGrams: (food: Food) => number | undefined,
): { capGrams: number | undefined; userMin: number | undefined; generalCap: boolean } {
    let capGrams = generalCapGrams(food);
    const userMin = user ? parseBound(user.min, `minimum grams for food ${food.id}`) : undefined;
    const userMax = user ? parseBound(user.max, `maximum grams for food ${food.id}`) : undefined;
    let generalCap = false;
    if (userMax !== undefined) capGrams = userMax;
    else if (userMin !== undefined && capGrams !== undefined && userMin > capGrams) capGrams = userMin;
    else if (capGrams !== undefined) generalCap = true;
    return { capGrams, userMin, generalCap };
}

// ---------------------------------------------------------------------------
// Scaling and diagnostics
// ---------------------------------------------------------------------------

function scaleModel(model: LpModel): { scaled: LpModel; scale: Record<string, number> } {
    const scale: Record<string, number> = {};
    const constraints: Record<string, ConstraintLimit> = {};
    for (const [row, c] of Object.entries(model.constraints)) {
        let s = Math.max(Math.abs(c.min ?? 0), Math.abs(c.max ?? 0));
        if (!(s > 0)) {
            for (const v of Object.values(model.variables)) s = Math.max(s, Math.abs(v[row] ?? 0));
        }
        if (!(s > 0)) s = 1;
        scale[row] = s;
        constraints[row] = {};
        if (c.min !== undefined) constraints[row].min = c.min / s;
        if (c.max !== undefined) constraints[row].max = c.max / s;
    }
    const variables: Record<string, Record<string, number>> = {};
    for (const [name, v] of Object.entries(model.variables)) {
        const out: Record<string, number> = { calories: v.calories };
        for (const row of Object.keys(constraints)) {
            if (v[row] !== undefined && v[row] !== 0) out[row] = v[row] / scale[row];
        }
        variables[name] = out;
    }
    return { scaled: { ...model, constraints, variables }, scale };
}

function diagnoseInfeasibility(
    scaled: LpModel,
    scale: Record<string, number>,
    limits: Record<string, ConstraintLimit>,
    guaranteedCalories: number,
    guaranteedNutrients: Record<string, number>,
    foodByVar: Map<string, Food>,
): { message: string; issues: OptimizationIssue[] } {
    const issues: { text: string; weight: number; issue: OptimizationIssue }[] = [];

    // Guaranteed foods alone already break a maximum.
    for (const [key, lim] of Object.entries(limits)) {
        if (lim.max === undefined) continue;
        const g = key === 'calories' ? guaranteedCalories : guaranteedNutrients[key] ?? 0;
        if (g > lim.max) {
            issues.push({
                text: `Guaranteed foods already exceed ${label(key)} limit (${fmt(g)}${unit(key)} > ${fmt(lim.max)}${unit(key)}).`,
                weight: Number.POSITIVE_INFINITY,
                issue: { kind: 'excess', nutrient: key === CALORIE_ROW ? 'calories' : key, amount: g - lim.max, cause: 'fixed_foods' },
            });
        }
    }

    // Elastic model: every row may be violated at a cost proportional to the
    // *relative* violation (rows are already scaled to |bound| = 1), so the
    // explanation does not depend on the units of each nutrient.
    const elastic: LpModel = {
        optimize: 'penalty',
        opType: 'min',
        constraints: scaled.constraints,
        variables: { ...scaled.variables },
    };
    // Per-food bounds are mostly defaults (3 servings), so relaxing them is
    // priced higher: users learn which *goal* is out of reach first.
    for (const [row, c] of Object.entries(scaled.constraints)) {
        const penalty = foodByVar.has(row) ? FOOD_BOUND_PENALTY : 1;
        if (c.min !== undefined) elastic.variables[`shortage_${row}`] = { [row]: 1, penalty };
        if (c.max !== undefined) elastic.variables[`excess_${row}`] = { [row]: -1, penalty };
    }
    const diag = solveLp(elastic);

    if (diag.feasible) {
        for (const [name, val] of Object.entries(diag)) {
            if (typeof val !== 'number' || val <= 1e-7) continue;
            const isShort = name.startsWith('shortage_');
            if (!isShort && !name.startsWith('excess_')) continue;
            const row = name.slice(isShort ? 'shortage_'.length : 'excess_'.length);
            const amount = val * (scale[row] ?? 1);
            const food = foodByVar.get(row);
            if (food) {
                const grams = fmt(amount * 100);
                issues.push({
                    text: isShort
                        ? `Cannot meet minimum requirement for ${describe(food)} (short by ${grams}g).`
                        : `Cannot stay under limit for ${describe(food)} (exceeds by ${grams}g).`,
                    weight: val,
                    issue: { kind: isShort ? 'food_min' : 'food_max', foodId: food.id, amount: amount * 100 },
                });
            } else {
                const u = unit(row);
                issues.push({
                    text: isShort
                        ? `Cannot meet ${label(row)} target (short by ${fmt(amount)}${u}).`
                        : `Cannot stay under ${label(row)} limit (exceeds by ${fmt(amount)}${u}).`,
                    weight: val,
                    issue: { kind: isShort ? 'short' : 'excess', nutrient: row === CALORIE_ROW ? 'calories' : row, amount },
                });
            }
        }
    }

    if (issues.length === 0) return { message: 'No combination of these foods can meet all daily requirements.', issues: [] };
    issues.sort((a, b) => b.weight - a.weight);
    const unique = Array.from(new Set(issues.map(i => i.text)));
    let message = `Optimization Failed:\n• ${unique.slice(0, 5).join('\n• ')}`;
    if (unique.length > 5) message += `\n...and ${unique.length - 5} more issues.`;
    // One structured issue per nutrient/food and direction (a fixed-food cause wins).
    const structured = new Map<string, OptimizationIssue>();
    for (const { issue } of issues) {
        const k = `${issue.kind}:${issue.nutrient ?? issue.foodId}`;
        if (!structured.has(k)) structured.set(k, issue);
    }
    return { message, issues: Array.from(structured.values()) };
}

function failureEquations(model: LpModel): string[] {
    return Object.entries(model.constraints).map(([row, limits]) => {
        let eq = `${label(row)}:`;
        if (limits.min !== undefined) eq += ` >= ${fmt(limits.min)}`;
        if (limits.max !== undefined) eq += ` <= ${fmt(limits.max)}`;
        return eq;
    });
}

function successEquations(model: LpModel, diet: DietItem[]): string[] {
    const short = (name: string) => `[${name.split(',')[0].substring(0, 15).trim()}]`;
    const eqs: string[] = [];
    if (diet.length > 0) {
        eqs.push(`Minimize Calories: ${diet.map(d => `${Math.round(d.food.calories ?? 0)} * ${short(describe(d.food))}`).join(' + ')}`);
    }
    for (const [row, limits] of Object.entries(model.constraints)) {
        if (row.startsWith('food_')) continue;
        const parts = diet
            .map(d => ({ d, v: model.variables[`food_${d.food.id}`]?.[row] ?? 0 }))
            .filter(({ v }) => v > 0)
            .map(({ d, v }) => `${v < 1 ? v.toFixed(2) : Math.round(v)} * Amt${short(describe(d.food))}`);
        if (parts.length === 0) continue;
        let eq = `${label(row)}: ${parts.join(' + ')}`;
        if (limits.min !== undefined) eq += ` >= ${fmt(limits.min)}`;
        if (limits.max !== undefined) eq += `${limits.min !== undefined ? ' AND' : ''} <= ${fmt(limits.max)}`;
        eqs.push(eq);
    }
    return eqs;
}
