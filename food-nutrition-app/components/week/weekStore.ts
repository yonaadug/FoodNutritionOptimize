'use client';

/**
 * The week plan in this browser, like hooks/usePlan.ts does for the day: a small external
 * store saved to localStorage, plus locks and the grocery list's ticks. Signed in, each new
 * week is also recorded to history (kind "week-plan").
 */
import { useMemo, useSyncExternalStore } from 'react';
import { buildPayload, payloadKey } from '@/components/planner/payload';
import { currentUserId, recordHistory } from '@/lib/auth/client';
import { LOCAL_DATA_CLEARED_EVENT } from '@/lib/local-data';
import { sameOriginFetch } from '@/lib/same-origin-fetch';
import { weekHistoryItem } from '@/lib/week-planner/history';
import { DEFAULT_WEEK_SETTINGS, type WeekLockItem, type WeekLocks, type WeekResult, type WeekSettings } from '@/lib/week-planner/types';
import type { PlannerState } from '@/hooks/usePlannerState';

export type WeekStatus = 'idle' | 'loading' | 'success' | 'infeasible' | 'error';

export interface WeekRun { key: string; at: number; ownerId?: string }

export interface WeekState {
    status: WeekStatus;
    result: WeekResult | null;
    error: string | null;
    run: WeekRun | null;
    /** Days kept as they are when re-planning. */
    lockedDays: number[];
    /** Foods kept on one day: "day:foodId". */
    lockedItems: string[];
    settings: WeekSettings;
    /** Grocery lines ticked, by food id, for the week made at `run.at`. */
    checked: number[];
    finished: number;
}

const KEY = 'nc.week.v1';
const SETTINGS_KEY = 'nc.week.settings.v1';
const GROCERY_KEY = 'nc.week.grocery.v1';
const VERSION = 1;

const INITIAL: WeekState = {
    status: 'idle', result: null, error: null, run: null, lockedDays: [], lockedItems: [],
    settings: DEFAULT_WEEK_SETTINGS, checked: [], finished: 0,
};

let store: WeekState = INITIAL;
let loaded = false;
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();

function read<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    } catch {
        return null;
    }
}

/** What a previous visit left (exported for tests). */
export function restoreWeek(): WeekState {
    const saved = read<{ v?: number; status?: WeekStatus; result?: WeekResult; run?: WeekRun; lockedDays?: number[]; lockedItems?: string[] }>(KEY);
    const settings = { ...DEFAULT_WEEK_SETTINGS, ...(read<Partial<WeekSettings>>(SETTINGS_KEY) ?? {}) };
    const grocery = read<{ at?: number; checked?: number[] }>(GROCERY_KEY);
    if (saved?.v !== VERSION || !saved.result || !saved.run || (saved.status !== 'success' && saved.status !== 'infeasible')) {
        return { ...INITIAL, settings };
    }
    return {
        ...INITIAL,
        status: saved.status,
        result: saved.result,
        run: saved.run,
        lockedDays: Array.isArray(saved.lockedDays) ? saved.lockedDays : [],
        lockedItems: Array.isArray(saved.lockedItems) ? saved.lockedItems : [],
        settings,
        checked: grocery?.at === saved.run.at && Array.isArray(grocery.checked) ? grocery.checked : [],
    };
}

function persist(s: WeekState) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s.settings));
        if ((s.status === 'success' || s.status === 'infeasible') && s.result && s.run) {
            localStorage.setItem(KEY, JSON.stringify({ v: VERSION, status: s.status, result: s.result, run: s.run, lockedDays: s.lockedDays, lockedItems: s.lockedItems }));
            localStorage.setItem(GROCERY_KEY, JSON.stringify({ at: s.run.at, checked: s.checked }));
        } else if (s.status === 'idle') {
            localStorage.removeItem(KEY);
            localStorage.removeItem(GROCERY_KEY);
        }
    } catch { /* full or blocked storage: the week still works in memory */ }
}

function getSnapshot(): WeekState {
    if (!loaded && typeof window !== 'undefined') {
        loaded = true;
        store = restoreWeek();
    }
    return store;
}

function set(next: WeekState) {
    store = next;
    persist(store);
    listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
        if (e.key !== KEY && e.key !== SETTINGS_KEY && e.key !== GROCERY_KEY) return;
        store = { ...restoreWeek(), finished: store.finished };
        cb();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
    };
}

if (typeof window !== 'undefined') {
    window.addEventListener(LOCAL_DATA_CLEARED_EVENT, () => {
        ctrl?.abort();
        store = { ...INITIAL, finished: store.finished };
        listeners.forEach(l => l());
    });
}

/** Detects an out-of-date week: the day planner's inputs plus the week's settings. */
export function weekKey(s: PlannerState, settings: WeekSettings): string {
    return JSON.stringify({ p: payloadKey(s), w: settings });
}

/** Locks for a re-plan, from the week on screen. */
export function locksFrom(result: WeekResult, lockedDays: readonly number[], lockedItems: readonly string[]): WeekLocks {
    const items: WeekLockItem[] = [];
    for (const day of result.days ?? []) {
        const wholeDay = lockedDays.includes(day.index);
        for (const e of day.entries) {
            if (!wholeDay && !lockedItems.includes(`${day.index}:${e.foodId}`)) continue;
            items.push({
                day: day.index, foodId: e.foodId, grams: e.grams,
                ...(e.servings ? { servings: e.servings } : {}),
                ...(e.role === 'leftover' ? { leftover: true } : {}),
            });
        }
    }
    return { days: lockedDays.filter(d => (result.days ?? []).some(x => x.index === d)), items };
}

