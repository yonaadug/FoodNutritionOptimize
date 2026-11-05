'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import { plannerActions, type PlannerState } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { biggerPortions, describePortionCap, presetTitle, type GoalRange } from '@/components/planner/goals';
import { useTopFoods, type TopFood } from '@/hooks/useTopFoods';
import { fmtNumber, nutrientLabel, nutrientUnit, nv, shortFoodName } from '@/components/planner/nutrients';
import type { PlanIssue } from './analysis';

interface InfeasibleHelpProps {
    state: PlannerState;
    parsed: { issues: PlanIssue[]; more: number };
    /** Bounds the planner used for this result (to offer Undo after "Drop this minimum"). */
    limitsAtRun: Record<string, { min?: number; max?: number }>;
    /** Foods chosen when the plan ran (suggestions leave these out, so newly added chips stay visible). */
    foodIdsAtRun: number[];
    /** Nutrients whose limit is a safe upper limit, not a user goal. */
    upperLimitKeys: string[];
    headingId: string;
    headingRef: React.RefObject<HTMLHeadingElement | null>;
    stale: boolean;
    onRun: () => void;
    onEditGoals: () => void;
    debug: React.ReactNode;
    /** The plan would work if the general portion cap were lifted. */
    portionCapBinding?: boolean;
}

const SHOWN_AT_FIRST = 6;

/** "vitamin D" stays capitalised; "Sodium" becomes "sodium" mid-sentence. */
function inSentence(label: string): string {
    return /^vitamin/i.test(label) ? label : label.toLowerCase();
}

/**
 * Plain-language help when no combination of foods meets every goal:
 * which goals are the problem, foods that would help, and one-click fixes,
 * each of which confirms what it did.
 */
export default function InfeasibleHelp({
    state, parsed, limitsAtRun, foodIdsAtRun, upperLimitKeys, headingId, headingRef, stale, onRun, onEditGoals, debug, portionCapBinding,
}: InfeasibleHelpProps) {
    const { issues, more } = parsed;
    const [showAll, setShowAll] = useState(false);
    const allNutrientIssues = issues.filter(i => i.nutrient && (i.kind === 'short' || i.kind === 'excess'));
    // Shortfalls of under 1% are a side effect of the main problem; mention them quietly.
    const bound = (i: PlanIssue) => limitsAtRun[i.nutrient!]?.[i.kind === 'short' ? 'min' : 'max'];
    const isMinor = (i: PlanIssue) => i.amount !== undefined && (bound(i) ?? 0) > 0 && i.amount / bound(i)! < 0.01;
    const major = allNutrientIssues.filter(i => !isMinor(i));
    const nutrientIssues = major.length ? major : allNutrientIssues;
    const minor = allNutrientIssues.filter(i => !nutrientIssues.includes(i));
    const otherIssues = issues.filter(i => !allNutrientIssues.includes(i));
    const visible = showAll ? nutrientIssues : nutrientIssues.slice(0, SHOWN_AT_FIRST);
    const hidden = nutrientIssues.length - visible.length;
    const selectedIds = new Set([...state.foods.map(f => f.id), ...state.fixedFoods.map(f => f.food.id)]);
    const updateAction = { label: 'Update plan', onClick: onRun };
    const foodCount = state.foods.length + state.fixedFoods.length;

    return (
        <>
            <div className="panel fade-in">
                <div className="callout callout-warn" style={{ marginBottom: 20 }}>
                    <span className="callout-icon"><Icon name="alert" size={20} /></span>
                    <div className="stack" style={{ gap: 6 }}>
                        <h2 className="panel-title" id={headingId} ref={headingRef} tabIndex={-1}>
                            We can&apos;t hit every goal with these foods
                        </h2>
                        <p className="secondary">
                            No mix of your {foodCount} {foodCount === 1 ? 'food' : 'foods'} covers everything at once.
                            Add a food that&apos;s rich in what&apos;s missing, or relax a goal. Each card shows a quick fix.
                        </p>
                        {portionCapBinding && state.portionCap.enabled && (
                            <p className="small"><strong>Good news:</strong> allowing bigger portions alone would make this work.</p>
                        )}
                    </div>
                </div>

                {nutrientIssues.length > 0 && (
                    <ul className="issue-list" aria-label="Goals that can't be met">
                        {visible.map((issue, i) => (
                            <IssueCard key={`${issue.nutrient}-${issue.kind}`} issue={issue} state={state}
                                limitAtRun={limitsAtRun[issue.nutrient!] ?? {}} selectedIds={selectedIds}
                                isUpperLimit={issue.kind === 'excess' && upperLimitKeys.includes(issue.nutrient!)}
                                excludeIds={foodIdsAtRun} showSuggestions={i < 4} updateAction={updateAction} />
                        ))}
                    </ul>
                )}
                {hidden > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>
                        Show {hidden} more {hidden === 1 ? 'goal' : 'goals'}: {nutrientIssues.slice(SHOWN_AT_FIRST).map(i => nutrientLabel(i.nutrient!)).join(', ')}
                    </button>
                )}

                {minor.length > 0 && (
                    <p className="small muted" style={{ marginTop: 12 }}>
                        Also just short: {minor.map(i => `${inSentence(nutrientLabel(i.nutrient!))} (by ${fmtNumber(i.amount)} ${nutrientUnit(i.nutrient!)})`).join(', ')}. Fixing the goals above usually fixes {minor.length === 1 ? 'this' : 'these'} too.
                    </p>
                )}
                {otherIssues.length > 0 && (
                    <ul className="small secondary" style={{ marginTop: 16, paddingLeft: 18 }}>
                        {otherIssues.map((i, idx) => <li key={idx}>{i.text}</li>)}
                    </ul>
                )}
                {more > 0 && <p className="small muted" style={{ marginTop: 12 }}>…and {more} more {more === 1 ? 'goal' : 'goals'} that can&apos;t be met yet.</p>}

                <div className="quick-fixes">
                    <span className="small secondary" style={{ flex: '1 1 100%' }}>Other quick fixes:</span>
                    {state.presetId !== 'essentials' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                            plannerActions.applyPreset('essentials');
                            notify(`Switched to ${presetTitle('essentials')}.`, { action: updateAction });
                        }}>
                            Switch to Everyday essentials
                        </button>
                    )}
                    {state.portionCap.enabled && (
                        <button type="button" className={`btn btn-sm ${portionCapBinding ? 'btn-primary-soft' : 'btn-secondary'}`}
                            onClick={() => {
                                const next = biggerPortions(state.portionCap);
                                plannerActions.setPortionCap(next);
                                notify(next.enabled ? `Portions can now go up to ${describePortionCap(next).replace(/^At most /, '')}.` : 'Portion limit turned off.',
                                    { action: updateAction });
                            }}>
                            Allow bigger portions{portionCapBinding ? ' (this would work)' : ''}
                        </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onEditGoals}>Review all goals</button>
                    <span className="spacer" />
                    <button type="button" className="btn btn-primary" onClick={onRun}>
                        <Icon name="refresh" size={15} /> {stale ? 'Update plan' : 'Try again'}
                    </button>
                </div>
            </div>
            {debug}
        </>
    );
}

