'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { AnalyzedIngredient, RecipeFood } from '@/lib/recipes/types';
import { fetchFood, searchFoods } from './api';
import styles from './recipes.module.css';

const DEBOUNCE_MS = 250;

interface Option { fdcId: number; description: string }

/** Pick a different USDA food: the matcher's suggestions, or a search through /api/search. */
export default function FoodChooser({ row, onPick, onClose }: {
    row: AnalyzedIngredient;
    onPick: (food: RecipeFood) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Option[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [picking, setPicking] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => { input.current?.focus(); }, []);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setSearching(true);
            setError(null);
            try {
                const foods = await searchFoods(q, controller.signal);
                setResults(foods.map(f => ({ fdcId: f.fdc_id, description: f.description })));
            } catch (e) {
                if ((e as Error).name !== 'AbortError') setError((e as Error).message);
            } finally {
                if (!controller.signal.aborted) setSearching(false);
            }
        }, DEBOUNCE_MS);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [query]);

    const pick = async (fdcId: number) => {
        setPicking(fdcId);
        setError(null);
        try {
            onPick(await fetchFood(fdcId));
        } catch (e) {
            setError((e as Error).message);
            setPicking(null);
        }
    };

    const showResults = query.trim().length >= 2 && results !== null;
    const suggestions: Option[] = row.candidates.filter(c => c.fdcId !== row.food?.fdc_id);
    const options = showResults ? results : suggestions;

    return (
        <div
            className={styles.chooser}
            role="group"
            aria-label={`Choose a food for ${row.name}`}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        >
            <div className={styles.chooserHead}>
                <label className="field-label" htmlFor={`chooser-${row.id}`}>Search USDA foods</label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close food search">
                    <Icon name="x" size={15} />
                </button>
            </div>
            <input
                id={`chooser-${row.id}`} ref={input} className="input" type="search" autoComplete="off"
                placeholder={row.name} value={query} onChange={e => setQuery(e.target.value)}
            />
            {error && <p className={styles.fieldError} role="alert">{error}</p>}
            <p className="tiny muted" role="status">
                {searching ? 'Searching…' : showResults ? `${options.length} ${options.length === 1 ? 'food' : 'foods'} found` : options.length ? 'Suggestions' : ''}
            </p>
            {options.length > 0 && (
                <ul className={styles.chooserList}>
                    {options.map(o => (
                        <li key={o.fdcId}>
                            <button type="button" className={styles.chooserOption} disabled={picking !== null} onClick={() => void pick(o.fdcId)}>
                                {picking === o.fdcId && <span className="spinner" aria-hidden="true" />}
                                {o.description}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
