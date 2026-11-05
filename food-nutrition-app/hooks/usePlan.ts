'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { Food } from '@/lib/food-types';
import { buildPayload, payloadKey } from '@/components/planner/payload';
import type { PresetId } from '@/components/planner/goals';
import type { FixedFood, PlannerState } from './usePlannerState';

/** Shape of a successful /api/optimize response (fields we rely on; extras are ignored). */
export interface PlanItem {
    food: Food;
    grams: number;
    calories: number | null;
    nutrients: Record<string, number | null>;
}

export type PlanWarning = string | {
    message?: string; food?: string; foodName?: string; description?: string; nutrients?: string[];
    foodId?: number; inDiet?: boolean; role?: 'optimized' | 'guaranteed'; [k: string]: unknown;
};

export interface PlanIssueData {
    kind: 'short' | 'excess' | 'food_min' | 'food_max';
    nutrient?: string;
    foodId?: number;
    amount?: number;
    cause?: 'fixed_foods';
}

export interface PlanResult {
    success: boolean;
    message?: string;
    error?: string;
    diet?: PlanItem[];
    totalCalories?: number | null;
    totalNutrients?: Record<string, number | null>;
    guaranteedStats?: { calories?: number | null; nutrients?: Record<string, number | null> };
    constraintLimits?: Record<string, { min?: number; max?: number }>;
    /** Keys whose `max` is a safe upper limit added by applyUpperLimits (not a user goal). */
    upperLimitKeys?: string[];
    debugEquations?: string[];
    lpModel?: { constraints?: unknown };
    warnings?: PlanWarning[];
    /** Structured diagnostics for infeasible plans (parsed from `message` when absent). */
    issues?: PlanIssueData[];
    totalCost?: number | null;
    /** Infeasible only: lifting the general portion cap would make the plan work. */
    portionCapBinding?: boolean;
}

export { buildPayload, payloadKey };

export type PlanStatus = 'idle' | 'loading' | 'success' | 'infeasible' | 'error';

/** What the plan was computed from (so a stale plan still describes itself correctly). */
export interface PlanRunInfo {
    key: string;
    fixed: FixedFood[];
    /** Ids of every food the user had chosen (planner-chosen and fixed). */
    foodIds: number[];
    presetId: PresetId;
    at: number;
}

export interface PlanStoreState {
    status: PlanStatus;
    result: PlanResult | null;
    error: string | null;
    run: PlanRunInfo | null;
    /** Increments when a run finishes in this page view (not on restore), e.g. to move focus. */
    finished: number;
}

const PLAN_KEY = 'nc.plan.v1';
const IDLE: PlanStoreState = { status: 'idle', result: null, error: null, run: null, finished: 0 };

let store: PlanStoreState = IDLE;
let loaded = false;
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();

/** Trim what is only needed for display so the saved plan stays small. */
function slim(result: PlanResult): PlanResult {
    return { ...result, lpModel: result.lpModel?.constraints ? { constraints: result.lpModel.constraints } : undefined };
}

/** The plan saved by a previous visit, or idle (exported for tests). */
export function restorePlan(): PlanStoreState {
    try {
        const raw = localStorage.getItem(PLAN_KEY);
        if (!raw) return IDLE;
        const saved = JSON.parse(raw) as { v?: number; status?: PlanStatus; result?: PlanResult; run?: PlanRunInfo };
        if (saved?.v !== 1 || !saved.result || !saved.run || (saved.status !== 'success' && saved.status !== 'infeasible')) return IDLE;
        if (!Array.isArray(saved.run.fixed) || typeof saved.run.key !== 'string') return IDLE;
        return { status: saved.status, result: saved.result, error: null, run: saved.run, finished: 0 };
    } catch {
        return IDLE;
    }
}

function persist(s: PlanStoreState) {
    try {
        if ((s.status === 'success' || s.status === 'infeasible') && s.result && s.run) {
            localStorage.setItem(PLAN_KEY, JSON.stringify({ v: 1, status: s.status, result: slim(s.result), run: s.run }));
        } else if (s.status === 'idle') {
            localStorage.removeItem(PLAN_KEY);
        }
        // 'loading' and 'error' keep the last good plan in storage.
    } catch { /* storage full or blocked: the plan still works in memory */ }
}

function getSnapshot(): PlanStoreState {
    if (!loaded && typeof window !== 'undefined') {
        loaded = true;
        store = restorePlan();
    }
    return store;
}

function set(next: PlanStoreState) {
    store = next;
    persist(store);
    listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/** A friendly sentence for a failed request (never the browser's raw "Failed to fetch"). */
export function requestErrorText(e: unknown): string {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You seem to be offline.';
    if (e instanceof DOMException && e.name === 'TimeoutError') return 'The planner took too long to answer.';
    return 'We couldn’t reach the planner.';
}

/** Run the optimizer for a planner state. */
export async function runPlan(s: PlannerState): Promise<void> {
    if (s.foods.length === 0 && s.fixedFoods.length === 0) return;
    getSnapshot();
    ctrl?.abort();
    const mine = new AbortController();
    ctrl = mine;
    const previous = store;
    set({ ...store, status: 'loading', error: null });
    try {
        const res = await fetch('/api/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload(s)),
            signal: mine.signal,
        });
        let data: PlanResult | null = null;
        try { data = await res.json(); } catch { data = null; }
        if (mine.signal.aborted) return;
        const run: PlanRunInfo = {
            key: payloadKey(s),
            fixed: s.fixedFoods,
            foodIds: [...s.foods.map(f => f.id), ...s.fixedFoods.map(f => f.food.id)],
            presetId: s.presetId,
            at: Date.now(),
        };
        const finished = store.finished + 1;
        if (data && data.success) {
            set({ status: 'success', result: data, error: null, run, finished });
        } else if (data && data.success === false && (data.message || data.issues)) {
            set({ status: 'infeasible', result: data, error: null, run, finished });
        } else {
            set({ ...previous, status: 'error', error: data?.error ? `The planner said: ${data.error}.` : `The planner couldn’t run (error ${res.status}).`, finished });
        }
    } catch (e) {
        if (mine.signal.aborted) return;
        set({ ...previous, status: 'error', error: requestErrorText(e), finished: store.finished + 1 });
    }
}

/** Forget the plan (e.g. after clearing every food). */
export function resetPlan() {
    ctrl?.abort();
    set({ ...IDLE, finished: store.finished });
}

export function usePlan(state: PlannerState) {
    const s = useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
    const currentKey = useMemo(() => payloadKey(state), [state]);
    return {
        status: s.status,
        result: s.result,
        error: s.error,
        runInfo: s.run,
        fixedAtRun: s.run?.fixed ?? [],
        finished: s.finished,
        /** Run with the current state, or with `override` (a state that hasn't re-rendered yet, e.g. the sample day). */
        run: (override?: PlannerState) => runPlan(override ?? state),
        reset: resetPlan,
        stale: s.run !== null && s.run.key !== currentKey && s.status !== 'loading',
    };
}