interface IssueCardProps {
    issue: PlanIssue;
    state: PlannerState;
    limitAtRun: { min?: number; max?: number };
    selectedIds: Set<number>;
    excludeIds: number[];
    showSuggestions: boolean;
    updateAction: { label: string; onClick: () => void };
    /** The limit is a safe upper limit ("Respect safe upper limits"), not a goal. */
    isUpperLimit: boolean;
}

function IssueCard({ issue, state, limitAtRun, selectedIds, excludeIds, showSuggestions, updateAction, isUpperLimit }: IssueCardProps) {
    const key = issue.nutrient!;
    const label = nutrientLabel(key);
    const unit = nutrientUnit(key);
    const isCalories = key === 'calories';
    const isShort = issue.kind === 'short';
    const side: 'min' | 'max' = isShort ? 'min' : 'max';
    const amount = issue.amount !== undefined ? `${fmtNumber(issue.amount)} ${issue.unit && issue.unit !== 'g' && issue.unit !== unit ? issue.unit : unit}` : null;
    const title = `${isShort ? 'Not enough' : 'Too much'} ${inSentence(label)}`;

    // "Dropped" is derived from the live goals, so it also reflects edits made elsewhere.
    const current: GoalRange = isCalories ? state.calories : state.goals[key] ?? {};
    const dropped = isUpperLimit ? !state.upperLimits : current[side] === undefined && limitAtRun[side] !== undefined;

    const setBound = (value: number | undefined) => {
        if (isCalories) plannerActions.setCalories({ ...state.calories, [side]: value });
        else plannerActions.setGoal(key, { ...state.goals[key], [side]: value });
    };
    const drop = () => {
        if (isUpperLimit) {
            plannerActions.setUpperLimits(false);
            notify('Safe upper limits turned off.', { action: updateAction });
            return;
        }
        setBound(undefined);
        notify(`Dropped the ${inSentence(label)} ${isShort ? 'minimum' : 'limit'}.`, { action: updateAction });
    };
    const undo = () => (isUpperLimit ? plannerActions.setUpperLimits(true) : setBound(limitAtRun[side]));

    return (
        <li className="issue" data-resolved={dropped}>
            <div className="issue-head">
                <span className="issue-title">{title}</span>
                {amount && <span className={`chip ${isShort ? 'chip-warn' : 'chip-danger'}`}>{isShort ? 'short by' : 'over by'} {amount}</span>}
                {dropped ? (
                    <span className="issue-done" role="status">
                        <Icon name="check" size={14} strokeWidth={3} /> {isUpperLimit ? 'Upper limits off' : isShort ? 'Minimum dropped' : 'Limit dropped'}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={undo}>Undo</button>
                    </span>
                ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={drop}>
                        {isUpperLimit ? 'Turn off upper limits' : isShort ? 'Drop this minimum' : 'Drop this limit'}
                    </button>
                )}
            </div>
            <p className="small secondary" style={{ marginTop: 4 }}>
                {dropped
                    ? 'Update the plan to see the result.'
                    : isUpperLimit
                        ? `This is the safe upper limit for ${inSentence(label)}, not one of your goals. Your other goals need more than it allows with these foods.`
                    : issue.fixedFoodsCause
                        ? `Your fixed-amount foods already go over this on their own${amount ? ` (by ${amount})` : ''}. Lower their amounts in Your foods.`
                        : isShort
                            ? isCalories ? 'Your foods can’t add up to the minimum calories within the portion limits. Add more foods or allow bigger portions.'
                                : `None of your foods have enough ${inSentence(label)} to reach the goal within realistic portions.`
                            : isCalories ? 'Meeting your other goals takes more calories than your maximum allows.'
                                : `Meeting your other goals pushes this over the limit. Swap in foods lower in ${inSentence(label)}, or relax the limit.`}
            </p>
            {isShort && !isCalories && showSuggestions && !dropped && (
                <Suggestions nutrient={key} selectedIds={selectedIds} excludeIds={excludeIds} updateAction={updateAction} />
            )}
        </li>
    );
}

