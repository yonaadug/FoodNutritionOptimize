/**
 * Recent searches, kept in the visitor's browser only (localStorage).
 * Pure list logic here; the storage hook lives in components/explore.
 */

export const RECENT_SEARCHES_KEY = 'mnd.recentSearches.v1';
export const RECENT_SEARCHES_MAX = 8;

/** Normalise whitespace and length. */
export function cleanQuery(q: string): string {
    return q.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Put `q` first, dropping case-insensitive duplicates and anything past `max`. Queries under 2 characters are ignored. */
export function pushRecent(list: readonly string[], q: string, max = RECENT_SEARCHES_MAX): string[] {
    const clean = cleanQuery(q);
    if (clean.length < 2) return list.slice(0, max);
    const lower = clean.toLowerCase();
    return [clean, ...list.filter(x => x.toLowerCase() !== lower)].slice(0, max);
}

export function removeRecent(list: readonly string[], q: string): string[] {
    const lower = q.toLowerCase();
    return list.filter(x => x.toLowerCase() !== lower);
}

/** Parse stored JSON defensively: anything unexpected becomes an empty list. */
export function parseRecent(raw: string | null | undefined, max = RECENT_SEARCHES_MAX): string[] {
    if (!raw) return [];
    try {
        const v: unknown = JSON.parse(raw);
        if (!Array.isArray(v)) return [];
        return v.filter((x): x is string => typeof x === 'string').map(cleanQuery).filter(x => x.length >= 2).slice(0, max);
    } catch {
        return [];
    }
}
