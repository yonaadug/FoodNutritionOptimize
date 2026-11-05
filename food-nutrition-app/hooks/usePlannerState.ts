'use client';

import { useSyncExternalStore } from 'react';
import type { Food } from '@/lib/food-types';
import { LOCAL_DATA_CLEARED_EVENT } from '@/lib/local-data';
import { addRecipeServing, removeRecipeServing, syncRecipeInPlan } from '@/lib/planner-recipes';
import {
    DEFAULT_PORTION_CAP, DEFAULT_PRESET, matchPreset, migrateLegacyGoals, presetById,
    type CalorieRange, type GoalRange, type Goals, type PortionCap, type PresetId,
} from '@/components/planner/goals';

/**
 * Planner state lives in a tiny external store persisted to localStorage.
 * Using useSyncExternalStore (rather than useState + effects) means the
 * server render uses defaults, the client hydrates straight from storage, and
 * there is no setState-in-effect.
 *
 * Storage compatibility:
 *  - `selectedFoods`, `guaranteedFoods`, `foodConstraints` keep their legacy keys and shapes.
 *  - Goals move to `nc.goals.v2` ({ presetId, goals, calories, portionCap }).
 *    If absent, legacy `customConstraints` / `minCalories` / `maxCalories` are migrated.
 */

export interface FixedFood { food: Food; grams: number }
export type FoodLimits = Record<number, { min?: number; max?: number }>;

export interface PlannerState {
    foods: Food[];
    fixedFoods: FixedFood[];
    foodLimits: FoodLimits;
    presetId: PresetId;
    goals: Goals;
    calories: CalorieRange;
    portionCap: PortionCap;
    /** Also cap nutrients at their Tolerable Upper Intake Level (opt-in). */
    upperLimits: boolean;
    hydrated: boolean;
}

const GOALS_KEY = 'nc.goals.v2';

const INITIAL: PlannerState = {
    foods: [],
    fixedFoods: [],
    foodLimits: {},
    presetId: DEFAULT_PRESET.id,
    goals: DEFAULT_PRESET.goals,
    calories: DEFAULT_PRESET.calories,
    portionCap: DEFAULT_PORTION_CAP,
    upperLimits: false,
    hydrated: false,
};

let state: PlannerState = INITIAL;
let loaded = false;
const listeners = new Set<() => void>();

function readJSON<T>(key: string): T | undefined {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : undefined;
    } catch {
        return undefined;
    }
}

function numOrUndef(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : undefined;
}

function load(): PlannerState {
    const foods = readJSON<Food[]>('selectedFoods');
    const fixed = readJSON<FixedFood[]>('guaranteedFoods');
    const limits = readJSON<FoodLimits>('foodConstraints');
    const v2 = readJSON<{ presetId: PresetId; goals: Goals; calories: CalorieRange; portionCap: PortionCap; upperLimits?: boolean }>(GOALS_KEY);

    const next: PlannerState = {
        ...INITIAL,
        foods: Array.isArray(foods) ? foods.filter(f => f && typeof f.id === 'number') : [],
        fixedFoods: Array.isArray(fixed) ? fixed.filter(f => f?.food && typeof f.food.id === 'number') : [],
        foodLimits: limits && typeof limits === 'object' ? limits : {},
        hydrated: true,
    };
    // A food should be either "planner decides" or "fixed", never both.
    const fixedIds = new Set(next.fixedFoods.map(f => f.food.id));
    next.foods = next.foods.filter(f => !fixedIds.has(f.id));

    if (v2 && v2.goals) {
        next.presetId = v2.presetId ?? 'custom';
        next.goals = v2.goals;
        next.calories = v2.calories ?? {};
        next.portionCap = v2.portionCap ?? DEFAULT_PORTION_CAP;
        next.upperLimits = !!v2.upperLimits;
    } else {
        const legacy = readJSON<unknown>('customConstraints');
        if (legacy !== undefined) {
            let minCal: number | undefined;
            let maxCal: number | undefined;
            try {
                minCal = numOrUndef(localStorage.getItem('minCalories'));
                maxCal = numOrUndef(localStorage.getItem('maxCalories'));
            } catch { /* ignore */ }
            next.goals = migrateLegacyGoals(legacy);
            next.calories = { min: minCal, max: maxCal };
            next.presetId = matchPreset(next.goals, next.calories);
        }
    }
    return next;
}

function persist(s: PlannerState) {
    try {
        localStorage.setItem('selectedFoods', JSON.stringify(s.foods));
        localStorage.setItem('guaranteedFoods', JSON.stringify(s.fixedFoods));
        localStorage.setItem('foodConstraints', JSON.stringify(s.foodLimits));
        localStorage.setItem(GOALS_KEY, JSON.stringify({
            presetId: s.presetId, goals: s.goals, calories: s.calories, portionCap: s.portionCap, upperLimits: s.upperLimits,
        }));
    } catch { /* storage full or blocked: keep working in memory */ }
}

function getSnapshot(): PlannerState {
    if (!loaded && typeof window !== 'undefined') {
        loaded = true;
        state = load();
    }
    return state;
}

function getServerSnapshot(): PlannerState {
    return INITIAL;
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
        if (e.key && ['selectedFoods', 'guaranteedFoods', 'foodConstraints', GOALS_KEY].includes(e.key)) {
            state = load();
            cb();
        }
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
        state = load();
        listeners.forEach(l => l());
    });
}

