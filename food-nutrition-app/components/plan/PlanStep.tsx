'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useEffect, useId, useMemo, useRef } from 'react';
import type { Food } from '@/lib/food-types';
import { isFilled } from '@/lib/nutrient-fill';
import FoodLink, { OlderEntryMark } from '@/components/food/FoodLink';
import { useCurrentUser } from '@/lib/auth/client';
import Icon from '@/components/ui/Icon';
import NutrientBreakdown, { type BreakdownItem } from '@/components/NutrientBreakdown';
import { plannerActions, type FixedFood, type PlannerState } from '@/hooks/usePlannerState';
import { savePlanNow, type PlanResult, type PlanRunInfo, type PlanStatus } from '@/hooks/usePlan';
import { notify } from '@/hooks/useToasts';
import { presetTitle } from '@/components/planner/goals';
import {
    GOAL_KEYS, amountFor, displayFoodName, fmtNumber, householdAmount, nutrientLabel, nutrientUnit, num, shortFoodName, splitFoodName,
} from '@/components/planner/nutrients';
import { typicalServing } from '@/lib/servings';
import { goalProgress, goalSummary, olderEntryUse, parseIssues, recipeCaveats, unusedFoods, warningText, type GoalProgress } from './analysis';
import InfeasibleHelp from './InfeasibleHelp';
import PlusGate from '@/components/billing/PlusGate';
import PlanContaminants from './PlanContaminants';
import { plannerContaminantActions } from './contaminantActions';
import WeekPlanEntry from './WeekPlanEntry';

interface PlanStepProps {
    state: PlannerState;
    status: PlanStatus;
    result: PlanResult | null;
    error: string | null;
    stale: boolean;
    runInfo: PlanRunInfo | null;
    /** Increments when a run finishes in this page view (0 after a reload). */
    finished: number;
    onRun: () => void;
    onEditFoods: () => void;
    onEditGoals: () => void;
    onTrySample: () => void;
    sampleLoading: boolean;
    sampleError: string | null;
}

