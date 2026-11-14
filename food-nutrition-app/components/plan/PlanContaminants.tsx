'use client';

/**
 * "Contaminants in this plan": the whole day's (or week's) totals at the planned grams, each
 * food's share, and one-click fixes for the foods that push a total up.
 *
 * PLUS-GATE: planContaminants. Self-contained: wrapping <PlanContaminants> is the whole gate.
 */
import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import { formatAmount, formatPercent, LEVELS } from '@/lib/contaminants-meter';
import { reduceFactor, type PlanContaminantRow, type PlanContaminantSummary, type PlanPortion } from '@/lib/plan-contaminants-core';
import type { SwapCandidate } from '@/lib/plan-contaminants';
import { RecentCache } from '@/lib/navigation-ux';
import { sameOriginFetch } from '@/lib/same-origin-fetch';
import { formatGrams } from '@/lib/serving-scale';
import Icon from '@/components/ui/Icon';
import styles from './PlanContaminants.module.css';

export interface PlanContaminantActions {
    /** Keep `factor` (0-1) of this food and plan again. `grams` is what the plan has of it now (the period's total). */
    onReduce?: (key: number, factor: number, grams: number) => void;
    /** Leave the food out and plan again. */
    onExclude?: (key: number) => void;
    /** Use another food instead and plan again. */
    onSwap?: (key: number, to: SwapCandidate) => void;
}

interface Props extends PlanContaminantActions {
    /** Each day's foods at their planned grams. A day plan is one day. */
    days: PlanPortion[][];
    /** Week view: names for days, for "highest day". */
    dayNames?: string[];
    /** Turn the action buttons off (e.g. while a plan is being made). */
    busy?: boolean;
}

interface Loaded { summary: PlanContaminantSummary; swaps: Record<string, SwapCandidate[]> }

const cache = new RecentCache<Loaded>(30);
const FETCH_DELAY_MS = 150;
const METHODOLOGY = '/methodology#plan-totals';

/** The request body for a plan: also the cache key, so the panel follows the planned grams exactly. */
export function contaminantRequest(days: PlanPortion[][]): string {
    return JSON.stringify({ days: days.map(d => d.filter(p => p.grams > 0).map(p => ({ key: p.key, fdcId: p.fdcId, name: p.name, grams: p.grams }))) });
}

