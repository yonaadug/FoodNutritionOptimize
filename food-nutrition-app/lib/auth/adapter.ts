import { createAdapterFactory, type CleanedWhere } from 'better-auth/adapters';
import { ACCOUNT_SK_PREFIX, PROFILE_SK, userPk } from '@/lib/user-store/user-store';
import type { ItemKey, SingleTable, TableItem } from '@/lib/user-store/table';

/**
 * Better Auth database adapter on the single table. Better Auth stores sessions and
 * magic-link tokens in secondary storage (see lib/auth/auth.ts), so only two models
 * reach this adapter, and each has a fixed set of access paths:
 *
 *   user     USER#<id> / PROFILE
 *            lookup by email: pointer EMAIL#<email>
 *   account  USER#<userId> / ACCOUNT#<id>
 *            lookup by id:        pointer ACCOUNTID#<id>
 *            lookup by provider:  pointer ACCTKEY#<providerId>#<accountId>
 *            lookup by user:      query the user's partition
 *
 * A pointer is a small item holding the key of the real record. Unlike a GSI it is
 * strongly consistent, and writing it with attribute_not_exists gives the uniqueness
 * a DynamoDB GSI can't (one user per email, one owner per provider identity).
 * Pointers are written before the record and removed after it, so a crash can only
 * leave an orphan pointer, which lookups ignore and creates replace.
 *
 * Any other model or query shape throws. That is deliberate: a table scan or a silent
 * empty result in an auth flow would be worse than a loud failure in tests.
 */

type Row = Record<string, unknown>;

interface PointerSpec {
    /** Fields that must all be present in the row (or in the where clause) to build this pointer. */
    fields: string[];
    key: (values: Record<string, unknown>) => ItemKey;
    /** Writing it fails if a live record already holds it. */
    unique: boolean;
}

interface ModelSpec {
    key: (row: Row) => ItemKey;
    /** A direct key from a where clause on the record's own id, when the key is derivable. */
    idKey?: (id: string) => ItemKey;
    /** A partition to query, per field. */
    partition?: Record<string, (value: string) => { pk: string; skPrefix: string }>;
    pointers: PointerSpec[];
}

const pointerKey = (kind: string, ...parts: unknown[]): ItemKey => ({ PK: `${kind}#${parts.join('#')}`, SK: kind });

const MODELS: Record<string, ModelSpec> = {
    user: {
        key: row => ({ PK: userPk(String(row.id)), SK: PROFILE_SK }),
        idKey: id => ({ PK: userPk(id), SK: PROFILE_SK }),
        pointers: [{ fields: ['email'], unique: true, key: v => pointerKey('EMAIL', String(v.email).toLowerCase()) }],
    },
    account: {
        key: row => ({ PK: userPk(String(row.userId)), SK: `${ACCOUNT_SK_PREFIX}${row.id}` }),
        partition: { userId: value => ({ pk: userPk(value), skPrefix: ACCOUNT_SK_PREFIX }) },
        pointers: [
            { fields: ['id'], unique: true, key: v => pointerKey('ACCOUNTID', v.id) },
            { fields: ['providerId', 'accountId'], unique: true, key: v => pointerKey('ACCTKEY', v.providerId, v.accountId) },
        ],
    },
};

/** A pointer whose target is missing is only "orphaned" once it is older than any in-flight create. */
const ORPHAN_AFTER_MS = 60_000;
const INTERNAL_ATTRS = new Set(['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'expiresAt', '_v', '_ptrs']);

export class UnsupportedAuthQueryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedAuthQueryError';
    }
}

export class DuplicateRecordError extends Error {
    constructor(model: string) {
        super(`A ${model} with this identity already exists`);
        this.name = 'DuplicateRecordError';
    }
}

function specFor(model: string): ModelSpec {
    const spec = Object.prototype.hasOwnProperty.call(MODELS, model) ? MODELS[model] : undefined;
    if (!spec) {
        throw new UnsupportedAuthQueryError(`Auth model "${model}" has no storage mapping. Add it to MODELS in lib/auth/adapter.ts.`);
    }
    return spec;
}

function stripInternal(item: TableItem): Row {
    const row: Row = {};
    for (const [k, v] of Object.entries(item)) if (!INTERNAL_ATTRS.has(k)) row[k] = v;
    return row;
}

const comparable = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

function clauseMatches(row: Row, clause: CleanedWhere): boolean {
    const insensitive = clause.mode === 'insensitive';
    const norm = (v: unknown) => {
        const c = comparable(v);
        return insensitive && typeof c === 'string' ? c.toLowerCase() : c;
    };
    const actual = norm(row[clause.field] ?? null);
    const expected = norm(clause.value);
    switch (clause.operator) {
        case 'eq': return actual === expected;
        case 'ne': return actual !== expected;
        case 'in': return Array.isArray(clause.value) && clause.value.map(norm).includes(actual);
        case 'not_in': return Array.isArray(clause.value) && !clause.value.map(norm).includes(actual);
        case 'contains': return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
        case 'starts_with': return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
        case 'ends_with': return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
        case 'gt': return actual !== null && expected !== null && (actual as string) > (expected as string);
        case 'gte': return actual !== null && expected !== null && (actual as string) >= (expected as string);
        case 'lt': return actual !== null && expected !== null && (actual as string) < (expected as string);
        case 'lte': return actual !== null && expected !== null && (actual as string) <= (expected as string);
        default: throw new UnsupportedAuthQueryError(`Unsupported operator ${String(clause.operator)}`);
    }
}

