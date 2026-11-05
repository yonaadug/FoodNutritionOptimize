'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tiny global toast queue (no context provider needed). Toasts are announced
 * politely by the <Toaster /> live region and dismiss themselves.
 */
export interface Toast {
    id: number;
    message: string;
    tone?: 'success' | 'info';
    action?: { label: string; onClick: () => void };
}

const EMPTY: Toast[] = [];
let toasts: Toast[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
    listeners.forEach(l => l());
}

export function dismissToast(id: number) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    toasts = toasts.filter(x => x.id !== id);
    emit();
}

/** Show a short confirmation, e.g. "Added Mushrooms to your foods". */
export function notify(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}): number {
    const id = nextId++;
    // Keep at most 3 on screen; newest last.
    toasts = [...toasts.slice(-2), { id, message, tone: opts.tone ?? 'success', action: opts.action }];
    emit();
    if (typeof window !== 'undefined') {
        timers.set(id, setTimeout(() => dismissToast(id), opts.ms ?? 5000));
    }
    return id;
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

export function useToasts(): Toast[] {
    return useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
}
