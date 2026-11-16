'use client';

import { useMemo } from 'react';
import type { Food } from '@/lib/food-types';
import IntentLink from '@/components/ui/IntentLink';
import { fmt, nutrientTable } from '@/lib/food-page';
import { filledKeys, isFilled, OLDER_ENTRY_NOTE } from '@/lib/nutrient-fill';
import { OlderEntryMark } from './FoodLink';

/**
 * Every nutrient we have for this food, scaled to the chosen serving and grouped.
 * "—" always means "not measured", never zero.
 */
export default function NutrientTable({ food, grams, servingLabel }: { food: Food; grams: number; servingLabel: string }) {
    const groups = useMemo(() => nutrientTable(food, grams), [food, grams]);
    const olderIds = Array.from(new Set(filledKeys(food).map(k => food.filledFrom![k])));
    return (
        <section className="panel" aria-labelledby="nutrients-table-title">
            <div className="panel-header">
                <div>
                    <h2 className="panel-title" id="nutrients-table-title">All nutrients</h2>
                    <p className="panel-sub">Per {servingLabel}.</p>
                </div>
            </div>
            <div className="table-scroll" tabIndex={0} role="group" aria-labelledby="nutrients-table-title">
                <table className="nutrient-table">
                    <thead>
                        <tr>
                            <th scope="col">Nutrient</th>
                            <th scope="col" className="num">Amount</th>
                            <th scope="col" className="num" colSpan={2}>% DV</th>
                            <th scope="col" className="num col-100g">Per 100 g</th>
                        </tr>
                    </thead>
                    {groups.map(g => (
                        <tbody key={g.id} data-group={g.id}>
                            <tr className="group-row"><th colSpan={5} scope="rowgroup">{g.title}</th></tr>
                            {g.rows.map(r => (
                                <tr key={r.key} data-missing={r.amount === null || undefined}>
                                    <th scope="row" data-indent={r.indent}>{r.label}</th>
                                    <td className="num tabular" title={r.amount === null ? 'Not measured by USDA for this food' : undefined}>
                                        {r.amount === null ? <span className="muted">—</span> : `${fmt(r.amount)} ${r.unit}`}
                                        {isFilled(food, r.key) && <OlderEntryMark />}
                                    </td>
                                    {/* Bar and number in their own columns, so every bar starts at the same x. */}
                                    <td className="dv-bar-cell">
                                        {r.dvPct !== null && (
                                            <span className="dv-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, r.dvPct)}%` }} /></span>
                                        )}
                                    </td>
                                    <td className="num tabular dv-num-cell">
                                        {r.dvPct === null ? <span className="muted">{r.amount === null ? '—' : ''}</span> : `${fmt(r.dvPct, 0)}%`}
                                    </td>
                                    <td className="num tabular muted col-100g">{r.per100g === null ? '—' : `${fmt(r.per100g)} ${r.unit}`}</td>
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
            {olderIds.length > 0 && (
                <p className="small secondary" style={{ marginTop: 10 }} data-testid="older-entry-note">
                    <span aria-hidden="true">† </span>
                    Values marked † are {OLDER_ENTRY_NOTE}, because the newest entry has no measurement for them.{' '}
                    {olderIds.map((id, i) => <span key={id}>{i > 0 && ', '}<IntentLink href={`/food/${id}`}>See the older entry</IntentLink></span>)}
                    {' · '}<IntentLink href="/methodology#older-entries">Why we do this</IntentLink>
                </p>
            )}
            <p className="tiny muted" style={{ marginTop: 10 }}>
                % DV = share of the FDA Daily Value for adults (a 2,000-calorie reference diet; adequate intake where no Daily Value exists).
                &ldquo;—&rdquo; means USDA has no measurement for this nutrient, which is not the same as zero.
            </p>
        </section>
    );
}
