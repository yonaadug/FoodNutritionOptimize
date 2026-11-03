import type { Food } from '../food-types';

/** Every per-100 g nutrient column on the `foods` table. */
export const NUTRIENT_COLUMNS = [
    'calories', 'protein_g', 'total_fat_g', 'carbohydrate_g', 'fiber_g', 'sugars_g',
    'saturated_g', 'monounsaturated_g', 'polyunsaturated_g', 'trans_g', 'cholesterol_mg',
    'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug',
    'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg', 'folate_ug',
    'vitamin_b12_ug', 'pantothenic_acid_mg', 'calcium_mg', 'iron_mg', 'magnesium_mg',
    'phosphorus_mg', 'potassium_mg', 'sodium_mg', 'zinc_mg', 'copper_mg', 'manganese_mg',
    'selenium_ug',
] as const;

/**
 * Build a complete Food for tests. Unspecified nutrients default to 0
 * (a *measured* zero); pass `null` explicitly to model missing data.
 */
export function makeFood(overrides: Partial<Food> & { id: number; description: string }): Food {
    const base: Record<string, unknown> = {
        fdc_id: 100000 + overrides.id,
        data_type: 'foundation_food',
        food_category: 'Test',
        brand_owner: null,
        serving_size: null,
        serving_size_unit: null,
    };
    for (const col of NUTRIENT_COLUMNS) base[col] = 0;
    return { ...base, ...overrides } as Food;
}

// Approximate USDA values per 100 g.
export const chicken = makeFood({
    id: 1, description: 'Chicken Breast, cooked',
    calories: 165, protein_g: 31, total_fat_g: 3.6, saturated_g: 1, cholesterol_mg: 85,
    calcium_mg: 15, iron_mg: 1, magnesium_mg: 29, phosphorus_mg: 228, potassium_mg: 256,
    sodium_mg: 74, zinc_mg: 1, copper_mg: 0.05, manganese_mg: 0.02, selenium_ug: 27.6,
    vitamin_a_ug: 6, vitamin_e_mg: 0.27, vitamin_d_ug: 0.1, thiamin_mg: 0.07,
    riboflavin_mg: 0.12, niacin_mg: 13.7, vitamin_b6_mg: 0.6, vitamin_b12_ug: 0.34, folate_ug: 4,
});

export const broccoli = makeFood({
    id: 2, description: 'Broccoli, raw',
    calories: 34, protein_g: 2.8, total_fat_g: 0.4, carbohydrate_g: 6.6, fiber_g: 2.6, sugars_g: 1.7,
    calcium_mg: 47, iron_mg: 0.73, magnesium_mg: 21, phosphorus_mg: 66, potassium_mg: 316,
    sodium_mg: 33, zinc_mg: 0.41, copper_mg: 0.049, manganese_mg: 0.21, selenium_ug: 2.5,
    vitamin_a_ug: 31, vitamin_e_mg: 0.78, vitamin_c_mg: 89.2, thiamin_mg: 0.071,
    riboflavin_mg: 0.117, niacin_mg: 0.639, vitamin_b6_mg: 0.175, folate_ug: 63, vitamin_k_ug: 101.6,
});

export const oliveOil = makeFood({
    id: 3, description: 'Olive Oil',
    calories: 884, total_fat_g: 100, saturated_g: 13.8, calcium_mg: 1, iron_mg: 0.56,
    potassium_mg: 1, sodium_mg: 2, vitamin_e_mg: 14.35, vitamin_k_ug: 60.2,
});

export const mockFoods: Food[] = [chicken, broccoli, oliveOil];

/** Constraints for every configured nutrient set to a no-op range. */
export function relaxedConstraints(keys: string[]): Record<string, { min?: number; max?: number }> {
    const out: Record<string, { min?: number; max?: number }> = {};
    for (const k of keys) if (k !== 'calories') out[k] = { min: 0, max: 100000 };
    return out;
}
