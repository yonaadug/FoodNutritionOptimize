'use client';

import { useEffect, useState } from 'react';
import type { Food } from '@/lib/food-types';
import type { FoodGroupResult, FoodTypeOption, GroupedSearchResult } from '@/lib/food-groups';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;

interface SearchData {
    key: string;
    groups: FoodGroupResult[];
    page: number;
    totalPages: number;
    total: number;
    entries: number;
    error?: string;
}

const EMPTY: SearchData = { key: '', groups: [], page: 0, totalPages: 0, total: 0, entries: 0 };

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

/** Foods already fetched for a type picker, by FoodData Central id (the DB is read-only). */
const typeFoods = new Map<number, Food>();

/** The full food behind a picked type (cached for this visit). */
export async function fetchTypeFood(fdcId: number): Promise<Food> {
    const hit = typeFoods.get(fdcId);
    if (hit) return hit;
    const [food] = await fetchFoodsByFdcIds([fdcId]);
    if (!food) throw new Error('That food could not be found');
    typeFoods.set(fdcId, food);
    return food;
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

/** One row per food (GET /api/search?group=1). Paging counts groups. */
export async function fetchGroupedSearch(q: string, page = 1, limit = PAGE_SIZE, signal?: AbortSignal): Promise<GroupedSearchResult> {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&group=1&page=${page}&limit=${limit}`, { signal });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const data = await res.json() as Partial<GroupedSearchResult>;
    return {
        groups: data.groups ?? [],
        total: Number(data.total ?? 0),
        entries: Number(data.entries ?? 0),
        page: Number(data.page ?? page),
        totalPages: Number(data.totalPages ?? 0),
        limit: Number(data.limit ?? limit),
    };
}

/** Every matched type of one group, for a picker whose row carried only the first 60. */
export async function fetchGroupTypes(q: string, key: string, signal?: AbortSignal): Promise<FoodTypeOption[]> {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&group=1&key=${encodeURIComponent(key)}`, { signal });
    if (!res.ok) throw new Error(`The types could not be loaded (${res.status})`);
    return ((await res.json()) as { types?: FoodTypeOption[] }).types ?? [];
}

/** Append the next page of groups, skipping any group already shown. */
export function appendGroups(shown: FoodGroupResult[], more: FoodGroupResult[]): FoodGroupResult[] {
    const keys = new Set(shown.map(g => g.key));
    return [...shown, ...more.filter(g => !keys.has(g.key))];
}

/**
 * Live, debounced food search, one row per food. Loading/empty states are derived from
 * whether the stored results belong to the current query, so no state is set
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
                const r = await fetchGroupedSearch(trimmed, 1, PAGE_SIZE, ctrl.signal);
                setData({ key, groups: r.groups, page: 1, totalPages: r.totalPages, total: r.total, entries: r.entries });
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
            const r = await fetchGroupedSearch(trimmed, current.page + 1);
            setData(d => d.key === key ? { ...d, groups: appendGroups(d.groups, r.groups), page: d.page + 1 } : d);
        } catch {
            /* keep what we have; the button stays available to retry */
        } finally {
            setLoadingMore(false);
        }
    };

    return {
        query,
        setQuery,
        /** The query the shown results are for. */
        resultsQuery: trimmed,
        active,
        loading: active && !current,
        error: current?.error,
        groups: current?.groups ?? [],
        total: current?.total ?? 0,
        entries: current?.entries ?? 0,
        hasMore: !!current && current.page < current.totalPages,
        loadingMore,
        loadMore,
        retry: () => setNonce(n => n + 1),
    };
}
