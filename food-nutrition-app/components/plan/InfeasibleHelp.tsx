'use client';

import type { Food } from '@/lib/food-types';
import Icon from '@/components/ui/Icon';
import { plannerActions, type PlannerState } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { biggerPortions, describePortionCap } from '@/components/planner/goals';
import { useTopFoods } from '@/hooks/useTopFoods';
import { fmtNumber, hasCoreData, nutrientLabel, nutrientUnit, nv } from '@/components/planner/nutrients';
import type { PlanIssue } from './analysis';

interface InfeasibleHelpProps {
    state: PlannerState;
    parsed: { issues: PlanIssue[]; more: number };
    headingId: string;
    headingRef: React.RefObject<HTMLHeadingElement | null>;
    onRun: () => void;
    onEditGoals: () => void;
    debug: React.ReactNode;
    /** The plan would work if the general portion cap were lifted. */
    portionCapBinding?: boolean;
}

/**
 * Plain-language help when no combination of foods meets every goal:
 * which goals are the problem, foods that would help, and one-click fixes.
 */
export default function InfeasibleHelp({ state, parsed, headingId, headingRef, onRun, onEditGoals, debug, portionCapBinding }: InfeasibleHelpProps) {
    const { issues, more } = parsed;
    const nutrientIssues = issues.filter(i => i.nutrient && (i.kind === 'short' || i.kind === 'excess'));
    const otherIssues = issues.filter(i => !nutrientIssues.includes(i));
    const portionHelps = !!portionCapBinding;
    const selectedIds = new Set([...state.foods.map(f => f.id), ...state.fixedFoods.map(f => f.food.id)]);

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
                            No mix of your {state.foods.length + state.fixedFoods.length} foods covers everything at once.
                            Add a food that&apos;s rich in what&apos;s missing, or relax a goal. Each card below shows a quick fix.
                        </p>
                    </div>
                </div>

                {nutrientIssues.length > 0 && (
                    <ul className="issue-list" aria-label="Goals that can't be met">
                        {nutrientIssues.map((issue, i) => (
                            <IssueCard key={`${issue.nutrient}-${issue.kind}`} issue={issue} state={state} selectedIds={selectedIds} showSuggestions={i < 4} />
                        ))}
                    </ul>
                )}

                {otherIssues.length > 0 && (
                    <ul className="small secondary" style={{ marginTop: 16, paddingLeft: 18 }}>
                        {otherIssues.map((i, idx) => <li key={idx}>{i.text}</li>)}
                    </ul>
                )}
                {more > 0 && <p className="small muted" style={{ marginTop: 12 }}>…and {more} more {more === 1 ? 'goal' : 'goals'} that can&apos;t be met yet.</p>}

                <div className="row-wrap" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <span className="small secondary" style={{ flex: '1 1 100%' }}>Other quick fixes:</span>
                    {state.presetId !== 'essentials' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => plannerActions.applyPreset('essentials')}>
                            Switch to Everyday essentials
                        </button>
                    )}
                    {state.portionCap.enabled && (
                        <button type="button" className={`btn btn-sm ${portionHelps ? 'btn-primary-soft' : 'btn-secondary'}`}
                            onClick={() => {
                                const next = biggerPortions(state.portionCap);
                                plannerActions.setPortionCap(next);
                                notify(next.enabled ? `Portions can now go up to ${describePortionCap(next).replace(/^At most /, '')}.` : 'Portion limit turned off.',
                                    { action: { label: 'Update plan', onClick: onRun } });
                            }}>
                            Allow bigger portions{portionHelps ? ' (this would work)' : ''}
                        </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onEditGoals}>Review all goals</button>
                    <span className="spacer" />
                    <button type="button" className="btn btn-primary" onClick={onRun}><Icon name="refresh" size={15} /> Try again</button>
                </div>
            </div>
            {debug}
        </>
    );
}

