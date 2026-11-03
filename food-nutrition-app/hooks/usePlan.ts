'use client';

import { useMemo, useRef, useState } from 'react';
import type { Food } from '@/lib/food-types';
import { goalsToPayload } from '@/components/planner/goals';
import type { FixedFood, PlannerState } from './usePlannerState';

/** Shape of a successful /api/optimize response (fields we rely on; extras are ignored). */
export interface PlanItem {
    food: Food;
    grams: number;
    calories: number | null;
    nutrients: Record<string, number | null>;
}

export type PlanWarning = string | { message?: string; food?: string; foodName?: string; description?: string; nutrients?: string[]; [k: string]: unknown };

export interface PlanResult {
    success: boolean;
    message?: string;
    error?: string;
    diet?: PlanItem[];
    totalCalories?: number | null;
    totalNutrients?: Record<string, number | null>;
    guaranteedStats?: { calories?: number | null; nutrients?: Record<string, number | null> };
    constraintLimits?: Record<string, { min?: number; max?: number }>;
    debugEquations?: string[];
    lpModel?: { constraints?: unknown };
    warnings?: PlanWarning[];
    /** Optional structured diagnostics (requested from the API team; parsed from `message` when absent). */
    issues?: { nutrient: string; kind: 'short' | 'excess'; amount?: number }[];
    totalCost?: number | null;
}

export type PlanStatus = 'idle' | 'loading' | 'success' | 'infeasible' | 'error';

export function buildPayload(s: PlannerState) {
    return {
        foods: s.foods,
        guaranteedFoods: s.fixedFoods,
        customConstraints: goalsToPayload(s.goals),
        minCalories: s.calories.min !== undefined ? String(s.calories.min) : undefined,
        maxCalories: s.calories.max !== undefined ? String(s.calories.max) : undefined,
        diversityMode: s.portionCap.enabled,
        maxFoodAmount: s.portionCap.enabled ? String(s.portionCap.grams) : undefined,
        foodConstraints: s.foodLimits,
        applyUpperLimits: s.upperLimits || undefined,
    };
}

/** A cheap fingerprint of the inputs, used to detect an out-of-date plan. */
export function payloadKey(s: PlannerState): string {
    return JSON.stringify({
        f: s.foods.map(f => f.id),
        x: s.fixedFoods.map(f => [f.food.id, f.grams]),
        g: s.goals, c: s.calories, p: s.portionCap, l: s.foodLimits, u: s.upperLimits,
    });
}

export function usePlan(state: PlannerState) {
    const [status, setStatus] = useState<PlanStatus>('idle');
    const [result, setResult] = useState<PlanResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ranWith, setRanWith] = useState<string | null>(null);
    const [fixedAtRun, setFixedAtRun] = useState<FixedFood[]>([]);
    const ctrlRef = useRef<AbortController | null>(null);

    const currentKey = useMemo(() => payloadKey(state), [state]);

    /** Run the optimizer. `override` lets callers plan a state that hasn't re-rendered yet (e.g. the sample day). */
    const run = async (override?: PlannerState) => {
        const s = override ?? state;
        if (s.foods.length === 0 && s.fixedFoods.length === 0) return;
        ctrlRef.current?.abort();
        const ctrl = new AbortController();
        ctrlRef.current = ctrl;
        setStatus('loading');
        setError(null);
        try {
            const res = await fetch('/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildPayload(s)),
                signal: ctrl.signal,
            });
            let data: PlanResult | null = null;
            try { data = await res.json(); } catch { data = null; }
            if (ctrl.signal.aborted) return;
            setRanWith(payloadKey(s));
            setFixedAtRun(s.fixedFoods);
            if (data && data.success) {
                setResult(data);
                setStatus('success');
            } else if (data && data.success === false && (data.message || data.issues)) {
                setResult(data);
                setStatus('infeasible');
            } else {
                setResult(null);
                setError(data?.error || `The planner couldn't run (status ${res.status}).`);
                setStatus('error');
            }
        } catch (e) {
            if (ctrl.signal.aborted) return;
            setResult(null);
            setError(e instanceof Error && e.message ? `Couldn't reach the planner: ${e.message}` : "Couldn't reach the planner.");
            setStatus('error');
        }
    };

    const reset = () => {
        ctrlRef.current?.abort();
        setStatus('idle');
        setResult(null);
        setError(null);
        setRanWith(null);
    };

    return {
        status,
        result,
        error,
        fixedAtRun,
        run,
        reset,
        stale: ranWith !== null && ranWith !== currentKey && status !== 'loading',
    };
}
