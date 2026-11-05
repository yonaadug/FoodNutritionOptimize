import type { ServingSize } from './food-types';

/**
 * What "one serving" of a food means, shared by the optimizer's portion cap,
 * the "Good sources" ranking and the UI. No runtime dependencies (safe for
 * client components).
 */

/** Generic gram rows ("100 g", "1 g") that every food carries; not a real portion. */
const GENERIC_GRAM_SERVING = /^\s*\d+(\.\d+)?\s*(g|gram|grams)\s*$/i;

/**
 * Rows that describe a purchase unit, a yield or a measurement rather than
 * something one person eats in a sitting.
 */
const NOT_A_PORTION = /(\b1 lb\b|\blb\b|pound|yield from|surface inch|cubic inch|\broast\b|package|\bquart\b|\bpint\b|gallon|\bloaf\b|whole (cake|pie)|\bcake\b \(|\bpie\b \(|\bcan\b|\bjar\b|bottle|as purchased|\bbunch\b|\bhead\b|\bstalk\b \(large|pizza \()/i;

function usable(servings: ServingSize[] | undefined): ServingSize[] {
    return (servings ?? []).filter(s =>
        typeof s?.weight_g === 'number' && s.weight_g > 0 &&
        !(typeof s.label === 'string' && GENERIC_GRAM_SERVING.test(s.label)));
}

/**
 * Grams of one reference serving: the FDA RACC row when labelled, else the
 * (lower) median of the household rows, ignoring generic "100 g" rows and
 * purchase units ("1 lb", "1 package"). Undefined when the food has no
 * household serving at all.
 */
export function referenceServingGrams(servings: ServingSize[] | undefined): number | undefined {
    return referenceServing(servings)?.weight_g;
}

const isRacc = (s: ServingSize) => typeof s.label === 'string' && /\bRACC\b/i.test(s.label);
const isFluidOunce = (s: ServingSize) => /\bfl\.? ?oz\b/i.test(s.label ?? '');

/** Household rows a person would eat in one sitting (no RACC, purchase units or fluid ounces). */
function portions(servings: ServingSize[] | undefined): ServingSize[] {
    return usable(servings).filter(s => !isRacc(s) && !NOT_A_PORTION.test(s.label ?? '') && !isFluidOunce(s));
}

function median(rows: ServingSize[]): ServingSize | undefined {
    const sorted = rows.slice().sort((a, b) => a.weight_g - b.weight_g);
    return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** The serving row used by referenceServingGrams. */
export function referenceServing(servings: ServingSize[] | undefined): ServingSize | undefined {
    const valid = usable(servings);
    const racc = valid.find(isRacc);
    if (racc) return racc;
    const pool = portions(servings);
    return median(pool.length ? pool : valid.filter(s => !NOT_A_PORTION.test(s.label ?? '')));
}

const PROTEIN_CATEGORY = /(beef|pork|poultry|lamb|veal|game|finfish|shellfish|sausages)/i;
const OUNCE_FOODS = /^(cheese|nuts|seeds)\b/i;

/**
 * A realistic single serving for display and ranking ("1 cup (240 g)"):
 * 3 oz for meat and fish, 1 oz for cheese, nuts and seeds, otherwise the
 * median household portion, then the FDA reference amount (RACC), then 100 g.
 */
export function typicalServing(
    servings: ServingSize[] | undefined,
    food?: { description?: string; food_category?: string | null; calories?: number | null },
): { label: string; grams: number } {
    const rows = portions(servings);
    const oz = (n: number) => rows.find(s => new RegExp(`(^|\\()${n} oz\\b`, 'i').test(s.label));
    let row: ServingSize | undefined;
    if (food && PROTEIN_CATEGORY.test(food.food_category ?? '') && !/\b(sandwich|pizza|dinner|meal)\b/i.test(food.description ?? '')) {
        row = oz(3) ?? oz(4);
        if (!row) return { label: '3 oz', grams: 85 };
    } else if (food && (OUNCE_FOODS.test(food.description ?? '') || /\b(nut|seed) butter\b/i.test(food.description ?? ''))) {
        row = oz(1);
        if (!row) return /butter/i.test(food.description ?? '') ? { label: '2 tbsp', grams: 32 } : { label: '1 oz', grams: 28 };
    }
    row ??= median(rows) ?? usable(servings).find(isRacc);
    // Whole birds, roasts and the like are not one person's serving.
    if (!row || row.weight_g > 300) {
        // Without a household serving, dense foods are eaten in ounces, not 100 g.
        return (food?.calories ?? 0) > 350 ? { label: '1 oz', grams: 28 } : { label: '100 g', grams: 100 };
    }
    return { label: friendlyServingLabel(row.label), grams: Math.max(5, row.weight_g) };
}

/** Replace USDA jargon in a serving label ("1 RACC" -> "1 standard serving"). */
export function friendlyServingLabel(label: string): string {
    return label
        .replace(/\bRACC\b/g, 'standard serving')
        .replace(/^Quantity not specified \(typical portion\)$/i, '1 typical portion')
        .replace(/,?\s*\bNFS\b/g, '')
        .replace(/,\s*pieces of ~1"/, ', bite-size pieces')
        .replace(/,\s*$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