/** The POST /api/plan/week body. */
export function weekPayload(s: PlannerState, settings: WeekSettings, replan: { result: WeekResult; lockedDays: number[]; lockedItems: string[] } | null) {
    const { guaranteedFoods, ...day } = buildPayload(s);
    const body: Record<string, unknown> = { ...day, fixedFoods: guaranteedFoods, settings };
    if (replan?.result.success) {
        const locks = locksFrom(replan.result, replan.lockedDays, replan.lockedItems);
        body.locks = locks;
        const kept = new Set(locks.items.map(i => `${i.day}:${i.foodId}`));
        body.avoid = (replan.result.days ?? []).flatMap(d => d.entries
            .filter(e => !kept.has(`${d.index}:${e.foodId}`) && e.role === 'planned')
            .map(e => ({ day: d.index, foodId: e.foodId })));
    }
    return body;
}

function requestErrorText(e: unknown): string {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You seem to be offline.';
    if (e instanceof DOMException && e.name === 'TimeoutError') return 'The week planner took too long to answer.';
    return 'We couldn’t reach the week planner.';
}

async function saveToAccount(s: PlannerState, result: WeekResult, at: number) {
    const outcome = await recordHistory(weekHistoryItem(s, result));
    const ownerId = currentUserId();
    if (outcome === 'sent' && ownerId && store.run?.at === at) set({ ...store, run: { ...store.run, ownerId } });
}

/**
 * Plan the week. `replan` keeps the locked days and foods and steers the rest away from
 * what's there now; otherwise it's a fresh week and the locks are cleared.
 *
 * PLUS-GATE: weekPlanner (the browser's call to the API route).
 */
export async function runWeek(s: PlannerState, replan = false): Promise<void> {
    getSnapshot();
    if (s.foods.length + s.fixedFoods.length === 0) return;
    ctrl?.abort();
    const mine = new AbortController();
    ctrl = mine;
    const previous = store;
    const settings = store.settings;
    const body = weekPayload(s, settings, replan && store.result ? { result: store.result, lockedDays: store.lockedDays, lockedItems: store.lockedItems } : null);
    set({ ...store, status: 'loading', error: null });
    try {
        const res = await sameOriginFetch('/api/plan/week', { method: 'POST', json: body, signal: mine.signal });
        let data: WeekResult | null = null;
        try { data = await res.json() as WeekResult; } catch { data = null; }
        if (mine.signal.aborted) return;
        const run: WeekRun = { key: weekKey(s, settings), at: Date.now() };
        const finished = store.finished + 1;
        const locks = replan ? { lockedDays: store.lockedDays, lockedItems: store.lockedItems } : { lockedDays: [], lockedItems: [] };
        if (data?.success) {
            set({ ...store, ...locks, status: 'success', result: data, error: null, run, checked: [], finished });
            void saveToAccount(s, data, run.at);
        } else if (data && data.success === false && data.message) {
            set({ ...store, ...locks, status: 'infeasible', result: data, error: null, run, finished });
        } else {
            set({ ...previous, status: 'error', error: data && 'error' in data && data.error ? `The week planner said: ${data.error}.` : `The week planner couldn’t run (error ${res.status}).`, finished });
        }
    } catch (e) {
        if (mine.signal.aborted) return;
        set({ ...previous, status: 'error', error: requestErrorText(e), finished: store.finished + 1 });
    }
}

export const weekActions = {
    setSettings(patch: Partial<WeekSettings>) {
        set({ ...getSnapshot(), settings: { ...store.settings, ...patch } });
    },
    toggleDay(day: number) {
        const s = getSnapshot();
        set({ ...s, lockedDays: s.lockedDays.includes(day) ? s.lockedDays.filter(d => d !== day) : [...s.lockedDays, day].sort() });
    },
    toggleItem(day: number, foodId: number) {
        const s = getSnapshot();
        const k = `${day}:${foodId}`;
        set({ ...s, lockedItems: s.lockedItems.includes(k) ? s.lockedItems.filter(x => x !== k) : [...s.lockedItems, k] });
    },
    clearLocks() {
        set({ ...getSnapshot(), lockedDays: [], lockedItems: [] });
    },
    toggleChecked(foodId: number) {
        const s = getSnapshot();
        set({ ...s, checked: s.checked.includes(foodId) ? s.checked.filter(x => x !== foodId) : [...s.checked, foodId] });
    },
    clearChecked() {
        set({ ...getSnapshot(), checked: [] });
    },
    /** Show a week reopened from history. */
    open(result: WeekResult, ownerId?: string) {
        ctrl?.abort();
        const s = getSnapshot();
        set({
            ...s, status: 'success', result, error: null, settings: result.settings,
            run: { key: '', at: Date.now(), ...(ownerId ? { ownerId } : {}) },
            lockedDays: (result.days ?? []).filter(d => d.locked).map(d => d.index),
            lockedItems: (result.days ?? []).flatMap(d => d.entries.filter(e => e.locked).map(e => `${d.index}:${e.foodId}`)),
            checked: [], finished: s.finished,
        });
    },
    reset() {
        ctrl?.abort();
        set({ ...getSnapshot(), status: 'idle', result: null, error: null, run: null, lockedDays: [], lockedItems: [], checked: [] });
    },
};

export function getWeekSnapshot(): WeekState {
    return getSnapshot();
}

export function useWeek(planner: PlannerState) {
    const s = useSyncExternalStore(subscribe, getSnapshot, () => INITIAL);
    const key = useMemo(() => weekKey(planner, s.settings), [planner, s.settings]);
    return { ...s, stale: s.run !== null && s.run.key !== '' && s.run.key !== key && s.status !== 'loading' };
}
