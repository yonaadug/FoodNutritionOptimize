'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import type { Food } from '@/lib/db';
import Icon from '@/components/ui/Icon';
import NutrientBreakdown, { type BreakdownItem } from '@/components/NutrientBreakdown';
import type { FixedFood, PlannerState } from '@/hooks/usePlannerState';
import type { PlanResult, PlanStatus } from '@/hooks/usePlan';
import { presetTitle } from '@/components/planner/goals';
import { GOAL_KEYS, amountFor, fmtNumber, householdAmount, nutrientLabel, nutrientUnit, num, splitFoodName } from '@/components/planner/nutrients';
import { goalProgress, parseIssues, warningText, type GoalProgress } from './analysis';
import InfeasibleHelp from './InfeasibleHelp';

interface PlanStepProps {
    state: PlannerState;
    status: PlanStatus;
    result: PlanResult | null;
    error: string | null;
    stale: boolean;
    fixedAtRun: FixedFood[];
    onRun: () => void;
    onEditFoods: () => void;
    onEditGoals: () => void;
}

export default function PlanStep({ state, status, result, error, stale, fixedAtRun, onRun, onEditFoods, onEditGoals }: PlanStepProps) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    const headingId = useId();

    // Move focus to the result heading when a run finishes (helps keyboard & screen-reader users).
    useEffect(() => {
        if (status === 'success' || status === 'infeasible' || status === 'error') headingRef.current?.focus();
    }, [status]);

    const hasFoods = state.foods.length + state.fixedFoods.length > 0;

    return (
        <section aria-labelledby={headingId} className="stack-lg">
            <div aria-live="polite" aria-atomic="true" className="sr-only">
                {status === 'loading' ? 'Building your plan…'
                    : status === 'success' ? 'Your plan is ready.'
                        : status === 'infeasible' ? "Couldn't meet every goal with these foods. Suggestions are below."
                            : status === 'error' ? 'Something went wrong building the plan.' : ''}
            </div>

            {stale && (status === 'success' || status === 'infeasible') && (
                <div className="callout callout-info fade-in" role="status">
                    <span className="callout-icon"><Icon name="info" /></span>
                    <div className="row-wrap" style={{ flex: 1 }}>
                        <span style={{ flex: 1, minWidth: 200 }}><span className="callout-title">You changed your foods or goals.</span> This plan is out of date.</span>
                        <button type="button" className="btn btn-primary btn-sm" onClick={onRun}><Icon name="refresh" size={14} /> Update plan</button>
                    </div>
                </div>
            )}

            {status === 'idle' && (
                <div className="panel empty-state">
                    <div className="empty-icon"><Icon name="sparkle" /></div>
                    <h2 className="panel-title" id={headingId} ref={headingRef} tabIndex={-1}>No plan yet</h2>
                    <p className="small" style={{ margin: '6px 0 16px' }}>
                        {hasFoods ? 'Your foods and goals are ready. Build a plan whenever you like.' : 'Add a few foods first, then come back here.'}
                    </p>
                    {hasFoods
                        ? <button type="button" className="btn btn-primary btn-lg" onClick={onRun}>Make my plan</button>
                        : <button type="button" className="btn btn-secondary" onClick={onEditFoods}><Icon name="arrowLeft" size={16} /> Pick foods</button>}
                </div>
            )}

            {status === 'loading' && (
                <div className="panel" aria-busy="true">
                    <div className="row" style={{ marginBottom: 16 }}>
                        <span className="spinner" style={{ color: 'var(--primary)' }} />
                        <h2 className="panel-title" id={headingId}>Balancing your foods…</h2>
                    </div>
                    <div className="plan-hero">
                        {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 84, borderRadius: 12 }} />)}
                    </div>
                    <div className="skeleton" style={{ height: 14, width: '70%', marginTop: 24 }} />
                    <div className="skeleton" style={{ height: 14, width: '55%', marginTop: 12 }} />
                </div>
            )}

            {status === 'error' && (
                <div className="panel">
                    <div className="callout callout-danger" role="alert">
                        <span className="callout-icon"><Icon name="alert" /></span>
                        <div className="stack" style={{ gap: 8 }}>
                            <h2 className="callout-title" id={headingId} ref={headingRef} tabIndex={-1}>Something went wrong</h2>
                            <p>{error ?? 'The planner did not respond.'} Your foods and goals are saved, so try again.</p>
                            <div><button type="button" className="btn btn-secondary btn-sm" onClick={onRun}><Icon name="refresh" size={14} /> Try again</button></div>
                        </div>
                    </div>
                </div>
            )}

            {status === 'infeasible' && result && (
                <InfeasibleHelp
                    state={state}
                    parsed={parseIssues(result)}
                    headingId={headingId}
                    headingRef={headingRef}
                    onRun={onRun}
                    onEditGoals={onEditGoals}
                    debug={<ShowTheMath result={result} />}
                />
            )}

            {status === 'success' && result && (
                <PlanResultView state={state} result={result} fixedAtRun={fixedAtRun} headingId={headingId} headingRef={headingRef}
                    onEditFoods={onEditFoods} onEditGoals={onEditGoals} />
            )}
        </section>
    );
}

