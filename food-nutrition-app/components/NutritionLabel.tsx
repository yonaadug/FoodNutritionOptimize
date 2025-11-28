'use client';

import type { Food } from '@/lib/db';

interface NutritionLabelProps {
    food: Food;
}

// Daily Values based on FDA recommendations for a 2,000 calorie diet (General/Male reference)
const DAILY_VALUES = {
    total_fat_g: 78,
    saturated_g: 20,
    cholesterol_mg: 300,
    sodium_mg: 2300,
    carbohydrate_g: 275,
    fiber_g: 28,
    sugars_g: 50, // Added sugars limit, using as proxy
    protein_g: 50,
    vitamin_d_ug: 20,
    calcium_mg: 1300,
    iron_mg: 18,
    potassium_mg: 4700,

    // New Vitamins & Minerals
    vitamin_a_ug: 900,
    vitamin_c_mg: 90,
    vitamin_e_mg: 15,
    vitamin_k_ug: 120,
    thiamin_mg: 1.2,
    riboflavin_mg: 1.3,
    niacin_mg: 16,
    vitamin_b6_mg: 1.7,
    folate_ug: 400,
    vitamin_b12_ug: 2.4,
    pantothenic_acid_mg: 5,

    magnesium_mg: 420,
    zinc_mg: 11,
    copper_mg: 0.9,
    manganese_mg: 2.3,
    selenium_ug: 55
};

