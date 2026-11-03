'use client';

import { useEffect, useState } from 'react';
import type { Food } from '@/lib/food-types';

interface TopData { key: string; foods: Food[]; error?: string }

/** Foods richest in a nutrient (per 100 g). Pass null to skip fetching. */
export function useTopFoods(nutrient: string | null, limit = 30) {
    const [nonce, setNonce] = useState(0);
    const [data, setData] = useState<TopData>({ key: '', foods: [] });
    const key = nutrient ? `${nutrient}#${limit}#${nonce}` : '';

    useEffect(() => {
        if (!nutrient) return;
        const ctrl = new AbortController();
        (async () => {
            try {
                const res = await fetch(`/api/foods/top?nutrient=${encodeURIComponent(nutrient)}&limit=${limit}`, { signal: ctrl.signal });
                if (!res.ok) throw new Error(`Couldn't load foods (${res.status})`);
                const json = await res.json();
                setData({ key, foods: (json.foods ?? []) as Food[] });
            } catch (e) {
                if (ctrl.signal.aborted) return;
                setData({ key, foods: [], error: e instanceof Error ? e.message : 'Failed to load' });
            }
        })();
        return () => ctrl.abort();
    }, [nutrient, limit, key]);

    const current = nutrient && data.key === key ? data : null;
    return {
        foods: current?.foods ?? [],
        loading: !!nutrient && !current,
        error: current?.error,
        retry: () => setNonce(n => n + 1),
    };
}
