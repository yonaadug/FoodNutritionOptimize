/**
 * The week planner: a mixed-integer program over 7 days.
 *
 * PLUS-GATE: weekPlanner. planWeek() is the server function the Plus check wraps
 * (see app/api/plan/week/route.ts).
 *
 * Formulation (units of 100 g, like lib/optimizer.ts)
 * -----------
 *   x[i,d] >= 0   amount of food i on day d             y[i,d] in {0,1}   food i used on day d
 *   minimize  sum kcal_i x[i,d]  +  P_bb sum z[i,d]  +  P_avoid sum y[i,d] (re-planned food-days)
 *   subject to
 *     daily goals       min_n <= sum_i a_ni x[i,d] + fixed_nd <= max_n       every day d
 *     weekly goals      sum_d sum_i a_ni x[i,d] + fixed_n >= days x min_n    vitamins A D E K B12, folate, iron, zinc
 *     portions          minPortion_i y[i,d] <= x[i,d] <= cap_i y[i,d]        "none, or a sensible portion"
 *     variety           sum_d y[i,d] <= K                                    at most K days a week per food
 *     back to back      y[i,d] + y[i,d+1] - z[i,d] <= 1, z >= 0              penalised, not forbidden
 *   Recipes are planned in whole servings. With leftovers, servings cooked on day d (c) are
 *   eaten that day (a) or the next (b): a[r,d] + b[r,d] = c[r,d]; cooking days count for variety
 *   and every recipe in the plan is cooked at least once. Locked days and foods are constants.
 *
 * Nutrient rows are scaled to |bound| = 1 before solving, as in lib/optimizer.ts.
 */
import { nutrientValue, type Food } from '../food-types';
import { ALL_NUTRIENT_CONFIG } from '../nutrient-defaults';
import {
    OptimizationInputError, foodBoundsGrams, generalCapResolver, resolveGoalLimits, validateFood,
    type BoundInput, type ConstraintLimit, type OptimizationIssue, type OptimizationWarning,
} from '../optimizer';
import { referenceServingGrams } from '../servings';
import { weekGoals } from './goals';
import { solveWithHighs, type Constraint, type JsModel, type Solved } from './highs';
import { dayTotals, weekTotals } from './totals';
import {
    DEFAULT_WEEK_SETTINGS, WEEK_LIMITS,
    type WeekDay, type WeekDiagnosis, type WeekEntry, type WeekGoal, type WeekLockItem, type WeekParams, type WeekResult,
    type WeekSettings, type WeekSolverInfo,
} from './types';

const NUTRIENT_KEYS = Object.keys(ALL_NUTRIENT_CONFIG).filter(k => k !== 'calories');
/** "No cap" in the linking rows: 2 kg of one food in a day. */
const BIG_UNITS = 20;
const MIN_PORTION_SHARE = 0.5;
const MIN_PORTION_FALLBACK_G = 30;
const MIN_PORTION_FLOOR_G = 5;
/** Penalties, in kcal: small next to a day's energy, so goals always come first. */
export const BACK_TO_BACK_PENALTY = 40;
export const AVOID_PENALTY = 120;
const ELASTIC_FOOD_PENALTY = 10;
const MIP_GAP = 0.01;

function solve(model: JsModel, timeLimitMs?: number, mipGap = MIP_GAP): Promise<Solved> {
    return solveWithHighs(model, { timeLimit: timeLimitMs === undefined ? undefined : timeLimitMs / 1000, mipGap });
}


// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface Item { food: Food; index: number; capUnits: number; minUnits: number; userMinUnits: number; generalCap: boolean; hasCap: boolean }
interface Recipe { food: Food; index: number; servingGrams: number }

interface Prepared {
    settings: WeekSettings;
    items: Item[];
    recipes: Recipe[];
    fixed: { food: Food; grams: number }[];
    byId: Map<number, Food>;
    limits: Record<string, ConstraintLimit>;
    upperLimitKeys: string[];
    goals: WeekGoal[];
    lockedDays: Set<number>;
    locks: WeekLockItem[];
    avoid: Set<string>;
}