interface MealItem { food: Food; grams: number; fixed: boolean }

function PlanResultView({ state, result, fixedAtRun, headingId, headingRef, onEditFoods, onEditGoals }: {
    state: PlannerState; result: PlanResult; fixedAtRun: FixedFood[]; headingId: string; headingRef: React.RefObject<HTMLHeadingElement | null>;
    onEditFoods: () => void; onEditGoals: () => void;
}) {
    const items: MealItem[] = useMemo(() => [
        ...fixedAtRun.filter(f => f.grams > 0).map(f => ({ food: f.food, grams: f.grams, fixed: true })),
        ...(result.diet ?? []).map(d => ({ food: d.food, grams: d.grams, fixed: false })),
    ].sort((a, b) => (amountFor(b.food, 'calories', b.grams) ?? 0) - (amountFor(a.food, 'calories', a.grams) ?? 0)), [result, fixedAtRun]);

    const progress = useMemo(() => goalProgress(result), [result]);
    const nutrientGoals = progress.filter(p => p.key !== 'calories');
    const met = nutrientGoals.filter(p => p.status === 'met').length;
    const totalKcal = num(result.totalCalories);
    const P = num(result.totalNutrients?.protein_g) ?? 0;
    const C = num(result.totalNutrients?.carbohydrate_g) ?? 0;
    const F = num(result.totalNutrients?.total_fat_g) ?? 0;
    const macroKcal = P * 4 + C * 4 + F * 9;
    const pct = (v: number) => macroKcal > 0 ? (v / macroKcal) * 100 : 0;
    const totalGrams = items.reduce((s, i) => s + i.grams, 0);
    const cost = num(result.totalCost);
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];

    const breakdown: BreakdownItem[] = items.map(i => ({
        name: i.food.description,
        fixed: i.fixed,
        amounts: Object.fromEntries(['calories', ...GOAL_KEYS].map(k => [k, amountFor(i.food, k, i.grams)])),
    }));

    return (
        <>
            <div className="panel fade-in">
                <div className="panel-header" style={{ flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <p className="eyebrow">Your day · {presetTitle(state.presetId)}</p>
                        <h2 className="section-title" id={headingId} ref={headingRef} tabIndex={-1} style={{ marginTop: 4 }}>
                            {nutrientGoals.length === 0 ? 'Here’s your day' : met === nutrientGoals.length ? 'Every goal met' : `${met} of ${nutrientGoals.length} goals met`}
                        </h2>
                        <p className="panel-sub">{items.length} {items.length === 1 ? 'food' : 'foods'}, about {fmtNumber(totalGrams, { decimals: 0 })} g in total. Amounts are for the whole day.</p>
                    </div>
                    <div className="row-wrap">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onEditFoods}>Edit foods</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onEditGoals}>Edit goals</button>
                    </div>
                </div>

                <div className="plan-hero">
                    <div className="stat">
                        <div className="stat-label">Calories</div>
                        <div className="stat-value">{fmtNumber(totalKcal, { decimals: 0 })}<small>kcal</small></div>
                        <div className="macro-bar" aria-hidden="true">
                            <span style={{ width: `${pct(P * 4)}%`, background: 'var(--protein)' }} />
                            <span style={{ width: `${pct(C * 4)}%`, background: 'var(--carbs)' }} />
                            <span style={{ width: `${pct(F * 9)}%`, background: 'var(--fat)' }} />
                        </div>
                        <div className="legend">
                            <span><i style={{ background: 'var(--protein)' }} />Protein {Math.round(pct(P * 4))}%</span>
                            <span><i style={{ background: 'var(--carbs)' }} />Carbs {Math.round(pct(C * 4))}%</span>
                            <span><i style={{ background: 'var(--fat)' }} />Fat {Math.round(pct(F * 9))}%</span>
                        </div>
                    </div>
                    <div className="stat row" style={{ gap: 16 }}>
                        <div className="ring" style={{ ['--pct' as string]: nutrientGoals.length ? (met / nutrientGoals.length) * 100 : 100 }}
                            data-label={`${met}/${nutrientGoals.length}`} role="img" aria-label={`${met} of ${nutrientGoals.length} goals met`} />
                        <div>
                            <div className="stat-label">Goals met</div>
                            <div className="small secondary">{met === nutrientGoals.length ? 'All on target' : `${nutrientGoals.length - met} need attention`}</div>
                        </div>
                    </div>
                    <div className="stat">
                        <div className="stat-label">Protein</div>
                        <div className="stat-value">{fmtNumber(P, { decimals: 0 })}<small>g</small></div>
                        <div className="small secondary">Fiber {fmtNumber(num(result.totalNutrients?.fiber_g), { decimals: 0 })} g</div>
                    </div>
                    {cost !== null && (
                        <div className="stat">
                            <div className="stat-label">Estimated cost</div>
                            <div className="stat-value">${cost.toFixed(2)}</div>
                        </div>
                    )}
                </div>
            </div>

            {warnings.length > 0 && (
                <div className="callout callout-warn" role="note">
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <div>
                        <div className="callout-title">Some foods are missing data</div>
                        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                            {warnings.slice(0, 6).map((w, i) => <li key={i}>{warningText(w)}</li>)}
                        </ul>
                        {warnings.length > 6 && <p className="tiny muted">…and {warnings.length - 6} more.</p>}
                    </div>
                </div>
            )}

            <div className="layout-2col">
                <section className="panel" aria-label="What to eat">
                    <h3 className="panel-title" style={{ marginBottom: 4 }}>What to eat</h3>
                    <p className="small muted" style={{ marginBottom: 8 }}>Weights are as listed in USDA data (raw or cooked as named).</p>
                    <ul className="meal-list">
                        {items.map((i, idx) => <MealRow key={`${i.food.id}-${i.fixed}`} item={i} index={idx} />)}
                    </ul>
                    {items.length === 0 && <p className="muted">The planner didn&apos;t need any of your foods. Try adding a calorie minimum in Goals.</p>}
                </section>

                <section className="panel sticky-col" aria-label="Goal progress">
                    <h3 className="panel-title" style={{ marginBottom: 12 }}>Goal progress</h3>
                    {progress.length === 0
                        ? <p className="small muted">No goals are switched on.</p>
                        : <div className="stack" style={{ gap: 14 }}>{progress.map(p => <ProgressBar key={p.key} p={p} />)}</div>}
                </section>
            </div>

            <details className="disclosure">
                <summary>Where each nutrient comes from</summary>
                <div className="disclosure-body"><NutrientBreakdown items={breakdown} /></div>
            </details>

            <ShowTheMath result={result} />
        </>
    );
}

