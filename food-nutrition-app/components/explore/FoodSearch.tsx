'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Food } from '@/lib/food-types';
import { RecentCache } from '@/lib/navigation-ux';
import Icon from '@/components/ui/Icon';
import { FoodRowSkeleton } from '@/components/foods/FoodRow';
import { fetchSearch } from '@/hooks/useFoodSearch';
import FoodResultRow from './FoodResultRow';
import { recentSearches, useRecentSearches } from './useRecentSearches';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

interface SearchData {
    key: string;
    foods: Food[];
    page: number;
    totalPages: number;
    total: number;
    error?: string;
}

const EMPTY: SearchData = { key: '', foods: [], page: 0, totalPages: 0, total: 0 };

const keyFor = (trimmed: string, nonce: number) => `${trimmed.toLowerCase()}#${nonce}`;

/** Results already shown in this visit, by lower-cased query. */
const seenResults = new RecentCache<SearchData>(20);

export interface InitialSearch {
    query: string;
    foods: Food[];
    total: number;
    totalPages: number;
}

interface FoodSearchProps {
    /** Results already rendered on the server for /?q=... */
    initial: InitialSearch | null;
    foodCount: number;
    /** Browse sections, shown until the visitor starts searching. */
    children: React.ReactNode;
}

/**
 * The home page search: results update as you type, and the address follows
 * (/?q=salmon), so Back from a food returns to the same results and a search can
 * be shared. Results are real links: Tab works, and the arrow keys move between
 * the box and the results. Without JavaScript the form still submits to /?q=.
 */