function settingsFrom(raw: Partial<WeekSettings> | undefined): WeekSettings {
    const s = { ...DEFAULT_WEEK_SETTINGS, ...(raw ?? {}) };
    const int = (v: unknown, lo: number, hi: number, dflt: number) =>
        (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
    const days = int(s.days, WEEK_LIMITS.minDays, WEEK_LIMITS.maxDays, DEFAULT_WEEK_SETTINGS.days);
    return {
        days,
        maxDaysPerFood: int(s.maxDaysPerFood, 1, days, Math.min(days, DEFAULT_WEEK_SETTINGS.maxDaysPerFood)),
        leftovers: s.leftovers !== false,
        weeklyAverages: s.weeklyAverages !== false,
        avoidBackToBack: s.avoidBackToBack !== false,
    };
}

function prepare(params: WeekParams): Prepared {
    if (!params || typeof params !== 'object') throw new OptimizationInputError('Request must be an object');
    const rawFoods: unknown = params.foods ?? [];
    const rawFixed: unknown = params.fixedFoods ?? [];
    if (!Array.isArray(rawFoods)) throw new OptimizationInputError('foods must be an array');
    if (!Array.isArray(rawFixed)) throw new OptimizationInputError('fixedFoods must be an array');
    const settings = settingsFrom(params.settings);
    const { constraintLimits: limits, upperLimitKeys } = resolveGoalLimits(params);
    const capOf = generalCapResolver(params);
    const fc = (params.foodConstraints ?? {}) as Record<string, { min?: BoundInput; max?: BoundInput } | undefined>;

    const byId = new Map<number, Food>();
    const items: Item[] = [];
    rawFoods.forEach((f, i) => {
        const food = validateFood(f, `foods[${i}]`);
        if (byId.has(food.id)) return;
        byId.set(food.id, food);
        const { capGrams, userMin, generalCap } = foodBoundsGrams(food, fc[String(food.id)], capOf);
        if (capGrams !== undefined && capGrams <= 0) return; // max 0 leaves the food out
        const ref = referenceServingGrams(food.serving_sizes);
        const capUnits = capGrams === undefined ? BIG_UNITS : capGrams / 100;
        const minGrams = Math.max(MIN_PORTION_FLOOR_G, MIN_PORTION_SHARE * (ref ?? MIN_PORTION_FALLBACK_G * 2));
        items.push({
            food, index: items.length, capUnits,
            minUnits: Math.min(minGrams / 100, capUnits),
            userMinUnits: userMin !== undefined && userMin > 0 ? userMin / 100 : 0,
            generalCap, hasCap: capGrams !== undefined,
        });
    });

    const recipes: Recipe[] = [];
    const fixed: { food: Food; grams: number }[] = [];
    rawFixed.forEach((it: unknown, i: number) => {
        if (!it || typeof it !== 'object') throw new OptimizationInputError(`fixedFoods[${i}] must be an object`);
        const { food: f, grams } = it as { food?: unknown; grams?: unknown };
        const food = validateFood(f, `fixedFoods[${i}]`);
        if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0 || grams > 100_000) {
            throw new OptimizationInputError(`fixedFoods[${i}]: grams must be between 0 and 100000`);
        }
        if (byId.has(food.id)) return;
        byId.set(food.id, food);
        const serving = food.recipe?.servingGrams;
        if (food.recipe && typeof serving === 'number' && serving > 0) {
            if (recipes.length >= WEEK_LIMITS.maxRecipes) throw new OptimizationInputError(`At most ${WEEK_LIMITS.maxRecipes} recipes in a week plan`);
            recipes.push({ food, index: recipes.length, servingGrams: serving });
        } else if (grams > 0) {
            fixed.push({ food, grams });
        }
    });
    if (items.length + recipes.length + fixed.length === 0) throw new OptimizationInputError('No foods selected');
    if (items.length > WEEK_LIMITS.maxFoods) throw new OptimizationInputError(`At most ${WEEK_LIMITS.maxFoods} foods in a week plan`);

    const locksIn = params.locks ?? { days: [], items: [] };
    const lockedDays = new Set((Array.isArray(locksIn.days) ? locksIn.days : []).filter(d => Number.isInteger(d) && d >= 0 && d < settings.days));
    const lockItems = Array.isArray(locksIn.items) ? locksIn.items : [];
    if (lockItems.length > WEEK_LIMITS.maxLockedItems) throw new OptimizationInputError('Too many locked foods');
    const locks: WeekLockItem[] = [];
    const seenLock = new Set<string>();
    for (const l of lockItems) {
        if (!l || !Number.isInteger(l.day) || l.day < 0 || l.day >= settings.days || !byId.has(l.foodId)) continue;
        if (typeof l.grams !== 'number' || !Number.isFinite(l.grams) || l.grams <= 0 || l.grams > 100_000) continue;
        const k = `${l.day}:${l.foodId}:${l.leftover ? 1 : 0}`;
        if (seenLock.has(k)) continue;
        seenLock.add(k);
        locks.push({ day: l.day, foodId: l.foodId, grams: l.grams, ...(l.servings ? { servings: l.servings } : {}), ...(l.leftover ? { leftover: true } : {}) });
    }
    const avoid = new Set((params.avoid ?? []).filter(a => a && Number.isInteger(a.day)).map(a => `${a.day}:${a.foodId}`));
    return {
        settings, items, recipes, fixed, byId, limits, upperLimitKeys,
        goals: weekGoals(limits, upperLimitKeys, settings.weeklyAverages),
        lockedDays, locks, avoid,
    };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const per100 = (food: Food, key: string) => nutrientValue(food, key) ?? 0;

export interface BuiltWeekModel {
    model: JsModel;
    /** Row scale factors (unscaled bound = scaled bound x scale). */
    scale: Record<string, number>;
    /** Each day's fixed and locked entries, which are constants in the model. */
    constants: WeekEntry[][];
    prepared: Prepared;
}

interface BuildOptions {
    /** Override the variety limit (diagnosis). */
    maxDaysPerFood?: number;
    /** No integers at all: no portions, variety or whole servings (diagnosis). */
    relaxed?: boolean;
    /** Lift the general portion cap (diagnosis). */
    noGeneralCap?: boolean;
}

function nutrientRow(key: string, day: number | null): string {
    return day === null ? `w|${key}` : `n|${key}|${day}`;
}

export function buildWeekModel(p: Prepared, opts: BuildOptions = {}): BuiltWeekModel {
    const { settings, items, recipes, fixed, limits, goals, lockedDays, locks, avoid } = p;
    const days = settings.days;
    const K = opts.maxDaysPerFood ?? settings.maxDaysPerFood;
    const relaxed = opts.relaxed === true;
    const model: JsModel = { optimize: 'cost', opType: 'min', constraints: {}, variables: {}, ints: {}, binaries: {} };
    const C = model.constraints;
    const V = model.variables;

    // Constants: fixed foods on open days, and everything locked.
    const constants: WeekEntry[][] = Array.from({ length: days }, () => []);
    for (let d = 0; d < days; d++) {
        if (!lockedDays.has(d)) for (const f of fixed) constants[d].push({ foodId: f.food.id, grams: f.grams, role: 'fixed', locked: false });
    }
    const recipeIds = new Set(recipes.map(r => r.food.id));
    const fixedIds = new Set(fixed.map(f => f.food.id));
    for (const l of locks) {
        if (!lockedDays.has(l.day) && fixedIds.has(l.foodId)) continue; // already there as fixed
        const role = recipeIds.has(l.foodId) ? (l.leftover ? 'leftover' : 'cooked') : fixedIds.has(l.foodId) ? 'fixed' : 'planned';
        constants[l.day].push({ foodId: l.foodId, grams: l.grams, ...(l.servings ? { servings: l.servings } : {}), role, locked: true });
    }
    const lockedPlanned = new Set(locks.map(l => `${l.day}:${l.foodId}`));
    const constNut = constants.map(entries => {
        const out: Record<string, number> = { calories: 0 };
        for (const k of NUTRIENT_KEYS) out[k] = 0;
        for (const e of entries) {
            const food = p.byId.get(e.foodId)!;
            out.calories += per100(food, 'calories') * e.grams / 100;
            for (const k of NUTRIENT_KEYS) out[k] += per100(food, k) * e.grams / 100;
        }
        return out;
    });

    // Goal rows.
    const goalByKey = new Map(goals.map(g => [g.key, g]));
    for (const [key, lim] of Object.entries(limits)) {
        const mode = goalByKey.get(key)?.mode ?? 'daily';
        for (let d = 0; d < days; d++) {
            if (lockedDays.has(d)) continue;
            const c: Constraint = {};
            if (mode === 'daily' && lim.min !== undefined && lim.min > 0) c.min = Math.max(0, lim.min - constNut[d][key]);
            if (lim.max !== undefined) c.max = lim.max - constNut[d][key];
            if (c.min !== undefined || c.max !== undefined) C[nutrientRow(key, d)] = c;
        }
        if (mode === 'weekly' && lim.min !== undefined && lim.min > 0) {
            const fixedTotal = constNut.reduce((s, n) => s + n[key], 0);
            C[nutrientRow(key, null)] = { min: Math.max(0, lim.min * days - fixedTotal) };
        }
    }
    const rowsFor = (key: string, d: number) => {
        const rows: string[] = [];
        const daily = nutrientRow(key, d);
        if (C[daily]) rows.push(daily);
        const weekly = nutrientRow(key, null);
        if (C[weekly]) rows.push(weekly);
        return rows;
    };
    const keysInRows = ['calories', ...NUTRIENT_KEYS].filter(k => limits[k]);
    const nutrientCoefficients = (food: Food, d: number, factor: number): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const k of keysInRows) {
            const v = per100(food, k) * factor;
            if (v === 0) continue;
            for (const row of rowsFor(k, d)) out[row] = v;
        }
        return out;
    };

    // Foods.
    for (const it of items) {
        const kcal = per100(it.food, 'calories');
        const exempt = it.userMinUnits > 0; // asked for every day: not subject to variety
        const cap = opts.noGeneralCap && it.generalCap ? BIG_UNITS : it.capUnits;
        let lockedUses = 0;
        const yName = (d: number) => `y|${it.index}|${d}`;
        const state: ('var' | 'one' | 'zero')[] = [];
        for (let d = 0; d < days; d++) {
            if (lockedPlanned.has(`${d}:${it.food.id}`)) { state.push('one'); lockedUses++; continue; }
            if (lockedDays.has(d)) { state.push('zero'); continue; }
            state.push('var');
            const x = `x|${it.index}|${d}`;
            V[x] = { cost: kcal, ...nutrientCoefficients(it.food, d, 1) };
            if (relaxed) {
                C[`cap|${it.index}|${d}`] = { max: cap, ...(it.userMinUnits > 0 ? { min: it.userMinUnits } : {}) };
                V[x][`cap|${it.index}|${d}`] = 1;
                continue;
            }
            const y = yName(d);
            C[`u|${it.index}|${d}`] = { max: 0 };
            C[`l|${it.index}|${d}`] = { min: 0 };
            V[x][`u|${it.index}|${d}`] = 1;
            V[x][`l|${it.index}|${d}`] = 1;
            V[y] = { cost: avoid.has(`${d}:${it.food.id}`) ? AVOID_PENALTY : 0, [`u|${it.index}|${d}`]: -cap, [`l|${it.index}|${d}`]: -Math.min(it.minUnits, cap) };
            model.binaries![y] = 1;
            if (it.userMinUnits > 0) {
                C[`m|${it.index}|${d}`] = { min: it.userMinUnits };
                V[x][`m|${it.index}|${d}`] = 1;
            }
            if (!exempt) V[y][`v|${it.index}`] = 1;
        }
        if (relaxed || exempt) continue;
        if (state.includes('var')) C[`v|${it.index}`] = { max: Math.max(0, K - lockedUses) };
        if (settings.avoidBackToBack) {
            for (let d = 0; d + 1 < days; d++) {
                const pair = [d, d + 1];
                const ones = pair.filter(e => state[e] === 'one').length;
                const vars = pair.filter(e => state[e] === 'var');
                if (vars.length === 0 || ones + vars.length < 2) continue;
                const row = `bb|${it.index}|${d}`;
                C[row] = { max: 1 - ones };
                for (const e of vars) V[yName(e)][row] = 1;
                V[`z|${it.index}|${d}`] = { cost: BACK_TO_BACK_PENALTY, [row]: -1 };
            }
        }
    }

    // Recipes, in whole servings.
    for (const r of recipes) {
        const perServing = r.servingGrams / 100;
        const kcal = per100(r.food, 'calories') * perServing;
        const lockedHere = locks.filter(l => l.foodId === r.food.id);
        const lockedServings = lockedHere.reduce((s, l) => s + (l.servings ?? l.grams / r.servingGrams), 0);
        const lockedCooks = lockedHere.filter(l => !l.leftover).length;
        let any = false;
        for (let d = 0; d < days; d++) {
            if (lockedDays.has(d) || lockedPlanned.has(`${d}:${r.food.id}`)) continue;
            any = true;
            const c = `c|${r.index}|${d}`, a = `a|${r.index}|${d}`, yc = `yc|${r.index}|${d}`;
            C[`rf|${r.index}|${d}`] = { equal: 0 };
            V[c] = { [`rf|${r.index}|${d}`]: -1, [`rm|${r.index}`]: 1 };
            V[a] = { cost: kcal, [`rf|${r.index}|${d}`]: 1, [`re|${r.index}|${d}`]: 1, ...nutrientCoefficients(r.food, d, perServing) };
            C[`re|${r.index}|${d}`] = { max: WEEK_LIMITS.recipeServingsPerDay };
            const next = d + 1;
            if (settings.leftovers && next < days && !lockedDays.has(next) && !lockedPlanned.has(`${next}:${r.food.id}`)) {
                const b = `b|${r.index}|${d}`;
                V[b] = { cost: kcal, [`rf|${r.index}|${d}`]: 1, [`re|${r.index}|${next}`]: 1, ...nutrientCoefficients(r.food, next, perServing) };
                if (!relaxed) model.ints![b] = 1;
            }
            if (relaxed) continue;
            model.ints![c] = 1;
            model.ints![a] = 1;
            C[`rc|${r.index}|${d}`] = { max: 0 };
            C[`rl|${r.index}|${d}`] = { min: 0 };
            V[c][`rc|${r.index}|${d}`] = 1;
            V[c][`rl|${r.index}|${d}`] = 1;
            V[yc] = { [`rc|${r.index}|${d}`]: -WEEK_LIMITS.recipeServingsPerBatch, [`rl|${r.index}|${d}`]: -1, [`rv|${r.index}`]: 1 };
            model.binaries![yc] = 1;
        }
        if (!any) continue;
        if (!relaxed) C[`rv|${r.index}`] = { max: Math.max(0, K - lockedCooks) };
        if (lockedServings < 1) C[`rm|${r.index}`] = { min: 1 - lockedServings };
    }

    // Row scaling for goal rows.
    const scale: Record<string, number> = {};
    for (const [row, c] of Object.entries(C)) {
        if (!row.startsWith('n|') && !row.startsWith('w|')) continue;
        let s = Math.max(Math.abs(c.min ?? 0), Math.abs(c.max ?? 0));
        if (!(s > 0)) for (const v of Object.values(V)) s = Math.max(s, Math.abs(v[row] ?? 0));
        if (!(s > 0)) s = 1;
        scale[row] = s;
        if (s === 1) continue;
        if (c.min !== undefined) c.min /= s;
        if (c.max !== undefined) c.max /= s;
        for (const v of Object.values(V)) if (v[row] !== undefined) v[row] /= s;
    }
    if (relaxed) { delete model.ints; delete model.binaries; }
    return { model, scale, constants, prepared: p };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function displayGrams(g: number): number {
    if (g >= 10) return Math.round(g);
    if (g >= 1) return Math.round(g * 10) / 10;
    return Number(g.toPrecision(2));
}