/** Same semantics as Better Auth's SQL adapters: every AND clause, and at least one OR clause if any exist. */
function matches(row: Row, where: CleanedWhere[]): boolean {
    const ands = where.filter(c => c.connector !== 'OR');
    const ors = where.filter(c => c.connector === 'OR');
    return ands.every(c => clauseMatches(row, c)) && (ors.length === 0 || ors.some(c => clauseMatches(row, c)));
}

/** Values a clause pins a field to (eq or in), case-preserved. Only AND clauses narrow the search. */
function pinned(where: CleanedWhere[], field: string): string[] | null {
    if (where.some(c => c.connector === 'OR')) return null;
    const clause = where.find(c => c.field === field && (c.operator === 'eq' || c.operator === 'in'));
    if (!clause || clause.value === null) return null;
    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
    return values.map(v => String(comparable(v)));
}

async function liveTarget(table: SingleTable, pointer: TableItem | null): Promise<TableItem | null> {
    if (!pointer) return null;
    return table.get({ PK: String(pointer.targetPK), SK: String(pointer.targetSK) });
}

async function candidates(table: SingleTable, model: string, where: CleanedWhere[]): Promise<TableItem[]> {
    const spec = specFor(model);

    const ids = spec.idKey ? pinned(where, 'id') : null;
    if (ids && spec.idKey) {
        const items = await Promise.all(ids.map(id => table.get(spec.idKey!(id))));
        return items.filter((i): i is TableItem => i !== null);
    }

    for (const pointer of spec.pointers) {
        const pins = pointer.fields.map(f => pinned(where, f));
        if (pins.some(p => p === null)) continue;
        // Expand `in` clauses into one lookup each. Only single-field pointers see more than one value in practice.
        let combos: Record<string, unknown>[] = [{}];
        pointer.fields.forEach((field, i) => {
            combos = combos.flatMap(c => (pins[i] as string[]).map(v => ({ ...c, [field]: v })));
        });
        const items = await Promise.all(combos.map(async c => liveTarget(table, await table.get(pointer.key(c)))));
        return items.filter((i): i is TableItem => i !== null);
    }

    for (const [field, toPartition] of Object.entries(spec.partition ?? {})) {
        const values = pinned(where, field);
        if (!values) continue;
        const items: TableItem[] = [];
        for (const value of values) {
            const { pk, skPrefix } = toPartition(value);
            let cursor: string | undefined;
            do {
                const page = await table.query({ pk, skPrefix, limit: 100, cursor });
                items.push(...page.items);
                cursor = page.cursor;
            } while (cursor);
        }
        return items;
    }

    throw new UnsupportedAuthQueryError(`No access path for ${model} where ${where.map(c => `${c.field} ${c.operator}`).join(', ') || '(none)'}`);
}

async function writePointer(table: SingleTable, model: string, pointer: PointerSpec, row: Row, target: ItemKey): Promise<ItemKey> {
    const key = pointer.key(row);
    const item: TableItem = { ...key, targetPK: target.PK, targetSK: target.SK, createdAtMs: Date.now() };
    for (let attempt = 0; attempt < 2; attempt++) {
        if (await table.put(item, { ifNotExists: true })) return key;
        const existing = await table.get(key);
        if (!existing) continue; // removed between the two calls
        if (await liveTarget(table, existing)) throw new DuplicateRecordError(model);
        // The target is gone. Replace an old orphan, but leave a fresh one alone: its creator may be mid-write.
        if (Date.now() - Number(existing.createdAtMs ?? 0) < ORPHAN_AFTER_MS) throw new DuplicateRecordError(model);
        await table.take(key, { ifVersion: existing._v });
    }
    throw new DuplicateRecordError(model);
}

function pointerKeysFor(spec: ModelSpec, row: Row): ItemKey[] {
    return spec.pointers
        .filter(p => p.fields.every(f => row[f] !== undefined && row[f] !== null))
        .map(p => p.key(row));
}

const pointersOf = (item: TableItem) => (Array.isArray(item._ptrs) ? (item._ptrs as ItemKey[]) : []);

function sameKey(a: ItemKey, b: ItemKey) {
    return a.PK === b.PK && a.SK === b.SK;
}

