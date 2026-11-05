import type { Food, ServingSize } from '@/lib/food-types';
import { ALL_NUTRIENT_CONFIG, NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import { friendlyServingLabel } from '@/lib/servings';

/**
 * UI-side nutrient helpers.
 *
 * Nutrient values from the API may be `number | null` (null = USDA has no
 * data). Older databases store "missing" as 0. Everything in the UI reads
 * nutrients through `nv()` so null is never silently treated as 0 for display.
 */

export type NutrientKey = string;

/** All goal-able nutrient keys, including optional ones (calories handled separately). */
export const GOAL_KEYS: NutrientKey[] = Object.keys(ALL_NUTRIENT_CONFIG).filter(k => k !== 'calories');

/** Nutrients the optimizer treats as default goals (the FDA Daily Value set). */
export const DEFAULT_GOAL_KEYS: NutrientKey[] = Object.entries(NUTRIENT_CONFIG)
    .filter(([k, c]) => k !== 'calories' && c.defaultEnabled !== false)
    .map(([k]) => k);

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
            'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug', 'pantothenic_acid_mg', 'choline_mg'],
    },
    { id: 'minerals', title: 'Minerals', keys: ['calcium_mg', 'iron_mg', 'potassium_mg', 'magnesium_mg', 'zinc_mg', 'copper_mg', 'manganese_mg', 'selenium_ug', 'phosphorus_mg'] },
    { id: 'fats', title: 'Omega-3 fats', keys: ['ala_g', 'epa_g', 'dha_g'] },
];

/** Groups for display; any nutrient added to NUTRIENT_CONFIG later lands in "Other". */
export const NUTRIENT_GROUPS: NutrientGroup[] = (() => {
    const known = new Set(GROUP_DEFS.flatMap(g => g.keys));
    const groups = GROUP_DEFS.map(g => ({ ...g, keys: g.keys.filter(k => ALL_NUTRIENT_CONFIG[k]) })).filter(g => g.keys.length);
    const other = GOAL_KEYS.filter(k => !known.has(k));
    if (other.length) groups.push({ id: 'other', title: 'Other', keys: other });
    return groups;
})();

const LABEL_OVERRIDES: Record<string, string> = {
    folate_ug: 'Folate (DFE)',
    choline_mg: 'Choline', ala_g: 'Omega-3 (ALA)', epa_g: 'Omega-3 (EPA)', dha_g: 'Omega-3 (DHA)',
    water_g: 'Water', caffeine_mg: 'Caffeine', alcohol_g: 'Alcohol',
    pantothenic_acid_mg: 'Pantothenic acid', phosphorus_mg: 'Phosphorus',
};

export function nutrientLabel(key: NutrientKey): string {
    if (key === 'calories') return 'Calories';
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
    return ALL_NUTRIENT_CONFIG[key]?.label ?? key.replace(/_(g|mg|ug)$/, '').replace(/_/g, ' ');
}

export function nutrientUnit(key: NutrientKey): string {
    if (key === 'calories') return 'kcal';
    const cfg = ALL_NUTRIENT_CONFIG[key];
    if (cfg) return cfg.unit;
    if (key.endsWith('_ug')) return 'mcg';
    if (key.endsWith('_mg')) return 'mg';
    return 'g';
}

/** Reference intake for a nutrient (FDA DV, or NASEM AI where no DV exists); null if none. */
export function dailyValue(key: NutrientKey): number | null {
    const v = ALL_NUTRIENT_CONFIG[key]?.defaultValue;
    return v && v > 0 ? v : null;
}

/** What kind of reference `dailyValue()` is, in plain words. */
export function referenceKind(key: NutrientKey): string {
    const src = ALL_NUTRIENT_CONFIG[key]?.source ?? '';
    if (dailyValue(key) === null) return 'No official target';
    if (/^FDA DV/.test(src)) return /added sugars/.test(src) ? 'FDA DV is for added sugars' : 'FDA Daily Value';
    if (/AI/.test(src)) return 'Adequate intake';
    return 'Reference';
}