export default function NutritionLabel({ food }: NutritionLabelProps) {
    const servingText = food.serving_size
        ? `${food.serving_size}${food.serving_size_unit || 'g'}`
        : '100g';

    const calculateDV = (value: number, nutrient: keyof typeof DAILY_VALUES) => {
        if (!value) return 0;
        const dv = DAILY_VALUES[nutrient];
        return Math.round((value / dv) * 100);
    };

    return (
        <div style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            borderRadius: '8px',
            padding: '16px',
            fontFamily: 'Helvetica, Arial, sans-serif',
            border: '2px solid var(--text-primary)'
        }}>
            {/* Title */}
            <div style={{
                borderBottom: '8px solid var(--text-primary)',
                paddingBottom: '4px',
                marginBottom: '8px'
            }}>
                <h4 style={{ fontSize: '28px', fontWeight: '900', margin: 0 }}>Nutrition Facts</h4>
                <p style={{ fontSize: '14px', margin: '4px 0 0 0', fontWeight: 'bold' }}>Serving size <span style={{ float: 'right' }}>{servingText}</span></p>
            </div>

            {/* Calories */}
            <div style={{
                borderBottom: '4px solid var(--text-primary)',
                paddingBottom: '4px',
                marginBottom: '8px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Amount per serving</div>
                        <div style={{ fontSize: '24px', fontWeight: '900' }}>Calories</div>
                    </div>
                    <span style={{ fontSize: '36px', fontWeight: '900', lineHeight: 1 }}>{Math.round(food.calories)}</span>
                </div>
            </div>

            {/* Macronutrients */}
            <div style={{ fontSize: '13px', borderBottom: '1px solid var(--text-primary)', paddingBottom: '4px', marginBottom: '4px' }}>
                <div style={{ fontWeight: '700', textAlign: 'right', marginBottom: '4px' }}>% Daily Value*</div>
            </div>

            <NutrientRow label="Total Fat" value={food.total_fat_g} unit="g" dv={calculateDV(food.total_fat_g, 'total_fat_g')} bold />
            <NutrientRow label="Saturated Fat" value={food.saturated_g} unit="g" dv={calculateDV(food.saturated_g, 'saturated_g')} indent />
            <NutrientRow label="Trans Fat" value={food.trans_g} unit="g" indent />
            <NutrientRow label="Cholesterol" value={food.cholesterol_mg} unit="mg" dv={calculateDV(food.cholesterol_mg, 'cholesterol_mg')} bold />
            <NutrientRow label="Sodium" value={food.sodium_mg} unit="mg" dv={calculateDV(food.sodium_mg, 'sodium_mg')} bold />
            <NutrientRow label="Total Carbohydrate" value={food.carbohydrate_g} unit="g" dv={calculateDV(food.carbohydrate_g, 'carbohydrate_g')} bold />
            <NutrientRow label="Dietary Fiber" value={food.fiber_g} unit="g" dv={calculateDV(food.fiber_g, 'fiber_g')} indent />
            <NutrientRow label="Total Sugars" value={food.sugars_g} unit="g" indent />
            <NutrientRow label="Protein" value={food.protein_g} unit="g" bold noBorder />

            {/* Divider */}
            <div style={{ borderTop: '8px solid var(--text-primary)', margin: '8px 0' }} />

            {/* Vitamins & Minerals */}
            <div style={{ fontSize: '13px' }}>
                <MicronutrientRow label="Vitamin D" value={food.vitamin_d_ug} unit="mcg" dv={calculateDV(food.vitamin_d_ug, 'vitamin_d_ug')} />
                <MicronutrientRow label="Calcium" value={food.calcium_mg} unit="mg" dv={calculateDV(food.calcium_mg, 'calcium_mg')} />
                <MicronutrientRow label="Iron" value={food.iron_mg} unit="mg" dv={calculateDV(food.iron_mg, 'iron_mg')} />
                <MicronutrientRow label="Potassium" value={food.potassium_mg} unit="mg" dv={calculateDV(food.potassium_mg, 'potassium_mg')} />

                <MicronutrientRow label="Vitamin A" value={food.vitamin_a_ug} unit="mcg" dv={calculateDV(food.vitamin_a_ug, 'vitamin_a_ug')} />
                <MicronutrientRow label="Vitamin C" value={food.vitamin_c_mg} unit="mg" dv={calculateDV(food.vitamin_c_mg, 'vitamin_c_mg')} />
                <MicronutrientRow label="Vitamin E" value={food.vitamin_e_mg} unit="mg" dv={calculateDV(food.vitamin_e_mg, 'vitamin_e_mg')} />
                <MicronutrientRow label="Vitamin K" value={food.vitamin_k_ug} unit="mcg" dv={calculateDV(food.vitamin_k_ug, 'vitamin_k_ug')} />

                <MicronutrientRow label="Thiamin" value={food.thiamin_mg} unit="mg" dv={calculateDV(food.thiamin_mg, 'thiamin_mg')} />
                <MicronutrientRow label="Riboflavin" value={food.riboflavin_mg} unit="mg" dv={calculateDV(food.riboflavin_mg, 'riboflavin_mg')} />
                <MicronutrientRow label="Niacin" value={food.niacin_mg} unit="mg" dv={calculateDV(food.niacin_mg, 'niacin_mg')} />
                <MicronutrientRow label="Vitamin B6" value={food.vitamin_b6_mg} unit="mg" dv={calculateDV(food.vitamin_b6_mg, 'vitamin_b6_mg')} />
                <MicronutrientRow label="Folate" value={food.folate_ug} unit="mcg" dv={calculateDV(food.folate_ug, 'folate_ug')} />
                <MicronutrientRow label="Vitamin B12" value={food.vitamin_b12_ug} unit="mcg" dv={calculateDV(food.vitamin_b12_ug, 'vitamin_b12_ug')} />

                <MicronutrientRow label="Magnesium" value={food.magnesium_mg} unit="mg" dv={calculateDV(food.magnesium_mg, 'magnesium_mg')} />
                <MicronutrientRow label="Zinc" value={food.zinc_mg} unit="mg" dv={calculateDV(food.zinc_mg, 'zinc_mg')} />
                <MicronutrientRow label="Copper" value={food.copper_mg} unit="mg" dv={calculateDV(food.copper_mg, 'copper_mg')} />
                <MicronutrientRow label="Manganese" value={food.manganese_mg} unit="mg" dv={calculateDV(food.manganese_mg, 'manganese_mg')} />
                <MicronutrientRow label="Selenium" value={food.selenium_ug} unit="mcg" dv={calculateDV(food.selenium_ug, 'selenium_ug')} />
            </div>

            {/* Footer */}
            <div style={{
                borderTop: '4px solid var(--text-primary)',
                marginTop: '8px',
                paddingTop: '4px',
                fontSize: '10px',
                lineHeight: '1.3'
            }}>
                * The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is used for general nutrition advice.
            </div>
        </div>
    );
}

function NutrientRow({
    label,
    value,
    unit,
    dv,
    bold = false,
    indent = false,
    noBorder = false
}: {
    label: string;
    value: number;
    unit: string;
    dv?: number;
    bold?: boolean;
    indent?: boolean;
    noBorder?: boolean;
}) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '4px 0',
            borderBottom: noBorder ? 'none' : '1px solid var(--text-muted)',
            fontSize: '13px',
            paddingLeft: indent ? '16px' : '0',
            fontWeight: bold ? '700' : '400'
        }}>
            <span>{label} <span style={{ fontWeight: '400' }}>{value?.toFixed(1)}{unit}</span></span>
            {dv !== undefined && <span style={{ fontWeight: '700' }}>{dv}%</span>}
        </div>
    );
}

function MicronutrientRow({
    label,
    value,
    unit,
    dv
}: {
    label: string;
    value: number;
    unit: string;
    dv?: number;
}) {
    if (!value) return null;

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '2px 0',
            fontSize: '11px'
        }}>
            <span>{label} <span style={{ color: 'var(--text-secondary)' }}>{value.toFixed(1)}{unit}</span></span>
            {dv !== undefined && <span style={{ fontWeight: '700' }}>{dv}%</span>}
        </div>
    );
}
