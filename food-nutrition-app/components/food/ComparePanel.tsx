'use client';

import { useEffect, useId, useState } from 'react';
import type { Food } from '@/lib/food-types';
import ComparisonView from '@/components/ComparisonView';
import Icon from '@/components/ui/Icon';
import { fetchSearch } from '@/hooks/useFoodSearch';
import { shortFoodName, splitFoodName } from '@/components/planner/nutrients';

const MAX_OTHERS = 3;

function foodShort(f: Food): string {
    const { name, detail } = splitFoodName(f.description);
    return detail ? `${name}, ${detail}` : name;
}

/** Compare this food with up to three others: suggested forms, or anything found by search. */
export default function ComparePanel({ food, suggestions, onClose }: { food: Food; suggestions: Food[]; onClose: () => void }) {
    const [others, setOthers] = useState<Food[]>([]);
    const [query, setQuery] = useState('');
    const [found, setFound] = useState<{ q: string; foods: Food[] }>({ q: '', foods: [] });
    const searchId = useId();

    const trimmed = query.trim();
    const active = trimmed.length >= 2;

    useEffect(() => {
        if (!active) return;
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const r = await fetchSearch(trimmed, 1, 6, ctrl.signal);
                setFound({ q: trimmed, foods: r.foods });
            } catch { /* keep the previous results; typing again retries */ }
        }, 200);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [active, trimmed]);

    const full = others.length >= MAX_OTHERS;
    const toggle = (f: Food) => {
        setOthers(list => list.some(x => x.id === f.id) ? list.filter(x => x.id !== f.id) : list.length >= MAX_OTHERS ? list : [...list, f]);
    };
    const isOn = (f: Food) => others.some(x => x.id === f.id);

    const results = active && found.q === trimmed ? found.foods.filter(f => f.id !== food.id) : [];

    return (
        <div className="stack-lg" id="compare-area">
            <section className="panel" aria-labelledby={`${searchId}-title`}>
                <h2 className="panel-title" id={`${searchId}-title`}>Compare {shortFoodName(food.description)} with…</h2>
                <p className="panel-sub">Choose up to {MAX_OTHERS} foods.</p>
                {suggestions.length > 0 && (
                    <ul className="chip-list" style={{ marginTop: 12 }} aria-label="Suggested foods">
                        {suggestions.map(f => (
                            <li key={f.id}>
                                <button type="button" className="chip chip-btn compare-chip" aria-pressed={isOn(f)}
                                    disabled={!isOn(f) && full} onClick={() => toggle(f)} title={f.description}>
                                    <Icon name={isOn(f) ? 'check' : 'plus'} size={13} /> {foodShort(f)}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="field" style={{ marginTop: 14, maxWidth: 460 }}>
                    <label className="field-label" htmlFor={searchId}>Or search for another food</label>
                    <input id={searchId} className="input" type="search" autoComplete="off" placeholder="e.g. tofu, chicken thigh"
                        value={query} onChange={e => setQuery(e.target.value)} />
                </div>
                {results.length > 0 && (
                    <ul className="compare-results" aria-label="Foods found">
                        {results.map(f => (
                            <li key={f.id}>
                                <span className="food-name-line" title={f.description}>{foodShort(f)}</span>
                                <button type="button" className="btn-add" aria-pressed={isOn(f)} disabled={!isOn(f) && full}
                                    aria-label={`${isOn(f) ? 'Remove' : 'Add'} ${f.description} ${isOn(f) ? 'from' : 'to'} the comparison`}
                                    onClick={() => toggle(f)}>
                                    {isOn(f) ? <><Icon name="check" size={14} /> Added</> : <><Icon name="plus" size={14} /> Add</>}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {active && found.q === trimmed && results.length === 0 && (
                    <p className="small muted" style={{ marginTop: 10 }}>No foods match &ldquo;{trimmed}&rdquo;.</p>
                )}
                {others.some(o => !suggestions.some(s => s.id === o.id)) && (
                    <ul className="chip-list" style={{ marginTop: 12 }} aria-label="Also in the comparison">
                        {others.filter(o => !suggestions.some(s => s.id === o.id)).map(f => (
                            <li key={f.id}>
                                <button type="button" className="chip chip-btn compare-chip" aria-pressed="true" onClick={() => toggle(f)} title={`Remove ${f.description}`}>
                                    <Icon name="x" size={13} /> {foodShort(f)}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <ComparisonView foods={[food, ...others]} onClose={onClose} />
        </div>
    );
}