function timeAgo(ms: number): string {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function PlanStep({ state, status, result, error, stale, runInfo, finished, onRun, onEditFoods, onEditGoals, onTrySample, sampleLoading, sampleError }: PlanStepProps) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    const headingId = useId();

    // Move focus to the result heading when a run finishes (not when a saved plan is restored).
    useEffect(() => {
        if (finished > 0 && status !== 'loading') headingRef.current?.focus({ preventScroll: false });
    }, [finished, status]);

    const hasFoods = state.foods.length + state.fixedFoods.length > 0;
    const showResult = (status === 'success' || (status === 'loading' && result?.success)) && result;
    const showInfeasible = (status === 'infeasible' || (status === 'loading' && result && !result.success)) && result;
    const restored = finished === 0 && !!runInfo;
    // Recipes that left ingredients out, whether or not the plan worked out.
    const caveats = recipeCaveats(status === 'idle' ? [] : [...(runInfo?.fixed ?? []), ...(result?.diet ?? [])]);

    return (
        <section aria-labelledby={headingId} className="stack-lg">
            <div aria-live="polite" aria-atomic="true" className="sr-only">
                {finished === 0 ? '' : status === 'loading' ? 'Building your plan…'
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
                    <p className="small" style={{ margin: '6px auto 16px', maxWidth: 420 }}>
                        {hasFoods ? 'Your foods and goals are ready. Build a plan whenever you like; it takes a second.' : 'A plan needs at least one food. Add a few you like, or start from a ready-made day.'}
                    </p>
                    {hasFoods
                        ? <button type="button" className="btn btn-primary btn-lg" onClick={onRun}>Make my plan</button>
                        : (
                            <div className="row-wrap" style={{ justifyContent: 'center' }}>
                                <button type="button" className="btn btn-primary" onClick={onEditFoods}><Icon name="arrowLeft" size={16} /> Pick foods</button>
                                <button type="button" className="btn btn-secondary" onClick={onTrySample} disabled={sampleLoading}>
                                    {sampleLoading ? <><span className="spinner" /> Building a sample day…</> : <><Icon name="sparkle" size={16} /> Try a sample day</>}
                                </button>
                            </div>
                        )}
                    {!hasFoods && sampleError && <p role="alert" className="small" style={{ color: 'var(--danger)', marginTop: 10 }}>{sampleError}</p>}
                </div>
            )}

            {status === 'loading' && !result && (
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
                            <p>{error ?? 'The planner did not respond.'}</p>
                            <p className="small secondary">Your foods and goals are saved. Check your connection, then try again.</p>
                            <div><button type="button" className="btn btn-secondary btn-sm" onClick={onRun}><Icon name="refresh" size={14} /> Try again</button></div>
                        </div>
                    </div>
                </div>
            )}

            {caveats.map(c => (
                <div key={c.recipeId} className="callout callout-warn" role="note" data-testid="recipe-not-counted">
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="callout-title">{c.name} leaves out {c.uncounted.join(', ')}</div>
                        <p className="small secondary">
                            {c.uncounted.length === 1 ? 'It has' : 'They have'} no amount or no matched food, so {c.uncounted.length === 1 ? "it isn't" : "they aren't"} counted in this plan, and real totals can be higher.{' '}
                            <IntentLink href={`/recipes?id=${encodeURIComponent(c.recipeId)}`}>Edit the recipe</IntentLink>
                        </p>
                    </div>
                </div>
            ))}

            {showInfeasible && (
                <div className={status === 'loading' ? 'is-updating' : undefined} aria-busy={status === 'loading'}>
                    <InfeasibleHelp
                        state={state}
                        parsed={parseIssues(result)}
                        limitsAtRun={result.constraintLimits ?? {}}
                        foodIdsAtRun={runInfo?.foodIds ?? []}
                        upperLimitKeys={result.upperLimitKeys ?? []}
                        headingId={headingId}
                        headingRef={headingRef}
                        stale={stale}
                        onRun={onRun}
                        onEditGoals={onEditGoals}
                        debug={<ShowTheMath result={result} />}
                        portionCapBinding={result.portionCapBinding}
                    />
                </div>
            )}

            {showResult && (
                <PlanResultView state={state} result={result} runInfo={runInfo} stale={stale} restored={restored}
                    updating={status === 'loading'} headingId={headingId} headingRef={headingRef}
                    onEditFoods={onEditFoods} onEditGoals={onEditGoals} />
            )}
        </section>
    );
}

interface MealItem { food: Food; grams: number; fixed: boolean }

interface PlanResultViewProps {
    state: PlannerState;
    result: PlanResult;
    runInfo: PlanRunInfo | null;
    stale: boolean;
    restored: boolean;
    updating: boolean;
    headingId: string;
    headingRef: React.RefObject<HTMLHeadingElement | null>;
    onEditFoods: () => void;
    onEditGoals: () => void;
}