function useSummary(days: PlanPortion[][]) {
    const body = useMemo(() => contaminantRequest(days), [days]);
    const [state, setState] = useState<{ body: string; data: Loaded | null; failed: boolean }>(() => ({ body, data: cache.get(body) ?? null, failed: false }));
    const [attempt, setAttempt] = useState(0);
    const current = state.body === body ? state : { body, data: cache.get(body) ?? null, failed: false };

    useEffect(() => {
        if (cache.get(body)) return;
        const ctrl = new AbortController();
        const timer = setTimeout(() => {
            sameOriginFetch('/api/plan/contaminants', { method: 'POST', json: JSON.parse(body), signal: ctrl.signal })
                .then(async res => {
                    if (!res.ok) throw new Error(String(res.status));
                    const data = await res.json() as Loaded;
                    cache.set(body, data);
                    setState({ body, data, failed: false });
                })
                .catch(() => { if (!ctrl.signal.aborted) setState({ body, data: null, failed: true }); });
        }, FETCH_DELAY_MS);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [body, attempt]);

    return { ...current, retry: () => { setState({ body, data: null, failed: false }); setAttempt(a => a + 1); } };
}

const levelClass = (level: string) => styles[`level_${level}`];

function Badge({ row }: { row: PlanContaminantRow }) {
    if (row.status === 'no_data') return <span className={`${styles.badge} ${styles.neutral}`}>No data</span>;
    if (row.status === 'not_detected') return <span className={`${styles.badge} ${styles.neutral}`}>Not detected</span>;
    if (row.kind === 'comparison') return <span className={`${styles.badge} ${styles.neutral}`}>Comparison only</span>;
    if (!row.level || !row.levelLabel) return null;
    return <span className={`${styles.badge} ${levelClass(row.level)}`}>{row.levelLabel}</span>;
}

function Meter({ row }: { row: PlanContaminantRow }) {
    if (row.kind === 'comparison' || row.status !== 'measured' || row.percent === null) return null;
    return (
        <div className={styles.meter} role="img" aria-label={`${row.name}: ${row.levelLabel?.toLowerCase()}. ${row.text}`}>
            {LEVELS.map(level => <span key={level} className={`${styles.segment} ${levelClass(level)}`} />)}
            <span className={styles.marker} style={{ left: `${row.position}%` }} />
        </div>
    );
}

function names(list: { name: string }[], max = 3): string {
    const shown = list.slice(0, max).map(f => f.name).join(', ');
    return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}

function Flagged({ row, swaps, actions, days, busy }: { row: PlanContaminantRow; swaps: Record<string, SwapCandidate[]>; actions: PlanContaminantActions; days: number; busy?: boolean }) {
    if (row.flagged.length === 0) return null;
    const elevated = row.id === 'mercury' ? (days === 1 ? "a third of the week's reference" : "half the week's reference") : "half the day's reference";
    return (
        <>
            {row.flagged.map(key => {
                const c = row.contributors.find(x => x.key === key);
                if (!c) return null;
                const keep = reduceFactor(row, key, days);
                const options = c.fdcId ? swaps[`${c.fdcId}:${row.id}`] ?? [] : [];
                const pct = c.percent === null ? null : row.id === 'mercury' ? c.percent : c.percent / Math.max(1, days);
                return (
                    <div key={key} className={styles.flag} data-testid="contaminant-flag">
                        <div className={styles.flagHead}>
                            {c.name} adds {pct === null ? 'most of this' : `${formatPercent(pct)} of the reference`}{days > 1 && row.id !== 'mercury' ? ' on an average day' : ''}, pushing the total past {elevated}.
                        </div>
                        <div className={styles.actions}>
                            {keep !== null && actions.onReduce && (
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => actions.onReduce!(key, keep, c.grams)}>
                                    {days > 1 ? `Cut it by ${Math.round((1 - keep) * 100)}%` : `Reduce to ${formatGrams(Math.floor((c.grams * keep) / 5) * 5)} g`}
                                </button>
                            )}
                            {options.slice(0, 2).map(o => actions.onSwap && (
                                <button key={o.fdcId} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => actions.onSwap!(key, o)}
                                    title={`${formatPercent(o.percentPer100g)} of the reference per 100 g, against ${formatPercent(o.originalPercentPer100g)}`}>
                                    Swap for {o.description}
                                </button>
                            ))}
                            {actions.onExclude && (
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => actions.onExclude!(key)}>
                                    <Icon name="x" size={13} /> Leave it out and re-plan
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </>
    );
}

function RowView({ row, summary, swaps, actions, dayNames, busy }: { row: PlanContaminantRow; summary: PlanContaminantSummary; swaps: Record<string, SwapCandidate[]>; actions: PlanContaminantActions; dayNames?: string[]; busy?: boolean }) {
    const subs: string[] = [];
    if (row.weekIfEveryDay !== undefined && row.status === 'measured') {
        subs.push(`Eaten every day, a week like this would be ${formatPercent(row.weekIfEveryDay)} of the weekly reference.`);
    }
    if (row.highestDay && row.status === 'measured' && dayNames) {
        subs.push(`Highest day: ${dayNames[row.highestDay.day] ?? `day ${row.highestDay.day + 1}`}, ${formatPercent(row.highestDay.percent)}.`);
    }
    if (row.atLeast) subs.push(`${row.unknown.length} ${row.unknown.length === 1 ? 'food has' : 'foods have'} no ${row.id === 'pesticide_residues' ? 'pesticide testing' : 'data'} here (${names(row.unknown)}), so the real total can be higher.`);
    if (row.notRated.length > 0) subs.push(`Not counted: ${names(row.notRated)}. Arsenic in seafood is mostly organic forms considered far less harmful, and the testing can't separate them.`);
    if (row.context) subs.push(row.context);
    return (
        <li className={styles.row} data-testid={`plan-contaminant-${row.id}`} data-level={row.level ?? row.status}>
            <div className={styles.head}>
                <span className={styles.name}>{row.name}</span>
                <Badge row={row} />
            </div>
            <Meter row={row} />
            <p className={styles.text}>{row.text}</p>
            {subs.map(s => <p key={s} className={styles.sub}>{s}</p>)}
            <Flagged row={row} swaps={swaps} actions={actions} days={summary.days} busy={busy} />
        </li>
    );
}

function Details({ summary }: { summary: PlanContaminantSummary }) {
    const rows = summary.rows.filter(r => r.contributors.some(c => c.amount > 0));
    const week = summary.period === 'week';
    return (
        <details className="disclosure disclosure-plain" style={{ marginTop: 12 }}>
            <summary>Each food&apos;s share</summary>
            <div className="disclosure-body">
                {rows.length === 0 && <p className="small muted">No food in this plan has a measured amount.</p>}
                {rows.map(r => (
                    <div key={r.id}>
                        <h4 className={styles.detailTitle}>{r.name}</h4>
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th scope="col">Food</th>
                                        <th scope="col">{week ? 'Grams this week' : 'Grams'}</th>
                                        <th scope="col">{r.unit === 'particles' ? 'Particles' : 'mcg'}</th>
                                        {r.kind === 'reference' && r.percent !== null && <th scope="col">{r.id === 'mercury' ? '% of week' : week ? '% of a day, averaged' : '% of the day'}</th>}
                                        <th scope="col">Share</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {r.contributors.filter(c => c.amount > 0).map(c => (
                                        <tr key={c.key}>
                                            <td>{c.name}{c.upperBoundOnly ? ' (at most)' : ''}</td>
                                            <td>{formatGrams(Math.round(c.grams * 10) / 10)}</td>
                                            <td>{formatAmount(c.amount)}</td>
                                            {r.kind === 'reference' && r.percent !== null && (
                                                <td>{c.percent === null ? '—' : formatPercent(r.id === 'mercury' || !week ? c.percent : c.percent / summary.days)}</td>
                                            )}
                                            <td>{formatPercent(c.share * 100)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {r.reference && (
                            <p className="tiny muted" style={{ marginTop: 4 }}>
                                Reference: {formatAmount(r.reference.amountUg)} mcg per {r.reference.period}, {r.reference.authority} ({r.reference.population.toLowerCase()}).
                            </p>
                        )}
                    </div>
                ))}
                <p className="small" style={{ marginTop: 12 }}>
                    Each food&apos;s amount is the food page&apos;s figure at the planned grams. <Link href={METHODOLOGY}>How we total a plan</Link>
                </p>
            </div>
        </details>
    );
}

export default function PlanContaminants({ days, dayNames, busy, ...actions }: Props) {
    const headingId = useId();
    const { data, failed, retry } = useSummary(days);
    const summary = data?.summary;
    const hasFoods = days.some(d => d.some(p => p.grams > 0));
    if (!hasFoods) return null;

    return (
        <section className="panel fade-in" aria-labelledby={headingId} data-testid="plan-contaminants" aria-busy={!summary && !failed}>
            <h3 className="panel-title" id={headingId}>Contaminants in this {days.length > 1 ? 'week' : 'plan'}</h3>
            <p className={`small secondary ${styles.intro}`}>
                Lead, cadmium, arsenic and pesticides are totalled against a day&apos;s reference, and mercury against a week&apos;s, at the planned amounts.{' '}
                <Link href={METHODOLOGY}>How we total a plan</Link>
            </p>
            {failed && (
                <div className="callout callout-warn" role="alert" style={{ marginTop: 12 }}>
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <div className="row-wrap" style={{ flex: 1 }}>
                        <span style={{ flex: 1, minWidth: 180 }}>We couldn&apos;t check contaminants for this plan.</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={retry}><Icon name="refresh" size={14} /> Try again</button>
                    </div>
                </div>
            )}
            {!summary && !failed && (
                <div aria-hidden="true" style={{ marginTop: 12 }}>
                    {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 14, width: `${80 - i * 12}%`, marginTop: 12 }} />)}
                </div>
            )}
            {summary && !summary.available && <p className="small muted" style={{ marginTop: 12 }}>This copy of the database has no contaminant data.</p>}
            {summary && summary.available && (
                <>
                    {summary.noDataFoods.length > 0 && (
                        <p className={styles.noData} data-testid="plan-contaminants-nodata">
                            <strong>{summary.noDataFoods.length} of {summary.foodsInPlan} {summary.foodsInPlan === 1 ? 'food has' : 'foods have'} no data</strong> ({names(summary.noDataFoods)}).
                            {' '}No data is not the same as none, so they count as unknown, never as zero.
                        </p>
                    )}
                    <ul className={styles.rows}>
                        {summary.rows.map(r => <RowView key={r.id} row={r} summary={summary} swaps={data.swaps} actions={actions} dayNames={dayNames} busy={busy} />)}
                    </ul>
                    <Details summary={summary} />
                    <p className={styles.disclaimer}>
                        General information from public food testing, not medical advice. Levels in any one package differ. Reference levels are cautious planning values, not a line between safe and harmful.
                    </p>
                </>
            )}
        </section>
    );
}
