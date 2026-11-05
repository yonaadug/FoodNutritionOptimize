import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
    decodeCursor, encodeCursor, indexAttrs, InvalidCursorError, isLive, nowSeconds,
    type ItemKey, type PutOptions, type QueryOptions, type QueryPage, type SingleTable, type TableItem,
} from './table';

/**
 * SingleTable on a writable SQLite file (local dev, tests, self-hosting on a box
 * with a disk). Opened read-write; this is never the read-only nutrition.db.
 *
 * Each row stores the whole item as JSON plus copies of the key attributes in
 * indexed columns, so queries behave like the DynamoDB table and its GSIs.
 */
type Row = { doc: string; pk: string; sk: string; ik: string | null };

const DDL = `
CREATE TABLE IF NOT EXISTS items (
    pk TEXT NOT NULL,
    sk TEXT NOT NULL,
    gsi1pk TEXT,
    gsi1sk TEXT,
    gsi2pk TEXT,
    gsi2sk TEXT,
    expires_at INTEGER,
    doc TEXT NOT NULL,
    PRIMARY KEY (pk, sk)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS items_gsi1 ON items (gsi1pk, gsi1sk) WHERE gsi1pk IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_gsi2 ON items (gsi2pk, gsi2sk) WHERE gsi2pk IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_expiry ON items (expires_at) WHERE expires_at IS NOT NULL;
`;

const COLUMN: Record<string, string> = { PK: 'pk', SK: 'sk', GSI1PK: 'gsi1pk', GSI1SK: 'gsi1sk', GSI2PK: 'gsi2pk', GSI2SK: 'gsi2sk' };

export class SqliteTable implements SingleTable {
    readonly kind = 'sqlite' as const;
    private db: Database.Database;
    private writes = 0;

    /** `file` may be ':memory:' (tests). Parent directories are created. */
    constructor(file: string) {
        if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
        this.db = new Database(file);
        if (file !== ':memory:') this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(DDL);
        this.purgeExpired();
    }

    close() {
        this.db.close();
    }

    /** Remove expired rows (reads already ignore them; this just reclaims space). */
    purgeExpired() {
        this.db.prepare('DELETE FROM items WHERE expires_at IS NOT NULL AND expires_at <= ?').run(nowSeconds());
    }

    private maybePurge() {
        if (++this.writes % 500 === 0) this.purgeExpired();
    }

    private readRaw(key: ItemKey): TableItem | null {
        const row = this.db.prepare('SELECT doc FROM items WHERE pk = ? AND sk = ?').get(key.PK, key.SK) as { doc: string } | undefined;
        return row ? (JSON.parse(row.doc) as TableItem) : null;
    }

    private write(item: TableItem) {
        this.db.prepare(`INSERT OR REPLACE INTO items (pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, expires_at, doc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
            item.PK, item.SK,
            item.GSI1PK ?? null, item.GSI1SK ?? null, item.GSI2PK ?? null, item.GSI2SK ?? null,
            typeof item.expiresAt === 'number' ? item.expiresAt : null,
            JSON.stringify(item),
        );
        this.maybePurge();
    }

    async get(key: ItemKey): Promise<TableItem | null> {
        const item = this.readRaw(key);
        return item && isLive(item) ? item : null;
    }

    async put(item: TableItem, options: PutOptions = {}): Promise<boolean> {
        return this.db.transaction(() => {
            const existing = this.readRaw(item);
            const live = existing && isLive(existing) ? existing : null;
            if (options.ifNotExists && live) return false;
            if (options.ifVersion !== undefined && (live?._v ?? -1) !== options.ifVersion) return false;
            this.write({ ...item, _v: (live?._v ?? 0) + 1 });
            return true;
        }).immediate();
    }

    async take(key: ItemKey, options: { ifVersion?: number } = {}): Promise<TableItem | null> {
        return this.db.transaction(() => {
            const existing = this.readRaw(key);
            if (!existing) return null;
            if (options.ifVersion !== undefined && existing._v !== options.ifVersion) return null;
            this.db.prepare('DELETE FROM items WHERE pk = ? AND sk = ?').run(key.PK, key.SK);
            return isLive(existing) ? existing : null;
        }).immediate();
    }

    async query(options: QueryOptions): Promise<QueryPage> {
        const { pk: pkAttr, sk: skAttr } = indexAttrs(options.index);
        const pkCol = COLUMN[pkAttr];
        const skCol = COLUMN[skAttr];
        const desc = !!options.descending;
        const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
        const params: unknown[] = [options.pk];
        let sql = `SELECT doc, pk, sk, ${skCol} AS ik FROM items WHERE ${pkCol} = ? AND (expires_at IS NULL OR expires_at > ?)`;
        params.push(nowSeconds());
        if (options.skPrefix) {
            sql += ` AND substr(${skCol}, 1, ?) = ?`;
            params.push(options.skPrefix.length, options.skPrefix);
        }
        // Order by (index sort key, table PK, table SK): a total order, so cursors are exact.
        const tuple = options.index ? `(${skCol}, pk, sk)` : '(sk)';
        if (options.cursor) {
            const pos = decodeCursor(options.cursor, `${options.index ?? 'T'}:${options.pk}`);
            const values = options.index ? [pos.ik, pos.pk, pos.sk] : [pos.sk];
            if (values.some(v => typeof v !== 'string')) throw new InvalidCursorError();
            sql += ` AND ${tuple} ${desc ? '<' : '>'} (${values.map(() => '?').join(', ')})`;
            params.push(...values);
        }
        const dir = desc ? 'DESC' : 'ASC';
        sql += options.index ? ` ORDER BY ${skCol} ${dir}, pk ${dir}, sk ${dir}` : ` ORDER BY sk ${dir}`;
        sql += ' LIMIT ?';
        params.push(limit + 1);
        const rows = this.db.prepare(sql).all(...params) as Row[];
        const page = rows.slice(0, limit);
        const items = page.map(r => JSON.parse(r.doc) as TableItem);
        if (rows.length <= limit) return { items };
        const last = page[page.length - 1];
        const position: Record<string, string> = options.index ? { ik: last.ik ?? '', pk: last.pk, sk: last.sk } : { sk: last.sk };
        return { items, cursor: encodeCursor(`${options.index ?? 'T'}:${options.pk}`, position) };
    }

    async increment(key: ItemKey, by: number, ttlSeconds?: number): Promise<number> {
        return this.db.transaction(() => {
            const existing = this.readRaw(key);
            const now = nowSeconds();
            if (!existing || !isLive(existing, now)) {
                const item: TableItem = { PK: key.PK, SK: key.SK, count: by, _v: 1 };
                if (ttlSeconds) item.expiresAt = now + ttlSeconds;
                this.write(item);
                return by;
            }
            const count = (typeof existing.count === 'number' ? existing.count : 0) + by;
            this.write({ ...existing, count, _v: (existing._v ?? 0) + 1 });
            return count;
        }).immediate();
    }

    async deleteMany(keys: ItemKey[]): Promise<void> {
        const del = this.db.prepare('DELETE FROM items WHERE pk = ? AND sk = ?');
        this.db.transaction(() => {
            for (const k of keys) del.run(k.PK, k.SK);
        })();
    }
}
