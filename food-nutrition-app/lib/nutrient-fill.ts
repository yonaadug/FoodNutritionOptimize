/**
 * The one rule for gaps in USDA's newest data. No runtime imports beyond types
 * (safe for client components); lib/db.ts applies it to everything it returns.
 *
 * Foundation foods are carefully measured but sparse: 80% have no vitamin D value and
 * "Garlic, raw" has no minerals at all, while the SR Legacy entry they replaced usually
 * has a full profile. So a food has one set of values on every page:
 *
 *   - A value the food has is kept, always, including a measured 0.
 *   - A null is filled from the older USDA entry it supersedes, when that entry has one.
 *   - Every filled nutrient is listed in `filledFrom`, so each place that shows it can say so,
 *     and the food page can cite the entry it came from.
 *   - Calories are never null: when a Foundation food reports no energy, the database build
 *     takes the older entry's (`calories_source` says so), and they are listed in `filledFrom` too.
 *
 * Nothing is written back: nutrition.db stays as USDA published it.
 */
import type { Food } from './food-types';

/** Every per-100 g nutrient column that can be filled. */
export const FILLABLE_NUTRIENTS = [
    'calories', 'protein_g', 'total_fat_g', 'carbohydrate_g', 'fiber_g', 'sugars_g',
    'saturated_g', 'monounsaturated_g', 'polyunsaturated_g', 'trans_g', 'cholesterol_mg',
    'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug',
    'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug',
    'pantothenic_acid_mg', 'choline_mg',
    'calcium_mg', 'iron_mg', 'magnesium_mg', 'phosphorus_mg', 'potassium_mg', 'sodium_mg',
    'zinc_mg', 'copper_mg', 'manganese_mg', 'selenium_ug',
    'water_g', 'alcohol_g', 'caffeine_mg', 'ala_g', 'epa_g', 'dha_g',
] as const;

/** `calories_source` values for calories the build took from the older entry (scripts/nutrient_spec.py). */
export const OLDER_ENTRY_CALORIE_SOURCES: readonly string[] = ['sr_legacy_ndb_match_1008', 'sr_legacy_crosswalk_1008'];

/** What the page says wherever a filled value appears. */
export const OLDER_ENTRY_NOTE = 'from USDA’s older entry for this food';

function isNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * `food` with its nulls filled from `olderEntries`, earliest first. Safe to apply twice.
 * A column absent from an older database stays absent: only an explicit null is a gap.
 */
export function fillFromOlderEntries<T extends Food>(food: T, olderEntries: readonly Food[]): T {
    if (olderEntries.length === 0) return food;
    const own = food as unknown as Record<string, unknown>;
    const filled: Record<string, number> = {};
    const from: Record<string, number> = {};
    for (const key of FILLABLE_NUTRIENTS) {
        if (own[key] !== null) continue;
        const donor = olderEntries.find(d => isNumber((d as unknown as Record<string, unknown>)[key]));
        if (!donor) continue;
        filled[key] = (donor as unknown as Record<string, number>)[key];
        from[key] = donor.fdc_id;
    }
    // The build already copied these calories in; find the entry they came from (same value).
    if (food.filledFrom?.calories === undefined && OLDER_ENTRY_CALORIE_SOURCES.includes(food.calories_source ?? '')) {
        const donor = olderEntries.find(d => isNumber(d.calories) && isNumber(food.calories) && Math.abs(d.calories - food.calories) < 0.011)
            ?? olderEntries.find(d => isNumber(d.calories));
        if (donor) from.calories = donor.fdc_id;
    }
    if (Object.keys(from).length === 0) return food;
    return { ...food, ...filled, filledFrom: { ...food.filledFrom, ...from } };
}

/** Is this value from an older USDA entry rather than the food's own record? */
export function isFilled(food: Pick<Food, 'filledFrom'> | null | undefined, key: string): boolean {
    return !!food?.filledFrom && food.filledFrom[key] !== undefined;
}

/** The nutrients of `keys` (default: all) that came from an older entry. */
export function filledKeys(food: Pick<Food, 'filledFrom'> | null | undefined, keys?: readonly string[]): string[] {
    if (!food?.filledFrom) return [];
    const from = food.filledFrom;
    return keys ? keys.filter(k => from[k] !== undefined) : Object.keys(from);
}

/** One older USDA entry that supplied some of a food's values, and which ones (in FILLABLE_NUTRIENTS order). */
export interface OlderEntrySource {
    fdcId: number;
    keys: string[];
}

/** The older entries a food's values came from, the one that supplied the most first: what its page cites. */
export function olderEntrySources(food: Pick<Food, 'filledFrom'> | null | undefined): OlderEntrySource[] {
    if (!food?.filledFrom) return [];
    const rank = (k: string) => {
        const i = (FILLABLE_NUTRIENTS as readonly string[]).indexOf(k);
        return i < 0 ? FILLABLE_NUTRIENTS.length : i;
    };
    const byEntry = new Map<number, string[]>();
    for (const key of Object.keys(food.filledFrom).sort((a, b) => rank(a) - rank(b))) {
        const id = food.filledFrom[key];
        const keys = byEntry.get(id);
        if (keys) keys.push(key);
        else byEntry.set(id, [key]);
    }
    return [...byEntry].map(([fdcId, keys]) => ({ fdcId, keys })).sort((a, b) => b.keys.length - a.keys.length || a.fdcId - b.fdcId);
}
