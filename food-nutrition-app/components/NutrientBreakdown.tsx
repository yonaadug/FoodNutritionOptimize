'use client';

import { useId, useMemo, useState } from 'react';
import FoodLink, { OlderEntryMark } from '@/components/food/FoodLink';
import { GOAL_KEYS, fmtNumber, nutrientLabel, nutrientUnit, splitFoodName } from '@/components/planner/nutrients';
import type { Food } from '@/lib/food-types';
import { isFilled } from '@/lib/nutrient-fill';

export interface BreakdownItem {
    name: string;
    fixed: boolean;
    /** For the link to its page, and to mark values from an older USDA entry. */
    food?: Pick<Food, 'fdc_id' | 'description' | 'recipe' | 'filledFrom'>;
    /** Absolute amounts in this plan (not per 100 g); null = no data. */
    amounts: Record<string, number | null>;
}

/** "Where does my iron come from?": per-food contribution to one nutrient. */
export default function NutrientBreakdown({ items, initial = 'protein_g' }: { items: BreakdownItem[]; initial?: string }) {
    const [nutrient, setNutrient] = useState(initial);
    const selectId = useId();
    const unit = nutrientUnit(nutrient);

    const { rows, missing } = useMemo(() => {
        const withVals = items.map(i => ({ ...i, value: i.amounts[nutrient] ?? null }));
        const total = withVals.reduce((s, i) => s + (i.value ?? 0), 0);
        return {
            rows: withVals.filter(i => (i.value ?? 0) > 0)
                .map(i => ({ ...i, pct: total > 0 ? ((i.value ?? 0) / total) * 100 : 0 }))
                .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
            missing: withVals.filter(i => i.value === null).map(i => i.name),
        };
    }, [items, nutrient]);

    return (
        <div className="stack">
            <div className="field" style={{ maxWidth: 280 }}>
                <label htmlFor={selectId} className="field-label">Nutrient</label>
                <select id={selectId} className="select" value={nutrient} onChange={e => setNutrient(e.target.value)}>
                    <option value="calories">Calories</option>
                    {GOAL_KEYS.map(k => <option key={k} value={k}>{nutrientLabel(k)}</option>)}
                </select>
            </div>
            {rows.length === 0 ? (
                <p className="small muted">None of the foods in this plan provide {nutrientLabel(nutrient)}.</p>
            ) : (
                <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
                    {rows.map((r, i) => (
                        <li key={i} className="progress-item">
                            <div className="progress-head">
                                <span className="progress-name">
                                    {r.food ? <FoodLink food={r.food}>{splitFoodName(r.name).name}</FoodLink> : splitFoodName(r.name).name}
                                    {r.fixed && <span className="tiny muted"> (fixed)</span>}
                                </span>
                                <span className="progress-value">{fmtNumber(r.value)} {unit}{isFilled(r.food, nutrient) && <OlderEntryMark />} · {Math.round(r.pct)}%</span>
                            </div>
                            <div className="progress-track" aria-hidden="true">
                                <div className="progress-fill" style={{ width: `${r.pct}%`, background: r.fixed ? 'var(--text-muted)' : 'var(--primary)' }} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {missing.length > 0 && (
                <p className="tiny muted">No data for: {missing.map(m => splitFoodName(m).name).join(', ')}.</p>
            )}
        </div>
    );
}
