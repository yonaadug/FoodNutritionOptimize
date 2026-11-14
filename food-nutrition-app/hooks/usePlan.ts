'use client';

import { sameOriginFetch } from '@/lib/same-origin-fetch';
import { useMemo, useSyncExternalStore } from 'react';
import type { Food } from '@/lib/food-types';
import { buildPayload, payloadKey } from '@/components/planner/payload';
import type { PresetId } from '@/components/planner/goals';
import { currentUserId, recordHistory } from '@/lib/auth/client';
import { LOCAL_DATA_CLEARED_EVENT } from '@/lib/local-data';
import { planHistoryItem } from '@/lib/plan-history';
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
    /** The fixed foods as the server used them (its values, not the browser's copy). */
    guaranteedFoods?: FixedFood[];
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
    /** The account this plan was saved to. Absent for a plan made before signing in. */
    ownerId?: string;
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
/**
 * Bump when a saved plan can no longer be trusted. Version 2: nutrition gaps are now
 * filled everywhere, so a plan saved before that has different totals.
 */
const PLAN_VERSION = 2;
const IDLE: PlanStoreState = { status: 'idle', result: null, error: null, run: null, finished: 0 };

let store: PlanStoreState = IDLE;
let loaded = false;
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();

/** Trim what is only needed for display so the saved plan stays small. */
function slim(result: PlanResult): PlanResult {
    return { ...result, guaranteedFoods: undefined, lpModel: result.lpModel?.constraints ? { constraints: result.lpModel.constraints } : undefined };
}

/** The plan saved by a previous visit, or idle (exported for tests). */
export function restorePlan(): PlanStoreState {
    try {
        const raw = localStorage.getItem(PLAN_KEY);
        if (!raw) return IDLE;
        const saved = JSON.parse(raw) as { v?: number; status?: PlanStatus; result?: PlanResult; run?: PlanRunInfo };
        if (saved?.v !== PLAN_VERSION || !saved.result || !saved.run || (saved.status !== 'success' && saved.status !== 'infeasible')) return IDLE;
        if (!Array.isArray(saved.run.fixed) || typeof saved.run.key !== 'string') return IDLE;
        return { status: saved.status, result: saved.result, error: null, run: saved.run, finished: 0 };
    } catch {
        return IDLE;
    }
}

function persist(s: PlanStoreState) {
    try {
        if ((s.status === 'success' || s.status === 'infeasible') && s.result && s.run) {
            localStorage.setItem(PLAN_KEY, JSON.stringify({ v: PLAN_VERSION, status: s.status, result: slim(s.result), run: s.run }));
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
    // Another tab made a plan, or signing out cleared it.
    const onStorage = (e: StorageEvent) => {
        if (e.key !== PLAN_KEY) return;
        store = { ...restorePlan(), finished: store.finished };
        cb();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
    };
}

// Signing out in this tab: don't keep showing what was just cleared.
if (typeof window !== 'undefined') {
    window.addEventListener(LOCAL_DATA_CLEARED_EVENT, () => {
        ctrl?.abort();
        store = { ...IDLE, finished: store.finished };
        listeners.forEach(l => l());
    });
}

/** Save a finished plan to the signed-in person's history. Does nothing when signed out. */
async function savePlanToAccount(s: PlannerState, result: PlanResult, key: string): Promise<void> {
    const outcome = await recordHistory(planHistoryItem(s, result));
    const ownerId = currentUserId();
    if (outcome === 'sent' && ownerId && store.run?.key === key) set({ ...store, run: { ...store.run, ownerId } });
}

/** A friendly sentence for a failed request (never the browser's raw "Failed to fetch"). */
export function requestErrorText(e: unknown): string {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You seem to be offline.';
    if (e instanceof DOMException && e.name === 'TimeoutError') return 'The planner took too long to answer.';
    return 'We couldn’t reach the planner.';
}

/** Run the optimizer for a planner state. */
export async function runPlan(s: PlannerState): Promise<void> {
    getSnapshot();
    if (s.foods.length === 0 && s.fixedFoods.length === 0) {
        resetPlan();
        return;
    }
    ctrl?.abort();
    const mine = new AbortController();
    ctrl = mine;
    const previous = store;
    set({ ...store, status: 'loading', error: null });
    try {
        const res = await sameOriginFetch('/api/optimize', { method: 'POST', json: buildPayload(s), signal: mine.signal });
        let data: PlanResult | null = null;
        try { data = await res.json(); } catch { data = null; }
        if (mine.signal.aborted) return;
        const run: PlanRunInfo = {
            key: payloadKey(s),
            fixed: data?.guaranteedFoods ?? s.fixedFoods,
            foodIds: [...s.foods.map(f => f.id), ...s.fixedFoods.map(f => f.food.id)],
            presetId: s.presetId,
            at: Date.now(),
        };
        const finished = store.finished + 1;
        if (data && data.success) {
            set({ status: 'success', result: data, error: null, run, finished });
            void savePlanToAccount(s, data, run.key);
        } else if (data && data.success === false && (data.message || data.issues)) {
            set({ status: 'infeasible', result: data, error: null, run, finished });
            void savePlanToAccount(s, data, run.key);
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

/** The plan right now, for code outside React (e.g. to offer Undo). */
export function getPlanSnapshot(): PlanStoreState {
    return getSnapshot();
}

/** Put back a plan taken with getPlanSnapshot. */
export function restorePlanSnapshot(snapshot: PlanStoreState) {
    ctrl?.abort();
    set({ ...snapshot, finished: store.finished });
}

/**
 * Save the plan on screen to the account, for a plan made before signing in. This is the
 * only way one reaches an account: signing in never uploads anything by itself.
 */
export function savePlanNow(s: PlannerState): Promise<void> {
    const { result, run } = getSnapshot();
    if (!result || !run) return Promise.resolve();
    return savePlanToAccount(s, result, run.key);
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
