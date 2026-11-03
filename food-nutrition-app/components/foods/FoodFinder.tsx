'use client';

import { useId, useRef, useState } from 'react';
import type { Food } from '@/lib/db';
import Icon from '@/components/ui/Icon';
import FoodRow, { FoodRowSkeleton } from './FoodRow';
import { useFoodSearch } from '@/hooks/useFoodSearch';
import { useTopFoods } from '@/hooks/useTopFoods';
import { GOAL_KEYS, fmtNumber, hasCoreData, nutrientLabel, nutrientUnit, nv, NUTRIENT_GROUPS } from '@/components/planner/nutrients';

const QUICK_SEARCHES = ['oats', 'egg', 'salmon', 'spinach', 'yogurt', 'lentils', 'banana', 'almonds', 'chicken', 'rice', 'tofu', 'broccoli'];

interface FoodFinderProps {
    isAdded: (id: number) => boolean;
    onToggle: (food: Food) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function FoodFinder({ isAdded, onToggle, searchInputRef }: FoodFinderProps) {
    const [tab, setTab] = useState<'search' | 'best'>('search');
    const tabsId = useId();

    return (
        <section className="panel" aria-labelledby={`${tabsId}-title`}>
            <div className="panel-header" style={{ flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <h2 className="panel-title" id={`${tabsId}-title`}>Find foods you like</h2>
                    <p className="panel-sub">Add a handful of foods you&apos;d happily eat. More variety makes goals easier to hit.</p>
                </div>
                <div className="segmented" role="tablist" aria-label="How to find foods">
                    <button type="button" role="tab" id={`${tabsId}-tab-search`} aria-controls={`${tabsId}-panel-search`}
                        aria-selected={tab === 'search'} onClick={() => setTab('search')}>Search</button>
                    <button type="button" role="tab" id={`${tabsId}-tab-best`} aria-controls={`${tabsId}-panel-best`}
                        aria-selected={tab === 'best'} onClick={() => setTab('best')}>Best sources of…</button>
                </div>
            </div>

            <div role="tabpanel" id={`${tabsId}-panel-search`} aria-labelledby={`${tabsId}-tab-search`} hidden={tab !== 'search'}>
                <SearchPanel isAdded={isAdded} onToggle={onToggle} inputRef={searchInputRef} />
            </div>
            <div role="tabpanel" id={`${tabsId}-panel-best`} aria-labelledby={`${tabsId}-tab-best`} hidden={tab !== 'best'}>
                {tab === 'best' && <BestSourcesPanel isAdded={isAdded} onToggle={onToggle} />}
            </div>
        </section>
    );
}

function SearchPanel({ isAdded, onToggle, inputRef }: { isAdded: (id: number) => boolean; onToggle: (f: Food) => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
    const s = useFoodSearch();
    const localRef = useRef<HTMLInputElement>(null);
    const ref = inputRef ?? localRef;
    const inputId = useId();
    const statusId = useId();

    return (
        <div className="stack">
            <form role="search" onSubmit={e => e.preventDefault()} className="search-box">
                <label htmlFor={inputId} className="sr-only">Search foods</label>
                <span className="search-icon"><Icon name="search" /></span>
                <input
                    ref={ref}
                    id={inputId}
                    className="input"
                    type="search"
                    autoComplete="off"
                    placeholder="Search foods, e.g. oats, salmon, black beans"
                    value={s.query}
                    onChange={e => s.setQuery(e.target.value)}
                    aria-describedby={statusId}
                />
                {s.query && (
                    <button type="button" className="icon-btn icon-btn-sm search-clear" aria-label="Clear search"
                        onClick={() => { s.setQuery(''); ref.current?.focus(); }}>
                        <Icon name="x" size={16} />
                    </button>
                )}
            </form>

            <p id={statusId} className="small muted" aria-live="polite">
                {!s.active ? 'Type at least 2 letters. Results update as you type.'
                    : s.loading ? 'Searching…'
                        : s.error ? ''
                            : s.total > 0 ? `${s.total.toLocaleString()} ${s.total === 1 ? 'match' : 'matches'}${s.total > s.results.length ? `, showing ${s.results.length}` : ''}`
                                : ''}
            </p>

            {!s.active && (
                <div>
                    <p className="small secondary" style={{ marginBottom: 8 }}>Popular starting points:</p>
                    <div className="row-wrap">
                        {QUICK_SEARCHES.map(q => (
                            <button key={q} type="button" className="chip chip-btn" onClick={() => { s.setQuery(q); ref.current?.focus(); }}>{q}</button>
                        ))}
                    </div>
                </div>
            )}

            {s.active && s.loading && <FoodRowSkeleton count={4} />}

            {s.active && s.error && (
                <div className="callout callout-danger" role="alert">
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <div className="stack" style={{ gap: 8 }}>
                        <span><span className="callout-title">Search isn&apos;t working right now.</span> {s.error}</span>
                        <div><button type="button" className="btn btn-secondary btn-sm" onClick={s.retry}><Icon name="refresh" size={14} /> Try again</button></div>
                    </div>
                </div>
            )}

            {s.active && !s.loading && !s.error && s.results.length === 0 && (
                <div className="empty-state">
                    <div className="empty-icon"><Icon name="search" /></div>
                    <h3>No foods match &ldquo;{s.query.trim()}&rdquo;</h3>
                    <p className="small">Try a simpler word (&ldquo;bean&rdquo; instead of &ldquo;black beans canned&rdquo;) or check the spelling.</p>
                </div>
            )}

            {s.results.length > 0 && (
                <div className="result-scroll">
                    <ul className="result-list" aria-label="Search results">
                        {s.results.map(f => <FoodRow key={f.id} food={f} added={isAdded(f.id)} onToggle={onToggle} />)}
                    </ul>
                    {s.hasMore && (
                        <div className="list-footer">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={s.loadMore} disabled={s.loadingMore}>
                                {s.loadingMore ? <><span className="spinner" /> Loading…</> : 'Show more results'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function BestSourcesPanel({ isAdded, onToggle }: { isAdded: (id: number) => boolean; onToggle: (f: Food) => void }) {
    const [nutrient, setNutrient] = useState('protein_g');
    const top = useTopFoods(nutrient, 40);
    const selectId = useId();
    const unit = nutrientUnit(nutrient);
    const foods = top.foods.filter(hasCoreData);

    return (
        <div className="stack">
            <div className="field" style={{ maxWidth: 320 }}>
                <label className="field-label" htmlFor={selectId}>Show foods richest in</label>
                <select id={selectId} className="select" value={nutrient} onChange={e => setNutrient(e.target.value)}>
                    {NUTRIENT_GROUPS.map(g => (
                        <optgroup key={g.id} label={g.title}>
                            {g.keys.filter(k => GOAL_KEYS.includes(k)).map(k => <option key={k} value={k}>{nutrientLabel(k)}</option>)}
                        </optgroup>
                    ))}
                </select>
            </div>
            <p className="small muted">Amounts are per 100 g. Dried or concentrated foods (powders, spices) rank high per 100 g but are eaten in small amounts.</p>

            {top.loading && <FoodRowSkeleton count={5} />}
            {top.error && (
                <div className="callout callout-danger" role="alert">
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <div className="row-wrap"><span>Couldn&apos;t load this list.</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={top.retry}><Icon name="refresh" size={14} /> Try again</button></div>
                </div>
            )}
            {!top.loading && !top.error && (
                foods.length === 0
                    ? <div className="empty-state"><h3>No foods found</h3><p className="small">No foods have data for {nutrientLabel(nutrient)} yet.</p></div>
                    : (
                        <div className="result-scroll">
                            <ul className="result-list" aria-label={`Foods richest in ${nutrientLabel(nutrient)}`}>
                                {foods.map(f => (
                                    <FoodRow key={f.id} food={f} added={isAdded(f.id)} onToggle={onToggle}
                                        highlight={`${fmtNumber(nv(f, nutrient))} ${unit}`} />
                                ))}
                            </ul>
                        </div>
                    )
            )}
        </div>
    );
}