function PlanResultView({ state, result, runInfo, stale, restored, updating, headingId, headingRef, onEditFoods, onEditGoals }: PlanResultViewProps) {
    const fixedAtRun: FixedFood[] = useMemo(() => runInfo?.fixed ?? [], [runInfo]);
    const items: MealItem[] = useMemo(() => [
        ...fixedAtRun.filter(f => f.grams > 0).map(f => ({ food: f.food, grams: f.grams, fixed: true })),
        ...(result.diet ?? []).map(d => ({ food: d.food, grams: d.grams, fixed: false })),
    ].sort((a, b) => (amountFor(b.food, 'calories', b.grams) ?? 0) - (amountFor(a.food, 'calories', a.grams) ?? 0)), [result, fixedAtRun]);

    const progress = useMemo(() => goalProgress(result), [result]);
    const summary = goalSummary(progress);
    const { met, total } = summary;
    const goalRows = progress.filter(p => p.kind === 'goal');
    const totalKcal = num(result.totalCalories);
    const P = num(result.totalNutrients?.protein_g) ?? 0;
    const C = num(result.totalNutrients?.carbohydrate_g) ?? 0;
    const F = num(result.totalNutrients?.total_fat_g) ?? 0;
    const macroKcal = P * 4 + C * 4 + F * 9;
    const pct = (v: number) => macroKcal > 0 ? (v / macroKcal) * 100 : 0;
    const totalGrams = items.reduce((s, i) => s + i.grams, 0);
    const cost = num(result.totalCost);

    // Only foods actually in the plan matter for the data note.
    const usedIds = new Set(items.map(i => i.food.id));
    const warnings = (Array.isArray(result.warnings) ? result.warnings : [])
        .filter(w => typeof w !== 'object' || w === null || w.inDiet !== false || (typeof w.foodId === 'number' && usedIds.has(w.foodId)));
    const floors = goalRows.filter(p => p.missing.length > 0 && p.min !== undefined && !p.uncertain);

    // Chosen foods (when the plan ran) that the plan left out.
    const chosenAtRun = new Set(runInfo?.foodIds ?? []);
    const chosen = state.foods.filter(f => chosenAtRun.has(f.id));
    const unused = unusedFoods(chosen, result, goalRows.map(g => g.key));
    const chosenCount = chosen.length + fixedAtRun.length;

    const goalKeys = goalRows.map(g => g.key);
    const olderUse = olderEntryUse(items, goalKeys);
    const { user } = useCurrentUser();
    const canSaveToAccount = restored && !stale && !!user && !!runInfo && !runInfo.ownerId;

    const breakdown: BreakdownItem[] = items.map(i => ({
        name: i.food.description,
        fixed: i.fixed,
        food: i.food,
        amounts: Object.fromEntries(['calories', ...GOAL_KEYS].map(k => [k, amountFor(i.food, k, i.grams)])),
    }));

    const presetAtRun = runInfo?.presetId ?? state.presetId;
    // The contaminant check follows the plan on screen, at exactly the grams shown.
    const contaminantDays = useMemo(() => [items.map(i => ({
        key: i.food.id, fdcId: i.food.recipe ? null : i.food.fdc_id, name: displayFoodName(i.food.description), grams: i.grams,
    }))], [items]);
    const contaminantActions = useMemo(() => plannerContaminantActions(), []);

    return (
        <div className={`stack-lg${updating ? ' is-updating' : ''}`} aria-busy={updating}>
            <div className="panel fade-in">
                <div className="panel-header" style={{ flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <p className="eyebrow">
                            Your day · {presetTitle(presetAtRun)}{stale && presetAtRun !== state.presetId ? ' (before your changes)' : ''}
                        </p>
                        <h2 className="section-title" id={headingId} ref={headingRef} tabIndex={-1} style={{ marginTop: 4 }}>
                            {updating && <span className="spinner" style={{ color: 'var(--primary)', marginRight: 10, verticalAlign: '-2px', display: 'inline-block' }} />}
                            {total === 0 ? 'Here’s your day' : met === total ? 'Every goal met' : `${met} of ${total} goals met`}
                        </h2>
                        <p className="panel-sub">
                            {items.length} {items.length === 1 ? 'food' : 'foods'}, about {fmtNumber(totalGrams, { decimals: 0 })} g in total. Amounts are for the whole day.
                            {restored && runInfo && <span className="muted"> {runInfo.ownerId ? 'Saved to your account' : 'Saved on this device'} · made {timeAgo(runInfo.at)}.</span>}
                        </p>
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
                        <div className="ring" style={{ ['--pct' as string]: total ? (met / total) * 100 : 100 }}
                            data-label={`${met}/${total}`} role="img" aria-label={`${met} of ${total} goals met`} />
                        <div>
                            <div className="stat-label">Goals met</div>
                            <div className="small secondary">
                                {met === total ? 'All on target' : `${total - met} need${total - met === 1 ? 's' : ''} attention`}
                            </div>
                            {summary.uncertain.length > 0 && (
                                <div className="tiny" style={{ color: 'var(--warning)', fontWeight: 600 }}>
                                    {summary.uncertain.length} {summary.uncertain.length === 1 ? 'limit' : 'limits'} uncertain (missing data)
                                </div>
                            )}
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

            {canSaveToAccount && (
                <div className="callout callout-info" role="note" data-testid="plan-unclaimed">
                    <span className="callout-icon"><Icon name="info" /></span>
                    <div className="row-wrap" style={{ flex: 1 }}>
                        <span style={{ flex: 1, minWidth: 200 }}>This plan was made before you signed in, so it&apos;s only in this browser.</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                            void savePlanNow(state).then(() => notify('Saved to your account.'));
                        }}>Save to my account</button>
                    </div>
                </div>
            )}

            {warnings.length > 0 && (
                <div className="callout callout-warn" role="note">
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="callout-title">
                            {warnings.length} {warnings.length === 1 ? 'food in this plan is' : 'foods in this plan are'} missing some USDA data
                        </div>
                        <p className="small secondary">
                            Unmeasured values count as 0, so real totals can be higher than shown.
                            {floors.length > 0 && <> Totals marked <strong>≥</strong> are at least that much.</>}
                            {summary.uncertain.length > 0 && <> {summary.uncertain.map(u => nutrientLabel(u.key)).join(', ')} {summary.uncertain.length === 1 ? 'looks' : 'look'} within {summary.uncertain.length === 1 ? 'its limit' : 'their limits'} but could actually be over.</>}
                        </p>
                        <details className="disclosure disclosure-plain" style={{ marginTop: 4 }}>
                            <summary>See which foods</summary>
                            <div className="disclosure-body">
                                <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
                                    {warnings.map((w, i) => <li key={i}>{warningText(w)}</li>)}
                                </ul>
                            </div>
                        </details>
                    </div>
                </div>
            )}

            {olderUse.length > 0 && (
                <div className="callout callout-info" role="note" data-testid="plan-older-entries">
                    <span className="callout-icon"><Icon name="info" /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="callout-title">Values marked † are from USDA&apos;s older entry for the food</div>
                        <p className="small secondary">
                            The newest entry has no measurement for them, so we use the older one. <IntentLink href="/methodology#older-entries">Why we do this</IntentLink>
                        </p>
                        <details className="disclosure disclosure-plain" style={{ marginTop: 4 }}>
                            <summary>See which foods</summary>
                            <div className="disclosure-body">
                                <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
                                    {olderUse.map(u => (
                                        <li key={u.food.id}><FoodLink food={u.food}>{shortFoodName(u.food.description)}</FoodLink>: {u.nutrients.map(nutrientLabel).join(', ')}</li>
                                    ))}
                                </ul>
                            </div>
                        </details>
                    </div>
                </div>
            )}

            <div className="layout-2col">
                <section className="panel" aria-labelledby={`${headingId}-eat`}>
                    <h3 className="panel-title" id={`${headingId}-eat`} style={{ marginBottom: 4 }}>What to eat</h3>
                    <p className="small muted" style={{ marginBottom: 8 }}>Weights are as listed in USDA data (raw or cooked as named).</p>
                    <ul className="meal-list">
                        {items.map((i, idx) => <MealRow key={`${i.food.id}-${i.fixed}`} item={i} index={idx} />)}
                    </ul>
                    {items.length === 0 && <p className="muted">The planner didn&apos;t need any of your foods. Try adding a calorie minimum in Goals.</p>}
                    {unused.length > 0 && <UnusedFoods unused={unused} chosenCount={chosenCount} state={state} />}
                </section>

                <section className="panel sticky-col" aria-labelledby={`${headingId}-progress`}>
                    <h3 className="panel-title" id={`${headingId}-progress`} style={{ marginBottom: 12 }}>Goal progress</h3>
                    {progress.filter(p => p.kind === 'goal').length === 0
                        ? <p className="small muted">No goals are switched on.</p>
                        : <div className="stack" style={{ gap: 14 }}>{goalRows.map(p => <ProgressBar key={p.key} p={p} usesOlderEntry={items.some(i => isFilled(i.food, p.key))} />)}</div>}
                    {summary.safety.length > 0 && <SafetyLimits rows={summary.safety} />}
                </section>
            </div>

            {/* PLUS-GATE: planContaminants (UI entry for the whole-plan check). */}
            <PlusGate feature="planContaminants" compact>
                <PlanContaminants days={contaminantDays} busy={updating} {...contaminantActions} />
            </PlusGate>

            {/* PLUS-GATE: weekPlanner (UI entry: "Plan a week"). */}
            <PlusGate feature="weekPlanner" compact>
                <WeekPlanEntry />
            </PlusGate>

            <details className="disclosure">
                <summary>Where each nutrient comes from</summary>
                <div className="disclosure-body"><NutrientBreakdown items={breakdown} /></div>
            </details>

            <ShowTheMath result={result} />
        </div>
    );
}

