/**
 * The one place a nutrient amount is scaled to a serving, and the weights servings
 * are measured in. Pure, no runtime dependencies (safe for client components).
 *
 * How values are stored: every nutrient column in nutrition.db, and on `Food`, is per
 * 100 g of edible portion (lib/food-types.ts). So for any weight:
 *
 *     amount = value_per_100g × grams / 100
 *
 * always from the stored, unrounded value. Nothing here rounds: rounding happens only
 * when a number is shown (formatNumber), after scaling. % Daily Value is computed from
 * the unrounded scaled amount, then rounded to a whole percent for display.
 *
 * A missing value (null: USDA has no measurement) stays missing at every weight. A
 * value filled from USDA's older entry (†, lib/nutrient-fill.ts) scales like any other
 * and keeps its mark, and a recipe's lower-bound total ("≥") stays a lower bound.
 */

/** The international avoirdupois ounce, exact by definition (1959): 1/16 of 453.59237 g. */
export const GRAMS_PER_OUNCE = 28.349523125;
/** The international avoirdupois pound, exact by definition. */
export const GRAMS_PER_POUND = 453.59237;

/** The food page's rule for a custom amount: 1 to 5,000 g, in whichever unit it is typed. */
export const MIN_SERVING_GRAMS = 1;
export const MAX_SERVING_GRAMS = 5000;
/** What a page shows while a custom amount is out of range. */
export const FALLBACK_GRAMS = 100;

export type MassUnit = 'g' | 'oz';

export function toGrams(amount: number, unit: MassUnit): number {
    return unit === 'oz' ? amount * GRAMS_PER_OUNCE : amount;
}

export function fromGrams(grams: number, unit: MassUnit): number {
    return unit === 'oz' ? grams / GRAMS_PER_OUNCE : grams;
}

function assertGrams(grams: number): void {
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0) {
        throw new RangeError(`A serving must be a finite, non-negative number of grams (got ${grams})`);
    }
}

/**
 * The amount of a nutrient in `grams` of food, from its value per 100 g. Null when the
 * value is missing (or not a finite number): "no data" stays "no data", never 0.
 * Throws a RangeError for a weight that isn't one (negative, NaN, infinite).
 */
export function scaleAmount(per100g: unknown, grams: number): number | null {
    assertGrams(grams);
    if (typeof per100g !== 'number' || !Number.isFinite(per100g)) return null;
    return per100g * grams / 100;
}

/** Unrounded % of a daily value; null without an amount or a positive daily value. */
export function percentOfDailyValue(amount: number | null, dailyValue: number | null | undefined): number | null {
    if (amount === null || !dailyValue || !(dailyValue > 0)) return null;
    return (amount / dailyValue) * 100;
}

/** One nutrient for one serving, before any rounding. */
export interface ScaledNutrient {
    /** Amount in the serving; null = not measured. */
    amount: number | null;
    /** % Daily Value of `amount`; null when there's no amount or no daily value. */
    dvPct: number | null;
    /** † The value is from USDA's older entry for this food. */
    olderEntry: boolean;
    /** ≥ The value is a lower bound (a recipe with an ingredient that has no data). */
    atLeast: boolean;
}

interface ScalableFood {
    filledFrom?: Record<string, number>;
    recipe?: { incomplete?: readonly string[] } | null;
}

export function scaleNutrient(food: ScalableFood, key: string, grams: number, dailyValue: number | null): ScaledNutrient {
    const amount = scaleAmount((food as Record<string, unknown>)[key], grams);
    return {
        amount,
        dvPct: percentOfDailyValue(amount, dailyValue),
        olderEntry: !!food.filledFrom && food.filledFrom[key] !== undefined,
        atLeast: amount !== null && !!food.recipe?.incomplete?.includes(key),
    };
}

// ---------------------------------------------------------------------------
// Display (the only place numbers are rounded)
// ---------------------------------------------------------------------------

/**
 * A number as the site shows it: 0 decimals from 10, 1 decimal from 1, 2 below 1,
 * "—" for unknown. Fixed locale, so server and browser render the same text.
 */
export function formatNumber(v: number | null | undefined, decimals?: number): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const d = decimals ?? (abs >= 10 ? 0 : abs >= 1 ? 1 : abs === 0 ? 0 : 2);
    return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

/** What a label shows for one nutrient. */
export interface NutrientDisplay {
    /** "11 g", "≥ 6 g", "173" (no unit), or "—". */
    amount: string;
    /** "14%", "≥ 12%", or null when no % Daily Value applies. */
    dv: string | null;
    olderEntry: boolean;
}

export function displayNutrient(s: ScaledNutrient, unit: string, decimals?: number): NutrientDisplay {
    if (s.amount === null) return { amount: '—', dv: null, olderEntry: s.olderEntry };
    const prefix = s.atLeast ? '≥ ' : '';
    const n = formatNumber(s.amount, decimals);
    return {
        amount: `${prefix}${unit ? `${n} ${unit}` : n}`,
        dv: s.dvPct === null ? null : `${prefix}${Math.round(s.dvPct)}%`,
        olderEntry: s.olderEntry,
    };
}

/** Scale, then round for display: what the Nutrition Facts label shows for `key`. */
export function labelNutrient(food: ScalableFood, key: string, grams: number, unit: string, dailyValue: number | null, decimals?: number): NutrientDisplay {
    return displayNutrient(scaleNutrient(food, key, grams, dailyValue), unit, decimals);
}