function num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function extractDays(built: BuiltWeekModel, sol: Solved): WeekDay[] {
    const { prepared: p, constants } = built;
    const days = p.settings.days;
    const out: WeekDay[] = [];
    for (let d = 0; d < days; d++) {
        const entries: WeekEntry[] = [...constants[d]];
        for (const it of p.items) {
            const x = num(sol[`x|${it.index}|${d}`]);
            if (x > 1e-6) entries.push({ foodId: it.food.id, grams: displayGrams(x * 100), role: 'planned', locked: false });
        }
        for (const r of p.recipes) {
            const ate = Math.round(num(sol[`a|${r.index}|${d}`]));
            const cooked = Math.round(num(sol[`c|${r.index}|${d}`]));
            if (ate > 0 || cooked > 0) {
                entries.push({ foodId: r.food.id, grams: displayGrams(ate * r.servingGrams), servings: ate, role: 'cooked', locked: false, ...(cooked > ate ? { cooked } : {}) });
            }
            const left = Math.round(num(sol[`b|${r.index}|${d - 1}`]));
            if (d > 0 && left > 0) entries.push({ foodId: r.food.id, grams: displayGrams(left * r.servingGrams), servings: left, role: 'leftover', locked: false });
        }
        out.push(dayTotals(p.byId, d, entries.filter(e => e.grams > 0), p.lockedDays.has(d)));
    }
    return out;
}

