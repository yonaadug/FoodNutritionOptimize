import type { Food, ServingSize } from '@/lib/db';
import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';

/**
 * UI-side nutrient helpers.
 *
 * Nutrient values from the API may be `number | null` (null = USDA has no
 * data). Older databases store "missing" as 0. Everything in the UI reads
 * nutrients through `nv()` so null is never silently treated as 0 for display.
 */

export type NutrientKey = string;

/** All goal-able nutrient keys (calories handled separately). */
export const GOAL_KEYS: NutrientKey[] = Object.keys(NUTRIENT_CONFIG).filter(k => k !== 'calories');

export interface NutrientGroup {
    id: string;
    title: string;
    keys: NutrientKey[];
}

const GROUP_DEFS: NutrientGroup[] = [
    { id: 'macros', title: 'Protein, carbs & fiber', keys: ['protein_g', 'carbohydrate_g', 'fiber_g', 'total_fat_g'] },
    { id: 'limits', title: 'Keep these in check', keys: ['saturated_g', 'sugars_g', 'sodium_mg', 'cholesterol_mg'] },
    {
        id: 'vitamins', title: 'Vitamins', keys: ['vitamin_a_ug', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug',
            'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug'],
    },
    { id: 'minerals', title: 'Minerals', keys: ['calcium_mg', 'iron_mg', 'potassium_mg', 'magnesium_mg', 'zinc_mg', 'copper_mg', 'manganese_mg', 'selenium_ug'] },
];

/** Groups for display; any nutrient added to NUTRIENT_CONFIG later lands in "Other". */
export const NUTRIENT_GROUPS: NutrientGroup[] = (() => {
    const known = new Set(GROUP_DEFS.flatMap(g => g.keys));
    const groups = GROUP_DEFS.map(g => ({ ...g, keys: g.keys.filter(k => NUTRIENT_CONFIG[k]) }));
    const other = GOAL_KEYS.filter(k => !known.has(k));
    if (other.length) groups.push({ id: 'other', title: 'Other', keys: other });
    return groups;
})();

const LABEL_OVERRIDES: Record<string, string> = {
    folate_ug: 'Folate (DFE)',
    choline_mg: 'Choline', ala_g: 'Omega-3 ALA', epa_g: 'Omega-3 EPA', dha_g: 'Omega-3 DHA',
    water_g: 'Water', caffeine_mg: 'Caffeine', alcohol_g: 'Alcohol',
    pantothenic_acid_mg: 'Pantothenic acid', phosphorus_mg: 'Phosphorus',
};

export function nutrientLabel(key: NutrientKey): string {
    if (key === 'calories') return 'Calories';
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
    return NUTRIENT_CONFIG[key]?.label ?? key.replace(/_(g|mg|ug)$/, '').replace(/_/g, ' ');
}

export function nutrientUnit(key: NutrientKey): string {
    if (key === 'calories') return 'kcal';
    const cfg = NUTRIENT_CONFIG[key];
    if (cfg) return cfg.unit;
    if (key.endsWith('_ug')) return 'mcg';
    if (key.endsWith('_mg')) return 'mg';
    return 'g';
}

/** FDA Daily Value reference for a nutrient (from NUTRIENT_CONFIG). */
export function dailyValue(key: NutrientKey): number | null {
    return NUTRIENT_CONFIG[key]?.defaultValue ?? null;
}

