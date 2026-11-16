'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useEffect, useId, useState } from 'react';
import {
    LEVELS, formatAmount, formatPercent, levelLabel,
    type BasedOn, type ContaminantGroup, type ContaminantItem, type ContaminantReport, type Meter as MeterData,
} from '@/lib/contaminants-meter';
import { formatGrams } from '@/lib/serving-scale';
import { RecentCache } from '@/lib/navigation-ux';
import styles from './ContaminantPanel.module.css';

const FETCH_DELAY_MS = 200;

/** Reports already shown in this visit, by food and serving, so Back shows the panel at once (and the page doesn't shift). */
const seenReports = new RecentCache<ContaminantReport>(40);

interface LoadState {
    key: string;
    report: ContaminantReport | null;
    failed: boolean;
}

const levelClass = (level: string) => styles[`level_${level}`];

function Meter({ meter, id }: { meter: MeterData; id: string }) {
    const relative = meter.scale === 'relative';
    return (
        <div className={styles.meterRow}>
            <div
                className={`${styles.meter} ${relative ? styles.meterRelative : ''}`}
                role="img"
                aria-labelledby={id}
            >
                {LEVELS.map(level => <span key={level} className={`${styles.segment} ${levelClass(level)}`} />)}
                <span className={styles.marker} style={{ left: `${meter.position}%` }} />
            </div>
            <span id={id} className={styles.srOnly}>{meter.text}</span>
        </div>
    );
}

function Badge({ item }: { item: ContaminantItem }) {
    if (item.status === 'no_data') return <span className={`${styles.badge} ${styles.badgeNeutral}`}>No data</span>;
    if (item.status === 'not_rated') return <span className={`${styles.badge} ${styles.badgeNeutral}`}>Not rated</span>;
    if (!item.meter) return null;
    if (item.status === 'not_detected') return <span className={`${styles.badge} ${styles.badgeNeutral}`}>{item.meter.label}</span>;
    const label = item.meter.scale === 'relative' ? levelLabel(item.meter.level, 'reference') : item.meter.label;
    return <span className={`${styles.badge} ${levelClass(item.meter.level)}`}>{label}</span>;
}

function ppm(value: number) {
    return formatAmount(value / 1000);
}

function Numbers({ item }: { item: ContaminantItem }) {
    const c = item.concentration;
    const s = item.perServing;
    const isParticles = s?.unit === 'particles';
    return (
        <dl className={styles.facts}>
            {s?.amount !== null && s?.amount !== undefined && (
                <>
                    <dt>Per serving</dt>
                    <dd>{item.upperBoundOnly ? 'At most ' : ''}{formatAmount(s.amount)} {s.unit}</dd>
                </>
            )}
            {s?.amount === null && s.upperBound !== null && (
                <>
                    <dt>Per serving</dt>
                    <dd>Less than {formatAmount(s.upperBound)} {s.unit}</dd>
                </>
            )}
            {!isParticles && s?.amount !== null && s?.upperBound !== null && s?.upperBound !== undefined && s.upperBound !== s.amount && (
                <>
                    <dt>If undetected samples sat just below the test limit</dt>
                    <dd>{formatAmount(s.upperBound)} {s.unit}</dd>
                </>
            )}
            {isParticles && s?.low !== null && s?.high !== null && s?.low !== undefined && s?.high !== undefined && (
                <>
                    <dt>Published range per serving</dt>
                    <dd>{formatAmount(s.low)} to {formatAmount(s.high)} particles</dd>
                </>
            )}
            {c && !isParticles && (
                <>
                    <dt>Measured level ({c.statistic})</dt>
                    <dd>{formatAmount(c.value)} ppb ({ppm(c.value)} ppm)</dd>
                </>
            )}
            {c && isParticles && (
                <>
                    <dt>Estimate ({c.statistic})</dt>
                    <dd>{formatAmount(c.value)} particles per gram</dd>
                </>
            )}
            {c && !isParticles && c.high !== null && (
                <>
                    <dt>Highest sample</dt>
                    <dd>{formatAmount(c.high)} ppb</dd>
                </>
            )}
            {item.percentOfReference !== null && item.reference && (
                <>
                    <dt>Share of reference</dt>
                    <dd>{formatPercent(item.percentOfReference)} of the {item.reference.period === 'week' ? 'weekly' : 'daily'} amount</dd>
                </>
            )}
        </dl>
    );
}