function Suggestions({ nutrient, selectedIds, excludeIds, updateAction }: {
    nutrient: string; selectedIds: Set<number>; excludeIds: number[]; updateAction: { label: string; onClick: () => void };
}) {
    // Ranked server-side by a realistic serving, everyday foods first (lib/best-sources.ts).
    // Foods chosen when the plan ran are excluded; ones added since stay, marked "Added".
    const top = useTopFoods(nutrient, 3, { exclude: excludeIds });
    const unit = nutrientUnit(nutrient);
    const picks = top.foods.slice(0, 3);
    const added = picks.filter(f => selectedIds.has(f.id)).length;

    if (top.loading) {
        return <div className="suggestions" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ width: 150, height: 32, borderRadius: 999 }} />)}</div>;
    }
    if (top.error || picks.length === 0) return null;
    return (
        <div className="suggestions" role="group" aria-label={`Good sources of ${nutrientLabel(nutrient)}`}>
            <span className="tiny muted" style={{ alignSelf: 'center' }}>Good sources:</span>
            {picks.map(f => {
                const isAdded = selectedIds.has(f.id);
                return (
                    <button key={f.id} type="button" className="chip chip-btn suggestion" title={f.description} aria-pressed={isAdded}
                        aria-label={`${isAdded ? 'Remove' : 'Add'} ${f.description} (${perServingText(f, nutrient, unit)})`}
                        onClick={() => {
                            if (isAdded) {
                                plannerActions.removeFood(f.id);
                                notify(`Removed ${shortFoodName(f.description)}.`, { tone: 'info' });
                            } else {
                                plannerActions.addFood(f);
                                notify(`Added ${shortFoodName(f.description)} to your foods.`, { action: updateAction });
                            }
                        }}>
                        <Icon name={isAdded ? 'check' : 'plus'} size={12} strokeWidth={isAdded ? 3 : 2} />
                        <span className="suggestion-name">{isAdded ? 'Added: ' : ''}{shortName(f.description)}</span>
                        <span className="muted">{perServingText(f, nutrient, unit)}</span>
                    </button>
                );
            })}
            {added > 0 && <span className="tiny secondary" style={{ alignSelf: 'center' }}>Update the plan to check.</span>}
        </div>
    );
}

function perServingText(f: TopFood, nutrient: string, unit: string): string {
    if (f.best) return `${fmtNumber(f.best.perServing)} ${unit} per ${f.best.servingLabel}`;
    return `${fmtNumber(nv(f, nutrient))} ${unit} per 100 g`;
}

/** A readable but bounded name, e.g. "Mushrooms, portabella, exposed to ultraviolet…". */
function shortName(description: string): string {
    const clean = description.replace(/\s*\(includes foods for usda's food distribution program\)/i, '');
    return clean.length > 44 ? `${clean.slice(0, 42).trimEnd()}…` : clean;
}
