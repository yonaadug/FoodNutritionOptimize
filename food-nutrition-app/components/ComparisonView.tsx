'use client';

import { useId, useMemo, useState } from 'react';
import type { Food } from '@/lib/food-types';
import FoodLink from '@/components/food/FoodLink';
import CustomAmount from '@/components/food/CustomAmount';
import ServingSelect, { CUSTOM_SERVING } from '@/components/food/ServingSelect';
import { servingOptions } from '@/lib/food-page';
import {
    basisChoices, basisFromChoice, choiceOfBasis, compareServings, initialBasis, normalizeBasis, optionAtGrams, preparationHint,
    type Anchor, type CardChoice, type ComparedServing, type CompareBasis,
} from '@/lib/compare-weights';
import { FALLBACK_GRAMS, type MassUnit } from '@/lib/serving-scale';
import NutritionLabel from './NutritionLabel';
import Icon from '@/components/ui/Icon';
import { shortFoodName, splitFoodName } from '@/components/planner/nutrients';

interface ComparisonViewProps {
    foods: Food[];
    onClose: () => void;
    /** The food page's food and serving, when Compare opens from a food page. */
    anchor?: Anchor;
}

const FOLLOW = 'follow';

/**
 * Side-by-side Nutrition Facts labels. "Compare at" puts every food on the same weight;
 * each label's own menu can still override it, and the panel says when weights differ.
 */
