/**
 * Shared food types (no runtime imports, safe for client components).
 *
 * All nutrient values are per 100 g of edible portion.
 * Data contract: `null` means "not measured / missing", `0` means measured zero.
 * `calories` is always present.
 */
export type NutrientValue = number | null;

export interface ServingSize {
    id: number;
    food_id: number;
    label: string;
    weight_g: number;
}

export interface Food {
    id: number;
    fdc_id: number;
    description: string;
    data_type: string;
    food_category: string | null;
    brand_owner: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    calories: number;
    protein_g: NutrientValue;
    total_fat_g: NutrientValue;
    carbohydrate_g: NutrientValue;
    fiber_g: NutrientValue;
    sugars_g: NutrientValue;
    saturated_g: NutrientValue;
    monounsaturated_g: NutrientValue;
    polyunsaturated_g: NutrientValue;
    trans_g: NutrientValue;
    cholesterol_mg: NutrientValue;
    // Vitamins
    vitamin_a_ug: NutrientValue;
    vitamin_c_mg: NutrientValue;
    vitamin_d_ug: NutrientValue;
    vitamin_e_mg: NutrientValue;
    vitamin_k_ug: NutrientValue;
    thiamin_mg: NutrientValue;
    riboflavin_mg: NutrientValue;
    niacin_mg: NutrientValue;
    vitamin_b6_mg: NutrientValue;
    folate_ug: NutrientValue;
    vitamin_b12_ug: NutrientValue;
    pantothenic_acid_mg: NutrientValue;
    /** Column may be added by the DB rebuild; absent in older databases. */
    choline_mg?: NutrientValue;
    // Minerals
    calcium_mg: NutrientValue;
    iron_mg: NutrientValue;
    magnesium_mg: NutrientValue;
    phosphorus_mg: NutrientValue;
    potassium_mg: NutrientValue;
    sodium_mg: NutrientValue;
    zinc_mg: NutrientValue;
    copper_mg: NutrientValue;
    manganese_mg: NutrientValue;
    selenium_ug: NutrientValue;
    // Added by DB schema v2 (absent in older databases)
    water_g?: NutrientValue;
    alcohol_g?: NutrientValue;
    caffeine_mg?: NutrientValue;
    ala_g?: NutrientValue;
    epa_g?: NutrientValue;
    dha_g?: NutrientValue;
    /** Provenance of the calories value, e.g. "fdc_1008_energy". */
    calories_source?: string | null;
    /** 1 Foundation, 2 SR Legacy, 3 FNDDS (lower is better). */
    data_type_rank?: number | null;
    /** Set on SR Legacy rows that have a Foundation equivalent. */
    superseded_by_fdc_id?: number | null;
    ndb_number?: number | null;
    fndds_food_code?: number | null;
    publication_date?: string | null;
    source_release?: string | null;
    serving_sizes?: ServingSize[];
    /**
     * Nutrients this food has no value for in its own record, filled by the server from
     * USDA's older entry for the same food (see lib/nutrient-fill.ts): column -> that
     * entry's fdc_id. Absent when nothing was filled.
     */
    filledFrom?: Record<string, number>;
    /** Set when this "food" is a recipe from the analyzer rather than a USDA row. */
    recipe?: RecipeInPlan;
}

/** What the planner keeps about a recipe, so a plan can link to it and carry its caveats. */
export interface RecipeInPlan {
    /** The recipe's record id: /recipes?id=<id> reopens it. */
    id: string;
    /** Grams in one serving, as the recipe stands now. */
    servingGrams: number;
    /** Ingredients left out of the totals (no amount or no matched food). */
    uncounted: string[];
    /** Nutrient columns whose total is only a lower bound, because an ingredient has no data. */
    incomplete: string[];
    /** Changes whenever the recipe's nutrition does, so a plan built on an older version reads as out of date. */
    fingerprint: string;
}

/** Read a nutrient by column name; undefined/null/non-finite -> null. */
export function nutrientValue(food: Food, key: string): number | null {
    const v = (food as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
