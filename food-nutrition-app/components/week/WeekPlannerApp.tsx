'use client';

/**
 * /plan/week: seven days from the planner's foods and goals.
 *
 * PLUS-GATE: weekPlanner (UI entry). The whole page is this component, so wrapping it is the gate.
 */
import IntentLink from '@/components/ui/IntentLink';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Food } from '@/lib/food-types';
import { fetchHistoryItem, fetchLatestHistory, useCurrentUser } from '@/lib/auth/client';
import type { HistoryItem } from '@/lib/user-store/history';
import { savedWeekFrom, weekFromSaved, WEEK_HISTORY_KIND } from '@/lib/week-planner/history';
import { WEEKLY_AVERAGE_KEYS } from '@/lib/week-planner/goals';
import { daysPerFood, weekGoalProgress } from '@/lib/week-planner/totals';
import type { WeekResult } from '@/lib/week-planner/types';
import { fetchFoodsByFdcIds } from '@/hooks/useFoodSearch';
import { getPlannerSnapshot, plannerActions, usePlannerState, type PlannerState } from '@/hooks/usePlannerState';
import { notify } from '@/hooks/useToasts';
import { biggerPortions, countGoals, presetTitle } from '@/components/planner/goals';
import { displayFoodName, fmtNumber, nutrientLabel, nutrientUnit, shortFoodName } from '@/components/planner/nutrients';
import PlanContaminants from '@/components/plan/PlanContaminants';
import { plannerContaminantActions } from '@/components/plan/contaminantActions';
import Icon from '@/components/ui/Icon';
import GroceryList from './GroceryList';
import WeekDays, { DAY_NAMES } from './WeekDays';
import { getWeekSnapshot, runWeek, useWeek, weekActions, type WeekState } from './weekStore';
import styles from './Week.module.css';
import PlusGate from '@/components/billing/PlusGate';

const replan = () => void runWeek(getPlannerSnapshot(), true);

function Settings({ week, planner, onRun }: { week: WeekState; planner: PlannerState; onRun: () => void }) {
    const varietyId = useId();
    const leftoversId = useId();
    const weeklyId = useId();
    const recipes = planner.fixedFoods.filter(f => f.food.recipe).length;
    const n = planner.foods.length + planner.fixedFoods.length;
    const goals = countGoals(planner.goals);
    return (
        <section className={`panel ${styles.printHide}`} aria-label="Week settings">
            <div className="panel-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <p className="eyebrow">Your foods and goals</p>
                    <p className="small" style={{ marginTop: 4 }}>
                        {n} {n === 1 ? 'food' : 'foods'}{recipes ? ` (${recipes} ${recipes === 1 ? 'recipe' : 'recipes'})` : ''} · {presetTitle(planner.presetId)}, {goals} {goals === 1 ? 'goal' : 'goals'}.{' '}
                        <IntentLink href="/plan#foods">Edit foods</IntentLink> · <IntentLink href="/plan#goals">Edit goals</IntentLink>
                    </p>
                </div>
            </div>
            <div className={styles.settings}>
                <div className="setting-row">
                    <div className="setting-text">
                        <div className="setting-title" id={varietyId}>Variety</div>
                        <div className="setting-help">The most days any one food appears in the week. Back-to-back days are avoided when possible.</div>
                    </div>
                    <select className={styles.select} aria-labelledby={varietyId} value={week.settings.maxDaysPerFood} data-testid="variety-select"
                        onChange={e => weekActions.setSettings({ maxDaysPerFood: Number(e.target.value) })}>
                        {[2, 3, 4, 5, 7].map(k => <option key={k} value={k}>{k === 7 ? 'Any day' : `At most ${k} days a week`}</option>)}
                    </select>
                </div>
                <div className="setting-row">
                    <div className="setting-text">
                        <div className="setting-title" id={leftoversId}>Cook once, eat twice</div>
                        <div className="setting-help">{recipes ? 'Recipes cooked one day can be eaten that day and the next.' : 'For recipes in your plan: add one from the Recipes page to use this.'}</div>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={week.settings.leftovers} aria-labelledby={leftoversId}
                            onChange={e => weekActions.setSettings({ leftovers: e.target.checked })} />
                        <span className="switch-track" />
                    </label>
                </div>
                <div className="setting-row">
                    <div className="setting-text">
                        <div className="setting-title" id={weeklyId}>Average stored vitamins and minerals over the week</div>
                        <div className="setting-help">
                            {WEEKLY_AVERAGE_KEYS.map(nutrientLabel).join(', ')} are met on average across the 7 days, since the body stores them
                            or intake naturally varies. Calories, protein, fiber, sodium, the other nutrients and every upper limit are met each day.
                        </div>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={week.settings.weeklyAverages} aria-labelledby={weeklyId}
                            onChange={e => weekActions.setSettings({ weeklyAverages: e.target.checked })} />
                        <span className="switch-track" />
                    </label>
                </div>
            </div>
            <div className="row-wrap" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary" onClick={onRun} disabled={n === 0 || week.status === 'loading'} data-testid="make-week">
                    {week.status === 'loading' ? <><span className="spinner" /> Planning your week…</> : week.result ? 'Make a new week' : 'Make my week'}
                </button>
                {n === 0 && <span className="small muted">Add foods in the <IntentLink href="/plan#foods">day planner</IntentLink> first.</span>}
            </div>
        </section>
    );
}