export default function ComparisonView({ foods, onClose, anchor }: ComparisonViewProps) {
    const titleId = useId();
    const basisId = useId();
    const statusId = useId();
    // Equal weights by default: the weight the food page shows, or 100 g in the planner.
    const [basis, setBasis] = useState<CompareBasis>(() => initialBasis(anchor));
    const [customBasis, setCustomBasis] = useState<{ text: string; unit: MassUnit }>({ text: '100', unit: 'g' });
    const [overrides, setOverrides] = useState<Record<number, CardChoice>>({});

    const choices = useMemo(() => basisChoices(foods, anchor), [foods, anchor]);
    // A setting the menu no longer offers (its food was removed) falls back sensibly.
    const active = useMemo(() => normalizeBasis(basis, foods, anchor), [basis, foods, anchor]);
    const comparison = useMemo(() => compareServings(foods, active, overrides, anchor), [foods, active, overrides, anchor]);
    // What each label shows while it follows "Compare at", for its menu's "same as" entry.
    const following = useMemo(() => compareServings(foods, active, {}, anchor), [foods, active, anchor]);
    const hint = useMemo(() => preparationHint(foods.map(f => f.description)), [foods]);

    const chooseBasis = (value: string) => {
        setBasis(basisFromChoice(value, customBasis));
        setOverrides({}); // "Compare at" puts every label on that weight
    };
    const setCustom = (text: string, unit: MassUnit) => {
        setCustomBasis({ text, unit });
        setBasis({ kind: 'custom', text, unit });
        setOverrides({});
    };
    const sameForAll = () => {
        if (active.kind === 'usual') setBasis({ kind: 'standard', id: 'w-100g' });
        setOverrides({});
    };

    const shared = active.kind === 'usual' ? null : following.servings[0]?.grams ?? null;
    const differing = comparison.servings.filter(s => shared === null || Math.abs(s.grams - shared) > 1e-9);
    const nameOf = (id: number) => shortFoodName(foods.find(f => f.id === id)?.description ?? '');

    return (
        <section className="panel fade-in" aria-labelledby={titleId} id="compare">
            <div className="panel-header">
                <div style={{ flex: 1 }}>
                    <h2 className="panel-title" id={titleId}>Compare nutrition labels</h2>
                    <p className="panel-sub">Every label is scaled from USDA&apos;s values per 100 g. Scroll sideways to see every food.</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={15} /> Close</button>
            </div>
            {foods.length === 0 ? (
                <p className="muted">Add some foods to compare them here.</p>
            ) : (
                <>
                    <div className="compare-basis" data-testid="compare-basis">
                        <div className="field compare-basis-field">
                            <label className="field-label" htmlFor={basisId}>Compare at</label>
                            <select id={basisId} className="select" value={choiceOfBasis(active)} onChange={e => chooseBasis(e.target.value)} aria-describedby={statusId}>
                                <optgroup label="Same weight for every food">
                                    {choices.filter(c => c.group === 'weight').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </optgroup>
                                {choices.some(c => c.group === 'food') && (
                                    <optgroup label="Every food at one food’s serving">
                                        {choices.filter(c => c.group === 'food').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </optgroup>
                                )}
                                <optgroup label="Other">
                                    {choices.filter(c => c.group === 'other').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </optgroup>
                            </select>
                        </div>
                        {active.kind === 'custom' && (
                            <CustomAmount text={customBasis.text} unit={customBasis.unit} onChange={setCustom}
                                label="Amount for every food" fallbackNote={`Showing ${FALLBACK_GRAMS} g for now.`} />
                        )}
                    </div>
                    <div id={statusId} role="status" className="compare-status" data-testid="compare-status" data-same={comparison.sameWeight}>
                        {foods.length > 1 && comparison.sameWeight ? (
                            <p className="small compare-same"><Icon name="check" size={14} /> All {foods.length} labels show {comparison.basisLabel ?? comparison.servings[0].label}, so you can compare them directly.</p>
                        ) : foods.length > 1 ? (
                            <div className="callout callout-warn compare-mismatch">
                                <span className="callout-icon"><Icon name="alert" size={16} /></span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p className="small"><span className="callout-title">Not the same weight.</span>{' '}
                                        {comparison.servings.map((s, i) => <span key={s.foodId}>{i > 0 && ', '}{nameOf(s.foodId)} {s.label}</span>)}.
                                        {' '}Amounts aren&apos;t directly comparable.</p>
                                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={sameForAll}>
                                        Put every food at {active.kind === 'usual' ? '100 g' : comparison.basisLabel}
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                    {hint && (
                        <p className="callout callout-info small compare-hint" data-testid="prep-hint">
                            <span className="callout-icon"><Icon name="info" size={16} /></span><span>{hint}</span>
                        </p>
                    )}
                    <div className="label-scroller" role="list">
                        {foods.map((f, i) => (
                            <LabelCard key={f.id} food={f} serving={comparison.servings[i]} follow={following.servings[i]}
                                different={shared !== null && differing.includes(comparison.servings[i])}
                                onChoose={choice => setOverrides(o => {
                                    const next = { ...o };
                                    if (choice === null) delete next[f.id]; else next[f.id] = choice;
                                    return next;
                                })} />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

interface LabelCardProps {
    food: Food;
    serving: ComparedServing;
    /** This food's serving while it follows "Compare at". */
    follow: ComparedServing;
    /** Its weight differs from "Compare at". */
    different: boolean;
    /** null: follow "Compare at" again. */
    onChoose: (choice: CardChoice | null) => void;
}

function LabelCard({ food, serving, follow, different, onChoose }: LabelCardProps) {
    const { options } = useMemo(() => servingOptions(food), [food]);
    const [custom, setCustom] = useState<{ text: string; unit: MassUnit } | null>(null);
    const selectId = useId();
    const { name, detail } = splitFoodName(food.description);

    // The food's own entry at the shared weight, or a "same as Compare at" entry when it has none.
    const followOption = optionAtGrams(options, follow.grams);
    const leading = followOption ? [] : [{ value: FOLLOW, label: `Same as Compare at: ${follow.label}` }];
    const value = custom !== null && !serving.followsBasis ? CUSTOM_SERVING
        : serving.followsBasis ? (followOption?.id ?? FOLLOW)
        : (optionAtGrams(options, serving.grams)?.id ?? CUSTOM_SERVING);

    const choose = (v: string) => {
        if (v === CUSTOM_SERVING) {
            const start = { text: String(Number(serving.grams.toFixed(2))), unit: 'g' as MassUnit };
            setCustom(start);
            onChoose({ kind: 'custom', ...start });
            return;
        }
        setCustom(null);
        const picked = options.find(o => o.id === v);
        // Picking the shared weight itself means following it again.
        if (v === FOLLOW || (picked && Math.abs(picked.grams - follow.grams) <= 1e-9)) onChoose(null);
        else onChoose({ kind: 'option', id: v });
    };

    return (
        <div role="listitem" className="stack" style={{ gap: 10 }} data-testid="compare-card" data-food-id={food.id} data-grams={serving.grams}>
            <div>
                <h3 style={{ fontSize: 15, fontWeight: 700 }} title={food.description}><FoodLink food={food}>{name}</FoodLink></h3>
                {detail && <p className="small secondary food-name-line">{detail}</p>}
                <div className="chip-list" style={{ marginTop: 6 }}>
                    {food.food_category && <span className="chip">{food.food_category}</span>}
                    {different && <span className="chip chip-warn" data-testid="different-weight">Different weight</span>}
                </div>
            </div>
            <div className="field">
                <label className="field-label" htmlFor={selectId}>Serving size<span className="sr-only"> for {name}{detail ? `, ${detail}` : ''}</span></label>
                <ServingSelect id={selectId} value={value} options={options} onChange={choose} leading={leading} />
            </div>
            {value === CUSTOM_SERVING && custom && (
                <CustomAmount text={custom.text} unit={custom.unit} context={name} fallbackNote={`Showing ${FALLBACK_GRAMS} g for now.`}
                    onChange={(text, unit) => { setCustom({ text, unit }); onChoose({ kind: 'custom', text, unit }); }} />
            )}
            <NutritionLabel food={food} grams={serving.grams} servingLabel={serving.label} />
        </div>
    );
}