/** Read a numeric value safely: returns null for null/undefined/NaN/non-numbers. */
export function num(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

/** Nutrient value per 100 g for a food, or null if unknown. */
export function nv(food: Food | Record<string, unknown> | null | undefined, key: NutrientKey): number | null {
    if (!food) return null;
    return num((food as unknown as Record<string, unknown>)[key]);
}

/**
 * Does this food have usable core data? Foods with no energy/macros at all are
 * almost always "not measured" rather than genuinely zero.
 */
export function hasCoreData(food: Food): boolean {
    const cal = nv(food, 'calories');
    if (cal === null) return false;
    if (cal > 0) return true;
    return ['protein_g', 'total_fat_g', 'carbohydrate_g'].some(k => (nv(food, k) ?? 0) > 0);
}

/** Format a number for humans: 0-1 decimals depending on size. */
export function fmtNumber(v: number | null | undefined, opts: { decimals?: number } = {}): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const decimals = opts.decimals ?? (abs >= 100 ? 0 : abs >= 10 ? 0 : abs >= 1 ? 1 : abs === 0 ? 0 : 2);
    return v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

/** "12 g", "1.3 mg", or "—" when unknown. */
export function fmtAmount(v: number | null | undefined, unit: string): string {
    const s = fmtNumber(v);
    return s === '—' ? s : `${s} ${unit}`;
}

/** Split a USDA description into a short name and the qualifying detail. */
export function splitFoodName(description: string): { name: string; detail: string } {
    const idx = description.indexOf(',');
    if (idx === -1) return { name: description, detail: '' };
    return { name: description.slice(0, idx).trim(), detail: description.slice(idx + 1).trim() };
}

const SKIP_SERVING = /(^100\s?g$|100\s?g serving|nlea|racc|quart|pint|100 milliliter|as purchased|quantity not specified|yield from|surface inch|^1 lb\b|^1 serving$)/i;

/** Household servings worth showing (drops "100g serving", NLEA, etc.). */
export function householdServings(food: Food): ServingSize[] {
    return (food.serving_sizes ?? []).filter(s => s.weight_g > 0 && !SKIP_SERVING.test(s.label));
}

const FRACTIONS: [number, string][] = [[0, ''], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, '']];

function fmtQty(q: number): string {
    const rounded = Math.round(q * 4) / 4;
    const whole = Math.floor(rounded);
    const frac = rounded - whole;
    const fracStr = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.01)?.[1] ?? '';
    if (whole === 0) return fracStr || '0';
    return `${whole}${fracStr}`;
}

const PLURALS: Record<string, string> = {
    cup: 'cups', slice: 'slices', piece: 'pieces', tablespoon: 'tablespoons', teaspoon: 'teaspoons', link: 'links',
    fillet: 'fillets', leaf: 'leaves', stick: 'sticks', steak: 'steaks', wedge: 'wedges', strip: 'strips', head: 'heads', bunch: 'bunches',
};

/**
 * Express grams as a household amount, e.g. 228 g broccoli → "≈ 3 cups, chopped".
 * Returns null if there is no sensible household serving.
 */
export function householdAmount(food: Food, grams: number): string | null {
    const servings = householdServings(food);
    if (!servings.length || grams <= 0) return null;
    // Choose the serving that makes the count closest to ~1.5 units.
    let best: ServingSize | null = null;
    let bestScore = Infinity;
    for (const s of servings) {
        const m = s.label.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);
        const baseQty = m ? parseFloat(m[1]) : 1;
        const units = (grams / s.weight_g) * baseQty;
        const score = Math.abs(Math.log(Math.max(units, 0.01) / 1.5));
        if (score < bestScore) { bestScore = score; best = s; }
    }
    if (!best) return null;
    const m = best.label.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);
    const baseQty = m ? parseFloat(m[1]) : 1;
    let rest = m ? m[2] : best.label;
    const units = (grams / best.weight_g) * baseQty;
    if (units < 0.2) return `a little (< ¼ ${rest})`;
    if (units > 1.125) {
        const [first, ...others] = rest.split(/(?=[ ,])/);
        const plural = PLURALS[first.toLowerCase()];
        if (plural) rest = plural + others.join('');
    }
    return `≈ ${fmtQty(units)} ${rest}`;
}

/** Calories etc. for an amount of food in grams; null if the per-100 g value is unknown. */
export function amountFor(food: Food, key: NutrientKey, grams: number): number | null {
    const per100 = nv(food, key);
    return per100 === null ? null : per100 * grams / 100;
}

/** Short, human label for the USDA data source. */
export function dataSourceLabel(dataType: string | null | undefined): string | null {
    if (!dataType) return null;
    const t = dataType.toLowerCase();
    if (t.includes('foundation')) return 'USDA Foundation';
    if (t.includes('sr_legacy') || t.includes('sr legacy')) return 'USDA SR Legacy';
    if (t.includes('fndds') || t.includes('survey')) return 'Mixed dish (FNDDS)';
    if (t.includes('branded')) return 'Branded';
    return dataType.replace(/_/g, ' ');
}