/** Grams as shown next to a measure: up to 2 decimals ("85.05", "28.35", "91", "1,000"). */
export function formatGrams(grams: number): string {
    return grams.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

/** An amount typed in `unit`, as a serving label: "5 oz (141.75 g)", "250 g". */
export function amountLabel(grams: number, unit: MassUnit): string {
    if (unit === 'g') return `${formatGrams(grams)} g`;
    const oz = fromGrams(grams, 'oz');
    return `${oz.toLocaleString('en-US', { maximumFractionDigits: 2 })} oz (${formatGrams(grams)} g)`;
}

// ---------------------------------------------------------------------------
// Custom amounts
// ---------------------------------------------------------------------------

export const AMOUNT_RANGE_MESSAGE = `Enter 1 to ${MAX_SERVING_GRAMS.toLocaleString('en-US')} g (about 0.04 to 176 oz).`;

export type ParsedAmount = { ok: true; grams: number } | { ok: false; message: string };

/** Read a typed amount in grams or ounces; it must come to 1–5,000 g. */
export function parseServingAmount(text: string, unit: MassUnit): ParsedAmount {
    const t = text.trim();
    const n = t === '' ? Number.NaN : Number(t);
    if (!Number.isFinite(n)) return { ok: false, message: AMOUNT_RANGE_MESSAGE };
    const grams = toGrams(n, unit);
    if (!(grams >= MIN_SERVING_GRAMS && grams <= MAX_SERVING_GRAMS)) return { ok: false, message: AMOUNT_RANGE_MESSAGE };
    return { ok: true, grams };
}

// ---------------------------------------------------------------------------
// Standard weights: offered for every food, wherever a serving menu appears
// ---------------------------------------------------------------------------

export type StandardWeightId = 'w-1oz' | 'w-3oz' | 'w-100g';

export interface StandardWeight {
    id: StandardWeightId;
    /** "3 oz" */
    label: string;
    grams: number;
    unit: MassUnit;
    /** The amount in `unit` (3 for 3 oz). */
    amount: number;
}

export const STANDARD_WEIGHTS: readonly StandardWeight[] = [
    { id: 'w-1oz', label: '1 oz', grams: GRAMS_PER_OUNCE, unit: 'oz', amount: 1 },
    { id: 'w-3oz', label: '3 oz', grams: 3 * GRAMS_PER_OUNCE, unit: 'oz', amount: 3 },
    { id: 'w-100g', label: '100 g', grams: 100, unit: 'g', amount: 100 },
];

export function standardWeight(id: StandardWeightId): StandardWeight {
    return STANDARD_WEIGHTS.find(w => w.id === id)!;
}

/** The standard weight at exactly these grams, if any. */
export function standardWeightAt(grams: number): StandardWeight | undefined {
    return STANDARD_WEIGHTS.find(w => w.grams === grams);
}

/**
 * "3 oz (85.05 g)", "100 g". With `alias`, what a USDA row at that weight calls it:
 * "3 oz · 1 standard serving (85.05 g)", or the row's own words when they start with the
 * weight ("1 oz (22 whole kernels) (28.35 g)").
 */
export function weightLabel(w: StandardWeight, alias?: string): string {
    let text = w.label;
    if (alias !== undefined && alias.trim() !== '' && !isPlainWeightLabel(alias, w)) {
        const startsWithWeight = alias.toLowerCase().startsWith(w.label.toLowerCase()) && /^[ ,(]/.test(alias.slice(w.label.length));
        text = startsWithWeight ? alias : `${w.label} · ${alias}`;
    }
    return w.unit === 'g' ? text : `${text} (${formatGrams(w.grams)} g)`;
}

/**
 * Half a gram: USDA records portion weights to the gram (sometimes 0.1 g), so its
 * "3 oz" is 85 g and "1 oz" 28 or 28.35 g. Weights this close are the same weight.
 */
export const SAME_WEIGHT_TOLERANCE_G = 0.5;

export function sameWeight(a: number, b: number): boolean {
    return Math.abs(a - b) <= SAME_WEIGHT_TOLERANCE_G;
}

/** Labels that only state an ounce weight: "3 oz", "3 oz (3 oz)". */
const PLAIN_OUNCES = /^(\d+(?:\.\d+)?)\s*oz\.?(?:\s*\(\s*\1\s*oz\.?\s*\))?$/i;

/**
 * The standard weight a serving is the same as, if any: within half a gram, or a label
 * that says exactly that many ounces within 2% (labels written at 28 g per ounce say
 * "3 oz" for 84 g).
 */
export function matchStandardWeight(label: string, grams: number): StandardWeight | undefined {
    const byWeight = STANDARD_WEIGHTS.find(w => sameWeight(grams, w.grams));
    if (byWeight) return byWeight;
    const m = label.trim().match(PLAIN_OUNCES);
    if (!m) return undefined;
    const oz = Number(m[1]);
    return STANDARD_WEIGHTS.find(w => w.unit === 'oz' && w.amount === oz && Math.abs(grams - w.grams) <= 0.02 * w.grams);
}

/** Is this label nothing more than the standard weight's own name ("3 oz", "3 oz (3 oz)", "100 g")? */
export function isPlainWeightLabel(label: string, w: StandardWeight): boolean {
    const t = label.trim();
    if (t.toLowerCase() === w.label.toLowerCase()) return true;
    const m = t.match(PLAIN_OUNCES);
    return !!m && w.unit === 'oz' && Number(m[1]) === w.amount;
}