/** "6 of your 15 foods weren't needed", with a reason each and a one-click way to include one. */
function UnusedFoods({ unused, chosenCount, state }: { unused: ReturnType<typeof unusedFoods>; chosenCount: number; state: PlannerState }) {
    const n = unused.length;
    return (
        <details className="unused" open={n <= 3}>
            <summary>
                <span>{n} of your {chosenCount} foods {n === 1 ? "wasn't" : "weren't"} needed for these goals</span>
            </summary>
            <p className="small secondary" style={{ margin: '6px 0 10px' }}>
                The planner finds the mix with the fewest calories that meets every goal, so it leaves out foods it doesn&apos;t need.
                Want one anyway? Include it and update the plan.
            </p>
            <ul className="unused-list">
                {unused.map(({ food, reason }) => {
                    const limit = state.foodLimits[food.id]?.min;
                    const serving = typicalServing(food.serving_sizes, food);
                    const grams = Math.round(Math.min(serving.grams, 150));
                    const stillChosen = state.foods.some(f => f.id === food.id);
                    return (
                        <li key={food.id}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="food-name-line">
                                    <FoodLink food={food}>
                                        <strong>{shortFoodName(food.description)}</strong>
                                        {splitFoodName(food.description).detail && <span className="food-detail">, {splitFoodName(food.description).detail}</span>}
                                    </FoodLink>
                                </div>
                                <div className="tiny muted">{reason}</div>
                            </div>
                            {!stillChosen ? <span className="tiny muted">Removed</span>
                                : limit !== undefined
                                    ? <span className="chip chip-success"><Icon name="check" size={12} strokeWidth={3} /> At least {fmtNumber(limit, { decimals: 0 })} g</span>
                                    : (
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                                            plannerActions.setFoodLimit(food.id, 'min', grams);
                                            notify(`${shortFoodName(food.description)} will be included (at least ${grams} g). Update the plan to see it.`);
                                        }}>
                                            <Icon name="plus" size={13} /> Include it
                                        </button>
                                    )}
                        </li>
                    );
                })}
            </ul>
        </details>
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
                    <FoodLink food={item.food}>
                        <span className="food-name">{name}</span>{detail && <span className="food-detail">, {detail}</span>}
                    </FoodLink>
                </div>
                <div className="food-meta">
                    {item.fixed && <span className="chip chip-primary"><Icon name="pin" size={11} /> Fixed amount</span>}
                    <span className="meal-kcal">{fmtNumber(kcal, { decimals: 0 })} kcal · {fmtNumber(protein)} g protein</span>
                </div>
            </div>
            <div className="meal-amount">
                <div className="meal-grams">{fmtNumber(item.grams, { decimals: item.grams < 10 ? 1 : 0 })} g</div>
                {hh && <div className="meal-household">{hh}</div>}
            </div>
        </li>
    );
}

