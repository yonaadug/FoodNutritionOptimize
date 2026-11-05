'use client';

import { useSyncExternalStore } from 'react';
import { LOCAL_DATA_CLEARED_EVENT } from '@/lib/local-data';
import { parseRecent, pushRecent, RECENT_SEARCHES_KEY, removeRecent } from '@/lib/recent-searches';

/** Recent searches in localStorage, as an external store so the server render stays empty and hydration is clean. */
const EMPTY: string[] = [];
let list: string[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function getSnapshot(): string[] {
    if (!loaded) {
        loaded = true;
        try { list = parseRecent(localStorage.getItem(RECENT_SEARCHES_KEY)); } catch { /* blocked storage */ }
    }
    return list;
}

function set(next: string[]) {
    list = next;
    try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* keep working in memory */ }
    listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    // Cleared by signing out in another tab.
    const onStorage = (e: StorageEvent) => {
        if (e.key !== RECENT_SEARCHES_KEY) return;
        list = parseRecent(e.newValue);
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
        list = EMPTY;
        listeners.forEach(l => l());
    });
}

export const recentSearches = {
    add(q: string) { set(pushRecent(getSnapshot(), q)); },
    remove(q: string) { set(removeRecent(getSnapshot(), q)); },
    clear() { set([]); },
};

export function useRecentSearches(): string[] {
    return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
