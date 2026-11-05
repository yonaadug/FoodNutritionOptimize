'use client';

import { useEffect, useState } from 'react';
import type { Food } from '@/lib/food-types';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;

interface SearchData {
    key: string;
    foods: Food[];
    page: number;
    totalPages: number;
    total: number;
    error?: string;
}

const EMPTY: SearchData = { key: '', foods: [], page: 0, totalPages: 0, total: 0 };

/** Foods by FoodData Central id, as the server has them today. Unknown ids are left out. */
export async function fetchFoodsByFdcIds(fdcIds: number[]): Promise<Food[]> {
    const ids = Array.from(new Set(fdcIds.filter(id => Number.isSafeInteger(id) && id > 0)));
    const foods: Food[] = [];
    for (let i = 0; i < ids.length; i += 200) {
        const res = await fetch(`/api/food?fdcIds=${ids.slice(i, i + 200).join(',')}`);
        if (!res.ok) throw new Error(`The food list could not be read (error ${res.status})`);
        foods.push(...((await res.json()) as { foods: Food[] }).foods);
    }
    return foods;
}

export async function fetchSearch(q: string, page = 1, limit = PAGE_SIZE, signal?: AbortSignal, opts: { includeSuperseded?: boolean } = {}) {
    const extra = opts.includeSuperseded ? '&includeSuperseded=1' : '';
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}${extra}`, { signal });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const data = await res.json();
    return {
        foods: (data.foods ?? []) as Food[],
        total: Number(data.total ?? 0),
        totalPages: Number(data.totalPages ?? 0),
    };
}

/**
 * Live, debounced food search. Loading/empty states are derived from whether
 * the stored results belong to the current query, so no state is set
 * synchronously inside effects.
 */
export function useFoodSearch() {
    const [query, setQuery] = useState('');
    const [nonce, setNonce] = useState(0);
    const [data, setData] = useState<SearchData>(EMPTY);
    const [loadingMore, setLoadingMore] = useState(false);

    const trimmed = query.trim();
    const active = trimmed.length >= 2;
    const key = `${trimmed.toLowerCase()}#${nonce}`;

    useEffect(() => {
        if (!active) return;
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
    }, [active, trimmed, key]);

    const current = active && data.key === key ? data : null;

    const loadMore = async () => {
        if (!current || current.page >= current.totalPages || loadingMore) return;
        setLoadingMore(true);
        try {
            const r = await fetchSearch(trimmed, current.page + 1);
            setData(d => d.key === key
                ? { ...d, foods: [...d.foods, ...r.foods.filter(f => !d.foods.some(x => x.id === f.id))], page: d.page + 1 }
                : d);
        } catch {
            /* keep what we have; the button stays available to retry */
        } finally {
            setLoadingMore(false);
        }
    };

    return {
        query,
        setQuery,
        active,
        loading: active && !current,
        error: current?.error,
        results: current?.foods ?? [],
        total: current?.total ?? 0,
        hasMore: !!current && current.page < current.totalPages,
        loadingMore,
        loadMore,
        retry: () => setNonce(n => n + 1),
    };
}