function GoalsSummary({ result }: { result: WeekResult }) {
    const rows = weekGoalProgress(result.days ?? [], result.goals);
    const days = result.days?.length ?? 7;
    return (
        <section className="panel" aria-labelledby="week-goals-title" data-testid="week-goals">
            <h2 className="panel-title" id="week-goals-title">Goals over the week</h2>
            <p className="small secondary" style={{ margin: '4px 0 10px' }}>
                &ldquo;Each day&rdquo; goals are checked on every day; &ldquo;weekly average&rdquo; goals on the average of the {days} days.
            </p>
            <div className="table-scroll">
                <table className={styles.goalTable}>
                    <thead><tr><th scope="col">Goal</th><th scope="col">Target</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead>
                    <tbody>
                        {rows.map(r => {
                            const unit = nutrientUnit(r.key);
                            const target = r.min !== undefined && r.max !== undefined ? `${fmtNumber(r.min)}–${fmtNumber(r.max)} ${unit}`
                                : r.min !== undefined ? `at least ${fmtNumber(r.min)} ${unit}` : `at most ${fmtNumber(r.max)} ${unit}`;
                            const result = r.mode === 'weekly'
                                ? `average ${fmtNumber(r.average)} ${unit}`
                                : `${r.daysMet} of ${r.days} days`;
                            return (
                                <tr key={r.key}>
                                    <td>{nutrientLabel(r.key)}{r.upperLimit ? ' (safe upper limit)' : ''}</td>
                                    <td className={styles.num}>{target}</td>
                                    <td>{r.mode === 'weekly' ? 'Weekly average' : 'Each day'}</td>
                                    <td className={r.status === 'met' ? styles.ok : r.status === 'low' ? styles.low : styles.high}>
                                        {r.status === 'met' ? '✓ ' : '⚠ '}{result}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function Variety({ result }: { result: WeekResult }) {
    const counts = [...daysPerFood(result.days ?? []).entries()].sort((a, b) => b[1] - a[1]);
    const foods = result.foods ?? {};
    return (
        <div data-testid="week-variety">
            <p className="small secondary">{counts.length} different foods this week. Days each one appears:</p>
            <div className={styles.variety}>
                {counts.map(([id, n]) => foods[String(id)] && (
                    <span key={id} className="chip">{shortFoodName(foods[String(id)].description)} · {n} {n === 1 ? 'day' : 'days'}</span>
                ))}
            </div>
        </div>
    );
}

function Infeasible({ result, planner, onRun, hasLocks }: { result: WeekResult; planner: PlannerState; onRun: () => void; hasLocks: boolean }) {
    const lines = (result.message ?? '').replace(/^Optimization Failed:\n?/, '').split('\n').map(l => l.replace(/^•\s*/, '')).filter(Boolean);
    return (
        <section className="panel" aria-labelledby="week-infeasible" data-testid="week-infeasible">
            <div className="callout callout-warn" role="alert">
                <span className="callout-icon"><Icon name="alert" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 className="callout-title" id="week-infeasible">This week can&apos;t meet every goal yet</h2>
                    <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{lines.map(l => <li key={l}>{l}</li>)}</ul>
                </div>
            </div>
            <div className="quick-fixes row-wrap" style={{ marginTop: 12 }}>
                {result.portionCapBinding && planner.portionCap.enabled && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { plannerActions.setPortionCap(biggerPortions(planner.portionCap)); setTimeout(onRun, 0); }}>
                        Allow bigger portions
                    </button>
                )}
                {hasLocks && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { weekActions.clearLocks(); setTimeout(onRun, 0); }}>Unlock all days and foods</button>}
                {result.diagnosis === 'time' && <button type="button" className="btn btn-secondary btn-sm" onClick={onRun}>Try again</button>}
                <IntentLink href="/plan#foods" className="btn btn-secondary btn-sm">Add or change foods</IntentLink>
                <IntentLink href="/plan#goals" className="btn btn-secondary btn-sm">Change goals</IntentLink>
            </div>
        </section>
    );
}

type OpenState = 'opening' | 'signed-out' | 'not-found' | 'too-long' | 'failed' | null;
const OPEN_MESSAGES: Record<Exclude<OpenState, 'opening' | null>, string> = {
    'signed-out': 'Sign in to open this saved week.',
    'not-found': "We couldn't find that saved week. It may have been removed.",
    'too-long': 'That week was too big to keep in full, so it can only be seen in your history.',
    failed: "We couldn't open that saved week. Check your connection, then try again.",
};

async function openSaved(item: HistoryItem): Promise<Exclude<OpenState, 'opening' | 'signed-out' | 'not-found'> | null> {
    const saved = savedWeekFrom(item.data);
    if (!saved) return 'too-long';
    try {
        const ids = [...saved.foods, ...saved.fixed.map(f => f[0]), ...saved.days.flat().map(e => e[0]).filter((r): r is number => typeof r === 'number')];
        const fetched = await fetchFoodsByFdcIds(ids);
        const { planner, result, missing } = weekFromSaved(saved, new Map(fetched.map(f => [f.fdc_id, f])), getPlannerSnapshot().fixedFoods);
        const before = getPlannerSnapshot();
        const weekBefore = getWeekSnapshot();
        plannerActions.replaceAll(planner);
        weekActions.open(result);
        const gone = missing > 0 ? ` ${missing} ${missing === 1 ? 'food is' : 'foods are'} no longer available, so ${missing === 1 ? 'it was' : 'they were'} left out.` : '';
        notify(`Opened your saved week.${gone}`, {
            action: {
                label: 'Undo',
                onClick: () => {
                    const { hydrated: _h, ...prev } = before;
                    void _h;
                    plannerActions.replaceAll(prev);
                    if (weekBefore.result) weekActions.open(weekBefore.result); else weekActions.reset();
                },
            },
        });
        return null;
    } catch {
        return 'failed';
    }
}

export default function WeekPlannerApp() {
    const planner = usePlannerState();
    const week = useWeek(planner);
    const { user } = useCurrentUser();
    const [openState, setOpenState] = useState<OpenState>(null);
    const [latest, setLatest] = useState<HistoryItem | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);

    const run = useCallback(() => void runWeek(getPlannerSnapshot(), false), []);

    // Focus the result when a run finishes in this page view.
    useEffect(() => {
        if (week.finished > 0 && week.status !== 'loading') headingRef.current?.focus({ preventScroll: true });
    }, [week.finished, week.status]);

    // /plan/week?open=<id>: a week from history.
    const handled = useRef(false);
    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        const id = new URLSearchParams(window.location.search).get('open');
        if (!id) return;
        void (async () => {
            setOpenState('opening');
            const found = await fetchHistoryItem(WEEK_HISTORY_KIND, id);
            if (found.status === 'signed-out') { setOpenState('signed-out'); return; }
            window.history.replaceState(window.history.state, '', window.location.pathname);
            if (found.status !== 'ok') { setOpenState(found.status); return; }
            setOpenState(await openSaved(found.item));
        })();
    }, []);

    // Signed in with no week here yet: offer the last saved one.
    useEffect(() => {
        if (!user || week.result || openState !== null) return;
        let current = true;
        fetchLatestHistory(WEEK_HISTORY_KIND, 1).then(items => { if (current) setLatest(items[0] ?? null); }).catch(() => { /* only an offer */ });
        return () => { current = false; };
    }, [user, week.result, openState]);

    const result = week.result;
    const success = result?.success && result.days ? result : null;
    const foods: Record<string, Food> = useMemo(() => result?.foods ?? {}, [result]);
    const contaminantDays = useMemo(() => (success?.days ?? []).map(d => d.entries.map(e => {
        const f = foods[String(e.foodId)];
        return { key: e.foodId, fdcId: f && !f.recipe ? f.fdc_id : null, name: f ? displayFoodName(f.description) : `Food ${e.foodId}`, grams: e.grams };
    })), [success, foods]);
    const contaminantActions = useMemo(() => plannerContaminantActions(replan, key => {
        const grams = (getWeekSnapshot().result?.days ?? []).flatMap(d => d.entries.filter(e => e.foodId === key).map(e => e.grams));
        return grams.length ? Math.max(...grams) : undefined;
    }), []);
    const hasLocks = week.lockedDays.length + week.lockedItems.length > 0;
    const busy = week.status === 'loading';

    if (!planner.hydrated) {
        return (
            <main className="container main">
                <h1 className="section-title" style={{ marginBottom: 16 }}>Plan your week</h1>
                <div className="skeleton sk-panel planner-pending" aria-hidden="true" />
            </main>
        );
    }

    return (
        <main className={`container main ${styles.printRoot}`} data-week-print>
            <div className={styles.printHide} style={{ marginBottom: 8 }}>
                <IntentLink href="/plan#plan" className="small"><Icon name="arrowLeft" size={14} /> Back to your day plan</IntentLink>
            </div>
            <h1 className="section-title" style={{ marginBottom: 4 }}>Plan your week</h1>
            <p className="secondary" style={{ marginBottom: 16 }}>
                Seven days from your foods and goals: different foods on different days, leftovers for recipes, and one grocery list.
            </p>

            {openState === 'opening' && (
                <div className="callout callout-info" role="status" style={{ marginBottom: 16 }}><span className="spinner" style={{ color: 'var(--primary)' }} /> Opening your saved week…</div>
            )}
            {openState !== null && openState !== 'opening' && (
                <div className="callout callout-warn" role="alert" style={{ marginBottom: 16 }}>
                    <span className="callout-icon"><Icon name="alert" /></span><span>{OPEN_MESSAGES[openState]}</span>
                </div>
            )}
            {latest && !week.result && openState === null && (
                <div className="callout callout-info" role="note" style={{ marginBottom: 16 }} data-testid="saved-week-offer">
                    <span className="callout-icon"><Icon name="info" /></span>
                    <div className="row-wrap" style={{ flex: 1 }}>
                        <span style={{ flex: 1, minWidth: 200 }}><span className="callout-title">Your last week:</span> {latest.title}</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { setOpenState('opening'); setOpenState(await openSaved(latest)); setLatest(null); }}>Open it</button>
                    </div>
                </div>
            )}

            <div className="stack-lg">
                <Settings week={week} planner={planner} onRun={run} />

                {week.status === 'error' && (
                    <div className="callout callout-danger" role="alert">
                        <span className="callout-icon"><Icon name="alert" /></span>
                        <div className="row-wrap" style={{ flex: 1 }}>
                            <span style={{ flex: 1, minWidth: 200 }}>{week.error}</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={run}><Icon name="refresh" size={14} /> Try again</button>
                        </div>
                    </div>
                )}

                {week.stale && result && (
                    <div className={`callout callout-info ${styles.printHide}`} role="status">
                        <span className="callout-icon"><Icon name="info" /></span>
                        <div className="row-wrap" style={{ flex: 1 }}>
                            <span style={{ flex: 1, minWidth: 200 }}><span className="callout-title">Your foods, goals or settings changed.</span> This week is out of date.</span>
                            <button type="button" className="btn btn-primary btn-sm" onClick={hasLocks ? replan : run}><Icon name="refresh" size={14} /> Update the week</button>
                        </div>
                    </div>
                )}

                {busy && !result && <div className="skeleton sk-panel" aria-hidden="true" style={{ height: 320 }} />}

                {result && !result.success && <Infeasible result={result} planner={planner} onRun={hasLocks ? replan : run} hasLocks={hasLocks} />}

                {success && (
                    <div className={`stack-lg${busy ? ' is-updating' : ''}`} aria-busy={busy}>
                        <section className="panel fade-in" aria-labelledby="week-title">
                            <div className="panel-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                    <p className="eyebrow">Your week · {presetTitle(planner.presetId)}</p>
                                    <h2 className="section-title" id="week-title" ref={headingRef} tabIndex={-1} style={{ marginTop: 4 }}>
                                        {busy && <span className="spinner" style={{ color: 'var(--primary)', marginRight: 10, display: 'inline-block' }} />}
                                        {weekHeadline(success)}
                                    </h2>
                                    <p className="panel-sub">
                                        Amounts are for each day. Tap <Icon name="pin" size={12} /> to keep a day or a food, then re-plan the rest.
                                        {success.solver.status === 'time_limit' && ' This is a good week, but the planner ran out of time before proving it the best one.'}
                                    </p>
                                </div>
                                <div className={`row-wrap ${styles.printHide}`}>
                                    <button type="button" className="btn btn-primary btn-sm" onClick={replan} disabled={busy} data-testid="replan">
                                        <Icon name="refresh" size={14} /> {hasLocks ? 'Re-plan the rest' : 'Re-plan the week'}
                                    </button>
                                    {hasLocks && <button type="button" className="btn btn-ghost btn-sm" onClick={weekActions.clearLocks} disabled={busy}>Unlock all</button>}
                                </div>
                            </div>
                            {success.varietyUsed !== undefined && (
                                <div className="callout callout-info" role="note" style={{ marginBottom: 12 }} data-testid="variety-raised">
                                    <span className="callout-icon"><Icon name="info" /></span>
                                    <span className="small">
                                        Your goals couldn&apos;t all be met with each food on at most {success.settings.maxDaysPerFood} days, so this week allows {success.varietyUsed === success.settings.days ? 'any food on any day' : `up to ${success.varietyUsed} days`}. Add more foods for more variety.
                                    </span>
                                </div>
                            )}
                            <WeekDays days={success.days!} foods={foods} lockedDays={week.lockedDays} lockedItems={week.lockedItems} busy={busy} />
                            <div style={{ marginTop: 16 }}><Variety result={success} /></div>
                        </section>

                        <GoalsSummary result={success} />

                        {/* PLUS-GATE: planContaminants (week view). */}
                        <PlusGate feature="planContaminants" compact>
                            <PlanContaminants days={contaminantDays} dayNames={DAY_NAMES} busy={busy} {...contaminantActions} />
                        </PlusGate>

                        <GroceryList days={success.days!} foods={foods} checked={week.checked} />

                        {(success.warnings?.length ?? 0) > 0 && (
                            <p className="small muted">
                                {success.warnings!.length} {success.warnings!.length === 1 ? 'food is' : 'foods are'} missing some USDA data, counted as 0, so real totals can be higher.
                            </p>
                        )}
                        <p className="tiny muted">
                            {user ? (week.run?.ownerId ? 'Saved to your account and this browser.' : 'Saved in this browser.') : 'Saved in this browser.'}
                            {success.solver.ms > 0 && ` Planned in ${fmtNumber(success.solver.ms / 1000, { decimals: 1 })} s.`}
                        </p>
                    </div>
                )}
            </div>
        </main>
    );
}

function weekHeadline(r: WeekResult): string {
    const progress = weekGoalProgress(r.days ?? [], r.goals).filter(p => p.key !== 'calories' && !p.upperLimit);
    const met = progress.filter(p => p.status === 'met').length;
    if (progress.length === 0) return 'Here’s your week';
    return met === progress.length ? 'Every goal met this week' : `${met} of ${progress.length} goals met this week`;
}
