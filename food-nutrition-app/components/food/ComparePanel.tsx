'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Food } from '@/lib/food-types';
import type { FoodGroupResult } from '@/lib/food-groups';
import type { Anchor } from '@/lib/compare-weights';
import ComparisonView from '@/components/ComparisonView';
import Icon from '@/components/ui/Icon';
import { fetchGroupedSearch } from '@/hooks/useFoodSearch';
import { shortFoodName, splitFoodName } from '@/components/planner/nutrients';
import { MostCommonNote } from '@/components/explore/FoodGroupRow';
import { foodForType } from '@/components/foods/FoodGroupRow';
import TypePicker, { TypesToggle } from '@/components/foods/TypePicker';

const MAX_OTHERS = 3;

function foodShort(f: Food): string {
    const { name, detail } = splitFoodName(f.description);
    return detail ? `${name}, ${detail}` : name;
}

/** Compare this food with up to three others: suggested forms, or anything found by search. */
export default function ComparePanel({ food, suggestions, onClose, anchor }: { food: Food; suggestions: Food[]; onClose: () => void; anchor?: Anchor }) {
    const [others, setOthers] = useState<Food[]>([]);
    const [query, setQuery] = useState('');
    const [found, setFound] = useState<{ q: string; groups: FoodGroupResult[] }>({ q: '', groups: [] });
    const searchId = useId();

    const trimmed = query.trim();
    const active = trimmed.length >= 2;

    useEffect(() => {
        if (!active) return;
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const r = await fetchGroupedSearch(trimmed, 1, 6, ctrl.signal);
                setFound({ q: trimmed, groups: r.groups });
            } catch { /* keep the previous results; typing again retries */ }
        }, 200);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [active, trimmed]);

    const full = others.length >= MAX_OTHERS;
    const toggle = (f: Food) => {
        setOthers(list => list.some(x => x.id === f.id) ? list.filter(x => x.id !== f.id) : list.length >= MAX_OTHERS ? list : [...list, f]);
    };
    const isOn = (f: Food) => others.some(x => x.id === f.id);
    const isOnId = (id: number) => others.some(x => x.id === id);

    // This page's own food is never offered: a food that is only this page's food is left out.
    const results = active && found.q === trimmed
        ? found.groups.filter(g => g.count > 1 || g.food.id !== food.id)
        : [];

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
                        {results.map(g => (
                            <CompareResult key={g.key} group={g} query={trimmed} pageFoodId={food.id} full={full}
                                isOn={isOnId} onToggle={toggle} />
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
            <ComparisonView foods={[food, ...others]} onClose={onClose} anchor={anchor} />
        </div>
    );
}

interface CompareResultProps {
    group: FoodGroupResult;
    query: string;
    /** The food this page is about: never compared with itself. */
    pageFoodId: number;
    full: boolean;
    isOn: (id: number) => boolean;
    onToggle: (food: Food) => void;
}

/**
 * One food found in Compare's search. Add compares its most common type; a food with
 * several types also has a "9 types" control to compare another type instead.
 */
function CompareResult({ group, query, pageFoodId, full, isOn, onToggle }: CompareResultProps) {
    const [open, setOpen] = useState(false);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const pickerId = useId();
    const f = group.food;
    const multi = group.count > 1;
    // When the most common type is this page's food, Add would compare it with itself: only the picker is offered.
    const self = f.id === pageFoodId;
    const on = isOn(f.id);
    const addedTypes = group.types.filter(t => isOn(t.id)).length;
    const close = () => {
        setOpen(false);
        toggleRef.current?.focus();
    };
    return (
        <li className="compare-result">
            <div className="compare-result-row">
                <span className="food-name-line" title={f.description}>
                    {multi ? <><span className="food-name">{group.name}</span><MostCommonNote group={group} /></> : foodShort(f)}
                </span>
                {multi && (
                    <TypesToggle ref={toggleRef} name={group.name} count={group.count} open={open} controls={pickerId}
                        added={addedTypes} onClick={() => (open ? close() : setOpen(true))} />
                )}
                {!self && (
                    <button type="button" className="btn-add" aria-pressed={on} disabled={!on && full}
                        aria-label={`${on ? 'Remove' : 'Add'} ${f.description}${multi ? ' (most common type)' : ''} ${on ? 'from' : 'to'} the comparison`}
                        onClick={() => onToggle(f)}>
                        {on ? <><Icon name="check" size={14} /> Added</> : <><Icon name="plus" size={14} /> Add</>}
                    </button>
                )}
            </div>
            {open && (
                <TypePicker id={pickerId} name={group.name} count={group.count} types={group.types}
                    more={{ query, groupKey: group.key }} onClose={close}
                    mode={{
                        kind: 'toggle', target: 'the comparison', currentId: pageFoodId,
                        isOn: t => isOn(t.id),
                        isDisabled: () => full,
                        onToggle: async t => onToggle(await foodForType(group, t)),
                    }} />
            )}
        </li>
    );
}
