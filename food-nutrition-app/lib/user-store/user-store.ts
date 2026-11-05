import { HISTORY_LIMITS, type HistoryInput, type HistoryItem } from './history';
import { nowSeconds, type ItemKey, type SingleTable, type TableItem } from './table';

/**
 * Per-user data on top of the single table. Better Auth owns sign-in (it writes the
 * PROFILE and ACCOUNT items through lib/auth/adapter.ts); this class owns everything
 * the app itself keeps about a person, plus account export and deletion.
 */

export const userPk = (userId: string) => `USER#${userId}`;
export const PROFILE_SK = 'PROFILE';
export const ACCOUNT_SK_PREFIX = 'ACCOUNT#';
const HIST_PREFIX = 'HIST#';
const HISTCOUNT_PREFIX = 'HISTCOUNT#';
const histSk = (kind: string, itemId: string) => `${HIST_PREFIX}${kind}#${itemId}`;
const countSk = (kind: string) => `${HISTCOUNT_PREFIX}${kind}`;
const recentAllPk = (userId: string) => `USER#${userId}#HIST`;
const recentKindPk = (userId: string, kind: string) => `USER#${userId}#HIST#${kind}`;

export const PREFERENCES_MAX_BYTES = 2 * 1024;
export const DISPLAY_NAME_MAX = 60;

export interface UserProfile {
    id: string;
    email: string;
    displayName: string;
    preferences: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface ProfilePatch {
    displayName?: string;
    preferences?: Record<string, unknown>;
}

export interface HistoryPage {
    items: HistoryItem[];
    nextCursor: string | null;
}

export interface AccountExport {
    format: 'micronutrient-diary-account-export';
    version: 1;
    exportedAt: string;
    profile: UserProfile | null;
    signInMethods: { providerId: string; createdAt: unknown }[];
    history: HistoryItem[];
}

const iso = (value: unknown): string => {
    if (typeof value === 'string' && value) return value;
    if (value instanceof Date) return value.toISOString();
    return new Date(0).toISOString();
};

function toProfile(item: TableItem): UserProfile {
    return {
        id: String(item.id),
        email: String(item.email ?? ''),
        displayName: typeof item.name === 'string' ? item.name : '',
        preferences: (item.preferences && typeof item.preferences === 'object' ? item.preferences : {}) as Record<string, unknown>,
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
    };
}

function toHistoryItem(item: TableItem): HistoryItem {
    return {
        kind: String(item.kind),
        itemId: String(item.itemId),
        title: String(item.title),
        href: String(item.href),
        data: item.data ?? null,
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
    };
}

export class UserStore {
    readonly table: SingleTable;
    private maxItemsPerKind: number;

    constructor(table: SingleTable, options: { maxItemsPerKind?: number } = {}) {
        this.table = table;
        this.maxItemsPerKind = options.maxItemsPerKind ?? HISTORY_LIMITS.itemsPerKind;
    }

    // ---- profile ----

    async getProfile(userId: string): Promise<UserProfile | null> {
        const item = await this.table.get({ PK: userPk(userId), SK: PROFILE_SK });
        return item ? toProfile(item) : null;
    }

    /** Compare-and-set so a profile edit can't overwrite a concurrent sign-in update. */
    async updateProfile(userId: string, patch: ProfilePatch): Promise<UserProfile | null> {
        for (let attempt = 0; attempt < 4; attempt++) {
            const item = await this.table.get({ PK: userPk(userId), SK: PROFILE_SK });
            if (!item) return null;
            const next: TableItem = { ...item, updatedAt: new Date().toISOString() };
            if (patch.displayName !== undefined) next.name = patch.displayName;
            if (patch.preferences !== undefined) next.preferences = patch.preferences;
            if (await this.table.put(next, { ifVersion: item._v ?? 0 })) return toProfile(next);
        }
        throw new Error('updateProfile: too much contention');
    }

    // ---- history ----

    /** Insert or update by (user, kind, itemId). A repeat moves the item to the top and keeps createdAt. */
    async upsertHistory(userId: string, input: HistoryInput): Promise<HistoryItem> {
        const key: ItemKey = { PK: userPk(userId), SK: histSk(input.kind, input.itemId) };
        for (let attempt = 0; attempt < 4; attempt++) {
            const existing = await this.table.get(key);
            const now = new Date().toISOString();
            const item: TableItem = {
                ...key,
                GSI1PK: recentAllPk(userId),
                GSI1SK: `${now}#${input.kind}#${input.itemId}`,
                GSI2PK: recentKindPk(userId, input.kind),
                GSI2SK: `${now}#${input.itemId}`,
                kind: input.kind,
                itemId: input.itemId,
                title: input.title,
                href: input.href,
                data: input.data ?? null,
                createdAt: existing ? iso(existing.createdAt) : now,
                updatedAt: now,
            };
            const written = existing
                ? await this.table.put(item, { ifVersion: existing._v ?? 0 })
                : await this.table.put(item, { ifNotExists: true });
            if (written) {
                if (!existing) await this.afterInsert(userId, input.kind);
                return toHistoryItem(item);
            }
        }
        throw new Error('upsertHistory: too much contention');
    }

