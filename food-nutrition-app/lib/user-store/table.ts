/**
 * The one storage primitive every account feature is built on: a DynamoDB-style
 * single table (PK/SK + two overloaded GSIs + a TTL attribute).
 *
 * Two backends implement it:
 *   - SqliteTable (lib/user-store/sqlite-table.ts): a writable SQLite file for
 *     local dev and tests (default .data/app.db). Never nutrition.db.
 *   - DynamoTable (lib/user-store/dynamo-table.ts): DynamoDB in production.
 *
 * Everything above this interface (the Better Auth adapter, sessions, magic-link
 * tokens, history, rate limits, export, deletion) is backend-independent, so the
 * code path exercised on a laptop is the same one that runs on Lambda.
 *
 * Layout (see docs/ACCOUNTS.md for the full table):
 *   USER#<id>   PROFILE                   user profile
 *   USER#<id>   ACCOUNT#<id>              sign-in method (e.g. Google)
 *   USER#<id>   HIST#<kind>#<itemId>      history item (+ GSI1/GSI2 for recency)
 *   USER#<id>   HISTCOUNT#<kind>          per-kind item counter (enforces the cap)
 *   EMAIL#<email>  EMAIL                  pointer to the profile (unique email)
 *   ACCOUNTID#<id> / ACCTKEY#<provider>#<accountId>   pointers to a sign-in method
 *   KV#<key>    KV                        Better Auth secondary storage (sessions,
 *                                         magic-link tokens, auth rate limits); TTL
 *   RL#<scope>#<key>  W#<window>          app rate-limit counters; TTL
 */

export type IndexName = 'GSI1' | 'GSI2';

export interface TableItem {
    PK: string;
    SK: string;
    GSI1PK?: string;
    GSI1SK?: string;
    GSI2PK?: string;
    GSI2SK?: string;
    /** Epoch seconds. Expired items are invisible to every read (DynamoDB TTL deletes lazily). */
    expiresAt?: number;
    /** Optimistic-concurrency version, maintained by the table. */
    _v?: number;
    [attr: string]: unknown;
}

export interface ItemKey {
    PK: string;
    SK: string;
}

export interface PutOptions {
    /** Fail (return false) if an item with this key already exists (and is not expired). */
    ifNotExists?: boolean;
    /** Fail (return false) unless the stored item's `_v` equals this value. */
    ifVersion?: number;
}

export interface QueryOptions {
    /** Partition key value (of the table, or of the index when `index` is set). */
    pk: string;
    index?: IndexName;
    /** Only items whose sort key starts with this prefix. */
    skPrefix?: string;
    /** Newest/largest sort key first. */
    descending?: boolean;
    limit?: number;
    /** Opaque cursor from a previous page. */
    cursor?: string;
}

export interface QueryPage {
    items: TableItem[];
    /** Present when more items may follow. */
    cursor?: string;
}

export interface SingleTable {
    readonly kind: 'sqlite' | 'dynamodb';
    get(key: ItemKey): Promise<TableItem | null>;
    /** Write a whole item. Returns false when a condition failed. Bumps `_v`. */
    put(item: TableItem, options?: PutOptions): Promise<boolean>;
    /**
     * Delete one item and return what was deleted (null if nothing live was there).
     * Atomic: when two callers race, at most one gets the item back. This is what
     * makes magic-link tokens single-use.
     */
    take(key: ItemKey, options?: { ifVersion?: number }): Promise<TableItem | null>;
    query(options: QueryOptions): Promise<QueryPage>;
    /**
     * Atomically add `by` to the numeric attribute `count` and return the new value.
     * Creates the item (count = by, expiresAt = now + ttlSeconds) when it is missing
     * or expired; later increments never extend the expiry (fixed window).
     */
    increment(key: ItemKey, by: number, ttlSeconds?: number): Promise<number>;
    deleteMany(keys: ItemKey[]): Promise<void>;
}

export class InvalidCursorError extends Error {
    constructor() {
        super('Invalid pagination cursor');
        this.name = 'InvalidCursorError';
    }
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function isLive(item: { expiresAt?: unknown }, now = nowSeconds()): boolean {
    return typeof item.expiresAt !== 'number' || item.expiresAt > now;
}

/** Cursor = base64url(JSON). It is bound to the partition it was issued for. */
export function encodeCursor(pk: string, position: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify({ p: pk, k: position }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, expectedPk: string): Record<string, string> {
    if (cursor.length > 2048) throw new InvalidCursorError();
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!parsed || parsed.p !== expectedPk || typeof parsed.k !== 'object' || parsed.k === null) throw new Error('bad');
        for (const v of Object.values(parsed.k)) if (typeof v !== 'string') throw new Error('bad');
        return parsed.k as Record<string, string>;
    } catch {
        throw new InvalidCursorError();
    }
}

export function indexAttrs(index: IndexName | undefined): { pk: 'PK' | 'GSI1PK' | 'GSI2PK'; sk: 'SK' | 'GSI1SK' | 'GSI2SK' } {
    if (index === 'GSI1') return { pk: 'GSI1PK', sk: 'GSI1SK' };
    if (index === 'GSI2') return { pk: 'GSI2PK', sk: 'GSI2SK' };
    return { pk: 'PK', sk: 'SK' };
}
