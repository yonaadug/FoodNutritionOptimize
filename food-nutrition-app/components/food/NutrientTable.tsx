'use client';

import { useMemo } from 'react';
import type { Food } from '@/lib/food-types';
import { fmt, nutrientTable } from '@/lib/food-page';

/**
 * Every nutrient we have for this food, scaled to the chosen serving and grouped.
 * "—" always means "not measured", never zero.
 */
export default function NutrientTable({ food, grams, servingLabel }: { food: Food; grams: number; servingLabel: string }) {
    const groups = useMemo(() => nutrientTable(food, grams), [food, grams]);
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
                            <th scope="col" className="num">% DV</th>
                            <th scope="col" className="num col-100g">Per 100 g</th>
                        </tr>
                    </thead>
                    {groups.map(g => (
                        <tbody key={g.id} data-group={g.id}>
                            <tr className="group-row"><th colSpan={4} scope="rowgroup">{g.title}</th></tr>
                            {g.rows.map(r => (
                                <tr key={r.key} data-missing={r.amount === null || undefined}>
                                    <th scope="row" data-indent={r.indent}>{r.label}</th>
                                    <td className="num tabular" title={r.amount === null ? 'Not measured by USDA for this food' : undefined}>
                                        {r.amount === null ? <span className="muted">—</span> : `${fmt(r.amount)} ${r.unit}`}
                                    </td>
                                    <td className="num tabular">
                                        {r.dvPct === null ? <span className="muted">{r.amount === null ? '—' : ''}</span> : (
                                            <span className="dv-cell">
                                                <span className="dv-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, r.dvPct)}%` }} /></span>
                                                {fmt(r.dvPct, 0)}%
                                            </span>
                                        )}
                                    </td>
                                    <td className="num tabular muted col-100g">{r.per100g === null ? '—' : `${fmt(r.per100g)} ${r.unit}`}</td>
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
                % DV = share of the FDA Daily Value for adults (a 2,000-calorie reference diet; adequate intake where no Daily Value exists).
                &ldquo;—&rdquo; means USDA has no measurement for this nutrient, which is not the same as zero.
            </p>
        </section>
    );
}
