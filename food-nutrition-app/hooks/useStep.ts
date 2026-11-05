'use client';

import { useSyncExternalStore } from 'react';
import { LOCAL_DATA_CLEARED_EVENT } from '@/lib/local-data';

export type StepId = 'foods' | 'goals' | 'plan';

const STEPS: StepId[] = ['foods', 'goals', 'plan'];
const STEP_KEY = 'nc.step';

export function isStep(v: unknown): v is StepId {
    return typeof v === 'string' && (STEPS as string[]).includes(v);
}

/**
 * Which step to open on: the address (#plan) wins, so a bookmark works;
 * otherwise the step the user was last on.
 */
export function initialStep(hash: string, saved: string | null): StepId {
    const fromHash = hash.replace(/^#/, '');
    if (isStep(fromHash)) return fromHash;
    return isStep(saved) ? saved : 'foods';
}

let step: StepId = 'foods';
let loaded = false;
const listeners = new Set<() => void>();

// Signing out in this tab: the next visit starts from the first step.
if (typeof window !== 'undefined') {
    window.addEventListener(LOCAL_DATA_CLEARED_EVENT, () => {
        step = 'foods';
        listeners.forEach(l => l());
    });
}

function read(): StepId {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STEP_KEY); } catch { /* blocked storage */ }
    return initialStep(window.location.hash, saved);
}

function getSnapshot(): StepId {
    if (!loaded && typeof window !== 'undefined') {
        loaded = true;
        step = read();
    }
    return step;
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    // Back/forward between steps, or someone editing the address.
    const onPop = () => {
        const fromHash = window.location.hash.replace(/^#/, '');
        if (isStep(fromHash) && fromHash !== step) {
            step = fromHash;
            try { localStorage.setItem(STEP_KEY, step); } catch { /* ignore */ }
            cb();
        }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
        listeners.delete(cb);
        window.removeEventListener('popstate', onPop);
        window.removeEventListener('hashchange', onPop);
    };
}

/** Go to a step: remembered across reloads and reflected in the address (#goals). */
export function setStep(next: StepId) {
    getSnapshot();
    if (next === step && window.location.hash === `#${next}`) return;
    const changed = next !== step;
    const leaving = step;
    step = next;
    try { localStorage.setItem(STEP_KEY, next); } catch { /* ignore */ }
    try {
        const base = `${window.location.pathname}${window.location.search}`;
        const url = `${base}#${next}`;
        if (changed) {
            // Name the step in the entry being left, so Back to it knows where it was
            // (regression: after arriving at a bare /plan, Back changed the address and the page stayed put).
            if (!isStep(window.location.hash.replace(/^#/, ''))) window.history.replaceState(window.history.state, '', `${base}#${leaving}`);
            window.history.pushState(null, '', url);
        } else {
            window.history.replaceState(null, '', url);
        }
    } catch { /* sandboxed iframes */ }
    listeners.forEach(l => l());
}

/**
 * Adopt the step named in the address, without adding a history entry. The
 * store only reads the address once, so a client-side navigation to /plan#goals
 * needs this when the planner has already been open in this tab.
 */
export function syncStepFromLocation() {
    getSnapshot();
    const fromHash = window.location.hash.replace(/^#/, '');
    if (!isStep(fromHash) || fromHash === step) return;
    step = fromHash;
    try { localStorage.setItem(STEP_KEY, step); } catch { /* ignore */ }
    listeners.forEach(l => l());
}

export function useStep(): StepId {
    return useSyncExternalStore(subscribe, getSnapshot, () => 'foods' as StepId);
}