/** Tolerable upper limit (adults) if one exists. */
export function upperLimit(key: NutrientKey): { value: number; total: boolean } | null {
    const ul = ALL_NUTRIENT_CONFIG[key]?.ul;
    return ul ? { value: ul.value, total: ul.appliesTo === 'total' } : null;
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
    if (['protein_g', 'total_fat_g', 'carbohydrate_g'].some(k => (nv(food, k) ?? 0) > 0)) return true;
    // A measured 0 kcal with measured macros or water (tea, water, table salt) is a real zero.
    return ['protein_g', 'total_fat_g', 'carbohydrate_g', 'water_g'].some(k => nv(food, k) !== null);
}

/** Format a number for humans: 0-1 decimals depending on size. */
export function fmtNumber(v: number | null | undefined, opts: { decimals?: number } = {}): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const decimals = opts.decimals ?? (abs >= 100 ? 0 : abs >= 10 ? 0 : abs >= 1 ? 1 : abs === 0 ? 0 : 2);
    // Fixed locale: labels are also server-rendered, and the server's locale may differ from the browser's.
    return v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

/** "12 g", "1.3 mg", or "—" when unknown. */
export function fmtAmount(v: number | null | undefined, unit: string): string {
    const s = fmtNumber(v);
    return s === '—' ? s : `${s} ${unit}`;
}

/**
 * USDA group words that come before the actual food ("Fish, salmon, ...",
 * "Beverages, tea, green"); the food is the next segment.
 */
const GROUP_PREFIXES = /^(fish|nuts|seeds|spices|beverages|mollusks|crustaceans|game meat|alcoholic beverage|cereals ready-to-eat|cereals|cheese|beans)$/i;

/** Filler segments that say nothing to a cook ("broilers or fryers"). */
const FILLER = /^(broilers? or fryers|all classes|mixed species|commercial|nfs|ns as to .*)$/i;