function ReferenceDetails({ item }: { item: ContaminantItem }) {
    const r = item.reference;
    if (!r) return null;
    return (
        <div className={styles.block}>
            <h5 className={styles.blockTitle}>Reference used</h5>
            <p>
                {formatAmount(r.amountUg)} mcg per {r.period}
                {r.bodyWeightKg !== null ? ` for ${/^(8|18)/.test(String(r.bodyWeightKg)) ? 'an' : 'a'} ${r.bodyWeightKg} kg adult` : ''}, from {r.authority} ({r.year}), set for: {r.population.toLowerCase()}.
            </p>
            <p className={styles.muted}>{r.basis}.</p>
            {r.whyChosen && <p className={styles.muted}>Why this one: {r.whyChosen}</p>}
            {r.notes && <p className={styles.muted}>{r.notes}</p>}
            {item.alternates.length > 0 && (
                <>
                    <p className={styles.muted}>Measured against other published values:</p>
                    <ul className={styles.list}>
                        {item.alternates.map(a => <li key={a.label}>{a.label}: {formatPercent(a.percent)}</li>)}
                    </ul>
                </>
            )}
        </div>
    );
}

function Quality({ item }: { item: ContaminantItem }) {
    const q = item.quality;
    if (!q) return null;
    const years = q.yearStart && q.yearEnd ? (q.yearStart === q.yearEnd ? String(q.yearEnd) : `${q.yearStart} to ${q.yearEnd}`) : null;
    return (
        <div className={styles.block}>
            <h5 className={styles.blockTitle}>How good is this data?</h5>
            <p>
                <strong>{q.grade === 'good' ? 'Good' : q.grade === 'fair' ? 'Fair' : 'Limited'}.</strong>
                {q.samples !== null ? ` ${q.samples.toLocaleString('en-US')} sample${q.samples === 1 ? '' : 's'}` : ' Published estimate'}
                {q.detected !== null && q.samples !== null ? `, found in ${q.detected.toLocaleString('en-US')}` : ''}
                {years ? `, tested ${years}` : ''}.
            </p>
            {q.matchConfidence !== null && (
                <p className={styles.muted}>Match to this food: {Math.round(q.matchConfidence * 100)}% confidence ({q.matchMethod?.replace('_', ' ')}).</p>
            )}
        </div>
    );
}