function MealRow({ item, index }: { item: MealItem; index: number }) {
    const { name, detail } = splitFoodName(item.food.description);
    const kcal = amountFor(item.food, 'calories', item.grams);
    const protein = amountFor(item.food, 'protein_g', item.grams);
    const hh = householdAmount(item.food, item.grams);
    return (
        <li className="meal-row" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
            <div style={{ minWidth: 0 }}>
                <div className="food-name-line" title={item.food.description}>
                    <span className="food-name">{name}</span>{detail && <span className="food-detail">, {detail}</span>}
                </div>
                <div className="food-meta">
                    {item.fixed && <span className="chip chip-primary"><Icon name="pin" size={11} /> Fixed amount</span>}
                    <span className="meal-kcal">{fmtNumber(kcal, { decimals: 0 })} kcal · {fmtNumber(protein)} g protein</span>
                </div>
            </div>
            <div className="meal-amount">
                <div className="meal-grams">{fmtNumber(item.grams, { decimals: 0 })} g</div>
                {hh && <div className="meal-household">{hh}</div>}
            </div>
        </li>
    );
}

function ProgressBar({ p }: { p: GoalProgress }) {
    const unit = nutrientUnit(p.key);
    const label = nutrientLabel(p.key);
    const ref = p.max ?? p.min ?? p.value ?? 1;
    const fillPct = p.value === null || ref <= 0 ? 0 : Math.min(100, (p.value / ref) * 100);
    const target = p.min !== undefined && p.max !== undefined ? `${fmtNumber(p.min)}–${fmtNumber(p.max)} ${unit}`
        : p.min !== undefined ? `at least ${fmtNumber(p.min)} ${unit}` : `at most ${fmtNumber(p.max)} ${unit}`;
    let statusText = 'On target';
    if (p.status === 'low' && p.min !== undefined && p.value !== null) statusText = `Short by ${fmtNumber(p.min - p.value)} ${unit}`;
    if (p.status === 'high' && p.max !== undefined && p.value !== null) statusText = `Over by ${fmtNumber(p.value - p.max)} ${unit}`;
    if (p.status === 'unknown') statusText = 'No data';

    return (
        <div className="progress-item">
            <div className="progress-head">
                <span className="progress-name">{label}</span>
                <span className="progress-value"><strong style={{ color: 'var(--text-primary)' }}>{fmtNumber(p.value)}</strong> {unit} <span className="muted">/ {target}</span></span>
            </div>
            <div className="progress-track" role="meter" aria-label={`${label}: ${fmtNumber(p.value)} ${unit}, goal ${target}`}
                aria-valuenow={p.value ?? 0} aria-valuemin={0} aria-valuemax={ref}>
                <div className="progress-fill" data-status={p.status} style={{ width: `${fillPct}%` }} />
                {p.min !== undefined && p.max !== undefined && p.max > 0 && (
                    <div className="progress-marker" style={{ left: `${Math.min(100, (p.min / p.max) * 100)}%` }} />
                )}
            </div>
            <div className="status-text" data-status={p.status === 'unknown' ? 'low' : p.status}>
                {p.status === 'met' ? '✓ ' : ''}{statusText}
            </div>
        </div>
    );
}

export function ShowTheMath({ result }: { result: PlanResult }) {
    if (!result.debugEquations?.length && !result.lpModel) return null;
    return (
        <details className="disclosure">
            <summary>Show the math <span className="tiny muted" style={{ fontWeight: 400 }}>(advanced)</span></summary>
            <div className="disclosure-body stack">
                <p className="small secondary">
                    NutriCompare uses linear programming: it finds the amounts of your foods with the fewest calories that satisfy every goal.
                </p>
                {result.debugEquations?.length ? (
                    <pre className="code-block">{result.debugEquations.join('\n')}</pre>
                ) : null}
                {result.lpModel?.constraints ? (
                    <details className="disclosure disclosure-plain">
                        <summary>Raw solver constraints</summary>
                        <div className="disclosure-body"><pre className="code-block">{JSON.stringify(result.lpModel.constraints, null, 2)}</pre></div>
                    </details>
                ) : null}
            </div>
        </details>
    );
}
