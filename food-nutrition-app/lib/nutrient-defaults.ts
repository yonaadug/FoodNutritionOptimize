/**
 * Nutrient reference values used as default optimizer goals.
 *
 * Sources
 * -------
 * [DV]  FDA Daily Values for adults and children >= 4 years, 2016 Nutrition
 *       Facts rule (81 FR 33742):
 *         - RDIs (vitamins/minerals): 21 CFR 101.9(c)(8)(iv)
 *         - DRVs (macronutrients, sodium, cholesterol, fiber): 21 CFR 101.9(c)(9)
 *       https://www.ecfr.gov/current/title-21/part-101/section-101.9
 * [UL]  Tolerable Upper Intake Levels, adults >= 19 y, National Academies (NASEM)
 *       DRI reports as summarised by NIH Office of Dietary Supplements fact sheets
 *       (https://ods.od.nih.gov/factsheets/list-all/) and the NASEM DRI summary
 *       tables (https://www.ncbi.nlm.nih.gov/books/NBK545442/).
 *
 * Data caveats (how the USDA columns relate to the DV basis)
 * ----------------------------------------------------------
 * - sugars_g is USDA nutrient 269 "Sugars, total". The FDA DV of 50 g is for
 *   *added* sugars only and there is no DV for total sugars, so the default
 *   cap is disabled by default (defaultEnabled: false).
 * - folate_ug is USDA 417 "Folate, total" (mcg); the DV is in mcg DFE. For
 *   unfortified foods they are equal; for folic-acid-fortified foods total
 *   folate under-counts DFE (DFE = food folate + 1.7 x folic acid).
 * - niacin_mg is USDA 406 (preformed niacin); the DV is in mg niacin
 *   equivalents (NE, includes tryptophan/60), so totals are conservative.
 * - vitamin_a_ug is USDA 320 "Vitamin A, RAE" which matches the DV basis.
 */

export type ConstraintType = 'min' | 'max';

/**
 * Which intake a UL applies to.
 *  - 'total'        : food + supplements; safe to use as a hard cap on a diet.
 *  - 'supplemental' : only synthetic/supplemental forms (or fortificants).
 *                     Must NOT be used as a cap on nutrients from whole foods.
 *  - 'preformed'    : vitamin A UL applies to preformed retinol only, while the
 *                     food column is RAE (includes provitamin-A carotenoids).
 *                     Must NOT be used as a cap on the RAE column.
 */
export type UpperLimitScope = 'total' | 'supplemental' | 'preformed';

export interface UpperLimit {
    value: number;
    appliesTo: UpperLimitScope;
    note?: string;
}

export interface NutrientConfig {
    label: string;
    unit: string;
    /** Default goal value (the FDA DV unless noted). */
    defaultValue: number;
    defaultType: ConstraintType;
    /**
     * When false, the optimizer does not apply this default unless the client
     * explicitly sends a constraint for it. Omitted means true.
     */
    defaultEnabled?: boolean;
    /** Tolerable Upper Intake Level for adults (>= 19 y), if one exists. */
    ul?: UpperLimit;
    /** Short citation for defaultValue. */
    source?: string;
}

const DV_RDI = 'FDA DV, 21 CFR 101.9(c)(8)(iv)';
const DV_DRV = 'FDA DV, 21 CFR 101.9(c)(9)';