function Residues({ item }: { item: ContaminantItem }) {
    const p = item.pesticides;
    if (!p) return null;
    const over = p.samplesOverTolerance ?? 0;
    const noTol = p.samplesNoTolerance ?? 0;
    const top = p.residues.slice(0, 8);
    return (
        <div className={styles.block}>
            <h5 className={styles.blockTitle}>What USDA found</h5>
            {p.samplesTested !== null && p.samplesWithResidue !== null && (
                <p>
                    {p.samplesWithResidue.toLocaleString('en-US')} of {p.samplesTested.toLocaleString('en-US')} samples had a detectable residue.
                    {p.pesticidesTested !== null ? ` USDA tested for up to ${p.pesticidesTested} pesticides and found ${p.pesticidesDetected}.` : ''}
                </p>
            )}
            {p.samplesTested !== null && (
                <p className={styles.muted}>
                    {over.toLocaleString('en-US')} sample{over === 1 ? '' : 's'} went over an EPA tolerance, and {noTol.toLocaleString('en-US')} had a residue with no tolerance set for this food.
                    A tolerance is the level that triggers enforcement, not a health limit.
                </p>
            )}
            {top.length > 0 && (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <caption className={styles.srOnly}>Pesticides detected, largest share of reference first</caption>
                        <thead>
                            <tr><th scope="col">Pesticide</th><th scope="col">Samples with it</th><th scope="col">Share of daily reference</th></tr>
                        </thead>
                        <tbody>
                            {top.map(r => (
                                <tr key={r.name}>
                                    <th scope="row">{r.name}</th>
                                    <td>{r.detectionRate === null ? '—' : formatPercent(r.detectionRate * 100)}</td>
                                    <td>{r.percent === null ? 'No reference' : formatPercent(r.percent)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {p.residues.length > top.length && <p className={styles.muted}>Plus {p.residues.length - top.length} more with smaller shares.</p>}
        </div>
    );
}

function ItemRow({ item }: { item: ContaminantItem }) {
    const meterId = useId();
    const hasDetails = item.status !== 'no_data';
    return (
        <li className={styles.item}>
            <div className={styles.itemHead}>
                <h4 className={styles.itemName}>{item.name}</h4>
                <span className={styles.badges}>
                    {/* Microplastics carry a group-level "Limited data" tag instead. */}
                    {item.quality?.grade === 'limited' && item.id !== 'microplastics' && item.status !== 'not_rated' && (
                        <span className={`${styles.badge} ${styles.badgeLimited}`}>Rough estimate</span>
                    )}
                    <Badge item={item} />
                </span>
            </div>
            {item.meter && item.status !== 'not_detected' && <Meter meter={item.meter} id={meterId} />}
            <p className={styles.explanation}>{item.explanation}</p>
            {item.servingsLine && <p className={styles.servings}>{item.servingsLine}</p>}
            {item.context && <p className={styles.servings}>{item.context}</p>}
            {hasDetails && (
                <details className={styles.details}>
                    <summary>Details and sources<span className={styles.srOnly}> for {item.name}</span></summary>
                    <div className={styles.detailsBody}>
                        <Numbers item={item} />
                        <ReferenceDetails item={item} />
                        <Residues item={item} />
                        <Quality item={item} />
                        {item.caveats.length > 0 && (
                            <div className={styles.block}>
                                <h5 className={styles.blockTitle}>Keep in mind</h5>
                                <ul className={styles.list}>{item.caveats.map(c => <li key={c}>{c}</li>)}</ul>
                            </div>
                        )}
                        {item.sources.length > 0 && (
                            <div className={styles.block}>
                                <h5 className={styles.blockTitle}>Sources</h5>
                                <ul className={styles.list}>
                                    {item.sources.map(s => (
                                        <li key={s.id}>
                                            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
                                            <span className={styles.muted}> ({s.publisher}, {s.year})</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </details>
            )}
        </li>
    );
}

/** "Based on: FDA Total Diet Study 'Eggs, hard-boiled', applies to 38 similar foods." */
function BasedOnLine({ items }: { items: ContaminantItem[] }) {
    const seen = new Map<string, BasedOn>();
    for (const i of items) if (i.basedOn) seen.set(i.basedOn.profileId, i.basedOn);
    if (seen.size === 0) return null;
    return (
        <ul className={styles.basedOn}>
            {[...seen.values()].map(b => (
                <li key={b.profileId}>
                    Based on: {b.sourceName}, &ldquo;{b.name}&rdquo;{b.sharedWith > 1 ? `, applies to ${b.sharedWith.toLocaleString('en-US')} similar foods` : ''}
                </li>
            ))}
        </ul>
    );
}

function Group({ group }: { group: ContaminantGroup }) {
    const limited = group.id === 'microplastics';
    return (
        <section className={styles.group} aria-label={group.label}>
            <div className={styles.groupHead}>
                <h3 className={styles.groupTitle}>{group.label}</h3>
                {limited && <span className={`${styles.badge} ${styles.badgeLimited}`}>Limited data</span>}
            </div>
            {limited && group.items.some(i => i.status !== 'no_data') && (
                <p className={styles.limitedNote}>
                    Science on microplastics in food is young, and studies count particles in different ways. No health limit exists, so this meter
                    only compares foods that have been studied. It does not rate safety.
                </p>
            )}
            <BasedOnLine items={group.items} />
            <ul className={styles.items}>{group.items.map(i => <ItemRow key={i.id} item={i} />)}</ul>
        </section>
    );
}

/**
 * Contaminant levels for one food at one serving size. Fetches its own data and re-fetches when the
 * serving changes. Foods with no testing get one calm line, never a fake zero.
 */
export default function ContaminantPanel({ fdcId, servingGrams }: { fdcId: number; servingGrams: number }) {
    const titleId = useId();
    const [attempt, setAttempt] = useState(0);
    const key = `${fdcId}:${servingGrams}:${attempt}`;
    const seen = attempt === 0 ? seenReports.get(`${fdcId}:${servingGrams}`) : undefined;
    const [state, setState] = useState<LoadState | null>(null);

    useEffect(() => {
        if (seen) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/contaminants?fdcId=${encodeURIComponent(fdcId)}&grams=${encodeURIComponent(servingGrams)}`, { signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const report = await res.json() as ContaminantReport;
                seenReports.set(`${fdcId}:${servingGrams}`, report);
                setState({ key, report, failed: false });
            } catch {
                if (!controller.signal.aborted) setState({ key, report: null, failed: true });
            }
        }, FETCH_DELAY_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [fdcId, servingGrams, key, seen]);

    const loading = !seen && state?.key !== key;
    const report = seen ?? state?.report ?? null;

    if (!seen && state?.failed && !loading) {
        return (
            <section className={`panel ${styles.panel}`} aria-labelledby={titleId}>
                <h2 className={styles.title} id={titleId}>Contaminants</h2>
                <p className={styles.explanation}>We couldn&apos;t load this right now.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt(a => a + 1)}>Try again</button>
            </section>
        );
    }
    if (!report) {
        return (
            <section className={`panel ${styles.panel}`} aria-labelledby={titleId} aria-busy="true">
                <h2 className={styles.title} id={titleId}>Contaminants</h2>
                <p className={styles.explanation} role="status">Loading test results…</p>
            </section>
        );
    }
    if (!report.available) return null;
    if (!report.hasData) {
        return (
            <section className={`panel ${styles.panel}`} aria-labelledby={titleId}>
                <h2 className={styles.title} id={titleId}>Contaminants</h2>
                <p className={styles.explanation}>
                    No public contaminant testing matches this food yet. That doesn&apos;t tell you anything either way about what it contains.{' '}
                    <IntentLink href={`${report.methodologyUrl}#similar-foods`}>How we match foods</IntentLink>
                </p>
            </section>
        );
    }
    return (
        <section className={`panel ${styles.panel}`} aria-labelledby={titleId} aria-busy={loading}>
            <h2 className={styles.title} id={titleId}>Contaminants</h2>
            <p className={styles.intro}>
                Heavy metals, pesticide residues and microplastics in one {formatGrams(report.serving.grams)} g serving, from government testing and published studies.
                Most foods contain traces of these. The meters show typical levels, so you can compare foods without reading raw numbers.
            </p>
            {report.groups.map(g => <Group key={g.id} group={g} />)}
            <details className={styles.details}>
                <summary>How we work this out</summary>
                <div className={styles.detailsBody}>
                    <p>One serving&apos;s amount is compared with a health-based reference from a public agency.</p>
                    <ul className={styles.list}>
                        <li>Lead, cadmium, arsenic and pesticides, share of a day&apos;s reference: low under 10%, moderate 10-25%, elevated 25-50%, high 50% or more.</li>
                        <li>Mercury, share of a week&apos;s reference: low under 10%, moderate 10-33%, elevated 33-100%, high 100% or more. These line up with the FDA/EPA fish advice.</li>
                        <li>Microplastics, particles per serving: low under 10, moderate 10-50, elevated 50-200, high 200 or more. This compares studied foods and is not a safety rating.</li>
                    </ul>
                    <p>Similar foods share one set of measurements, so large and medium eggs use the same egg testing. Dried and cooked forms are scaled for water content where that is reasonable.</p>
                    <p><IntentLink href={report.methodologyUrl}>Read the full methodology and all sources</IntentLink></p>
                </div>
            </details>
            <p className={styles.disclaimer}>{report.disclaimer}</p>
        </section>
    );
}
