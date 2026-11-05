'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Food } from '@/lib/food-types';
import { fmt, foodPath, keyNutrients, servingOptions } from '@/lib/food-page';
import { isFilled } from '@/lib/nutrient-fill';
import { typicalServing } from '@/lib/servings';
import NutritionLabel from '@/components/NutritionLabel';
import Icon from '@/components/ui/Icon';
import { plannerActions, usePlannerState } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { displayFoodName, nv, shortFoodName } from '@/components/planner/nutrients';
import ComparePanel from './ComparePanel';
import { OlderEntryMark } from './FoodLink';
import NutrientTable from './NutrientTable';
import SafetySlot from './SafetySlot';
import { onFoodViewed } from './onFoodViewed';

const CUSTOM = 'custom';
const MAX_GRAMS = 5000;

/**
 * The interactive heart of a food page, rendered on the server for the default
 * serving and then live in the browser: serving selector, Nutrition Facts,
 * nutrient table, and the plan / compare / share actions.
 */
export default function FoodDetail({ food, compareSuggestions }: { food: Food; compareSuggestions: Food[] }) {
    const { options, defaultId } = useMemo(() => servingOptions(food), [food]);
    const [servingId, setServingId] = useState(defaultId);
    const [customText, setCustomText] = useState('150');
    const [comparing, setComparing] = useState(false);
    const selectId = useId();
    const customId = useId();

    const fdcId = food.fdc_id;
    const description = food.description;
    // What a history row shows: calories in a typical serving, and what the food is richest in.
    const viewSummary = useMemo(() => {
        const serving = typicalServing(food.serving_sizes, food);
        const kcal = nv(food, 'calories');
        const richIn = keyNutrients(food, serving.grams, 3, 20).map(k => k.label.replace(/ \(.*\)$/, ''));
        return [
            ...(kcal === null ? [] : [{ label: 'Calories', value: `${fmt(kcal * serving.grams / 100, 0)} kcal per ${serving.label}` }]),
            ...(richIn.length ? [{ label: 'Rich in', value: richIn.join(', ') }] : []),
        ];
    }, [food]);
    useEffect(() => {
        onFoodViewed({ fdcId, description, title: displayFoodName(description), path: foodPath({ fdc_id: fdcId, description }), summary: viewSummary });
    }, [fdcId, description, viewSummary]);

    const customGrams = Number.parseFloat(customText);
    const customValid = Number.isFinite(customGrams) && customGrams > 0 && customGrams <= MAX_GRAMS;
    const chosen = options.find(o => o.id === servingId) ?? options[0];
    const isCustom = servingId === CUSTOM;
    // While the custom amount is being typed (empty or out of range), keep the last shown numbers sensible.
    const grams = isCustom ? (customValid ? customGrams : 100) : chosen.grams;
    const servingLabel = isCustom ? `${fmt(grams)} g` : chosen.label;
    const rich = useMemo(() => keyNutrients(food, grams, 5, 20), [food, grams]);

    return (
        <>
            <FoodActions food={food} grams={grams} servingLabel={servingLabel} gramsValid={!isCustom || customValid} comparing={comparing} onCompare={() => {
                setComparing(true);
                requestAnimationFrame(() => document.getElementById('compare-area')?.scrollIntoView({ behavior: 'smooth' }));
            }} />

            <div className="food-layout">
                <div className="food-label-col">
                    <div className="serving-picker">
                        <div className="field">
                            <label className="field-label" htmlFor={selectId}>Serving size</label>
                            <select id={selectId} className="select" value={servingId} onChange={e => setServingId(e.target.value)}>
                                {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                <option value={CUSTOM}>Custom amount…</option>
                            </select>
                        </div>
                        {isCustom && (
                            <div className="field serving-custom">
                                <label className="field-label" htmlFor={customId}>Amount in grams</label>
                                <input id={customId} className="input" type="number" inputMode="decimal" min={1} max={MAX_GRAMS} step="any"
                                    value={customText} onChange={e => setCustomText(e.target.value)}
                                    aria-invalid={!customValid} aria-describedby={customValid ? undefined : `${customId}-err`} />
                                {!customValid && <p className="tiny" id={`${customId}-err`} style={{ color: 'var(--danger)' }}>Enter 1 to {MAX_GRAMS.toLocaleString('en-US')} grams. Showing 100 g for now.</p>}
                            </div>
                        )}
                    </div>
                    <NutritionLabel food={food} grams={grams} servingLabel={servingLabel} titleAs="h2" micros="fda" />
                </div>

                <div className="food-data-col">
                    {rich.length > 0 && (
                        <section aria-label="What this serving is richest in" className="rich-in">
                            <span className="small secondary">Rich in</span>
                            {rich.map(k => (
                                <span key={k.key} className="chip chip-success tabular">{k.label.replace(/ \(.*\)$/, '')} {fmt(k.dvPct, 0)}%{isFilled(food, k.key) && <OlderEntryMark />}</span>
                            ))}
                            <span className="tiny muted">of Daily Value, per serving</span>
                        </section>
                    )}
                    <NutrientTable food={food} grams={grams} servingLabel={servingLabel} />
                    <SafetySlot fdcId={fdcId} servingGrams={grams} />
                </div>
            </div>

            {comparing && <ComparePanel food={food} suggestions={compareSuggestions} onClose={() => setComparing(false)} />}
        </>
    );
}

interface FoodActionsProps {
    food: Food;
    /** The serving chosen on this page. */
    grams: number;
    servingLabel: string;
    gramsValid: boolean;
    comparing: boolean;
    onCompare: () => void;
}

function FoodActions({ food, grams, servingLabel, gramsValid, comparing, onCompare }: FoodActionsProps) {
    const state = usePlannerState();
    const router = useRouter();
    const openPlan = useRef<HTMLAnchorElement>(null);
    const [moveFocus, setMoveFocus] = useState(false);
    const name = shortFoodName(food.description);
    const fixed = state.fixedFoods.find(f => f.food.fdc_id === food.fdc_id);
    const inPlan = !!fixed || state.foods.some(f => f.fdc_id === food.fdc_id);
    const amount = Math.round(grams * 10) / 10;
    const toast = { action: { label: 'Open plan', onClick: () => router.push('/plan#foods') } };

    // The button that was just pressed is replaced by a link: keep keyboard users in place.
    useEffect(() => {
        if (moveFocus && inPlan) {
            openPlan.current?.focus();
            setMoveFocus(false); // eslint-disable-line react-hooks/set-state-in-effect -- one-shot request from the click
        }
    }, [moveFocus, inPlan]);

    const add = () => {
        plannerActions.addFood(food);
        setMoveFocus(true);
        notify(`Added ${name} to your plan. The planner will choose how much.`, toast);
    };

    const addExactly = () => {
        const target = fixed?.food ?? state.foods.find(f => f.fdc_id === food.fdc_id) ?? food;
        plannerActions.setFixed(target, amount);
        setMoveFocus(!inPlan);
        notify(`${name}: exactly ${servingLabel} in your plan. The rest of the day is planned around it.`, toast);
    };

    const share = async () => {
        const url = window.location.href;
        // The share sheet suits phones; on desktop, copying the link is what people expect.
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
            try { await navigator.share({ title: `${food.description}: nutrition facts`, url }); return; } catch (e) {
                if ((e as Error).name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            notify('Link copied.', { ms: 3000 });
        } catch {
            notify("Couldn't copy the link. You can copy it from the address bar.", { tone: 'info' });
        }
    };

    const exactLabel = fixed
        ? `Change to exactly ${fmt(amount)} g`
        : inPlan ? `Use exactly ${fmt(amount)} g instead` : `Add exactly ${fmt(amount)} g`;
    const showExact = gramsValid && fixed?.grams !== amount;

    return (
        <div className="food-actions-wrap">
        <div className="food-actions">
            {inPlan ? (
                <Link ref={openPlan} href="/plan#foods" className="btn btn-primary-soft" data-testid="in-plan">
                    <Icon name="check" size={16} /> In your plan{fixed ? ` · exactly ${fmt(fixed.grams)} g` : ''} · Open plan
                </Link>
            ) : (
                <button type="button" className="btn btn-primary" onClick={add}>
                    <Icon name="plus" size={16} /> Add to my plan
                </button>
            )}
            {showExact && (
                <button type="button" className="btn btn-primary-soft" onClick={addExactly} title={`Keep ${servingLabel} fixed in your plan`}>
                    <Icon name="pin" size={15} /> {exactLabel}
                </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onCompare} aria-expanded={comparing}>
                <Icon name="compare" size={16} /> Compare
            </button>
            <button type="button" className="btn btn-secondary" onClick={share}>
                <Icon name="share" size={16} /> Share
            </button>
        </div>
        <p className="tiny muted food-actions-hint" data-testid="plan-hint">
            {fixed
                ? `Your plan keeps exactly ${fmt(fixed.grams)} g of this and plans the rest of the day around it.`
                : inPlan
                    ? 'The planner chooses how much of this to eat. To fix the amount, pick a serving below and use the button above.'
                    : 'Add to my plan lets the planner choose how much. Add exactly keeps the serving you pick below, and plans the rest of the day around it.'}
        </p>
        </div>
    );
}
