'use client';

import { useSyncExternalStore } from 'react';

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
    step = next;
    try { localStorage.setItem(STEP_KEY, next); } catch { /* ignore */ }
    try {
        const url = `${window.location.pathname}${window.location.search}#${next}`;
        if (changed) window.history.pushState(null, '', url); else window.history.replaceState(null, '', url);
    } catch { /* sandboxed iframes */ }
    listeners.forEach(l => l());
}

export function useStep(): StepId {
    return useSyncExternalStore(subscribe, getSnapshot, () => 'foods' as StepId);
}
