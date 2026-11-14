import type { HistoryItem } from '@/lib/user-store/history';
import type { HistoryPage, UserStore } from '@/lib/user-store/user-store';
import { LIMITED_HISTORY_KINDS } from './entitlements';

/**
 * Free accounts see their most recent plans and recipes only (FREE_HISTORY_LIMIT).
 * Nothing is deleted: older rows stay in the table, come back with Plus, and are always
 * in the export. Foods, and any other kind, are never limited.
 */

export interface LimitedHistoryPage extends HistoryPage {
    /** Present when a limit applied to this kind: how many are shown at most, and how many are kept back. */
    limited?: { limit: number; hidden: number };
}

const isLimitedKind = (kind: string) => (LIMITED_HISTORY_KINDS as readonly string[]).includes(kind);

async function newestIds(store: UserStore, userId: string, kind: string, limit: number): Promise<Set<string>> {
    const { items } = await store.listHistory(userId, { kind, limit });
    return new Set(items.map(i => i.itemId));
}

/**
 * `limit` is the plan's history limit, null for all of it. A limited kind is served in
 * one page of at most `limit` items, so there is never a cursor into the hidden rows.
 */
export async function listHistoryWithLimit(
    store: UserStore,
    userId: string,
    limit: number | null,
    options: { kind?: string; limit?: number; cursor?: string },
): Promise<LimitedHistoryPage> {
    if (limit === null) return store.listHistory(userId, options);

    if (options.kind) {
        if (!isLimitedKind(options.kind)) return store.listHistory(userId, options);
        const total = await store.countHistory(userId, options.kind);
        const limited = { limit, hidden: Math.max(0, total - limit) };
        if (options.cursor) return { items: [], nextCursor: null, limited };
        const { items } = await store.listHistory(userId, { kind: options.kind, limit: Math.min(limit, options.limit ?? limit) });
        return { items, nextCursor: null, limited };
    }

    // The mixed list: keep plans and recipes that are among the newest of their kind.
    const visible = new Map<string, Set<string>>();
    await Promise.all(LIMITED_HISTORY_KINDS.map(async kind => visible.set(kind, await newestIds(store, userId, kind, limit))));
    const page = await store.listHistory(userId, options);
    const keep = (item: HistoryItem) => !visible.has(item.kind) || visible.get(item.kind)!.has(item.itemId);
    return { items: page.items.filter(keep), nextCursor: page.nextCursor };
}

/** Whether one saved item may be opened on this plan. */
export async function historyItemVisible(store: UserStore, userId: string, limit: number | null, kind: string, itemId: string): Promise<boolean> {
    if (limit === null || !isLimitedKind(kind)) return true;
    return (await newestIds(store, userId, kind, limit)).has(itemId);
}