function warningsFor(p: Prepared, used: Set<number>): OptimizationWarning[] {
    const keys = Object.keys(p.limits);
    const out: OptimizationWarning[] = [];
    for (const food of p.byId.values()) {
        if (!used.has(food.id)) continue;
        const lower = Array.isArray(food.recipe?.incomplete) ? food.recipe.incomplete : [];
        const missing = keys.filter(k => nutrientValue(food, k) === null || lower.includes(k));
        if (missing.length === 0) continue;
        const name = food.description || `Food ${food.id}`;
        out.push({
            code: 'missing_nutrient_data',
            message: `"${name}" has no data for ${missing.map(label).join(', ')}; it was counted as 0 toward ${missing.length === 1 ? 'that goal' : 'those goals'}, so actual totals may differ.`,
            foodId: food.id, description: name, nutrients: missing, role: 'optimized', inDiet: true,
        });
    }
    return out;
}

function label(key: string): string {
    return key === 'calories' ? 'Calories' : ALL_NUTRIENT_CONFIG[key]?.label ?? key;
}
function unit(key: string): string {
    return key === 'calories' ? 'kcal' : ALL_NUTRIENT_CONFIG[key]?.unit ?? '';
}
function fmt(n: number): string {
    const a = Math.abs(n);
    if (a >= 100) return String(Math.round(n));
    if (a >= 10) return String(Math.round(n * 10) / 10);
    if (a === 0) return '0';
    return String(Number(n.toPrecision(2)));
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

/** Why no week works with these foods: the same style as the day planner's explanation. */
async function diagnoseNutrients(p: Prepared, timeLimitMs: number): Promise<{ message: string; issues: OptimizationIssue[] }> {
    const built = buildWeekModel(p, { relaxed: true });
    const { model, scale } = built;
    // Every goal row may be broken at a cost proportional to the relative shortfall (rows are
    // scaled to |bound| = 1); per-food and recipe rows cost more, so goals are named first.
    const elastic: JsModel = { optimize: 'penalty', opType: 'min', constraints: model.constraints, variables: { ...model.variables } };
    for (const [row, c] of Object.entries(model.constraints)) {
        if (row.startsWith('rf|')) continue;
        const penalty = row.startsWith('n|') || row.startsWith('w|') ? 1 : ELASTIC_FOOD_PENALTY;
        if (c.min !== undefined) elastic.variables[`short:${row}`] = { [row]: 1, penalty };
        if (c.max !== undefined) elastic.variables[`excess:${row}`] = { [row]: -1, penalty };
    }
    const sol = await solve(elastic, timeLimitMs);
    const issues: { text: string; weight: number; issue: OptimizationIssue }[] = [];
    // A max that the fixed or locked foods alone already break.
    for (const [row, c] of Object.entries(model.constraints)) {
        if (!row.startsWith('n|') || c.max === undefined || c.max >= 0) continue;
        const [, key, day] = row.split('|');
        const over = -c.max * (scale[row] ?? 1);
        issues.push({
            text: `Your fixed or locked foods already go over the ${label(key)} limit on day ${Number(day) + 1} (by ${fmt(over)}${unit(key)}).`,
            weight: Number.POSITIVE_INFINITY,
            issue: { kind: 'excess', nutrient: key, amount: over, cause: 'fixed_foods' },
        });
    }
    if (sol.feasible) {
        const byKey = new Map<string, { kind: 'short' | 'excess'; amount: number; days: number; weekly: boolean; weight: number }>();
        for (const [name, val] of Object.entries(sol)) {
            if (typeof val !== 'number' || val <= 1e-7) continue;
            const isShort = name.startsWith('short:');
            if (!isShort && !name.startsWith('excess:')) continue;
            const row = name.slice(name.indexOf(':') + 1);
            if (!row.startsWith('n|') && !row.startsWith('w|')) continue;
            const parts = row.split('|');
            const key = parts[1];
            const weekly = parts[0] === 'w';
            const amount = val * (scale[row] ?? 1) / (weekly ? p.settings.days : 1);
            const k = `${isShort ? 'short' : 'excess'}:${key}`;
            const prev = byKey.get(k);
            if (prev) { prev.amount = Math.max(prev.amount, amount); prev.days++; prev.weight += val; } else {
                byKey.set(k, { kind: isShort ? 'short' : 'excess', amount, days: 1, weekly, weight: val });
            }
        }
        for (const [k, v] of byKey) {
            const key = k.slice(k.indexOf(':') + 1);
            const u = unit(key);
            const when = v.weekly ? 'on average over the week' : v.days >= p.settings.days ? 'on any day' : `on ${v.days} ${v.days === 1 ? 'day' : 'days'}`;
            issues.push({
                text: v.kind === 'short'
                    ? `Cannot meet ${label(key)} target ${when} (short by ${v.days > 1 && !v.weekly ? 'up to ' : ''}${fmt(v.amount)}${u}${v.weekly ? ' a day' : ''}).`
                    : `Cannot stay under ${label(key)} limit ${when} (over by ${v.days > 1 ? 'up to ' : ''}${fmt(v.amount)}${u}).`,
                weight: v.weight,
                issue: { kind: v.kind, nutrient: key, amount: v.amount },
            });
        }
    }
    if (issues.length === 0) return { message: 'No combination of these foods can meet every goal across the week.', issues: [] };
    issues.sort((a, b) => b.weight - a.weight);
    const unique = Array.from(new Set(issues.map(i => i.text)));
    let message = `Optimization Failed:\n• ${unique.slice(0, 5).join('\n• ')}`;
    if (unique.length > 5) message += `\n...and ${unique.length - 5} more issues.`;
    const structured = new Map<string, OptimizationIssue>();
    for (const { issue } of issues) {
        const k = `${issue.kind}:${issue.nutrient}`;
        if (!structured.has(k)) structured.set(k, issue);
    }
    return { message, issues: [...structured.values()] };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function solverInfo(built: BuiltWeekModel, ms: number, status: WeekSolverInfo['status']): WeekSolverInfo {
    return {
        ms: Math.round(ms),
        status,
        variables: Object.keys(built.model.variables).length,
        integers: Object.keys(built.model.ints ?? {}).length + Object.keys(built.model.binaries ?? {}).length,
        constraints: Object.keys(built.model.constraints).length,
    };
}

function foodsUsed(p: Prepared, days: WeekDay[]): Record<string, Food> {
    const out: Record<string, Food> = {};
    for (const d of days) for (const e of d.entries) { const f = p.byId.get(e.foodId); if (f) out[String(f.id)] = f; }
    return out;
}

/** PLUS-GATE: weekPlanner. Plan a week. Never throws for bad input: `error` is set instead. */
export async function planWeek(params: WeekParams): Promise<WeekResult> {
    const started = performance.now();
    let p: Prepared;
    try {
        p = prepare(params);
    } catch (e) {
        if (e instanceof OptimizationInputError) {
            return { success: false, error: e.message, goals: [], settings: settingsFrom(params?.settings), solver: { ms: 0, status: 'error', variables: 0, integers: 0, constraints: 0 } };
        }
        throw e;
    }
    const base = { goals: p.goals, constraintLimits: p.limits, settings: p.settings };

    for (const [key, lim] of Object.entries(p.limits)) {
        if (lim.min !== undefined && lim.max !== undefined && lim.min > lim.max) {
            return {
                ...base, success: false,
                message: `Optimization Failed:\n• ${label(key)}: minimum (${fmt(lim.min)}${unit(key)}) is greater than maximum (${fmt(lim.max)}${unit(key)}).`,
                diagnosis: 'nutrients', issues: [],
                solver: { ms: 0, status: 'infeasible', variables: 0, integers: 0, constraints: 0 },
            };
        }
    }

    const timeLimit = Math.min(WEEK_LIMITS.timeLimitMs, Math.max(200, params.timeLimitMs ?? WEEK_LIMITS.timeLimitMs));
    const built = buildWeekModel(p);
    const sol = await solve(built.model, timeLimit);
    const elapsed = performance.now() - started;
    const timedOut = sol.timeLimited;

    if (sol.feasible) {
        const days = extractDays(built, sol);
        const used = new Set(days.flatMap(d => d.entries.map(e => e.foodId)));
        return {
            ...base,
            success: true,
            days,
            foods: foodsUsed(p, days),
            weekTotals: weekTotals(days),
            solver: solverInfo(built, elapsed, timedOut ? 'time_limit' : 'optimal'),
            warnings: warningsFor(p, used),
        };
    }

    // No week found: explain why, in the day planner's terms.
    const relaxed = await solve(buildWeekModel(p, { relaxed: true }).model, timeLimit);
    let diagnosis: WeekDiagnosis;
    let message: string;
    let issues: OptimizationIssue[] = [];
    let varietyNeeded: number | undefined;
    let portionCapBinding = false;
    if (timedOut && relaxed.feasible) {
        diagnosis = 'time';
        message = 'The week planner ran out of time before it found a plan. Try fewer foods, a looser variety limit, or lock a day you like.';
    } else if (!relaxed.feasible) {
        diagnosis = p.locks.length > 0 || p.lockedDays.size > 0 ? 'locks' : 'nutrients';
        ({ message, issues } = await diagnoseNutrients(p, timeLimit));
        portionCapBinding = p.items.some(i => i.generalCap) && (await solve(buildWeekModel(p, { relaxed: true, noGeneralCap: true }).model, timeLimit)).feasible;
        if (diagnosis === 'locks' && !issues.length) message = 'The locked days and foods leave no room to meet your goals on the other days.';
    } else {
        // Every goal can be met, but not with this much variety (or such sensible portions).
        // The variety limit is a preference, so the week is planned with the smallest limit that
        // works, and the result says so.
        const k = p.settings.maxDaysPerFood;
        for (const candidate of [k + 1, k + 2, p.settings.days]) {
            if (candidate <= k || candidate > p.settings.days || varietyNeeded !== undefined) continue;
            const m = buildWeekModel(p, { maxDaysPerFood: candidate });
            const s2 = await solve(m.model, timeLimit);
            if (!s2.feasible) continue;
            varietyNeeded = candidate;
            const days = extractDays(m, s2);
            return {
                ...base,
                success: true,
                days,
                foods: foodsUsed(p, days),
                weekTotals: weekTotals(days),
                varietyUsed: candidate,
                solver: solverInfo(m, performance.now() - started, s2.timeLimited ? 'time_limit' : 'optimal'),
                warnings: warningsFor(p, new Set(days.flatMap(d => d.entries.map(e => e.foodId)))),
            };
        }
        diagnosis = 'portions';
        message = 'Optimization Failed:\n• These foods can meet your goals only in very small amounts of some foods. The week planner uses at least half a serving of a food when it uses it at all. Add more foods, or loosen a goal.';
    }
    return {
        ...base,
        success: false,
        message, issues, diagnosis, varietyNeeded, portionCapBinding,
        solver: solverInfo(built, performance.now() - started, 'infeasible'),
    };
}