function IssueCard({ issue, state, selectedIds, showSuggestions }: { issue: PlanIssue; state: PlannerState; selectedIds: Set<number>; showSuggestions: boolean }) {
    const key = issue.nutrient!;
    const label = nutrientLabel(key);
    const unit = nutrientUnit(key);
    const isCalories = key === 'calories';
    const amount = issue.amount !== undefined ? `${fmtNumber(issue.amount)} ${issue.unit && issue.unit !== 'g' && issue.unit !== unit ? issue.unit : unit}` : null;

    const title = issue.kind === 'short'
        ? `Not enough ${label.toLowerCase().startsWith('vitamin') ? label : label.toLowerCase()}`
        : `Too much ${label.toLowerCase().startsWith('vitamin') ? label : label.toLowerCase()}`;

    const turnOff = () => {
        if (isCalories) plannerActions.setCalories(issue.kind === 'short' ? { ...state.calories, min: undefined } : { ...state.calories, max: undefined });
        else plannerActions.setGoal(key, issue.kind === 'short' ? { ...state.goals[key], min: undefined } : { ...state.goals[key], max: undefined });
    };

    return (
        <li className="issue">
            <div className="issue-head">
                <span className="issue-title">{title}</span>
                {amount && <span className={`chip ${issue.kind === 'short' ? 'chip-warn' : ''}`} style={issue.kind === 'excess' ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}>
                    {issue.kind === 'short' ? 'short by' : 'over by'} {amount}
                </span>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={turnOff}>
                    {issue.kind === 'short' ? 'Drop this minimum' : 'Drop this limit'}
                </button>
            </div>
            <p className="small secondary" style={{ marginTop: 4 }}>
                {issue.fixedFoodsCause
                    ? 'Your fixed-amount foods already go over this on their own. Lower their amounts in Your foods.'
                    : issue.kind === 'short'
                        ? isCalories ? 'Your foods can’t add up to the minimum calories within the portion limits. Add more foods or allow bigger portions.'
                            : `None of your foods have enough ${label} to reach the goal within realistic portions.`
                        : isCalories ? 'Meeting your other goals takes more calories than your maximum allows.'
                            : `Meeting your other goals forces this over the limit. Swap in foods lower in ${label}, or relax the limit.`}
            </p>
            {issue.kind === 'short' && !isCalories && showSuggestions && <Suggestions nutrient={key} selectedIds={selectedIds} />}
        </li>
    );
}

function Suggestions({ nutrient, selectedIds }: { nutrient: string; selectedIds: Set<number> }) {
    const top = useTopFoods(nutrient, 50);
    const unit = nutrientUnit(nutrient);
    const candidates = top.foods.filter(f => !selectedIds.has(f.id) && hasCoreData(f));
    const everyday = candidates.filter(isEverydayFood);
    // Prefer everyday foods; if every top source is specialty (e.g. vitamin A → organ meats), still show something.
    const picks: Food[] = (everyday.length ? everyday : candidates).slice(0, 3);

    if (top.loading) return <div className="suggestions" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ width: 140, height: 30, borderRadius: 999 }} />)}</div>;
    if (top.error || picks.length === 0) return null;
    return (
        <div className="suggestions" aria-label={`Foods rich in ${nutrientLabel(nutrient)}`}>
            <span className="tiny muted" style={{ alignSelf: 'center' }}>Good sources:</span>
            {picks.map(f => (
                <button key={f.id} type="button" className="chip chip-btn" title={f.description}
                    onClick={() => plannerActions.addFood(f)} aria-label={`Add ${f.description}`}>
                    <Icon name="plus" size={12} /> {shortName(f.description)} <span className="muted">({fmtNumber(nv(f, nutrient))} {unit}/100 g)</span>
                </button>
            ))}
        </div>
    );
}

const SPECIALTY = /(powder|dehydrated|dry mix|drink mix|instant|freeze-dried|liver|giblet|p[aâ]t[eé]|variety meats|kidney|oil, |fish oil|supplement|formula|baby|leavening|spices?,|seasoning|yeast extract|gelatin)/i;
const SPECIALTY_CATEGORIES = /(fats and oils|spices and herbs|baby foods|supplements|beverages)/i;

/** Hide concentrated or specialty items (spices, powders, organ meats, oils) from beginner suggestions. */
function isEverydayFood(f: Food): boolean {
    return !SPECIALTY.test(f.description) && !SPECIALTY_CATEGORIES.test(f.food_category ?? '');
}

/** A readable but bounded USDA name, e.g. "Sweet potato, cooked, baked in skin". */
function shortName(description: string): string {
    return description.length > 48 ? `${description.slice(0, 46).trimEnd()}…` : description;
}
