'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import NutritionLabel from '@/components/NutritionLabel';
import { dailyValue, nutrientLabel, nutrientUnit } from '@/components/planner/nutrients';
import { plannerActions } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { fmt } from '@/lib/food-page';
import { platedRange, type EditorState } from '@/lib/recipes/editor';
import { recipeAsFood, recipeFoodId } from '@/lib/recipes/nutrition';
import type { NutrientTotal, RecipeNutrition } from '@/lib/recipes/types';
import styles from './recipes.module.css';

const KEY_NUTRIENTS = ['protein_g', 'carbohydrate_g', 'fiber_g', 'total_fat_g', 'saturated_g', 'sodium_mg', 'iron_mg', 'calcium_mg', 'potassium_mg', 'vitamin_d_ug'];
const MORE_NUTRIENTS = [
    'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_e_mg', 'vitamin_k_ug', 'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg',
    'folate_ug', 'vitamin_b12_ug', 'pantothenic_acid_mg', 'choline_mg', 'magnesium_mg', 'phosphorus_mg', 'zinc_mg', 'copper_mg',
    'manganese_mg', 'selenium_ug', 'sugars_g', 'cholesterol_mg',
];

function amountText(t: NutrientTotal | undefined, unit: string): string {
    if (!t || t.value === null) return '—';
    return `${t.incomplete ? '≥ ' : ''}${fmt(t.value)} ${unit}`;
}

function NutrientLine({ nutrientKey, total }: { nutrientKey: string; total: NutrientTotal | undefined }) {
    const dv = dailyValue(nutrientKey);
    const pct = dv && total?.value !== null && total?.value !== undefined ? Math.round((total.value / dv) * 100) : null;
    return (
        <li className={styles.nutrientLine} data-nutrient={nutrientKey}>
            <span className={styles.nutrientName}>{nutrientLabel(nutrientKey)}</span>
            <span className={styles.nutrientAmount}>{amountText(total, nutrientUnit(nutrientKey))}</span>
            <span className={styles.nutrientPct}>{pct === null ? '' : `${total?.incomplete ? '≥ ' : ''}${pct}%`}</span>
        </li>
    );
}

/** Live per-serving totals, the FDA-style label and "Add to my plan". */
export default function RecipeTotals({ state, nutrition }: { state: EditorState; nutrition: RecipeNutrition }) {
    const router = useRouter();
    const hasData = nutrition.totalGrams > 0;
    const calories = nutrition.perServing.calories;
    const food = useMemo(
        () => recipeAsFood(nutrition, state.title, recipeFoodId(state.id)),
        [nutrition, state.title, state.id],
    );
    const lowerBounds = useMemo(
        () => [...KEY_NUTRIENTS, ...MORE_NUTRIENTS].filter(k => nutrition.perServing[k]?.incomplete).map(nutrientLabel),
        [nutrition],
    );
    const range = state.platedMeal && calories?.value ? platedRange(calories.value) : null;
    const servingText = state.servings === 1
        ? `1 serving (${fmt(nutrition.servingGrams, 0)} g)`
        : `1 of ${fmt(state.servings)} servings (${fmt(nutrition.servingGrams, 0)} g)`;
    const usesOlderData = state.rows.some(r => (r.food?.filledNutrients?.length ?? 0) > 0);

    const addToPlan = () => {
        plannerActions.setFixed(food, Math.round(nutrition.servingGrams * 10) / 10);
        notify(`Added one serving of ${state.title.trim() || 'your recipe'} to your plan.`, {
            action: { label: 'Open plan', onClick: () => router.push('/plan#foods') },
        });
    };

    return (
        <aside className={styles.totals} id="recipe-totals" aria-label="Nutrition per serving">
            {hasData && (
                <a href="#recipe-totals" className={styles.stickyTotal}>
                    <span><strong>{calories?.incomplete ? '≥ ' : ''}{fmt(calories?.value, 0)} kcal</strong> per serving</span>
                    <span className={styles.stickyHint}>See totals</span>
                </a>
            )}
            <section className={`panel ${styles.summary}`}>
                <h2 className="panel-title">Per serving</h2>
                {!hasData ? (
                    <p className="small muted">Add an ingredient with an amount to see the nutrition.</p>
                ) : (
                    <>
                        <p className={styles.calories} aria-live="polite" data-testid="calories-per-serving">
                            <span className={styles.caloriesValue}>{calories?.incomplete ? '≥ ' : ''}{fmt(calories?.value, 0)}</span> kcal
                        </p>
                        {range && (
                            <p className={styles.range}>Could be roughly {fmt(range.low, 0)} to {fmt(range.high, 0)} kcal.</p>
                        )}
                        <p className="tiny muted">{servingText}</p>
                        <ul className={styles.nutrientList}>
                            {KEY_NUTRIENTS.map(k => <NutrientLine key={k} nutrientKey={k} total={nutrition.perServing[k]} />)}
                        </ul>
                        <details className={styles.more}>
                            <summary>All vitamins and minerals</summary>
                            <ul className={styles.nutrientList}>
                                {MORE_NUTRIENTS.map(k => <NutrientLine key={k} nutrientKey={k} total={nutrition.perServing[k]} />)}
                            </ul>
                        </details>

                        {nutrition.uncounted.length > 0 && (
                            <p className={styles.noteWarn} data-testid="uncounted-note">
                                Not counted: {nutrition.uncounted.join(', ')}. Give {nutrition.uncounted.length === 1 ? 'it' : 'them'} an amount and a food to include {nutrition.uncounted.length === 1 ? 'it' : 'them'}.
                            </p>
                        )}
                        {lowerBounds.length > 0 && (
                            <p className="tiny muted">
                                ≥ means at least this much: USDA has no value for {lowerBounds.length > 4 ? 'some nutrients' : lowerBounds.join(', ')} in one or more ingredients.
                            </p>
                        )}
                        {usesOlderData && (
                            <p className="tiny muted">
                                Where USDA&apos;s newest entry for a food lacks a nutrient, we use its older entry for the same food.
                            </p>
                        )}
                        <p className="tiny muted">
                            Totals add up the ingredients as listed. Cooking changes water weight and can reduce some vitamins, so treat these as a close guide.
                        </p>

                        <button type="button" className="btn btn-primary btn-block" onClick={addToPlan}>
                            <Icon name="plus" size={16} /> Add a serving to my plan
                        </button>
                    </>
                )}
            </section>

            {hasData && (
                <NutritionLabel food={food} grams={nutrition.servingGrams} servingLabel={servingText} titleAs="h3" micros="fda" />
            )}
        </aside>
    );
}