function ProgressBar({ p, usesOlderEntry }: { p: GoalProgress; usesOlderEntry: boolean }) {
    const unit = nutrientUnit(p.key);
    const label = nutrientLabel(p.key);
    const ref = p.max ?? p.min ?? p.value ?? 1;
    const fillPct = p.value === null || ref <= 0 ? 0 : Math.min(100, (p.value / ref) * 100);
    const target = p.min !== undefined && p.max !== undefined ? `${fmtNumber(p.min)}–${fmtNumber(p.max)} ${unit}`
        : p.min !== undefined ? `at least ${fmtNumber(p.min)} ${unit}` : `at most ${fmtNumber(p.max)} ${unit}`;
    const floor = p.missing.length > 0;
    const who = p.missing.length === 1 ? p.missing[0] : `${p.missing.length} foods`;
    let statusText = 'On target';
    let tone: string = p.status;
    if (p.status === 'low' && p.min !== undefined && p.value !== null) {
        statusText = floor ? `Short by up to ${fmtNumber(p.min - p.value)} ${unit} (no data for ${who})` : `Short by ${fmtNumber(p.min - p.value)} ${unit}`;
    }
    if (p.status === 'high' && p.value !== null) {
        statusText = p.max !== undefined && p.value > p.max
            ? `Over by ${fmtNumber(p.value - p.max)} ${unit}`
            : `Over the safe upper limit by ${fmtNumber(p.value - (p.safeMax ?? 0))} ${unit}`;
    }
    if (p.status === 'unknown') statusText = 'No data';
    if (p.uncertain) { statusText = `Could be over: no data for ${who}`; tone = 'uncertain'; }

    return (
        <div className="progress-item">
            <div className="progress-head">
                <span className="progress-name">{label}{usesOlderEntry && <OlderEntryMark />}</span>
                <span className="progress-value">
                    {floor && <span className="muted" title="At least this much: some foods have no data">≥ </span>}
                    <strong style={{ color: 'var(--text-primary)' }}>{fmtNumber(p.value)}</strong> {unit} <span className="muted">/ {target}</span>
                </span>
            </div>
            <div className="progress-track" role="meter" aria-label={`${label}: ${floor ? 'at least ' : ''}${fmtNumber(p.value)} ${unit}, goal ${target}`}
                aria-valuenow={p.value ?? 0} aria-valuemin={0} aria-valuemax={ref}>
                <div className="progress-fill" data-status={tone} style={{ width: `${fillPct}%` }} />
                {p.min !== undefined && p.max !== undefined && p.max > 0 && (
                    <div className="progress-marker" style={{ left: `${Math.min(100, (p.min / p.max) * 100)}%` }} />
                )}
            </div>
            <div className="status-text" data-status={p.status === 'unknown' ? 'low' : tone}>
                {p.status === 'met' && !p.uncertain ? '✓ ' : p.uncertain ? '⚠ ' : ''}{statusText}
                {p.safeMax !== undefined && p.status !== 'high' && <span className="muted" style={{ fontWeight: 500 }}> · safe upper limit {fmtNumber(p.safeMax)} {unit}</span>}
            </div>
        </div>
    );
}

/** Ceiling-only safe upper limits: a quiet check, not goals. */
function SafetyLimits({ rows }: { rows: GoalProgress[] }) {
    const over = rows.filter(r => r.status === 'high');
    return (
        <div className="safety-limits">
            <div className="safety-head">
                <span className="safety-title">Safe upper limits</span>
                <span className="status-text" data-status={over.length ? 'high' : 'met'} style={{ marginTop: 0 }}>
                    {over.length ? `${over.length} over the limit` : `✓ All ${rows.length} within`}
                </span>
            </div>
            <p className="tiny muted">Not goals: the planner only made sure these stay under the adult Tolerable Upper Intake Level.</p>
            <ul className="safety-list">
                {rows.map(r => (
                    <li key={r.key} data-status={r.status}>
                        <span>{nutrientLabel(r.key)}</span>
                        <span className="tabular">{r.missing.length > 0 ? '≥ ' : ''}{fmtNumber(r.value)} <span className="muted">/ max {fmtNumber(r.safeMax)} {nutrientUnit(r.key)}</span></span>
                    </li>
                ))}
            </ul>
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
                    NutritionDictionary uses linear programming: it finds the amounts of your foods with the fewest calories that satisfy every goal.
                    Numbers are per 100 g of each food.
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
