'use client';

import type { Food } from '@/lib/db';
import { amountFor, dailyValue, fmtNumber, hasCoreData, nutrientLabel, nutrientUnit } from '@/components/planner/nutrients';

interface NutritionLabelProps {
    food: Food;
    /** Amount the label describes, in grams (default 100 g). */
    grams?: number;
    /** Text shown as the serving size, e.g. "1 cup, chopped (91 g)". */
    servingLabel?: string;
}

const MAIN: { key: string; label?: string; bold?: boolean; indent?: boolean; dv?: boolean }[] = [
    { key: 'total_fat_g', label: 'Total Fat', bold: true, dv: true },
    { key: 'saturated_g', label: 'Saturated Fat', indent: true, dv: true },
    { key: 'trans_g', label: 'Trans Fat', indent: true },
    { key: 'cholesterol_mg', bold: true, dv: true },
    { key: 'sodium_mg', bold: true, dv: true },
    { key: 'carbohydrate_g', label: 'Total Carbohydrate', bold: true, dv: true },
    { key: 'fiber_g', label: 'Dietary Fiber', indent: true, dv: true },
    { key: 'sugars_g', label: 'Total Sugars', indent: true },
    { key: 'protein_g', bold: true },
];

const MICROS = [
    'vitamin_d_ug', 'calcium_mg', 'iron_mg', 'potassium_mg', 'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_e_mg', 'vitamin_k_ug',
    'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug', 'pantothenic_acid_mg',
    'choline_mg', 'magnesium_mg', 'phosphorus_mg', 'zinc_mg', 'copper_mg', 'manganese_mg', 'selenium_ug',
];

const EXTRA_UNITS: Record<string, string> = { trans_g: 'g', pantothenic_acid_mg: 'mg', phosphorus_mg: 'mg', choline_mg: 'mg' };

function unitOf(key: string) {
    return EXTRA_UNITS[key] ?? nutrientUnit(key);
}

/**
 * FDA-style Nutrition Facts label. Missing values show "—" (no data), never 0.
 */
export default function NutritionLabel({ food, grams = 100, servingLabel }: NutritionLabelProps) {
    const val = (key: string) => amountFor(food, key, grams);
    const dvPct = (key: string, v: number | null) => {
        const dv = dailyValue(key);
        if (v === null || !dv) return null;
        return Math.round((v / dv) * 100);
    };
    const kcal = val('calories');

    return (
        <div className="nutrition-label" style={{
            background: 'var(--bg-card)', color: 'var(--text-primary)', borderRadius: 8, padding: 14,
            fontFamily: 'Helvetica, Arial, sans-serif', border: '2px solid var(--text-primary)', fontSize: 13,
        }}>
            <div style={{ borderBottom: '8px solid var(--text-primary)', paddingBottom: 4, marginBottom: 6 }}>
                <h4 style={{ fontSize: 26, fontWeight: 900, margin: 0, letterSpacing: '-0.01em' }}>Nutrition Facts</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700, fontSize: 14, marginTop: 4 }}>
                    <span>Serving size</span>
                    <span style={{ textAlign: 'right' }}>{servingLabel ?? `${fmtNumber(grams)} g`}</span>
                </div>
            </div>

            {!hasCoreData(food) && (
                <p style={{ fontSize: 11, background: 'var(--warning-bg)', color: 'var(--warning)', padding: '6px 8px', borderRadius: 4, margin: '0 0 6px' }}>
                    USDA has limited data for this food. &ldquo;—&rdquo; means not measured.
                </p>
            )}

            <div style={{ borderBottom: '4px solid var(--text-primary)', paddingBottom: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Amount per serving</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>Calories</div>
                </div>
                <span style={{ fontSize: 34, fontWeight: 900, lineHeight: 1 }}>{fmtNumber(kcal, { decimals: 0 })}</span>
            </div>

            <div style={{ fontWeight: 700, textAlign: 'right', borderBottom: '1px solid var(--text-primary)', padding: '2px 0' }}>% Daily Value*</div>

            {MAIN.map(row => {
                const v = val(row.key);
                const pct = row.dv ? dvPct(row.key, v) : null;
                return (
                    <div key={row.key} style={{
                        display: 'flex', justifyContent: 'space-between', padding: '3px 0',
                        borderBottom: row.key === 'protein_g' ? 'none' : '1px solid var(--border-strong)',
                        paddingLeft: row.indent ? 14 : 0, fontWeight: row.bold ? 700 : 400,
                    }}>
                        <span>{row.label ?? nutrientLabel(row.key)} <span style={{ fontWeight: 400 }}>{fmtNumber(v)}{v === null ? '' : unitOf(row.key)}</span></span>
                        {pct !== null && <span style={{ fontWeight: 700 }}>{pct}%</span>}
                    </div>
                );
            })}

            <div style={{ borderTop: '8px solid var(--text-primary)', margin: '6px 0' }} />

            <div style={{ fontSize: 12 }}>
                {MICROS.map(key => {
                    const raw = (food as unknown as Record<string, unknown>)[key];
                    if (raw === undefined) return null; // column not in this DB
                    const v = val(key);
                    const pct = dvPct(key, v);
                    return (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                            <span>{nutrientLabel(key)} <span style={{ color: 'var(--text-secondary)' }}>{v === null ? '—' : `${fmtNumber(v)} ${unitOf(key)}`}</span></span>
                            {pct !== null && <span style={{ fontWeight: 700 }}>{pct}%</span>}
                        </div>
                    );
                })}
            </div>

            <div style={{ borderTop: '4px solid var(--text-primary)', marginTop: 6, paddingTop: 4, fontSize: 10, lineHeight: 1.35 }}>
                * The % Daily Value tells you how much a nutrient in a serving contributes to a daily diet. 2,000 calories a day is used for general nutrition advice. &ldquo;—&rdquo; = no data.
            </div>
        </div>
    );
}
