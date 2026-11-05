'use client';

import { useEffect, useState } from 'react';
import type { Food } from '@/lib/food-types';

/** Per-serving ranking info the API adds with `rank=serving`. */
export interface BestInfo {
    servingLabel: string;
    servingGrams: number;
    perServing: number;
    per100g: number;
    everyday: boolean;
}

export type TopFood = Food & { best?: BestInfo };

interface TopData { key: string; foods: TopFood[]; error?: string }

export interface TopFoodsOptions {
    /** 'serving' (default): good sources for people, everyday foods first. '100g': raw per-100 g order. */
    rank?: 'serving' | '100g';
    /** With rank=serving: false includes specialty items (supplements, powders, organ meats). */
    everyday?: boolean;
    /** Food ids to leave out. */
    exclude?: number[];
}

/** Foods richest in a nutrient. Pass null to skip fetching. */
export function useTopFoods(nutrient: string | null, limit = 30, opts: TopFoodsOptions = {}) {
    const [nonce, setNonce] = useState(0);
    const [data, setData] = useState<TopData>({ key: '', foods: [] });
    const rank = opts.rank ?? 'serving';
    const everyday = opts.everyday !== false;
    const exclude = (opts.exclude ?? []).slice().sort((a, b) => a - b).join(',');
    const query = nutrient
        ? `nutrient=${encodeURIComponent(nutrient)}&limit=${limit}&rank=${rank}${everyday ? '' : '&everyday=0'}${exclude ? `&exclude=${exclude}` : ''}`
        : '';
    const key = query ? `${query}#${nonce}` : '';

    useEffect(() => {
        if (!query) return;
        const ctrl = new AbortController();
        (async () => {
            try {
                const res = await fetch(`/api/foods/top?${query}`, { signal: ctrl.signal });
                if (!res.ok) throw new Error(`Couldn't load foods (${res.status})`);
                const json = await res.json();
                setData({ key, foods: (json.foods ?? []) as TopFood[] });
            } catch (e) {
                if (ctrl.signal.aborted) return;
                setData({ key, foods: [], error: e instanceof Error ? e.message : 'Failed to load' });
            }
        })();
        return () => ctrl.abort();
    }, [query, key]);

    const current = query && data.key === key ? data : null;
    return {
        foods: current?.foods ?? [],
        loading: !!query && !current,
        error: current?.error,
        retry: () => setNonce(n => n + 1),
    };
}