function capitalize(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Split a USDA description into a short name and the qualifying detail:
 * "Fish, salmon, sockeye, raw" -> "Salmon" + "sockeye, raw (fish)";
 * "Chicken, broilers or fryers, breast, meat only" -> "Chicken" + "breast, meat only".
 * Cheese and beans keep their group word ("Cheese, cheddar" -> "Cheddar cheese").
 */
export function splitFoodName(description: string): { name: string; detail: string } {
    description = description.replace(/\s*\(includes foods for usda's food distribution program\)/i, '');
    const segs = description.split(',').map(x => x.trim()).filter(Boolean);
    if (segs.length <= 1) return { name: description.trim(), detail: '' };
    let name = segs[0];
    let rest = segs.slice(1);
    if (GROUP_PREFIXES.test(segs[0]) && segs[1]) {
        const group = segs[0].toLowerCase();
        if (group === 'cheese') name = `${capitalize(segs[1])} cheese`;
        else if (group === 'beans') name = `${capitalize(segs[1])} beans`;
        else name = capitalize(segs[1]);
        rest = segs.slice(2);
    }
    rest = rest.filter(x => !FILLER.test(x));
    return { name, detail: rest.join(', ') };
}

/** Just the short name ("Salmon", "Chicken"). */
export function shortFoodName(description: string): string {
    return splitFoodName(description).name;
}

const SKIP_SERVING = /(^100\s?g$|100\s?g serving|nlea|racc|quart|pint|100 milliliter|as purchased|quantity not specified|yield from|surface inch|cubic inch|^1 lb\b|^1 serving$|^\d+(\.\d+)?\s*(oz|lb|g)$|package|\bcan\b|container \(|bunch|\bhead\b)/i;

/** Household servings worth showing (drops "100g serving", NLEA, plain weights, etc.). */
export function householdServings(food: Food): ServingSize[] {
    return (food.serving_sizes ?? []).filter(s => s.weight_g > 0 && !SKIP_SERVING.test(s.label) && !/^(\d+(\.\d+)?\s+)?extra (small|large)\b/i.test(s.label));
}

/** Countable units read better than volumes ("3 eggs" rather than "1 cup, chopped"). */
const COUNT_UNIT = /^(\d+(\.\d+)?\s+)?(large|medium|small|extra large|jumbo|egg|banana|fruit|piece|slice|fillet|breast|thigh|drumstick|wing|leg|chop|steak|patty|link|spear|clove|cookie|muffin|bagel|tortilla|pita|bar|wedge)\b/i;

const FRACTIONS: [number, string][] = [[0, ''], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, '']];

function fmtQty(q: number): string {
    if (q >= 4) return String(Math.round(q));
    const rounded = Math.round(q * 4) / 4;
    const whole = Math.floor(rounded);
    const frac = rounded - whole;
    const fracStr = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.01)?.[1] ?? '';
    if (whole === 0) return fracStr || '0';
    return `${whole}${fracStr}`;
}

const PLURALS: Record<string, string> = {
    cup: 'cups', slice: 'slices', piece: 'pieces', tablespoon: 'tablespoons', teaspoon: 'teaspoons', link: 'links', tbsp: 'tbsp', tsp: 'tsp',
    fillet: 'fillets', leaf: 'leaves', egg: 'eggs', container: 'containers', banana: 'bananas', fruit: 'fruits', serving: 'servings', stick: 'sticks', steak: 'steaks', wedge: 'wedges', strip: 'strips', head: 'heads', bunch: 'bunches',
    breast: 'breasts', thigh: 'thighs', drumstick: 'drumsticks', wing: 'wings', chop: 'chops', patty: 'patties', stalk: 'stalks', spear: 'spears',
    floweret: 'flowerets', clove: 'cloves', cookie: 'cookies', muffin: 'muffins', bagel: 'bagels', tortilla: 'tortillas', pita: 'pitas', bar: 'bars',
    large: 'large', medium: 'medium', small: 'small',
};

/** A label as it reads inside a sentence: plain words, lower-case qualifiers ("1 banana, peeled"). */
function readableLabel(label: string): string {
    return friendlyServingLabel(label)
        .replace(/, ([A-Z])([a-z])/g, (_m, a: string, b: string) => `, ${a.toLowerCase()}${b}`)
        // Drop measurements in brackets ('(2-7/8" dia)', '(less than 6" long)', '(4" x 5")').
        .replace(/\s*\([^)]*(["”]|\bdia\b|\binch)[^)]*\)/gi, '')
        .replace(/\s*\(\s*\)/g, '')
        .trim();
}

/**
 * Express grams as a household amount, e.g. 228 g broccoli → "≈ 3 cups, chopped",
 * 150 g egg → "≈ 3 large". Returns null if there is no sensible household serving.
 */
export function householdAmount(food: Food, grams: number): string | null {
    const servings = householdServings(food);
    if (!servings.length || grams <= 0) return null;
    // Choose the serving that makes the count closest to ~1.5 units, preferring countable units.
    let best: ServingSize | null = null;
    let bestScore = Infinity;
    for (const s of servings) {
        const m = s.label.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);
        const baseQty = m ? parseFloat(m[1]) : 1;
        const units = (grams / s.weight_g) * baseQty;
        let score = Math.abs(Math.log(Math.max(units, 0.01) / 1.5));
        if (COUNT_UNIT.test(s.label) && units >= 0.75 && units <= 8) score *= 0.4;
        if (/^(\d+(\.\d+)?\s+)?medium\b/i.test(s.label)) score *= 0.9;
        if (units > 8) score += 1;
        if (score < bestScore) { bestScore = score; best = s; }
    }
    if (!best) return null;
    const m = best.label.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);
    const baseQty = m ? parseFloat(m[1]) : 1;
    let rest = readableLabel(m ? m[2] : best.label);
    const units = (grams / best.weight_g) * baseQty;
    if (units < 0.2) return `a little (< ¼ ${rest})`;
    if (units > 1.125) {
        const [first, ...others] = rest.split(/(?=[ ,(])/);
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

/** "Fish, salmon, sockeye, raw" -> "Salmon, sockeye, raw": the name used across the site. */
export function displayFoodName(description: string): string {
    const { name, detail } = splitFoodName(description);
    return detail ? `${name}, ${detail}` : name;
}
