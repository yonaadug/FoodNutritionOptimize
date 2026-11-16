'use client';

import { useEffect, useMemo } from 'react';
import IntentLink from '@/components/ui/IntentLink';
import { useRouter } from 'next/navigation';
import { OlderEntryMark } from '@/components/food/FoodLink';
import Icon from '@/components/ui/Icon';
import NutritionLabel from '@/components/NutritionLabel';
import { dailyValue, nutrientLabel, nutrientUnit } from '@/components/planner/nutrients';
import { plannerActions, usePlannerState } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { fmt, nutrientName } from '@/lib/food-page';
import { filledKeys, isFilled } from '@/lib/nutrient-fill';
import { recipeServingsInPlan } from '@/lib/planner-recipes';
import { platedRange, type EditorState } from '@/lib/recipes/editor';
import { RECIPE_NUTRIENTS, recipeAsFood, recipeFoodId, UNTITLED_RECIPE } from '@/lib/recipes/nutrition';
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

function NutrientLine({ nutrientKey, total, older }: { nutrientKey: string; total: NutrientTotal | undefined; older: boolean }) {
    const dv = dailyValue(nutrientKey);
    const pct = dv && total?.value !== null && total?.value !== undefined ? Math.round((total.value / dv) * 100) : null;
    return (
        <li className={styles.nutrientLine} data-nutrient={nutrientKey}>
            <span className={styles.nutrientName}>{nutrientLabel(nutrientKey)}</span>
            <span className={styles.nutrientAmount}>{amountText(total, nutrientUnit(nutrientKey))}{older && <OlderEntryMark />}</span>
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
        () => recipeAsFood(nutrition, state.title, recipeFoodId(state.id), state.id),
        [nutrition, state.title, state.id],
    );
    const planner = usePlannerState();
    const servingsInPlan = recipeServingsInPlan(planner.fixedFoods, food.id);
    // Edits reach the plan, which then reads as out of date until it's made again.
    useEffect(() => { plannerActions.syncRecipe(food); }, [food]);
    const lowerBounds = useMemo(
        () => [...KEY_NUTRIENTS, ...MORE_NUTRIENTS].filter(k => nutrition.perServing[k]?.incomplete).map(nutrientLabel),
        [nutrition],
    );
    const range = state.platedMeal && calories?.value ? platedRange(calories.value) : null;
    const servingText = state.servings === 1
        ? `1 serving (${fmt(nutrition.servingGrams, 0)} g)`
        : `1 of ${fmt(state.servings)} servings (${fmt(nutrition.servingGrams, 0)} g)`;
    const olderEntries = state.rows.flatMap(r => {
        const nutrients = filledKeys(r.food, RECIPE_NUTRIENTS);
        return r.conversion.grams && nutrients.length > 0 ? [{ food: r.food!.description, nutrients }] : [];
    });

    const addToPlan = () => {
        plannerActions.addRecipeServing(food);
        const total = servingsInPlan + 1;
        notify(`Added one serving of ${state.title.trim() || UNTITLED_RECIPE} to your plan${total > 1 ? `, ${fmt(total)} servings in all` : ''}.`, {
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
                            {KEY_NUTRIENTS.map(k => <NutrientLine key={k} nutrientKey={k} total={nutrition.perServing[k]} older={isFilled(food, k)} />)}
                        </ul>
                        <details className={styles.more}>
                            <summary>All vitamins and minerals</summary>
                            <ul className={styles.nutrientList}>
                                {MORE_NUTRIENTS.map(k => <NutrientLine key={k} nutrientKey={k} total={nutrition.perServing[k]} older={isFilled(food, k)} />)}
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
                        {olderEntries.length > 0 && (
                            <p className="tiny muted" data-testid="recipe-older-entries">
                                † From USDA&apos;s older entry for {olderEntries.length === 1 ? olderEntries[0].food : 'some ingredients'}, where the newest entry has no value:{' '}
                                {olderEntries.length === 1
                                    ? olderEntries[0].nutrients.map(nutrientName).join(', ')
                                    : olderEntries.map(e => `${e.food} (${e.nutrients.slice(0, 3).map(nutrientName).join(', ')}${e.nutrients.length > 3 ? ` and ${e.nutrients.length - 3} more` : ''})`).join('; ')}.{' '}
                                <IntentLink href="/methodology#older-entries">Why we do this</IntentLink>
                            </p>
                        )}
                        <p className="tiny muted">
                            Totals add up the ingredients as listed. Cooking changes water weight and can reduce some vitamins, so treat these as a close guide.
                        </p>

                        {servingsInPlan > 0 ? (
                            <div className={styles.inPlan} data-testid="recipe-in-plan">
                                <IntentLink href="/plan#foods" className="btn btn-primary-soft btn-block">
                                    <Icon name="check" size={16} /> In your plan: {fmt(servingsInPlan)} {servingsInPlan === 1 ? 'serving' : 'servings'} · Open plan
                                </IntentLink>
                                <div className="row-wrap">
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addToPlan}>
                                        <Icon name="plus" size={14} /> Add another serving
                                    </button>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => plannerActions.removeRecipeServing(food.id)}>
                                        Remove one
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button type="button" className="btn btn-primary btn-block" onClick={addToPlan}>
                                <Icon name="plus" size={16} /> Add a serving to my plan
                            </button>
                        )}
                    </>
                )}
            </section>

            {hasData && (
                <NutritionLabel food={food} grams={nutrition.servingGrams} servingLabel={servingText} titleAs="h3" micros="fda" />
            )}
        </aside>
    );
}