export const NUTRIENT_CONFIG: Record<string, NutrientConfig> = {
    calories: {
        label: 'Calories',
        unit: 'kcal',
        // 2,000 kcal is the reference intake the DRVs are based on
        // (21 CFR 101.9(d)(9)); it is not a requirement, so the optimizer only
        // applies a calorie bound when the client sends one.
        defaultValue: 2000,
        defaultType: 'max',
        defaultEnabled: false,
        source: 'FDA reference 2,000 kcal diet',
    },
    total_fat_g: {
        label: 'Total Fat',
        unit: 'g',
        // DRV 78 g (35% of 2,000 kcal). Treated as an upper bound, consistent
        // with the AMDR upper end of 35% of energy.
        defaultValue: 78,
        defaultType: 'max',
        source: DV_DRV,
    },
    saturated_g: {
        label: 'Saturated Fat',
        unit: 'g',
        defaultValue: 20,
        defaultType: 'max',
        source: DV_DRV,
    },
    cholesterol_mg: {
        label: 'Cholesterol',
        unit: 'mg',
        defaultValue: 300,
        defaultType: 'max',
        source: DV_DRV,
    },
    sodium_mg: {
        label: 'Sodium',
        unit: 'mg',
        // 2,300 mg is also the NASEM (2019) Chronic Disease Risk Reduction
        // intake; sodium no longer has a UL.
        defaultValue: 2300,
        defaultType: 'max',
        source: DV_DRV,
    },
    carbohydrate_g: {
        label: 'Carbohydrate',
        unit: 'g',
        // DRV 275 g (55% of 2,000 kcal). Note the RDA is only 130 g/day, so
        // using the DV as a *minimum* is a strong default.
        defaultValue: 275,
        defaultType: 'min',
        source: DV_DRV,
    },
    fiber_g: {
        label: 'Fiber',
        unit: 'g',
        defaultValue: 28,
        defaultType: 'min',
        source: DV_DRV,
    },
    sugars_g: {
        label: 'Total Sugars',
        unit: 'g',
        // The 50 g DV is for ADDED sugars; this column is TOTAL sugars
        // (incl. fruit/milk sugars) which has no DV. Kept for users who want a
        // cap, but not applied by default.
        defaultValue: 50,
        defaultType: 'max',
        defaultEnabled: false,
        source: `${DV_DRV} (added sugars)`,
    },
    protein_g: {
        label: 'Protein',
        unit: 'g',
        defaultValue: 50,
        defaultType: 'min',
        source: DV_DRV,
    },
    vitamin_d_ug: {
        label: 'Vitamin D',
        unit: 'mcg',
        defaultValue: 20,
        defaultType: 'min',
        ul: { value: 100, appliesTo: 'total', note: '100 mcg = 4,000 IU' },
        source: DV_RDI,
    },
    calcium_mg: {
        label: 'Calcium',
        unit: 'mg',
        defaultValue: 1300,
        defaultType: 'min',
        ul: { value: 2500, appliesTo: 'total', note: '19-50 y; 2,000 mg for 51+ y' },
        source: DV_RDI,
    },
    iron_mg: {
        label: 'Iron',
        unit: 'mg',
        defaultValue: 18,
        defaultType: 'min',
        ul: { value: 45, appliesTo: 'total' },
        source: DV_RDI,
    },
    potassium_mg: {
        label: 'Potassium',
        unit: 'mg',
        // FDA DV is still 4,700 mg (2016 rule); NASEM 2019 lowered the AI to
        // 3,400 mg (men) / 2,600 mg (women). No UL for potassium from food.
        defaultValue: 4700,
        defaultType: 'min',
        source: DV_RDI,
    },
    vitamin_a_ug: {
        label: 'Vitamin A',
        unit: 'mcg',
        defaultValue: 900, // mcg RAE
        defaultType: 'min',
        ul: {
            value: 3000,
            appliesTo: 'preformed',
            note: 'UL is for preformed vitamin A (retinol) only; this column is RAE incl. carotenoids',
        },
        source: DV_RDI,
    },
    vitamin_c_mg: {
        label: 'Vitamin C',
        unit: 'mg',
        defaultValue: 90,
        defaultType: 'min',
        ul: { value: 2000, appliesTo: 'total' },
        source: DV_RDI,
    },
    vitamin_e_mg: {
        label: 'Vitamin E',
        unit: 'mg',
        defaultValue: 15, // mg alpha-tocopherol
        defaultType: 'min',
        ul: { value: 1000, appliesTo: 'supplemental', note: 'Any form of supplemental alpha-tocopherol' },
        source: DV_RDI,
    },
    vitamin_k_ug: {
        label: 'Vitamin K',
        unit: 'mcg',
        defaultValue: 120, // no UL established
        defaultType: 'min',
        source: DV_RDI,
    },
    thiamin_mg: {
        label: 'Thiamin',
        unit: 'mg',
        defaultValue: 1.2, // no UL established
        defaultType: 'min',
        source: DV_RDI,
    },
    riboflavin_mg: {
        label: 'Riboflavin',
        unit: 'mg',
        defaultValue: 1.3, // no UL established
        defaultType: 'min',
        source: DV_RDI,
    },
    niacin_mg: {
        label: 'Niacin',
        unit: 'mg',
        defaultValue: 16, // mg NE
        defaultType: 'min',
        ul: { value: 35, appliesTo: 'supplemental', note: 'Supplements and fortified foods only' },
        source: DV_RDI,
    },
    vitamin_b6_mg: {
        label: 'Vitamin B6',
        unit: 'mg',
        defaultValue: 1.7,
        defaultType: 'min',
        ul: { value: 100, appliesTo: 'total' },
        source: DV_RDI,
    },
    folate_ug: {
        label: 'Folate',
        unit: 'mcg',
        defaultValue: 400, // mcg DFE
        defaultType: 'min',
        ul: { value: 1000, appliesTo: 'supplemental', note: 'Synthetic folic acid (supplements/fortified foods) only' },
        source: DV_RDI,
    },
    vitamin_b12_ug: {
        label: 'Vitamin B12',
        unit: 'mcg',
        defaultValue: 2.4, // no UL established
        defaultType: 'min',
        source: DV_RDI,
    },
    magnesium_mg: {
        label: 'Magnesium',
        unit: 'mg',
        defaultValue: 420,
        defaultType: 'min',
        ul: { value: 350, appliesTo: 'supplemental', note: 'Supplements/pharmacological agents only; no UL for food magnesium' },
        source: DV_RDI,
    },
    zinc_mg: {
        label: 'Zinc',
        unit: 'mg',
        defaultValue: 11,
        defaultType: 'min',
        ul: { value: 40, appliesTo: 'total' },
        source: DV_RDI,
    },
    copper_mg: {
        label: 'Copper',
        unit: 'mg',
        defaultValue: 0.9,
        defaultType: 'min',
        ul: { value: 10, appliesTo: 'total', note: '10,000 mcg' },
        source: DV_RDI,
    },
    manganese_mg: {
        label: 'Manganese',
        unit: 'mg',
        defaultValue: 2.3,
        defaultType: 'min',
        ul: { value: 11, appliesTo: 'total' },
        source: DV_RDI,
    },
    selenium_ug: {
        label: 'Selenium',
        unit: 'mcg',
        defaultValue: 55,
        defaultType: 'min',
        ul: { value: 400, appliesTo: 'total' },
        source: DV_RDI,
    },
};