    /** Keep a per-kind counter and evict the oldest items past the cap, so one account can't grow without bound. */
    private async afterInsert(userId: string, kind: string) {
        const counterKey = { PK: userPk(userId), SK: countSk(kind) };
        const count = await this.table.increment(counterKey, 1);
        const excess = count - this.maxItemsPerKind;
        if (excess <= 0) return;
        const { items } = await this.table.query({ pk: recentKindPk(userId, kind), index: 'GSI2', limit: excess });
        if (items.length === 0) return;
        await this.table.deleteMany(items.map(i => ({ PK: i.PK, SK: i.SK })));
        await this.table.increment(counterKey, -items.length);
    }

    /** Newest first. `kind` is optional. */
    async listHistory(userId: string, options: { kind?: string; limit?: number; cursor?: string } = {}): Promise<HistoryPage> {
        const page = await this.table.query({
            pk: options.kind ? recentKindPk(userId, options.kind) : recentAllPk(userId),
            index: options.kind ? 'GSI2' : 'GSI1',
            descending: true,
            limit: options.limit ?? HISTORY_LIMITS.pageSizeDefault,
            cursor: options.cursor,
        });
        return { items: page.items.map(toHistoryItem), nextCursor: page.cursor ?? null };
    }

    /** One item, or null. Read directly by key, so it is never behind an index. */
    async getHistoryItem(userId: string, kind: string, itemId: string): Promise<HistoryItem | null> {
        const item = await this.table.get({ PK: userPk(userId), SK: histSk(kind, itemId) });
        return item ? toHistoryItem(item) : null;
    }

    /** Returns whether an item was actually removed. */
    async deleteHistory(userId: string, kind: string, itemId: string): Promise<boolean> {
        const removed = await this.table.take({ PK: userPk(userId), SK: histSk(kind, itemId) });
        if (!removed) return false;
        await this.table.increment({ PK: userPk(userId), SK: countSk(kind) }, -1);
        return true;
    }

    /** Clear all history, or just one kind. Returns how many items were removed. */
    async clearHistory(userId: string, kind?: string): Promise<number> {
        const pk = userPk(userId);
        const removed = await this.deletePartition(pk, kind ? `${HIST_PREFIX}${kind}#` : HIST_PREFIX);
        await this.deletePartition(pk, kind ? countSk(kind) : HISTCOUNT_PREFIX);
        return removed;
    }

    private async deletePartition(pk: string, skPrefix?: string): Promise<number> {
        let total = 0;
        for (;;) {
            // Always restart from the top: the previous page has just been deleted.
            const { items, cursor } = await this.table.query({ pk, skPrefix, limit: 200 });
            // Sign-in records carry the keys of their lookup pointers (lib/auth/adapter.ts).
            // Removing those too is what stops a deleted email from resolving to anything.
            const pointers = items.flatMap(i => (Array.isArray(i._ptrs) ? (i._ptrs as ItemKey[]) : []));
            const keys = [...items.map(i => ({ PK: i.PK, SK: i.SK })), ...pointers];
            if (keys.length > 0) await this.table.deleteMany(keys);
            total += items.length;
            if (!cursor) return total;
        }
    }

    private async readAll(pk: string, skPrefix: string): Promise<TableItem[]> {
        const all: TableItem[] = [];
        let cursor: string | undefined;
        do {
            const page = await this.table.query({ pk, skPrefix, limit: 200, cursor });
            all.push(...page.items);
            cursor = page.cursor;
        } while (cursor);
        return all;
    }

    // ---- privacy: export and delete ----

    /** Everything we hold about a person, minus secrets (provider tokens are never exported). */
    async exportAccount(userId: string): Promise<AccountExport> {
        const pk = userPk(userId);
        const [profile, accounts, history] = await Promise.all([
            this.getProfile(userId),
            this.readAll(pk, ACCOUNT_SK_PREFIX),
            this.readAll(pk, HIST_PREFIX),
        ]);
        return {
            format: 'micronutrient-diary-account-export',
            version: 1,
            exportedAt: new Date().toISOString(),
            profile,
            signInMethods: accounts.map(a => ({ providerId: String(a.providerId), createdAt: a.createdAt })),
            history: history.map(toHistoryItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        };
    }

    /**
     * Permanently delete everything stored under the user's partition (profile, sign-in
     * methods, history, counters) and the lookup pointers those records own. Session
     * revocation is the caller's job (lib/auth/handlers.ts), because sessions belong to
     * Better Auth.
     */
    async deleteAccountData(userId: string): Promise<number> {
        return this.deletePartition(userPk(userId));
    }
}

// ---- Better Auth secondary storage (sessions, magic-link tokens, auth rate limits) ----

const kvKey = (key: string): ItemKey => ({ PK: `KV#${key}`, SK: 'KV' });

export interface KeyValueStore {
    get(key: string): Promise<string | null>;
    getAndDelete(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string, ttlSeconds: number): Promise<number>;
}

export function createKeyValueStore(table: SingleTable): KeyValueStore {
    const read = (item: TableItem | null) => {
        if (!item) return null;
        // A counter written by increment() has `count`, not `value`.
        return typeof item.value === 'string' ? item.value : item.count !== undefined ? String(item.count) : null;
    };
    return {
        get: async key => read(await table.get(kvKey(key))),
        getAndDelete: async key => read(await table.take(kvKey(key))),
        set: async (key, value, ttlSeconds) => {
            const item: TableItem = { ...kvKey(key), value };
            if (ttlSeconds && ttlSeconds > 0) item.expiresAt = nowSeconds() + Math.ceil(ttlSeconds);
            await table.put(item);
        },
        delete: async key => {
            await table.take(kvKey(key));
        },
        increment: (key, ttlSeconds) => table.increment(kvKey(key), 1, ttlSeconds),
    };
}
