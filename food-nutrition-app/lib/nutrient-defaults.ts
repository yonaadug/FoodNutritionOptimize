export type ConstraintType = 'min' | 'max';

export interface NutrientConfig {
    label: string;
    unit: string;
    defaultValue: number;
    defaultType: ConstraintType;
}

export const NUTRIENT_CONFIG: Record<string, NutrientConfig> = {
    calories: {
        label: 'Calories',
        unit: 'kcal',
        defaultValue: 2000,
        defaultType: 'max'
    },
    total_fat_g: {
        label: 'Total Fat',
        unit: 'g',
        defaultValue: 78,
        defaultType: 'max' // Often treated as a limit in some contexts, but FDA has a DV. Let's say Max for fat to be healthy? Or Min? FDA DV is usually a "limit" for Fat, but for "Total Fat" it's often a guideline. Let's stick to 'max' for fats generally in a "healthy" context, or 'min' if we want to ensure enough. The previous logic had it as 'min' (target). Let's keep previous logic: 'min' for most, 'max' for specific bad ones.
        // Wait, previous logic:
        // if (['sodium_mg', 'cholesterol_mg', 'saturated_g'].includes(nutrient)) -> MAX
        // else -> MIN
        // So Total Fat was MIN.
    },
    saturated_g: {
        label: 'Saturated Fat',
        unit: 'g',
        defaultValue: 20,
        defaultType: 'max'
    },
    cholesterol_mg: {
        label: 'Cholesterol',
        unit: 'mg',
        defaultValue: 300,
        defaultType: 'max'
    },
    sodium_mg: {
        label: 'Sodium',
        unit: 'mg',
        defaultValue: 2300,
        defaultType: 'max'
    },
    carbohydrate_g: {
        label: 'Carbohydrate',
        unit: 'g',
        defaultValue: 275,
        defaultType: 'min'
    },
    fiber_g: {
        label: 'Fiber',
        unit: 'g',
        defaultValue: 28,
        defaultType: 'min'
    },
    sugars_g: {
        label: 'Sugars',
        unit: 'g',
        defaultValue: 50,
        defaultType: 'max' // Added sugars usually max.
    },
    protein_g: {
        label: 'Protein',
        unit: 'g',
        defaultValue: 50,
        defaultType: 'min'
    },
    vitamin_d_ug: {
        label: 'Vitamin D',
        unit: 'mcg',
        defaultValue: 20,
        defaultType: 'min'
    },
    calcium_mg: {
        label: 'Calcium',
        unit: 'mg',
        defaultValue: 1300,
        defaultType: 'min'
    },
    iron_mg: {
        label: 'Iron',
        unit: 'mg',
        defaultValue: 18,
        defaultType: 'min'
    },
    potassium_mg: {
        label: 'Potassium',
        unit: 'mg',
        defaultValue: 4700,
        defaultType: 'min'
    },
    vitamin_a_ug: {
        label: 'Vitamin A',
        unit: 'mcg',
        defaultValue: 900,
        defaultType: 'min'
    },
    vitamin_c_mg: {
        label: 'Vitamin C',
        unit: 'mg',
        defaultValue: 90,
        defaultType: 'min'
    },
    vitamin_e_mg: {
        label: 'Vitamin E',
        unit: 'mg',
        defaultValue: 15,
        defaultType: 'min'
    },
    vitamin_k_ug: {
        label: 'Vitamin K',
        unit: 'mcg',
        defaultValue: 120,
        defaultType: 'min'
    },
    thiamin_mg: {
        label: 'Thiamin',
        unit: 'mg',
        defaultValue: 1.2,
        defaultType: 'min'
    },
    riboflavin_mg: {
        label: 'Riboflavin',
        unit: 'mg',
        defaultValue: 1.3,
        defaultType: 'min'
    },
    niacin_mg: {
        label: 'Niacin',
        unit: 'mg',
        defaultValue: 16,
        defaultType: 'min'
    },
    vitamin_b6_mg: {
        label: 'Vitamin B6',
        unit: 'mg',
        defaultValue: 1.7,
        defaultType: 'min'
    },
    folate_ug: {
        label: 'Folate',
        unit: 'mcg',
        defaultValue: 400,
        defaultType: 'min'
    },
    vitamin_b12_ug: {
        label: 'Vitamin B12',
        unit: 'mcg',
        defaultValue: 2.4,
        defaultType: 'min'
    },
    magnesium_mg: {
        label: 'Magnesium',
        unit: 'mg',
        defaultValue: 420,
        defaultType: 'min'
    },
    zinc_mg: {
        label: 'Zinc',
        unit: 'mg',
        defaultValue: 11,
        defaultType: 'min'
    },
    copper_mg: {
        label: 'Copper',
        unit: 'mg',
        defaultValue: 0.9,
        defaultType: 'min'
    },
    manganese_mg: {
        label: 'Manganese',
        unit: 'mg',
        defaultValue: 2.3,
        defaultType: 'min'
    },
    selenium_ug: {
        label: 'Selenium',
        unit: 'mcg',
        defaultValue: 55,
        defaultType: 'min'
    }
};

// Helper to get simple key-value pairs for backward compatibility if needed
export const DAILY_VALUES: Record<string, number> = Object.entries(NUTRIENT_CONFIG).reduce((acc, [key, config]) => {
    if (key !== 'calories') { // Exclude calories from standard nutrient list if needed, but usually it's fine.
        acc[key] = config.defaultValue;
    }
    return acc;
}, {} as Record<string, number>);