function update(fn: (s: PlannerState) => PlannerState) {
    const next = fn(getSnapshot());
    if (next === state) return;
    state = next;
    persist(state);
    listeners.forEach(l => l());
}

/* ---------------- actions ---------------- */

export const plannerActions = {
    addFood(food: Food) {
        update(s => (s.foods.some(f => f.id === food.id) || s.fixedFoods.some(f => f.food.id === food.id))
            ? s : { ...s, foods: [...s.foods, food] });
    },
    addFoods(foods: Food[]) {
        update(s => {
            const have = new Set([...s.foods.map(f => f.id), ...s.fixedFoods.map(f => f.food.id)]);
            const add = foods.filter(f => !have.has(f.id));
            return add.length ? { ...s, foods: [...s.foods, ...add] } : s;
        });
    },
    removeFood(id: number) {
        update(s => {
            const limits = { ...s.foodLimits };
            delete limits[id];
            return {
                ...s,
                foods: s.foods.filter(f => f.id !== id),
                fixedFoods: s.fixedFoods.filter(f => f.food.id !== id),
                foodLimits: limits,
            };
        });
    },
    /** Switch a food between "planner decides" and "fixed amount". */
    setFixed(food: Food, grams: number | null) {
        update(s => {
            const foods = s.foods.filter(f => f.id !== food.id);
            const fixedFoods = s.fixedFoods.filter(f => f.food.id !== food.id);
            if (grams === null) return { ...s, foods: [...foods, food], fixedFoods };
            const idx = s.fixedFoods.findIndex(f => f.food.id === food.id);
            const entry = { food, grams };
            if (idx >= 0) { const copy = [...s.fixedFoods]; copy[idx] = entry; return { ...s, foods, fixedFoods: copy }; }
            return { ...s, foods, fixedFoods: [...fixedFoods, entry] };
        });
    },
    setFoodLimit(id: number, field: 'min' | 'max', grams: number | undefined) {
        update(s => {
            const cur = { ...(s.foodLimits[id] ?? {}) };
            if (grams === undefined) delete cur[field]; else cur[field] = grams;
            const limits = { ...s.foodLimits };
            if (cur.min === undefined && cur.max === undefined) delete limits[id]; else limits[id] = cur;
            return { ...s, foodLimits: limits };
        });
    },
    clearFoods() {
        update(s => ({ ...s, foods: [], fixedFoods: [], foodLimits: {} }));
    },
    restoreFoods(foods: Food[], fixedFoods: FixedFood[], foodLimits: FoodLimits) {
        update(s => ({ ...s, foods, fixedFoods, foodLimits }));
    },
    /** Replace everything, e.g. when reopening a saved plan. */
    replaceAll(next: Omit<PlannerState, 'hydrated'>) {
        update(s => ({ ...s, ...next, hydrated: true }));
    },
    /** One more serving of a recipe, as it stands now. */
    addRecipeServing(food: Food) {
        update(s => ({ ...s, fixedFoods: addRecipeServing(s.fixedFoods, food) }));
    },
    removeRecipeServing(id: number) {
        update(s => ({ ...s, fixedFoods: removeRecipeServing(s.fixedFoods, id) }));
    },
    /** Carry an edited recipe into the plan, if it's there. */
    syncRecipe(food: Food) {
        update(s => {
            const fixedFoods = syncRecipeInPlan(s.fixedFoods, food);
            return fixedFoods === s.fixedFoods ? s : { ...s, fixedFoods: [...fixedFoods] };
        });
    },
    /**
     * Swap saved copies of foods for what the server says today. The browser may have
     * saved a food before a data change, and a food has one set of values everywhere.
     */
    refreshFoods(fresh: Food[]) {
        const byFdc = new Map(fresh.map(f => [f.fdc_id, f]));
        const swap = (f: Food): Food => {
            const row = byFdc.get(f.fdc_id);
            if (!row) return f;
            const next = { ...row, id: f.id };
            return JSON.stringify(next) === JSON.stringify(f) ? f : next;
        };
        update(s => {
            const foods = s.foods.map(swap);
            const fixedFoods = s.fixedFoods.map(entry => {
                const food = swap(entry.food);
                return food === entry.food ? entry : { ...entry, food };
            });
            const same = foods.every((f, i) => f === s.foods[i]) && fixedFoods.every((f, i) => f === s.fixedFoods[i]);
            return same ? s : { ...s, foods, fixedFoods };
        });
    },
    applyPreset(id: PresetId) {
        const p = presetById(id);
        update(s => p ? { ...s, presetId: p.id, goals: p.goals, calories: p.calories } : { ...s, presetId: 'custom' });
    },
    setGoal(key: string, range: GoalRange) {
        update(s => {
            const goals = { ...s.goals, [key]: range };
            return { ...s, goals, presetId: matchPreset(goals, s.calories) };
        });
    },
    setCalories(calories: CalorieRange) {
        update(s => ({ ...s, calories, presetId: matchPreset(s.goals, calories) }));
    },
    setPortionCap(portionCap: PortionCap) {
        update(s => ({ ...s, portionCap }));
    },
    setUpperLimits(upperLimits: boolean) {
        update(s => ({ ...s, upperLimits }));
    },
};

/** Latest state, synchronously (useful right after an action, before re-render). */
export function getPlannerSnapshot(): PlannerState {
    return getSnapshot();
}

export function usePlannerState(): PlannerState {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