/**
 * Nutrients that have an FDA DV and a column (or a planned column) in the
 * foods table but are NOT default optimizer goals. They are kept out of
 * NUTRIENT_CONFIG so existing UIs that turn every NUTRIENT_CONFIG entry into
 * a default goal do not suddenly impose them; the optimizer accepts and
 * reports them when a client sends an explicit constraint.
 * (choline_mg is a column Section A may add; until then foods lack it and
 * any choline goal will produce missing-data warnings.)
 */
export const OPTIONAL_NUTRIENT_CONFIG: Record<string, NutrientConfig> = {
    phosphorus_mg: {
        label: 'Phosphorus',
        unit: 'mg',
        defaultValue: 1250,
        defaultType: 'min',
        defaultEnabled: false,
        ul: { value: 4000, appliesTo: 'total', note: '19-70 y; 3,000 mg for 71+ y' },
        source: DV_RDI,
    },
    pantothenic_acid_mg: {
        label: 'Pantothenic Acid',
        unit: 'mg',
        defaultValue: 5, // no UL established
        defaultType: 'min',
        defaultEnabled: false,
        source: DV_RDI,
    },
    choline_mg: {
        label: 'Choline',
        unit: 'mg',
        defaultValue: 550,
        defaultType: 'min',
        defaultEnabled: false,
        ul: { value: 3500, appliesTo: 'total' },
        source: DV_RDI,
    },
};

/** Every nutrient the optimizer understands (defaults first). */
export const ALL_NUTRIENT_CONFIG: Record<string, NutrientConfig> = {
    ...NUTRIENT_CONFIG,
    ...OPTIONAL_NUTRIENT_CONFIG,
};

/** True if this nutrient's UL may be used as a hard cap on whole-food intake. */
export function isFoodSafeUpperLimit(config: NutrientConfig): boolean {
    return config.ul?.appliesTo === 'total';
}

// Helper to get simple key-value pairs for backward compatibility if needed
export const DAILY_VALUES: Record<string, number> = Object.entries(NUTRIENT_CONFIG).reduce((acc, [key, config]) => {
    if (key !== 'calories') {
        acc[key] = config.defaultValue;
    }
    return acc;
}, {} as Record<string, number>);