export default function FoodSearch({ initial, foodCount, children }: FoodSearchProps) {
    // Back to /?q=salmon renders the page the router cached for this entry, which can be the
    // bare home page (the query was added to the address as you typed), so the address wins.
    const addressQuery = (useSearchParams().get('q') ?? '').trim().slice(0, 200);
    const initialQuery = initial?.query ?? addressQuery;
    const [query, setQuery] = useState(initialQuery);
    const [nonce, setNonce] = useState(0);
    const [data, setData] = useState<SearchData>(() => {
        if (initial) return { key: keyFor(initial.query.trim(), 0), foods: initial.foods, page: 1, totalPages: initial.totalPages, total: initial.total };
        // Results seen earlier in this visit come back at once, so Back lands where it left off.
        const seen = initialQuery.trim().length >= MIN_CHARS ? seenResults.get(initialQuery.trim().toLowerCase()) : undefined;
        return seen ? { ...seen, key: keyFor(initialQuery.trim(), 0) } : EMPTY;
    });
    // Remember what's on screen (including "Show more" pages) for Back.
    useEffect(() => {
        if (data.key && !data.error && data.foods.length) seenResults.set(data.key.replace(/#\d+$/, ''), data);
    }, [data]);
    const [loadingMore, setLoadingMore] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const recents = useRecentSearches();
    const inputId = useId();
    const statusId = useId();

    const trimmed = query.trim();
    const active = trimmed.length >= MIN_CHARS;
    const key = keyFor(trimmed, nonce);
    const current = active && data.key === key ? data : null;
    const loading = active && !current;

    // Fetch as the visitor types; stale requests are aborted.
    useEffect(() => {
        if (!active || data.key === key) return;
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const r = await fetchSearch(trimmed, 1, PAGE_SIZE, ctrl.signal);
                setData({ key, foods: r.foods, page: 1, totalPages: r.totalPages, total: r.total });
            } catch (e) {
                if (ctrl.signal.aborted) return;
                setData({ ...EMPTY, key, error: e instanceof Error ? e.message : 'Search failed' });
            }
        }, DEBOUNCE_MS);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [active, data.key, key, trimmed]);

    // Keep the address in step, without adding a history entry per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => {
            const url = trimmed.length >= MIN_CHARS ? `/?q=${encodeURIComponent(trimmed)}` : '/';
            if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url);
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [trimmed]);

    // Search-first: focus the box on larger screens (not on phones, where it would open the keyboard).
    useEffect(() => {
        if (!initialQuery && window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus({ preventScroll: true });
    }, [initialQuery]);

    // "/" jumps to the search box from anywhere on the page.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
            e.preventDefault();
            inputRef.current?.focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const loadMore = async () => {
        if (!current || current.page >= current.totalPages || loadingMore) return;
        setLoadingMore(true);
        try {
            const r = await fetchSearch(trimmed, current.page + 1, PAGE_SIZE);
            setData(d => d.key === key
                ? { ...d, foods: [...d.foods, ...r.foods.filter(f => !d.foods.some(x => x.id === f.id))], page: d.page + 1 }
                : d);
        } catch {
            /* keep what we have; the button stays available to retry */
        } finally {
            setLoadingMore(false);
        }
    };

    const remember = () => { if (active) recentSearches.add(trimmed); };

    const focusResult = (index: number) => {
        const links = listRef.current?.querySelectorAll<HTMLAnchorElement>('a.result-link');
        if (!links || links.length === 0) return;
        links[Math.max(0, Math.min(index, links.length - 1))].focus();
    };

    const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' && current?.foods.length) {
            e.preventDefault();
            focusResult(0);
        } else if (e.key === 'Escape' && query) {
            e.preventDefault();
            setQuery('');
        }
    };

    const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
        const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>('a.result-link') ?? []);
        const at = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (at < 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusResult(at + 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (at === 0) inputRef.current?.focus(); else focusResult(at - 1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            inputRef.current?.focus();
        }
    };

    const status = !active ? ''
        : loading ? 'Searching…'
            : current?.error ? ''
                : current?.total ? `${current.total.toLocaleString('en-US')} ${current.total === 1 ? 'food matches' : 'foods match'} “${trimmed}”`
                    : '';

    return (
        <>
            <form role="search" action="/" method="get" className="search-box search-box-hero"
                onSubmit={e => { e.preventDefault(); remember(); }}>
                <label htmlFor={inputId} className="sr-only">Search foods</label>
                <span className="search-icon"><Icon name="search" size={20} /></span>
                <input
                    ref={inputRef}
                    id={inputId}
                    name="q"
                    className="input"
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={200}
                    placeholder={foodCount ? `Search ${foodCount.toLocaleString('en-US')} foods…` : 'Search foods…'}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={onInputKey}
                    aria-describedby={statusId}
                />
                {query && (
                    <button type="button" className="icon-btn icon-btn-sm search-clear" aria-label="Clear search"
                        onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                        <Icon name="x" size={16} />
                    </button>
                )}
            </form>

            <div className="search-status small muted" id={statusId} aria-live="polite">
                {status}
                {active && !!current?.foods.length && <span className="search-hint"> · Press ↓ to move through results</span>}
            </div>

            {!active && recents.length > 0 && (
                <section className="recent-searches" aria-label="Recent searches">
                    <span className="small secondary">Recent:</span>
                    {recents.map(r => (
                        <span key={r} className="recent-chip">
                            <button type="button" className="chip chip-btn" onClick={() => { setQuery(r); inputRef.current?.focus(); }}>
                                <Icon name="clock" size={13} /> {r}
                            </button>
                            <button type="button" className="recent-remove" aria-label={`Remove ${r} from recent searches`} onClick={() => recentSearches.remove(r)}>
                                <Icon name="x" size={12} />
                            </button>
                        </span>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => recentSearches.clear()}>Clear</button>
                </section>
            )}

            {active ? (
                <section className="search-results" aria-label="Search results" aria-busy={loading}>
                    {loading && <FoodRowSkeleton count={5} />}

                    {current?.error && (
                        <div className="callout callout-danger" role="alert">
                            <span className="callout-icon"><Icon name="alert" /></span>
                            <div className="stack" style={{ gap: 8 }}>
                                <span><span className="callout-title">Search isn&apos;t working right now.</span> {current.error}</span>
                                <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setNonce(n => n + 1)}><Icon name="refresh" size={14} /> Try again</button></div>
                            </div>
                        </div>
                    )}

                    {current && !current.error && current.foods.length === 0 && (
                        <div className="empty-state">
                            <div className="empty-icon"><Icon name="search" /></div>
                            <h2>No foods match &ldquo;{trimmed}&rdquo;</h2>
                            <p className="small">Try a simpler word (&ldquo;bean&rdquo; instead of &ldquo;black beans canned&rdquo;) or check the spelling.</p>
                            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                                Browse foods instead
                            </button>
                        </div>
                    )}

                    {!!current?.foods.length && (
                        <ul className="result-list" ref={listRef} onKeyDown={onListKey}>
                            {current.foods.map(f => <FoodResultRow key={f.id} food={f} onOpen={remember} />)}
                        </ul>
                    )}

                    {!!current && current.page < current.totalPages && (
                        <div className="list-footer">
                            <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? <><span className="spinner" /> Loading…</> : `Show more (${(current.total - current.foods.length).toLocaleString('en-US')} left)`}
                            </button>
                        </div>
                    )}
                </section>
            ) : children}
        </>
    );
}
