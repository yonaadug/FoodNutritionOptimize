import solver from 'javascript-lp-solver';
import type { Food, ServingSize } from '@/lib/food-types';
import { nutrientValue } from '@/lib/food-types';
import { ALL_NUTRIENT_CONFIG, isFoodSafeUpperLimit } from '@/lib/nutrient-defaults';

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

export interface OptimizationResult {
    success: boolean;
    message?: string;
    diet?: DietItem[];
    guaranteedStats?: { calories: number; nutrients: Record<string, number> };
    totalCalories?: number;
    totalNutrients?: Record<string, number>;
    constraintLimits?: Record<string, ConstraintLimit>;
    debugEquations?: string[];
    lpModel?: LpModel;
    /** Set (with success=false) for malformed input; the API maps it to HTTP 400. */
    error?: string;
    warnings?: OptimizationWarning[];
}

interface LpModel {
    optimize: string;
    opType: 'min' | 'max';
    constraints: Record<string, ConstraintLimit>;
    variables: Record<string, Record<string, number>>;
}

export class OptimizationInputError extends Error {}

const DEFAULT_SERVINGS = 3;
const DEFAULT_CAP_GRAMS = 300;
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

function validateFood(food: unknown, where: string): Food {
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

/** Generic gram-based rows ("100 g", "1 g") that every food carries; not a real portion. */
const GENERIC_GRAM_SERVING = /^\s*\d+(\.\d+)?\s*(g|gram|grams)\s*$/i;

/**
 * Reference serving for the default cap: RACC if labelled, else the (lower)
 * median household serving, ignoring generic "100 g" rows.
 */
function referenceServingGrams(servings: ServingSize[] | undefined): number | undefined {
    const valid = (servings ?? []).filter(s =>
        typeof s?.weight_g === 'number' && s.weight_g > 0 &&
        !(typeof s.label === 'string' && GENERIC_GRAM_SERVING.test(s.label)));
    if (valid.length === 0) return undefined;
    const racc = valid.find(s => typeof s.label === 'string' && s.label.toUpperCase().includes('RACC'));
    if (racc) return racc.weight_g;
    const sorted = valid.map(s => s.weight_g).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
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
    const {
        customConstraints, maxCalories, minCalories, diversityMode, maxFoodAmount,
        foodConstraints, applyUpperLimits,
    } = params ?? ({} as OptimizationParams);
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
    const custom = (customConstraints ?? {}) as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(custom, k);
    const constraintLimits: Record<string, ConstraintLimit> = {};

    for (const key of NUTRIENT_KEYS) {
        const bounds = resolveBounds(key, custom[key], has(key));
        const config = ALL_NUTRIENT_CONFIG[key];
        if (applyUpperLimits && bounds.max === undefined && config.ul && isFoodSafeUpperLimit(config)) {
            bounds.max = config.ul.value;
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

    const diversityCap = diversityMode ? parseBound(maxFoodAmount, 'maxFoodAmount') : undefined;
    const fc = (foodConstraints ?? {}) as Record<string, { min?: BoundInput; max?: BoundInput } | undefined>;

    // 2. Missing-data warnings (for every user-selected food).
    const constrainedKeys = Object.keys(constraintLimits);
    const buildWarnings = (dietIds: Set<number>): OptimizationWarning[] => {
        const out: OptimizationWarning[] = [];
        const add = (food: Food, role: 'optimized' | 'guaranteed', inDiet: boolean) => {
            const missing = constrainedKeys.filter(k => nutrientValue(food, k) === null);
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
    for (const food of foods) {
        const key = `food_${food.id}`;
        foodByVar.set(key, food);
        const kcal = nutrientValue(food, 'calories') ?? 0;
        const variable: Record<string, number> = { calories: kcal, [CALORIE_ROW]: kcal, [key]: 1 };
        for (const n of NUTRIENT_KEYS) variable[n] = nutrientValue(food, n) ?? 0;
        model.variables[key] = variable;

        // Per-food bounds (grams).
        const ref = referenceServingGrams(food.serving_sizes);
        let capGrams = ref !== undefined ? DEFAULT_SERVINGS * ref : DEFAULT_CAP_GRAMS;
        if (diversityCap !== undefined) capGrams = Math.min(capGrams, diversityCap);
        const user = fc[String(food.id)];
        const userMin = user ? parseBound(user.min, `minimum grams for food ${food.id}`) : undefined;
        const userMax = user ? parseBound(user.max, `maximum grams for food ${food.id}`) : undefined;
        if (userMax !== undefined) capGrams = userMax; // explicit user max overrides every default
        else if (userMin !== undefined && userMin > capGrams) capGrams = userMin; // ...and so does a min

        const bound: ConstraintLimit = { max: capGrams / 100 };
        if (userMin !== undefined && userMin > 0) bound.min = userMin / 100;
        model.constraints[key] = bound;
    }

    // 4. Solve a row-scaled copy.
    const { scaled, scale } = scaleModel(model);
    const results = solver.Solve(scaled);

    if (!results.feasible || results.bounded === false) {
        const message = results.feasible
            ? 'The problem is unbounded; check the nutrient data for the selected foods.'
            : diagnoseInfeasibility(scaled, scale, constraintLimits, guaranteedCalories, guaranteedNutrients, foodByVar);
        return {
            success: false,
            message,
            lpModel: model,
            debugEquations: failureEquations(model),
            constraintLimits,
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
        debugEquations: successEquations(model, diet),
        lpModel: model,
        warnings: buildWarnings(new Set(diet.map(d => d.food.id))),
    };
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
): string {
    const issues: { text: string; weight: number }[] = [];

    // Guaranteed foods alone already break a maximum.
    for (const [key, lim] of Object.entries(limits)) {
        if (lim.max === undefined) continue;
        const g = key === 'calories' ? guaranteedCalories : guaranteedNutrients[key] ?? 0;
        if (g > lim.max) {
            issues.push({
                text: `Guaranteed foods already exceed ${label(key)} limit (${fmt(g)}${unit(key)} > ${fmt(lim.max)}${unit(key)}).`,
                weight: Number.POSITIVE_INFINITY,
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
    const diag = solver.Solve(elastic);

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
                });
            } else {
                const u = unit(row);
                issues.push({
                    text: isShort
                        ? `Cannot meet ${label(row)} target (short by ${fmt(amount)}${u}).`
                        : `Cannot stay under ${label(row)} limit (exceeds by ${fmt(amount)}${u}).`,
                    weight: val,
                });
            }
        }
    }

    if (issues.length === 0) return 'No combination of these foods can meet all daily requirements.';
    issues.sort((a, b) => b.weight - a.weight);
    const unique = Array.from(new Set(issues.map(i => i.text)));
    let message = `Optimization Failed:\n• ${unique.slice(0, 5).join('\n• ')}`;
    if (unique.length > 5) message += `\n...and ${unique.length - 5} more issues.`;
    return message;
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
