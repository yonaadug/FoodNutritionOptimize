'use client';

import { useId, useState } from 'react';
import type { Food } from '@/lib/food-types';
import Icon from '@/components/ui/Icon';
import NumberInput from '@/components/ui/NumberInput';
import { plannerActions, type FixedFood, type FoodLimits } from '@/hooks/usePlannerState';
import { householdAmount, splitFoodName, hasCoreData } from '@/components/planner/nutrients';

interface YourFoodsProps {
    foods: Food[];
    fixedFoods: FixedFood[];
    foodLimits: FoodLimits;
    onCompare: () => void;
    onTrySample: () => void;
    sampleLoading: boolean;
}

export default function YourFoods({ foods, fixedFoods, foodLimits, onCompare, onTrySample, sampleLoading }: YourFoodsProps) {
    const [undo, setUndo] = useState<{ foods: Food[]; fixedFoods: FixedFood[]; foodLimits: FoodLimits } | null>(null);
    const titleId = useId();
    const count = foods.length + fixedFoods.length;
    const limited = [...foods, ...fixedFoods.map(f => f.food)].filter(f => !hasCoreData(f)).length;

    const clearAll = () => {
        setUndo({ foods, fixedFoods, foodLimits });
        plannerActions.clearFoods();
    };

    return (
        <section className="panel" aria-labelledby={titleId}>
            <div className="panel-header">
                <div style={{ flex: 1 }}>
                    <h2 className="panel-title" id={titleId}>Your foods <span className="muted" style={{ fontWeight: 600 }}>({count})</span></h2>
                    <p className="panel-sub">The planner decides how much of each to eat. Open a food to set a fixed amount or limits.</p>
                </div>
            </div>

            {undo && count === 0 && (
                <div className="undo-bar" role="status">
                    <span style={{ flex: 1 }}>Cleared your foods.</span>
                    <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => { plannerActions.restoreFoods(undo.foods, undo.fixedFoods, undo.foodLimits); setUndo(null); }}>Undo</button>
                </div>
            )}

            {count === 0 && !undo && (
                <div className="empty-state" style={{ padding: '24px 8px' }}>
                    <div className="empty-icon"><Icon name="leaf" /></div>
                    <h3>No foods yet</h3>
                    <p className="small" style={{ marginBottom: 12 }}>Search and tap <strong>Add</strong>, or start from a ready-made day.</p>
                    <button type="button" className="btn btn-secondary" onClick={onTrySample} disabled={sampleLoading}>
                        {sampleLoading ? <><span className="spinner" /> Loading…</> : <><Icon name="sparkle" size={16} /> Try a sample day</>}
                    </button>
                </div>
            )}

            {count > 0 && (
                <>
                    <ul className="basket-list" aria-label="Your foods">
                        {[
                            ...foods.map(f => ({ food: f, grams: null as number | null })),
                            ...fixedFoods.map(f => ({ food: f.food, grams: f.grams as number | null })),
                        ].sort((a, b) => a.food.description.localeCompare(b.food.description)).map(({ food, grams }) => (
                            <BasketItem key={food.id} food={food} fixedGrams={grams} limits={grams === null ? foodLimits[food.id] : undefined} />
                        ))}
                    </ul>
                    {limited > 0 && (
                        <p className="small" style={{ marginTop: 12, color: 'var(--warning)' }}>
                            <Icon name="alert" size={13} /> {limited} {limited === 1 ? 'food has' : 'foods have'} limited USDA data and may be undercounted.
                        </p>
                    )}
                    <div className="row-wrap" style={{ marginTop: 16 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onCompare} disabled={count < 1}>
                            <Icon name="compare" size={15} /> Compare nutrition labels
                        </button>
                        <span className="spacer" />
                        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={clearAll}>
                            <Icon name="trash" size={15} /> Clear all
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}

function BasketItem({ food, fixedGrams, limits }: { food: Food; fixedGrams: number | null; limits?: { min?: number; max?: number } }) {
    const [open, setOpen] = useState(false);
    const optionsId = useId();
    const radioName = useId();
    const { name, detail } = splitFoodName(food.description);
    const isFixed = fixedGrams !== null;

    let sub = 'Planner chooses the amount';
    if (isFixed) {
        const hh = householdAmount(food, fixedGrams);
        sub = `Fixed: ${fixedGrams} g${hh ? ` (${hh})` : ''}`;
    } else if (limits && (limits.min !== undefined || limits.max !== undefined)) {
        sub = `Planner chooses, ${limits.min !== undefined ? `at least ${Math.round(limits.min)} g` : ''}${limits.min !== undefined && limits.max !== undefined ? ', ' : ''}${limits.max !== undefined ? `at most ${Math.round(limits.max)} g` : ''}`;
    }

    return (
        <li className="basket-item" data-fixed={isFixed}>
            <div className="basket-head">
                <div className="basket-name">
                    <div className="food-name-line" title={food.description}>
                        {name}{detail && <span className="food-detail" style={{ fontWeight: 400 }}>, {detail}</span>}
                    </div>
                    <div className="basket-sub">{isFixed && <span className="chip chip-primary" style={{ marginRight: 6 }}><Icon name="pin" size={11} /> Fixed</span>}{sub}</div>
                </div>
                <button type="button" className="icon-btn icon-btn-sm" aria-expanded={open} aria-controls={optionsId}
                    aria-label={`Options for ${food.description}`} title="More options" onClick={() => setOpen(o => !o)}>
                    <Icon name="sliders" size={15} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${food.description}`} title="Remove"
                    onClick={() => plannerActions.removeFood(food.id)}>
                    <Icon name="x" size={15} />
                </button>
            </div>
            {open && (
                <div className="basket-options fade-in" id={optionsId}>
                    <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
                        <legend className="field-label" style={{ marginBottom: 6 }}>How much should I eat?</legend>
                        <label className="radio-line">
                            <input type="radio" name={radioName} checked={!isFixed} onChange={() => plannerActions.setFixed(food, null)} />
                            Let the planner choose
                        </label>
                        <div className="radio-line">
                            <label className="radio-line">
                                <input type="radio" name={radioName} checked={isFixed} onChange={() => plannerActions.setFixed(food, fixedGrams ?? 100)} />
                                I&apos;ll eat exactly
                            </label>
                            <NumberInput label={`Fixed amount of ${name} in grams`} hideLabel unit="g" className="input-num"
                                value={fixedGrams ?? undefined} placeholder="100"
                                onChange={v => plannerActions.setFixed(food, v ?? 0)} />
                        </div>
                    </fieldset>
                    {!isFixed && (
                        <div className="stack" style={{ gap: 6 }}>
                            <span className="field-label">Limit the planner (optional)</span>
                            <div className="row-wrap">
                                <NumberInput label="At least" unit="g" className="input-num" value={limits?.min}
                                    onChange={v => plannerActions.setFoodLimit(food.id, 'min', v)} />
                                <NumberInput label="At most" unit="g" className="input-num" value={limits?.max}
                                    onChange={v => plannerActions.setFoodLimit(food.id, 'max', v)} />
                            </div>
                            <ServingHints food={food} />
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}

function ServingHints({ food }: { food: Food }) {
    const servings = (food.serving_sizes ?? []).filter(s => s.weight_g > 0 && !/^100\s?g/i.test(s.label)).slice(0, 4);
    if (!servings.length) return null;
    return (
        <p className="tiny muted">
            For reference: {servings.map(s => `${s.label} = ${Math.round(s.weight_g)} g`).join(' · ')}
        </p>
    );
}