/** Apply a change to one stored record with compare-and-set. Returns the new item, or null if it stopped matching. */
async function updateItem(table: SingleTable, model: string, start: TableItem, where: CleanedWhere[], update: Row): Promise<TableItem | null> {
    const spec = specFor(model);
    let current: TableItem | null = start;
    for (let attempt = 0; attempt < 4 && current; attempt++) {
        if (!matches(stripInternal(current), where)) return null;
        const row: Row = { ...stripInternal(current), ...update };
        if (spec.key(row).PK !== current.PK || spec.key(row).SK !== current.SK) {
            throw new UnsupportedAuthQueryError(`Changing the key fields of ${model} is not supported`);
        }
        const oldPointers = pointersOf(current);
        const newKeys = pointerKeysFor(spec, row);
        const added: ItemKey[] = [];
        for (const pointer of spec.pointers) {
            if (!pointer.fields.every(f => row[f] !== undefined && row[f] !== null)) continue;
            const key = pointer.key(row);
            if (oldPointers.some(k => sameKey(k, key))) continue;
            added.push(await writePointer(table, model, pointer, row, current));
        }
        const next: TableItem = { ...current, ...update, _ptrs: newKeys };
        if (await table.put(next, { ifVersion: current._v ?? 0 })) {
            const stale = oldPointers.filter(k => !newKeys.some(n => sameKey(n, k)));
            if (stale.length) await table.deleteMany(stale);
            return { ...next, _v: (current._v ?? 0) + 1 };
        }
        if (added.length) await table.deleteMany(added);
        current = await table.get(current);
    }
    return null;
}

/** A compare-and-set delete, so a concurrent change can't be lost and two deleters can't both win. */
async function removeItem(table: SingleTable, item: TableItem): Promise<boolean> {
    const taken = await table.take(item, { ifVersion: item._v ?? 0 });
    if (!taken) return false;
    const pointers = pointersOf(taken);
    if (pointers.length) await table.deleteMany(pointers);
    return true;
}

export function singleTableAdapter(table: SingleTable) {
    return createAdapterFactory({
        config: {
            adapterId: 'single-table',
            adapterName: 'Single Table',
            // Rows are JSON documents on both backends. Dates are stored as ISO-8601
            // strings, which also compare correctly for gt/lt in `matches`.
            supportsDates: false,
            supportsBooleans: true,
            supportsJSON: true,
            supportsArrays: true,
            transaction: false,
        },
        adapter: () => ({
            async create({ model, data }) {
                const spec = specFor(model);
                const row = data as Row;
                const key = spec.key(row);
                const written: ItemKey[] = [];
                try {
                    for (const pointer of spec.pointers) {
                        if (!pointer.fields.every(f => row[f] !== undefined && row[f] !== null)) continue;
                        written.push(await writePointer(table, model, pointer, row, key));
                    }
                    const item: TableItem = { ...key, ...row, _ptrs: written };
                    if (!(await table.put(item, { ifNotExists: true }))) throw new DuplicateRecordError(model);
                } catch (e) {
                    if (written.length) await table.deleteMany(written);
                    throw e;
                }
                return data;
            },
            async findOne<T>({ model, where }: { model: string; where: CleanedWhere[] }) {
                const items = await candidates(table, model, where);
                const hit = items.map(stripInternal).find(r => matches(r, where));
                return (hit ?? null) as T | null;
            },
            async findMany<T>({ model, where, limit, offset, sortBy }: { model: string; where?: CleanedWhere[]; limit: number; offset?: number; sortBy?: { field: string; direction: 'asc' | 'desc' } }) {
                const clauses = where ?? [];
                let rows = (await candidates(table, model, clauses)).map(stripInternal).filter(r => matches(r, clauses));
                if (sortBy) {
                    const dir = sortBy.direction === 'desc' ? -1 : 1;
                    rows = [...rows].sort((a, b) => {
                        const x = a[sortBy.field] as string;
                        const y = b[sortBy.field] as string;
                        return x === y ? 0 : x > y ? dir : -dir;
                    });
                }
                return rows.slice(offset ?? 0, (offset ?? 0) + limit) as T[];
            },
            async count({ model, where }) {
                const clauses = where ?? [];
                return (await candidates(table, model, clauses)).filter(i => matches(stripInternal(i), clauses)).length;
            },
            async update<T>({ model, where, update }: { model: string; where: CleanedWhere[]; update: T }) {
                const items = (await candidates(table, model, where)).filter(i => matches(stripInternal(i), where));
                if (items.length === 0) return null;
                const next = await updateItem(table, model, items[0], where, update as Row);
                return (next ? stripInternal(next) : null) as T | null;
            },
            async updateMany({ model, where, update }) {
                const items = (await candidates(table, model, where)).filter(i => matches(stripInternal(i), where));
                let changed = 0;
                for (const item of items) if (await updateItem(table, model, item, where, update)) changed++;
                return changed;
            },
            async delete({ model, where }) {
                const items = (await candidates(table, model, where)).filter(i => matches(stripInternal(i), where));
                if (items[0]) await removeItem(table, items[0]);
            },
            async deleteMany({ model, where }) {
                const items = (await candidates(table, model, where)).filter(i => matches(stripInternal(i), where));
                let removed = 0;
                for (const item of items) if (await removeItem(table, item)) removed++;
                return removed;
            },
            async consumeOne<T>({ model, where }: { model: string; where: CleanedWhere[] }) {
                const items = (await candidates(table, model, where)).filter(i => matches(stripInternal(i), where));
                for (const item of items) {
                    const row = stripInternal(item);
                    if (await removeItem(table, item)) return row as T;
                }
                return null;
            },
        }),
    });
}
